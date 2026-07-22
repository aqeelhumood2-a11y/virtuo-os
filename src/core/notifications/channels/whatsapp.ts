import "server-only";

// A second NotificationChannel implementation (Phase 6), exactly the shape
// channels/in-app.ts's own header comment anticipated: "a future
// email/SMS/WhatsApp channel would implement the same two-function shape
// ... against its own delivery mechanism instead of Firestore." Real
// adapter against Meta's WhatsApp Cloud API -- pure network I/O, no
// Firestore, no Platform import. Config/credential are supplied by the
// caller (platform/notification-channels resolves them); this function
// never resolves anything itself, the same "pure adapter, caller owns
// state" boundary Phase 5's Connectors established. See
// docs/phases/PHASE_6_PLAN.md §5 for why this is NOT wired directly into
// createNotification/createNotificationInTransaction (Core must not
// import Platform to resolve a company's WhatsApp connection).
const API_VERSION = "v20.0";

export type WhatsAppChannelConfig = {
  phoneNumberId: string;
  accessToken: string;
  toPhoneNumber: string;
};

export class WhatsAppSendError extends Error {
  constructor(reason: string) {
    super(`WhatsApp message send failed: ${reason}`);
    this.name = "WhatsAppSendError";
  }
}

export async function sendWhatsAppMessage(config: WhatsAppChannelConfig, message: string): Promise<void> {
  const response = await fetch(`https://graph.facebook.com/${API_VERSION}/${config.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: config.toPhoneNumber,
      type: "text",
      text: { body: message },
    }),
  }).catch((error: unknown) => {
    throw new WhatsAppSendError(error instanceof Error ? error.message : "network error");
  });

  if (!response.ok) {
    throw new WhatsAppSendError(`${response.status} ${response.statusText}`);
  }
}

// Validates a phone-number-id/access-token pair against Meta's own API
// (fetching the phone number's own metadata) -- the same "validate by a
// real, harmless API call" pattern Phase 5's connectors use for connect().
export async function verifyWhatsAppCredential(phoneNumberId: string, accessToken: string): Promise<void> {
  const response = await fetch(`https://graph.facebook.com/${API_VERSION}/${phoneNumberId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch((error: unknown) => {
    throw new WhatsAppSendError(error instanceof Error ? error.message : "network error");
  });

  if (!response.ok) {
    throw new WhatsAppSendError(`${response.status} ${response.statusText}`);
  }
}
