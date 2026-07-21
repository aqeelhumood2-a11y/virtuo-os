// @vitest-environment node
//
// Pinned to node for the same reason as inventory-engine's
// stock.emulator.test.ts (see docs/phases/PHASE_1E_PLAN.md §10).
import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

async function seedCompanyAndMember(companyId: string, uid: string, role: "Owner" | "Employee") {
  const { adminDb } = await import("@/lib/firebase/admin");
  await adminDb.collection("companies").doc(companyId).set({ name: "Acme", ownerId: uid, status: "active" });
  await adminDb
    .collection("companies")
    .doc(companyId)
    .collection("memberships")
    .doc(uid)
    .set({ uid, role, branchIds: [], status: "active" });
}

describe.skipIf(!IS_EMULATOR)("core/companies/company-settings (branding) (Firestore Emulator)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("round-trips branding and writes a company.brandingUpdated audit entry", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    await seedCompanyAndMember(companyId, uid, "Owner");
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });

    const { getCompanyBranding, updateCompanyBranding } = await import("./company-settings");

    await expect(getCompanyBranding(companyId)).resolves.toEqual({});

    await updateCompanyBranding(companyId, { logoUrl: "https://x.test/logo.png", primaryColor: "#336699" });

    await expect(getCompanyBranding(companyId)).resolves.toEqual({
      logoUrl: "https://x.test/logo.png",
      primaryColor: "#336699",
    });

    const { listAuditLogs } = await import("@/core/audit-logs");
    const logs = await listAuditLogs(companyId);
    const entry = logs.find((log) => log.action === "company.brandingUpdated");
    expect(entry).toBeDefined();
    expect(entry?.targetType).toBe("companySettings");
    expect(entry?.after).toEqual({ logoUrl: "https://x.test/logo.png", primaryColor: "#336699" });
  });

  it("denies updateCompanyBranding to a non-Owner/Manager member", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    await seedCompanyAndMember(companyId, uid, "Employee");
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });

    const { updateCompanyBranding } = await import("./company-settings");

    await expect(updateCompanyBranding(companyId, { primaryColor: "#000000" })).rejects.toThrow("REDIRECT:/account");
  });
});
