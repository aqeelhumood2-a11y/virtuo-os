import "server-only";

import { FieldValue, type Transaction } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import { writeAuditInTransaction } from "@/core/audit-logs";
import { listCompanyMembers } from "@/core/companies/membership";
import { listNotificationsPage, sendWhatsAppMessage, verifyWhatsAppCredential } from "@/core/notifications";
import type { Notification } from "@/core/notifications";

import { deleteConnectorCredential, resolveConnectorCredential, storeConnectorCredential } from "../secrets";
import { requirePlatformCapability } from "../shared/require-platform-capability";

import { getSyncCursor, getWhatsAppChannel, setSyncCursor, whatsAppChannelDoc } from "./whatsapp-channel.repository";
import type { NotificationChannelAuditAction } from "./notification-channel.types";

// platform/secrets' storeConnectorCredential/resolveConnectorCredential/
// deleteConnectorCredential are named around Connectors (Phase 5) but are
// mechanically generic -- "store a secret for {companyId, some string id}"
// -- so they're reused here as-is for the WhatsApp connection's access
// token rather than duplicating that module for one more caller. The
// GCP-side secret is simply named connector-{companyId}-whatsapp; this is
// an internal resource name, not a claim that WhatsApp is a Connector.
const CHANNEL_ID = "whatsapp";

export class WhatsAppChannelNotConnectedError extends Error {
  constructor() {
    super("The WhatsApp channel is not connected for this company.");
    this.name = "WhatsAppChannelNotConnectedError";
  }
}

export type ConnectWhatsAppChannelInput = {
  phoneNumberId: string;
  accessToken: string;
  toPhoneNumber: string;
};

export async function connectWhatsAppChannel(companyId: string, input: ConnectWhatsAppChannelInput): Promise<void> {
  const { session } = await requirePlatformCapability(companyId, "notificationChannels.manage");

  await verifyWhatsAppCredential(input.phoneNumberId, input.accessToken);
  const credentialRef = await storeConnectorCredential(companyId, CHANNEL_ID, input.accessToken);

  const ref = whatsAppChannelDoc(companyId);
  await adminDb.runTransaction(async (transaction: Transaction) => {
    const snap = await transaction.get(ref);
    const before = { status: snap.exists ? (snap.data()?.status ?? "disconnected") : "disconnected" };

    transaction.set(
      ref,
      {
        status: "connected",
        credentialRef,
        config: { phoneNumberId: input.phoneNumberId, toPhoneNumber: input.toPhoneNumber },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    writeAuditInTransaction<NotificationChannelAuditAction, "notificationChannel">(transaction, {
      companyId,
      actorId: session.uid,
      action: "notificationChannel.connected",
      targetType: "notificationChannel",
      targetId: CHANNEL_ID,
      before,
      after: { status: "connected" },
    });
  });
}

export async function disconnectWhatsAppChannel(companyId: string): Promise<void> {
  const { session } = await requirePlatformCapability(companyId, "notificationChannels.manage");

  const ref = whatsAppChannelDoc(companyId);
  let hadCredential = false;
  await adminDb.runTransaction(async (transaction: Transaction) => {
    const snap = await transaction.get(ref);
    const before = { status: snap.exists ? (snap.data()?.status ?? "disconnected") : "disconnected" };
    hadCredential = snap.exists && Boolean(snap.data()?.credentialRef);

    transaction.set(
      ref,
      { status: "disconnected", credentialRef: null, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );

    writeAuditInTransaction<NotificationChannelAuditAction, "notificationChannel">(transaction, {
      companyId,
      actorId: session.uid,
      action: "notificationChannel.disconnected",
      targetType: "notificationChannel",
      targetId: CHANNEL_ID,
      before,
      after: { status: "disconnected" },
    });
  });

  if (hadCredential) {
    await deleteConnectorCredential(companyId, CHANNEL_ID);
  }
}

// Bounded by Firestore's own page size per admin scanned; unbounded in
// count of pages walked, same "walk backward until the stored cursor (or
// exhaust on first run)" precedent as Loyalty's syncAccruals -- see
// docs/phases/PHASE_4_2_PLAN.md §7 and docs/phases/PHASE_6_PLAN.md §5.
const PAGE_SIZE = 50;

async function collectNewNotificationsSinceCursor(uid: string, cursorId: string | null): Promise<Notification[]> {
  const collected: Notification[] = [];
  let pageCursor: string | undefined;
  let reachedStoredCursor = false;

  do {
    const page = await listNotificationsPage(uid, { cursor: pageCursor, limit: PAGE_SIZE });
    for (const item of page.items) {
      if (item.id === cursorId) {
        reachedStoredCursor = true;
        break;
      }
      collected.push(item);
    }
    pageCursor = page.nextCursor ?? undefined;
  } while (pageCursor && !reachedStoredCursor);

  return collected;
}

export type WhatsAppSyncSummary = {
  syncedAt: string;
  messagesSent: number;
};

// Lazy/on-demand only -- no Cloud Function, scheduler, or background
// worker, the same standing decision every prior phase made. Mirrors each
// company admin's (Owner/Manager) own notification inbox to the one
// configured WhatsApp destination number -- not a per-recipient
// preference, see notification-channel.types.ts. A send failure for one
// notification does not abort the rest (same per-entry-skip precedent as
// Loyalty's BranchAccessDeniedError handling).
export async function syncWhatsAppNotifications(companyId: string): Promise<WhatsAppSyncSummary> {
  const { session } = await requirePlatformCapability(companyId, "notificationChannels.manage");

  const connection = await getWhatsAppChannel(companyId);
  if (!connection || connection.status !== "connected" || !connection.credentialRef || !connection.config) {
    throw new WhatsAppChannelNotConnectedError();
  }

  const accessToken = await resolveConnectorCredential(connection.credentialRef);
  const channelConfig = {
    phoneNumberId: connection.config.phoneNumberId,
    accessToken,
    toPhoneNumber: connection.config.toPhoneNumber,
  };

  const members = await listCompanyMembers(companyId);
  const admins = members.filter((member) => member.role === "Owner" || member.role === "Manager");

  let messagesSent = 0;
  for (const admin of admins) {
    const cursor = await getSyncCursor(companyId, admin.uid);
    const newest = await collectNewNotificationsSinceCursor(admin.uid, cursor);
    if (newest.length === 0) continue;

    for (const notification of [...newest].reverse()) {
      try {
        await sendWhatsAppMessage(channelConfig, `${notification.title}: ${notification.body}`);
        messagesSent += 1;
      } catch {
        // best-effort -- continue with the rest of this admin's
        // notifications and every other admin, same precedent as Phase 5's
        // per-order failure isolation.
      }
    }

    await setSyncCursor(companyId, admin.uid, newest[0].id);
  }

  const syncedAt = new Date().toISOString();
  await adminDb.runTransaction(async (transaction: Transaction) => {
    transaction.set(whatsAppChannelDoc(companyId), { lastSyncAt: syncedAt, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

    writeAuditInTransaction<NotificationChannelAuditAction, "notificationChannel">(transaction, {
      companyId,
      actorId: session.uid,
      action: "notificationChannel.synced",
      targetType: "notificationChannel",
      targetId: CHANNEL_ID,
      after: { messagesSent },
    });
  });

  return { syncedAt, messagesSent };
}
