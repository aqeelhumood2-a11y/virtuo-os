import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

// These tests exercise the real onboarding transaction against the real
// Firestore Emulator -- a multi-document transaction's retry/contention
// behavior is exactly the kind of thing hand-written mocks can't be
// trusted to model realistically (see docs/phases/PHASE_1C_PLAN.md §8).
// Run via `npm run test:emulator`; skipped cleanly under plain
// `npm run test` when no emulator is running.
const IS_EMULATOR = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

describe.skipIf(!IS_EMULATOR)("runOnboardingTransaction (Firestore Emulator)", () => {
  it("creates the user, company, default branch, and Owner membership atomically", async () => {
    const { adminDb } = await import("@/lib/firebase/admin");
    const { runOnboardingTransaction } = await import("./onboarding");

    const uid = `test-uid-${randomUUID()}`;
    const email = `${uid}@example.com`;

    const result = await runOnboardingTransaction({ uid, email, companyName: "Acme" });

    const userSnap = await adminDb.collection("users").doc(uid).get();
    expect(userSnap.exists).toBe(true);
    expect(userSnap.data()?.onboardedAt).toBeTruthy();
    expect(userSnap.data()?.email).toBe(email);
    expect(userSnap.data()?.status).toBe("active");

    const companySnap = await adminDb.collection("companies").doc(result.companyId).get();
    expect(companySnap.exists).toBe(true);
    expect(companySnap.data()).toMatchObject({ name: "Acme", ownerId: uid, status: "active" });

    const branchSnap = await adminDb
      .collection("companies")
      .doc(result.companyId)
      .collection("branches")
      .doc(result.branchId)
      .get();
    expect(branchSnap.exists).toBe(true);
    expect(branchSnap.data()).toMatchObject({ name: "Main", isActive: true, isDefault: true });

    const membershipSnap = await adminDb
      .collection("companies")
      .doc(result.companyId)
      .collection("memberships")
      .doc(uid)
      .get();
    expect(membershipSnap.exists).toBe(true);
    expect(membershipSnap.data()).toMatchObject({
      uid,
      role: "Owner",
      branchIds: [],
      status: "active",
    });
  });

  it("rejects a second onboarding attempt for the same uid (duplicate onboarding)", async () => {
    const { runOnboardingTransaction, AlreadyOnboardedError } = await import("./onboarding");
    const uid = `test-uid-${randomUUID()}`;
    const email = `${uid}@example.com`;

    await runOnboardingTransaction({ uid, email, companyName: "First Co" });

    await expect(
      runOnboardingTransaction({ uid, email, companyName: "Second Co" }),
    ).rejects.toThrow(AlreadyOnboardedError);
  });

  it("under concurrent onboarding attempts for the same uid, exactly one company is created", async () => {
    const { adminDb } = await import("@/lib/firebase/admin");
    const { runOnboardingTransaction, AlreadyOnboardedError } = await import("./onboarding");
    const uid = `test-uid-${randomUUID()}`;
    const email = `${uid}@example.com`;

    const results = await Promise.allSettled([
      runOnboardingTransaction({ uid, email, companyName: "Race A" }),
      runOnboardingTransaction({ uid, email, companyName: "Race B" }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(AlreadyOnboardedError);

    const membershipsSnap = await adminDb
      .collectionGroup("memberships")
      .where("uid", "==", uid)
      .get();
    expect(membershipsSnap.docs).toHaveLength(1);
  });

  it("performs no partial writes when the transaction aborts (rollback)", async () => {
    const { adminDb } = await import("@/lib/firebase/admin");
    const { runOnboardingTransaction } = await import("./onboarding");
    const uid = `test-uid-${randomUUID()}`;
    const email = `${uid}@example.com`;

    await runOnboardingTransaction({ uid, email, companyName: "Original Co" });

    const before = await adminDb.collection("companies").where("ownerId", "==", uid).get();
    expect(before.docs).toHaveLength(1);

    await expect(
      runOnboardingTransaction({ uid, email, companyName: "Should Not Be Created" }),
    ).rejects.toThrow();

    const after = await adminDb.collection("companies").where("ownerId", "==", uid).get();
    // Still exactly one company -- the rejected second attempt created
    // nothing at all, not a second (or partial) company.
    expect(after.docs).toHaveLength(1);
    expect(after.docs[0].data().name).toBe("Original Co");
  });
});
