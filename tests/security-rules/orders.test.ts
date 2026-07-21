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

// Mirrors tests/security-rules/companies.test.ts's setup -- see that file
// for why this is skipped outside the emulator.
const IS_EMULATOR = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe.skipIf(!IS_EMULATOR)("Firestore security rules: orders/lines (1F)", () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      // Own unique projectId -- see inventory.test.ts's comment on why
      // sharing one across rules-test files causes intermittent failures
      // when Vitest runs them in parallel against the same emulator.
      projectId: "demo-rules-test-orders",
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

  async function seedCompanyAndOrder(companyId: string, ownerUid: string) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "companies", companyId), { name: "Acme", ownerId: ownerUid, status: "active" });
      await setDoc(doc(db, "companies", companyId, "memberships", ownerUid), {
        uid: ownerUid,
        role: "Owner",
        branchIds: [],
        status: "active",
      });
      await setDoc(doc(db, "companies", companyId, "orders", "order-1"), {
        branchId: "branch-1",
        appId: "retail",
        status: "pending",
        totals: { subtotal: 10, tax: 0, discount: 0, total: 10 },
        createdBy: ownerUid,
      });
      await setDoc(doc(db, "companies", companyId, "orders", "order-1", "lines", "line-1"), {
        branchId: "branch-1",
        itemId: "item-1",
        itemNameSnapshot: "Widget",
        quantity: 1,
        unitPrice: 10,
        lineTotal: 10,
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

  describe("orders", () => {
    it("allows a member scoped to the matching branch to read the order", async () => {
      await seedCompanyAndOrder("company-1", "owner-1");
      await addScopedMember("company-1", "employee-1", ["branch-1"]);
      const employeeDb = testEnv.authenticatedContext("employee-1").firestore();

      await assertSucceeds(getDoc(doc(employeeDb, "companies", "company-1", "orders", "order-1")));
    });

    it("denies a member scoped to a different branch from reading the order", async () => {
      await seedCompanyAndOrder("company-1", "owner-1");
      await addScopedMember("company-1", "employee-1", ["branch-2"]);
      const employeeDb = testEnv.authenticatedContext("employee-1").firestore();

      await assertFails(getDoc(doc(employeeDb, "companies", "company-1", "orders", "order-1")));
    });

    it("denies a non-member entirely", async () => {
      await seedCompanyAndOrder("company-1", "owner-1");
      const strangerDb = testEnv.authenticatedContext("stranger-1").firestore();

      await assertFails(getDoc(doc(strangerDb, "companies", "company-1", "orders", "order-1")));
    });

    it("denies any direct client write", async () => {
      await seedCompanyAndOrder("company-1", "owner-1");
      const ownerDb = testEnv.authenticatedContext("owner-1").firestore();

      await assertFails(updateDoc(doc(ownerDb, "companies", "company-1", "orders", "order-1"), { status: "voided" }));
      await assertFails(deleteDoc(doc(ownerDb, "companies", "company-1", "orders", "order-1")));
      await assertFails(
        setDoc(doc(ownerDb, "companies", "company-1", "orders", "new-order"), {
          branchId: "branch-1",
          appId: "retail",
          status: "pending",
          totals: { subtotal: 0, tax: 0, discount: 0, total: 0 },
          createdBy: "owner-1",
        }),
      );
    });

    it("lets a superAdmin claim holder read an order with no membership at all", async () => {
      await seedCompanyAndOrder("company-1", "owner-1");
      const superAdminDb = testEnv.authenticatedContext("superadmin-1", { superAdmin: true }).firestore();

      await assertSucceeds(getDoc(doc(superAdminDb, "companies", "company-1", "orders", "order-1")));
    });
  });

  describe("order lines", () => {
    it("allows a member scoped to the matching branch to read a line", async () => {
      await seedCompanyAndOrder("company-1", "owner-1");
      await addScopedMember("company-1", "employee-1", ["branch-1"]);
      const employeeDb = testEnv.authenticatedContext("employee-1").firestore();

      await assertSucceeds(
        getDoc(doc(employeeDb, "companies", "company-1", "orders", "order-1", "lines", "line-1")),
      );
    });

    it("denies a member scoped to a different branch from reading a line", async () => {
      await seedCompanyAndOrder("company-1", "owner-1");
      await addScopedMember("company-1", "employee-1", ["branch-2"]);
      const employeeDb = testEnv.authenticatedContext("employee-1").firestore();

      await assertFails(getDoc(doc(employeeDb, "companies", "company-1", "orders", "order-1", "lines", "line-1")));
    });

    it("denies any direct client write to a line", async () => {
      await seedCompanyAndOrder("company-1", "owner-1");
      const ownerDb = testEnv.authenticatedContext("owner-1").firestore();

      await assertFails(
        updateDoc(doc(ownerDb, "companies", "company-1", "orders", "order-1", "lines", "line-1"), { quantity: 99 }),
      );
    });
  });
});
