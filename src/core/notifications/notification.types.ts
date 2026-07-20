// Only "in-app" is implemented (1G) -- email/SMS/WhatsApp are additive
// later, same interface (ARCHITECTURE.md §4).
export type NotificationChannel = "in-app";

export type RelatedEntity = {
  type: string;
  id: string;
};

export type Notification = {
  id: string;
  title: string;
  body: string;
  channel: NotificationChannel;
  read: boolean;
  relatedEntity?: RelatedEntity;
};

export type CreateNotificationInput = {
  title: string;
  body: string;
  relatedEntity?: RelatedEntity;
};
