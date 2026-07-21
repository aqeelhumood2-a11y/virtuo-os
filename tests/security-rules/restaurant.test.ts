import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  type RulesTestEnvironment,
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

// Mirrors tests/security-rules/orders.test.ts's setup -- see that file for
// why this is skipped outside the emulator, and why each rules-test file
// needs its own unique projectId.
const IS_EMULATOR = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe.skipIf(!IS_EMULATOR)("Firestore security rules: Restaurant App + Core idempotency keys (3)", () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-rules-test-restaurant",
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

  async function seedCompanyAndOrderMeta(companyId: string, ownerUid: string) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "companies", companyId), { name: "Acme Diner", ownerId: ownerUid, status: "active" });
      await setDoc(doc(db, "companies", companyId, "memberships", ownerUid), {
        uid: ownerUid,
        role: "Owner",
        branchIds: [],
        status: "active",
      });
      await setDoc(doc(db, "companies", companyId, "apps", "restaurant"), { enabled: true });
      await setDoc(doc(db, "companies", companyId, "apps", "restaurant", "orderMeta", "draft-1"), {
        orderId: "order-1",
        branchId: "branch-1",
        orderType: "dineIn",
        tableRef: "Table 4",
        guestCount: null,
        kitchenNote: null,
        status: "confirmed",
      });
      await setDoc(doc(db, "companies", companyId, "idempotencyKeys", "draft-1"), {
        operation: "createOrder",
        resultId: "order-1",
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

  describe("apps/restaurant/orderMeta", () => {
    it("allows a member scoped to the matching branch to read it", async () => {
      await seedCompanyAndOrderMeta("company-1", "owner-1");
      await addScopedMember("company-1", "employee-1", ["branch-1"]);
      const employeeDb = testEnv.authenticatedContext("employee-1").firestore();

      await assertSucceeds(
        getDoc(doc(employeeDb, "companies", "company-1", "apps", "restaurant", "orderMeta", "draft-1")),
      );
    });

    it("denies a member scoped to a different branch", async () => {
      await seedCompanyAndOrderMeta("company-1", "owner-1");
      await addScopedMember("company-1", "employee-1", ["branch-2"]);
      const employeeDb = testEnv.authenticatedContext("employee-1").firestore();

      await assertFails(
        getDoc(doc(employeeDb, "companies", "company-1", "apps", "restaurant", "orderMeta", "draft-1")),
      );
    });

    it("denies a non-member entirely", async () => {
      await seedCompanyAndOrderMeta("company-1", "owner-1");
      const strangerDb = testEnv.authenticatedContext("stranger-1").firestore();

      await assertFails(
        getDoc(doc(strangerDb, "companies", "company-1", "apps", "restaurant", "orderMeta", "draft-1")),
      );
    });

    it("denies any direct client write", async () => {
      await seedCompanyAndOrderMeta("company-1", "owner-1");
      const ownerDb = testEnv.authenticatedContext("owner-1").firestore();

      await assertFails(
        updateDoc(doc(ownerDb, "companies", "company-1", "apps", "restaurant", "orderMeta", "draft-1"), {
          tableRef: "Table 9",
        }),
      );
      await assertFails(deleteDoc(doc(ownerDb, "companies", "company-1", "apps", "restaurant", "orderMeta", "draft-1")));
    });

    it("lets a superAdmin claim holder read it with no membership at all", async () => {
      await seedCompanyAndOrderMeta("company-1", "owner-1");
      const superAdminDb = testEnv.authenticatedContext("superadmin-1", { superAdmin: true }).firestore();

      await assertSucceeds(
        getDoc(doc(superAdminDb, "companies", "company-1", "apps", "restaurant", "orderMeta", "draft-1")),
      );
    });
  });

  describe("idempotencyKeys", () => {
    it("denies a regular member read", async () => {
      await seedCompanyAndOrderMeta("company-1", "owner-1");
      const ownerDb = testEnv.authenticatedContext("owner-1").firestore();

      await assertFails(getDoc(doc(ownerDb, "companies", "company-1", "idempotencyKeys", "draft-1")));
    });

    it("allows a superAdmin claim holder to read it", async () => {
      await seedCompanyAndOrderMeta("company-1", "owner-1");
      const superAdminDb = testEnv.authenticatedContext("superadmin-1", { superAdmin: true }).firestore();

      await assertSucceeds(getDoc(doc(superAdminDb, "companies", "company-1", "idempotencyKeys", "draft-1")));
    });

    it("denies any direct client write", async () => {
      await seedCompanyAndOrderMeta("company-1", "owner-1");
      const ownerDb = testEnv.authenticatedContext("owner-1").firestore();

      await assertFails(
        setDoc(doc(ownerDb, "companies", "company-1", "idempotencyKeys", "draft-2"), {
          operation: "createOrder",
          resultId: "order-2",
        }),
      );
    });
  });
});
