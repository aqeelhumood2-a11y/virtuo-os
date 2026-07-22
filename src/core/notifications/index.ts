export {
  createNotification,
  createNotificationInTransaction,
  listNotifications,
  listNotificationsPage,
  markAllAsRead,
  markAsRead,
} from "./notification.repository";
export type { CreateNotificationInput, Notification, NotificationChannel, RelatedEntity } from "./notification.types";

// Phase 6: a second channel implementation, exported as a plain utility --
// see channels/whatsapp.ts's header comment for why nothing in Core calls
// this automatically.
export { sendWhatsAppMessage, verifyWhatsAppCredential, WhatsAppSendError } from "./channels/whatsapp";
export type { WhatsAppChannelConfig } from "./channels/whatsapp";
