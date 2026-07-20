import "server-only";

import { FieldValue, type DocumentData, type Transaction } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";

import { notificationsCollection, sendInApp, sendInAppInTransaction } from "./channels/in-app";
import type { CreateNotificationInput, Notification } from "./notification.types";

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
// responsible for ensuring uid is the actor's own.
export async function listNotifications(uid: string, opts?: { unreadOnly?: boolean }): Promise<Notification[]> {
  const query = opts?.unreadOnly
    ? notificationsCollection(uid).where("readAt", "==", null)
    : notificationsCollection(uid);
  const snap = await query.get();
  return snap.docs.map((doc) => toNotification(doc.id, doc.data()));
}

export async function markAsRead(uid: string, notificationId: string): Promise<void> {
  await notificationsCollection(uid).doc(notificationId).update({ readAt: FieldValue.serverTimestamp() });
}

export async function markAllAsRead(uid: string): Promise<void> {
  const snap = await notificationsCollection(uid).where("readAt", "==", null).get();
  if (snap.empty) return;

  const batch = adminDb.batch();
  const now = FieldValue.serverTimestamp();
  snap.docs.forEach((doc) => batch.update(doc.ref, { readAt: now }));
  await batch.commit();
}
