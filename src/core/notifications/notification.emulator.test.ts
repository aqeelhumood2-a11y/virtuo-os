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
});
