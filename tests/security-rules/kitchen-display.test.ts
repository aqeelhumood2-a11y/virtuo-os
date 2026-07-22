import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  type RulesTestEnvironment,
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

// Mirrors tests/security-rules/restaurant.test.ts's setup for orderMeta --
// prepStatus is the same shape (branch-scoped, Admin-SDK-only writes), and
// this collection is additionally the first one ever read by a Client
// Component directly (see docs/phases/PHASE_6_PLAN.md §3); these rules are
// what actually enforce that read, identically for a server or client caller.
const IS_EMULATOR = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe.skipIf(!IS_EMULATOR)("Firestore security rules: Kitchen Display App (6.1)", () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-rules-test-kitchen-display",
      firestore: {
        rules: readFileSync(path.join(projectRoot, "firestore.rules"), "utf8"),
        host: "localhost",
        port: 8080,
      },
    });
  });

  afterAll(async () => {
    await testEnv?.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  async function seedCompanyAndPrepStatus(companyId: string, ownerUid: string) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "companies", companyId), { name: "Acme Diner", ownerId: ownerUid, status: "active" });
      await setDoc(doc(db, "companies", companyId, "memberships", ownerUid), {
        uid: ownerUid,
        role: "Owner",
        branchIds: [],
        status: "active",
      });
      await setDoc(doc(db, "companies", companyId, "apps", "kitchen-display"), { enabled: true });
      await setDoc(doc(db, "companies", companyId, "apps", "kitchen-display", "prepStatus", "order-1"), {
        branchId: "branch-1",
        stage: "queued",
        updatedBy: ownerUid,
      });
    });
  }

  async function addScopedMember(companyId: string, uid: string, branchIds: string[]) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "companies", companyId, "memberships", uid), {
        uid,
        role: "Employee",
        branchIds,
        status: "active",
      });
    });
  }

  describe("apps/kitchen-display/prepStatus", () => {
    it("allows a member scoped to the matching branch to read it", async () => {
      await seedCompanyAndPrepStatus("company-1", "owner-1");
      await addScopedMember("company-1", "employee-1", ["branch-1"]);
      const employeeDb = testEnv.authenticatedContext("employee-1").firestore();

      await assertSucceeds(getDoc(doc(employeeDb, "companies", "company-1", "apps", "kitchen-display", "prepStatus", "order-1")));
    });

    it("denies a member scoped to a different branch", async () => {
      await seedCompanyAndPrepStatus("company-1", "owner-1");
      await addScopedMember("company-1", "employee-1", ["branch-2"]);
      const employeeDb = testEnv.authenticatedContext("employee-1").firestore();

      await assertFails(getDoc(doc(employeeDb, "companies", "company-1", "apps", "kitchen-display", "prepStatus", "order-1")));
    });

    it("denies a non-member entirely", async () => {
      await seedCompanyAndPrepStatus("company-1", "owner-1");
      const strangerDb = testEnv.authenticatedContext("stranger-1").firestore();

      await assertFails(getDoc(doc(strangerDb, "companies", "company-1", "apps", "kitchen-display", "prepStatus", "order-1")));
    });

    it("denies any direct client write", async () => {
      await seedCompanyAndPrepStatus("company-1", "owner-1");
      const ownerDb = testEnv.authenticatedContext("owner-1").firestore();

      await assertFails(
        updateDoc(doc(ownerDb, "companies", "company-1", "apps", "kitchen-display", "prepStatus", "order-1"), { stage: "ready" }),
      );
    });

    it("lets a superAdmin claim holder read it with no membership at all", async () => {
      await seedCompanyAndPrepStatus("company-1", "owner-1");
      const superAdminDb = testEnv.authenticatedContext("superadmin-1", { superAdmin: true }).firestore();

      await assertSucceeds(
        getDoc(doc(superAdminDb, "companies", "company-1", "apps", "kitchen-display", "prepStatus", "order-1")),
      );
    });
  });
});
