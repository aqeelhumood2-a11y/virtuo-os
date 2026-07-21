import "server-only";

import { FieldValue, type DocumentData, type Transaction } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import { applyCursor, DEFAULT_PAGE_SIZE } from "@/lib/firebase/pagination";
import type { Page, PageOptions } from "@/shared/types";

import { notificationsCollection, sendInApp, sendInAppInTransaction } from "./channels/in-app";
import type { CreateNotificationInput, Notification } from "./notification.types";

// Firestore's hard cap on operations in a single WriteBatch. Not a tunable
// constant -- this is the platform limit itself (see markAllAsRead below).
const MAX_BATCH_SIZE = 500;

// Thin dispatch to the one channel implemented so far -- callers never
// touch channels/in-app.ts directly, so adding a second channel later
// (email/SMS/WhatsApp) doesn't change any call site here.
export async function createNotification(uid: string, input: CreateNotificationInput): Promise<void> {
  await sendInApp(uid, input);
}

export function createNotificationInTransaction(
  transaction: Transaction,
  uid: string,
  input: CreateNotificationInput,
): void {
  sendInAppInTransaction(transaction, uid, input);
}

function toNotification(id: string, data: DocumentData): Notification {
  return {
    id,
    title: data.title,
    body: data.body,
    channel: data.channel,
    read: data.readAt != null,
    relatedEntity: data.relatedEntity ?? undefined,
  };
}

// No session/capability check here -- same as core/users/profile.ts's
// getUserProfile(uid), this takes uid as a plain trusted parameter. The
// caller (a future Server Action reading the caller's own session) is
// responsible for ensuring uid is the actor's own. Unpaginated and
// unordered, kept exactly as-is (existing callers, existing behavior) now
// that listNotificationsPage() below exists for anything that needs
// bounded, ordered reads.
export async function listNotifications(uid: string, opts?: { unreadOnly?: boolean }): Promise<Notification[]> {
  const query = opts?.unreadOnly
    ? notificationsCollection(uid).where("readAt", "==", null)
    : notificationsCollection(uid);
  const snap = await query.get();
  return snap.docs.map((doc) => toNotification(doc.id, doc.data()));
}

// The pagination-ready read entry point, added ahead of any real UI so the
// eventual notification bell/inbox never needs a breaking API change --
// same cursor convention as core/audit-logs' listAuditLogsPage (newest
// first, `limit`/`cursor` bound the page, cursor is the last item's own doc
// ID resolved back to a DocumentSnapshot for Query.startAfter()).
export async function listNotificationsPage(
  uid: string,
  opts: PageOptions & { unreadOnly?: boolean } = {},
): Promise<Page<Notification>> {
  const limit = opts.limit ?? DEFAULT_PAGE_SIZE;

  const collectionRef = notificationsCollection(uid);
  const baseQuery = opts.unreadOnly
    ? collectionRef.where("readAt", "==", null).orderBy("createdAt", "desc").limit(limit)
    : collectionRef.orderBy("createdAt", "desc").limit(limit);
  const query = await applyCursor(collectionRef, baseQuery, opts.cursor);

  const snap = await query.get();
  const items = snap.docs.map((doc) => toNotification(doc.id, doc.data()));
  const nextCursor = snap.docs.length === limit ? snap.docs[snap.docs.length - 1].id : null;
  return { items, nextCursor };
}

export async function markAsRead(uid: string, notificationId: string): Promise<void> {
  await notificationsCollection(uid).doc(notificationId).update({ readAt: FieldValue.serverTimestamp() });
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

// Firestore rejects a WriteBatch beyond 500 operations, so a user with more
// than 500 unread notifications would previously fail this call entirely.
// Splits into as many <=500-op batches as needed and commits them
// concurrently (each chunk touches a disjoint set of docs, so there's no
// write conflict between them) -- external signature and behavior for any
// caller under the old limit are unchanged.
export async function markAllAsRead(uid: string): Promise<void> {
  const snap = await notificationsCollection(uid).where("readAt", "==", null).get();
  if (snap.empty) return;

  const now = FieldValue.serverTimestamp();
  await Promise.all(
    chunk(snap.docs, MAX_BATCH_SIZE).map((docsChunk) => {
      const batch = adminDb.batch();
      docsChunk.forEach((doc) => batch.update(doc.ref, { readAt: now }));
      return batch.commit();
    }),
  );
}
