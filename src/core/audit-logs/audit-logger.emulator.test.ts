// @vitest-environment node
//
// Pinned to node for the same reason as inventory-engine's
// stock.emulator.test.ts (see docs/phases/PHASE_1E_PLAN.md §10): this file
// does real Firestore transactions, and the project's default jsdom
// environment was found to break their conflict-detection timing.
import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Exercises real Firestore transactions against the real emulator -- a mock
// structurally cannot prove that a mutation and its audit log entry commit
// (or roll back) together, only that both calls were made. Run via
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

async function seedCompanyAndMember(
  companyId: string,
  uid: string,
  role: "Owner" | "Manager" | "Employee",
) {
  const { adminDb } = await import("@/lib/firebase/admin");
  await adminDb.collection("companies").doc(companyId).set({ name: "Acme", ownerId: uid, status: "active" });
  await adminDb
    .collection("companies")
    .doc(companyId)
    .collection("memberships")
    .doc(uid)
    .set({ uid, role, branchIds: [], status: "active" });
}

describe.skipIf(!IS_EMULATOR)("audit-logs (Firestore Emulator)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("writes the audit log entry atomically with the mutation it records", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    await seedCompanyAndMember(companyId, uid, "Owner");
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });

    const { updateCompanyName } = await import("../companies/company");
    const { listAuditLogs } = await import("./audit-logger");
    const { adminDb } = await import("@/lib/firebase/admin");

    await updateCompanyName(companyId, "New Name");

    const companySnap = await adminDb.collection("companies").doc(companyId).get();
    expect(companySnap.data()?.name).toBe("New Name");

    const logs = await listAuditLogs(companyId);
    const entry = logs.find((log) => log.action === "company.updated");
    expect(entry).toBeDefined();
    expect(entry?.actorId).toBe(uid);
    expect(entry?.before).toEqual({ name: "Acme" });
    expect(entry?.after).toEqual({ name: "New Name" });
  });

  it("rolls back the whole transaction, including the audit entry, when the mutation fails", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    await seedCompanyAndMember(companyId, uid, "Owner");
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });

    const { updateCompanyName } = await import("../companies/company");
    const { listAuditLogs } = await import("./audit-logger");
    const { adminDb } = await import("@/lib/firebase/admin");

    // Delete the company doc after the membership/session are seeded, so
    // updateCompanyName's transaction reads a missing doc and throws before
    // its transaction.update()/writeAuditInTransaction() calls ever commit.
    await adminDb.collection("companies").doc(companyId).delete();

    await expect(updateCompanyName(companyId, "New Name")).rejects.toThrow(/not found/i);

    const logs = await listAuditLogs(companyId);
    expect(logs).toHaveLength(0);
  });

  it("gates listAuditLogs behind audit.view -- Owner/Manager can read, Employee cannot", async () => {
    const ownerCompanyId = `company-${randomUUID()}`;
    const ownerUid = `uid-${randomUUID()}`;
    await seedCompanyAndMember(ownerCompanyId, ownerUid, "Owner");
    requireSessionMock.mockResolvedValue({ uid: ownerUid, email: null, superAdmin: false });

    const { updateCompanyName } = await import("../companies/company");
    const { listAuditLogs } = await import("./audit-logger");
    await updateCompanyName(ownerCompanyId, "Renamed");
    await expect(listAuditLogs(ownerCompanyId)).resolves.not.toHaveLength(0);

    const employeeCompanyId = `company-${randomUUID()}`;
    const employeeUid = `uid-${randomUUID()}`;
    await seedCompanyAndMember(employeeCompanyId, employeeUid, "Employee");
    requireSessionMock.mockResolvedValue({ uid: employeeUid, email: null, superAdmin: false });

    await expect(listAuditLogs(employeeCompanyId)).rejects.toThrow("REDIRECT:/account");
  });
});
