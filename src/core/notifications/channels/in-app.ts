import "server-only";

import { FieldValue, type Transaction } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";

import type { CreateNotificationInput } from "../notification.types";

export function notificationsCollection(uid: string) {
  return adminDb.collection("users").doc(uid).collection("notifications");
}

function notificationDoc(input: CreateNotificationInput) {
  return {
    title: input.title,
    body: input.body,
    channel: "in-app" as const,
    readAt: null,
    relatedEntity: input.relatedEntity ?? null,
    createdAt: FieldValue.serverTimestamp(),
  };
}

// Only channel implementation so far -- "sending" an in-app notification is
// just persisting it; a future email/SMS/WhatsApp channel would implement
// the same two-function shape (transactional + standalone) against its own
// delivery mechanism instead of Firestore.
export function sendInAppInTransaction(transaction: Transaction, uid: string, input: CreateNotificationInput): void {
  const ref = notificationsCollection(uid).doc();
  transaction.set(ref, notificationDoc(input));
}

export async function sendInApp(uid: string, input: CreateNotificationInput): Promise<void> {
  await notificationsCollection(uid).doc().set(notificationDoc(input));
}
