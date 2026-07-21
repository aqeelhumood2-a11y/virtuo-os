// @vitest-environment node
//
// Pinned to node for the same reason as inventory-engine's
// stock.emulator.test.ts (see docs/phases/PHASE_1E_PLAN.md §10): this file
// does real Firestore transactions, and the project's default jsdom
// environment was found to break their conflict-detection timing.
import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Exercises real Firestore transactions against the real emulator -- a mock
// structurally cannot prove that the install/uninstall write, its audit
// entry, and its notifications commit (or roll back) together. Run via
// `npm run test:emulator`; skipped cleanly under plain `npm run test`.
const IS_EMULATOR = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

const requireSessionMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("@/core/auth/session", () => ({
  requireSession: () => requireSessionMock(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

async function seedCompanyAndLicense(
  companyId: string,
  ownerUid: string,
  entitledApps: string[] = [],
) {
  const { adminDb } = await import("@/lib/firebase/admin");
  await adminDb.collection("companies").doc(companyId).set({ name: "Acme", ownerId: ownerUid, status: "active" });
  await adminDb
    .collection("companies")
    .doc(companyId)
    .collection("memberships")
    .doc(ownerUid)
    .set({ uid: ownerUid, role: "Owner", branchIds: [], status: "active" });
  await adminDb.collection("companies").doc(companyId).collection("licenses").doc("default").set({
    plan: "pro",
    entitledApps,
    entitledConnectors: [],
    seats: 5,
    renewsAt: null,
  });
}

async function addMember(companyId: string, uid: string, role: "Manager" | "Employee") {
  const { adminDb } = await import("@/lib/firebase/admin");
  await adminDb
    .collection("companies")
    .doc(companyId)
    .collection("memberships")
    .doc(uid)
    .set({ uid, role, branchIds: [], status: "active" });
}

describe.skipIf(!IS_EMULATOR)("platform/app-installs (Firestore Emulator)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("installs an app atomically with its audit entry, notifying other admins but never the actor", async () => {
    const companyId = `company-${randomUUID()}`;
    const ownerUid = `uid-${randomUUID()}`;
    const managerUid = `uid-${randomUUID()}`;
    const employeeUid = `uid-${randomUUID()}`;
    await seedCompanyAndLicense(companyId, ownerUid, ["restaurant"]);
    await addMember(companyId, managerUid, "Manager");
    await addMember(companyId, employeeUid, "Employee");

    const { registerApp } = await import("@/app-registry");
    registerApp({ id: "restaurant", displayName: "Restaurant" });

    requireSessionMock.mockResolvedValue({ uid: ownerUid, email: null, superAdmin: false });

    const { installApp } = await import("./app-install.service");
    const { isAppInstalled } = await import("./app-install.repository");
    await installApp(companyId, "restaurant");

    await expect(isAppInstalled(companyId, "restaurant")).resolves.toBe(true);

    const { listAuditLogs } = await import("@/core/audit-logs");
    const logs = await listAuditLogs(companyId);
    const entry = logs.find((log) => log.action === "app.installed");
    expect(entry).toBeDefined();
    expect(entry?.actorId).toBe(ownerUid);
    expect(entry?.targetType).toBe("app");
    expect(entry?.targetId).toBe("restaurant");

    const { listNotifications } = await import("@/core/notifications");
    await expect(listNotifications(managerUid)).resolves.not.toHaveLength(0);
    await expect(listNotifications(employeeUid)).resolves.toHaveLength(0);
    await expect(listNotifications(ownerUid)).resolves.toHaveLength(0);
  });

  it("throws AppNotEntitledError and writes nothing when the plan doesn't include the app", async () => {
    const companyId = `company-${randomUUID()}`;
    const ownerUid = `uid-${randomUUID()}`;
    await seedCompanyAndLicense(companyId, ownerUid, []);
    requireSessionMock.mockResolvedValue({ uid: ownerUid, email: null, superAdmin: false });

    const { registerApp } = await import("@/app-registry");
    registerApp({ id: "retail", displayName: "Retail" });

    const { installApp, AppNotEntitledError } = await import("./app-install.service");
    const { isAppInstalled } = await import("./app-install.repository");

    await expect(installApp(companyId, "retail")).rejects.toThrow(AppNotEntitledError);
    await expect(isAppInstalled(companyId, "retail")).resolves.toBe(false);

    const { listAuditLogs } = await import("@/core/audit-logs");
    await expect(listAuditLogs(companyId)).resolves.toEqual([]);
  });

  it("uninstalls an app, writing an app.uninstalled entry", async () => {
    const companyId = `company-${randomUUID()}`;
    const ownerUid = `uid-${randomUUID()}`;
    await seedCompanyAndLicense(companyId, ownerUid, ["restaurant"]);
    requireSessionMock.mockResolvedValue({ uid: ownerUid, email: null, superAdmin: false });

    const { registerApp } = await import("@/app-registry");
    registerApp({ id: "restaurant", displayName: "Restaurant" });

    const { installApp, uninstallApp } = await import("./app-install.service");
    const { isAppInstalled } = await import("./app-install.repository");

    await installApp(companyId, "restaurant");
    await uninstallApp(companyId, "restaurant");

    await expect(isAppInstalled(companyId, "restaurant")).resolves.toBe(false);

    const { listAuditLogs } = await import("@/core/audit-logs");
    const logs = await listAuditLogs(companyId);
    expect(logs.some((log) => log.action === "app.uninstalled")).toBe(true);
  });

  it("forceToggleApp bypasses entitlement entirely for a Super Admin", async () => {
    const companyId = `company-${randomUUID()}`;
    const ownerUid = `uid-${randomUUID()}`;
    const adminUid = `uid-${randomUUID()}`;
    await seedCompanyAndLicense(companyId, ownerUid, []); // not entitled to anything

    const { registerApp } = await import("@/app-registry");
    registerApp({ id: "warehouse", displayName: "Warehouse" });

    requireSessionMock.mockResolvedValue({ uid: adminUid, email: null, superAdmin: true });

    const { forceToggleApp } = await import("./app-install.service");
    const { isAppInstalled } = await import("./app-install.repository");

    await forceToggleApp(companyId, "warehouse", true);
    await expect(isAppInstalled(companyId, "warehouse")).resolves.toBe(true);

    const { listAuditLogs } = await import("@/core/audit-logs");
    requireSessionMock.mockResolvedValue({ uid: ownerUid, email: null, superAdmin: false });
    const logs = await listAuditLogs(companyId);
    const entry = logs.find((log) => log.action === "app.forceToggled");
    expect(entry?.actorId).toBe(adminUid);
  });

  it("rejects a non-Super-Admin caller of forceToggleApp", async () => {
    const companyId = `company-${randomUUID()}`;
    const ownerUid = `uid-${randomUUID()}`;
    await seedCompanyAndLicense(companyId, ownerUid, []);
    requireSessionMock.mockResolvedValue({ uid: ownerUid, email: null, superAdmin: false });

    const { forceToggleApp } = await import("./app-install.service");

    await expect(forceToggleApp(companyId, "warehouse", true)).rejects.toThrow("REDIRECT:/account");
  });
});
