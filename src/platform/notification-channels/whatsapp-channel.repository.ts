import "server-only";

import type { DocumentData } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";

import type { WhatsAppChannelConnection } from "./notification-channel.types";

function channelsCollection(companyId: string) {
  return adminDb.collection("companies").doc(companyId).collection("notificationChannels");
}

export function whatsAppChannelDoc(companyId: string) {
  return channelsCollection(companyId).doc("whatsapp");
}

// One cursor per company admin (Owner/Manager) synced to WhatsApp -- each
// admin's own notification inbox is scanned independently, the same
// per-scan-target cursor granularity as Core's own per-branch/per-App
// bookkeeping elsewhere. See whatsapp-channel.service.ts's syncWhatsAppNotifications.
function cursorDoc(companyId: string, uid: string) {
  return whatsAppChannelDoc(companyId).collection("cursors").doc(uid);
}

function toConnection(data: DocumentData): WhatsAppChannelConnection {
  return {
    status: data.status,
    lastSyncAt: data.lastSyncAt ?? undefined,
    credentialRef: data.credentialRef ?? undefined,
    config: data.config ?? undefined,
  };
}

export async function getWhatsAppChannel(companyId: string): Promise<WhatsAppChannelConnection | null> {
  const snap = await whatsAppChannelDoc(companyId).get();
  if (!snap.exists) return null;
  return toConnection(snap.data()!);
}

export async function getSyncCursor(companyId: string, uid: string): Promise<string | null> {
  const snap = await cursorDoc(companyId, uid).get();
  if (!snap.exists) return null;
  return snap.data()?.lastNotificationId ?? null;
}

export async function setSyncCursor(companyId: string, uid: string, lastNotificationId: string): Promise<void> {
  await cursorDoc(companyId, uid).set({ lastNotificationId }, { merge: true });
}
