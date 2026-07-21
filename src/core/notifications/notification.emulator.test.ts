// @vitest-environment node
//
// Pinned to node for the same reason as inventory-engine's
// stock.emulator.test.ts (see docs/phases/PHASE_1E_PLAN.md §10).
import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Exercises real Firestore reads/writes against the real emulator -- proves
// the notification round-trip (create -> list -> mark read) and the
// transactional variant actually persist against a real Firestore instance,
// not just that the mocked calls were made. Run via `npm run test:emulator`;
// skipped cleanly under plain `npm run test`.
const IS_EMULATOR = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

describe.skipIf(!IS_EMULATOR)("notifications (Firestore Emulator)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates, lists, and marks a single notification as read", async () => {
    const uid = `uid-${randomUUID()}`;
    const { createNotification, listNotifications, markAsRead } = await import("./notification.repository");

    await createNotification(uid, { title: "Welcome", body: "Glad to have you." });

    const unread = await listNotifications(uid);
    expect(unread).toHaveLength(1);
    expect(unread[0]).toMatchObject({ title: "Welcome", body: "Glad to have you.", read: false });

    await markAsRead(uid, unread[0].id);

    const afterRead = await listNotifications(uid);
    expect(afterRead[0].read).toBe(true);
  });

  it("filters to unread-only and supports marking every notification read at once", async () => {
    const uid = `uid-${randomUUID()}`;
    const { createNotification, listNotifications, markAllAsRead } = await import("./notification.repository");

    await createNotification(uid, { title: "One", body: "First" });
    await createNotification(uid, { title: "Two", body: "Second" });

    const unreadBefore = await listNotifications(uid, { unreadOnly: true });
    expect(unreadBefore).toHaveLength(2);

    await markAllAsRead(uid);

    const unreadAfter = await listNotifications(uid, { unreadOnly: true });
    expect(unreadAfter).toHaveLength(0);

    const all = await listNotifications(uid);
    expect(all.every((n) => n.read)).toBe(true);
  });

  it("createNotificationInTransaction commits atomically with the transaction it's part of", async () => {
    const uid = `uid-${randomUUID()}`;
    const { adminDb } = await import("@/lib/firebase/admin");
    const { createNotificationInTransaction } = await import("./notification.repository");
    const { listNotifications } = await import("./notification.repository");

    await adminDb.runTransaction(async (transaction) => {
      createNotificationInTransaction(transaction, uid, {
        title: "Role updated",
        body: "Your role is now Manager.",
        relatedEntity: { type: "membership", id: uid },
      });
    });

    const notifications = await listNotifications(uid);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      title: "Role updated",
      relatedEntity: { type: "membership", id: uid },
    });
  });

  it("a notification is scoped to its own user -- a different uid sees none of it", async () => {
    const uid = `uid-${randomUUID()}`;
    const otherUid = `uid-${randomUUID()}`;
    const { createNotification, listNotifications } = await import("./notification.repository");

    await createNotification(uid, { title: "Private", body: "Just for me" });

    await expect(listNotifications(otherUid)).resolves.toEqual([]);
  });

  it("paginates newest-first with a stable cursor, covering every notification exactly once", async () => {
    const uid = `uid-${randomUUID()}`;
    const { createNotification, listNotificationsPage } = await import("./notification.repository");

    for (let i = 0; i < 5; i++) {
      await createNotification(uid, { title: `Notification ${i}`, body: "..." });
    }

    const page1 = await listNotificationsPage(uid, { limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await listNotificationsPage(uid, { limit: 2, cursor: page1.nextCursor! });
    expect(page2.items).toHaveLength(2);
    expect(page2.nextCursor).not.toBeNull();

    const page3 = await listNotificationsPage(uid, { limit: 2, cursor: page2.nextCursor! });
    expect(page3.items).toHaveLength(1);
    expect(page3.nextCursor).toBeNull();

    const seenIds = [...page1.items, ...page2.items, ...page3.items].map((n) => n.id);
    expect(new Set(seenIds).size).toBe(5);
  });

  it("paginates the unread-only filter too, server-side filtered and ordered", async () => {
    const uid = `uid-${randomUUID()}`;
    const { createNotification, markAsRead, listNotifications, listNotificationsPage } = await import(
      "./notification.repository"
    );

    for (let i = 0; i < 4; i++) {
      await createNotification(uid, { title: `Notification ${i}`, body: "..." });
    }
    const [firstUnread] = await listNotifications(uid, { unreadOnly: true });
    await markAsRead(uid, firstUnread.id);

    const page = await listNotificationsPage(uid, { unreadOnly: true, limit: 10 });
    expect(page.items).toHaveLength(3);
    expect(page.items.every((n) => !n.read)).toBe(true);
  });

  it(
    "markAllAsRead marks every notification read even when there are more than 500 (chunked batches)",
    async () => {
      const uid = `uid-${randomUUID()}`;
      const { adminDb } = await import("@/lib/firebase/admin");
      const { FieldValue } = await import("firebase-admin/firestore");
      const { markAllAsRead, listNotifications } = await import("./notification.repository");

      // Seeded directly via chunked batched writes rather than 600
      // individual createNotification() calls -- creation isn't under test
      // here, only that markAllAsRead correctly marks all of them read
      // despite exceeding a single Firestore WriteBatch's 500-operation cap.
      const COUNT = 600;
      const notificationsRef = adminDb.collection("users").doc(uid).collection("notifications");
      const refs = Array.from({ length: COUNT }, () => notificationsRef.doc());
      for (let i = 0; i < refs.length; i += 500) {
        const batch = adminDb.batch();
        refs.slice(i, i + 500).forEach((ref) => {
          batch.set(ref, { title: "x", body: "y", channel: "in-app", readAt: null, createdAt: FieldValue.serverTimestamp() });
        });
        await batch.commit();
      }

      await markAllAsRead(uid);

      const all = await listNotifications(uid);
      expect(all).toHaveLength(COUNT);
      expect(all.every((n) => n.read)).toBe(true);
    },
    30000,
  );
});
