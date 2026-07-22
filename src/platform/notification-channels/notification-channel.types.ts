// Platform's own capability, never added to core/roles-permissions -- same
// reasoning as ConnectorCapability (docs/phases/PHASE_2_PLAN.md §8):
// "which notification channels are connected" is a commercial/config
// concern Core must never know exists.
export type NotificationChannelCapability = "notificationChannels.manage";

export type NotificationChannelAuditAction =
  | "notificationChannel.connected"
  | "notificationChannel.disconnected"
  | "notificationChannel.synced";

export type WhatsAppChannelStatus = "connected" | "disconnected";

// companies/{companyId}/notificationChannels/whatsapp -- connection state
// only, same shape as a Connector's own connection doc (Phase 2/5).
// Credentials are never stored here, only an opaque credentialRef -- see
// docs/DATABASE.md §5. toPhoneNumber is the ONE company-wide WhatsApp
// destination every mirrored notification is sent to (see
// docs/phases/PHASE_6_PLAN.md §5 for why this is not a per-recipient
// preference).
export type WhatsAppChannelConnection = {
  status: WhatsAppChannelStatus;
  lastSyncAt?: string;
  credentialRef?: string;
  config?: { phoneNumberId: string; toPhoneNumber: string };
};
