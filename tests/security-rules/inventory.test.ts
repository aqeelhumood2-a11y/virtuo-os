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

describe.skipIf(!IS_EMULATOR)("Firestore security rules: inventoryItems/stock/inventoryMovements (1E)", () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      // Deliberately a different projectId from companies.test.ts -- both
      // files talk to the same emulator process, and Vitest runs test
      // files in parallel by default. Sharing one projectId let one file's
      // clearFirestore()/writes race against the other's, causing
      // intermittent rules-evaluation errors on otherwise-correct rules.
      projectId: "demo-rules-test-inventory",
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

  async function seedCompanyAndInventory(companyId: string, ownerUid: string) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "companies", companyId), {
        name: "Acme",
        ownerId: ownerUid,
        status: "active",
      });
      await setDoc(doc(db, "companies", companyId, "memberships", ownerUid), {
        uid: ownerUid,
        role: "Owner",
        branchIds: [],
        status: "active",
      });
      await setDoc(doc(db, "companies", companyId, "inventoryItems", "item-1"), {
        sku: "SKU-1",
        name: "Widget",
        unit: "each",
        category: "general",
        defaultPrice: 9.99,
        isActive: true,
      });
      await setDoc(doc(db, "companies", companyId, "stock", "branch-1_item-1"), {
        branchId: "branch-1",
        itemId: "item-1",
        quantityOnHand: 10,
        reorderPoint: 2,
      });
      await setDoc(doc(db, "companies", companyId, "inventoryMovements", "movement-1"), {
        itemId: "item-1",
        branchId: "branch-1",
        type: "receive",
        quantityDelta: 10,
        itemNameSnapshot: "Widget",
        reason: "receive",
        performedBy: ownerUid,
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

  describe("inventoryItems", () => {
    it("allows any active member to read the company-wide catalog", async () => {
      await seedCompanyAndInventory("company-1", "owner-1");
      await addScopedMember("company-1", "employee-1", ["branch-2"]);
      const employeeDb = testEnv.authenticatedContext("employee-1").firestore();

      await assertSucceeds(getDoc(doc(employeeDb, "companies", "company-1", "inventoryItems", "item-1")));
    });

    it("denies a non-member from reading the catalog", async () => {
      await seedCompanyAndInventory("company-1", "owner-1");
      const strangerDb = testEnv.authenticatedContext("stranger-1").firestore();

      await assertFails(getDoc(doc(strangerDb, "companies", "company-1", "inventoryItems", "item-1")));
    });

    it("denies any direct client write", async () => {
      await seedCompanyAndInventory("company-1", "owner-1");
      const ownerDb = testEnv.authenticatedContext("owner-1").firestore();

      await assertFails(updateDoc(doc(ownerDb, "companies", "company-1", "inventoryItems", "item-1"), { name: "Hacked" }));
      await assertFails(
        setDoc(doc(ownerDb, "companies", "company-1", "inventoryItems", "item-2"), {
          sku: "SKU-2",
          name: "x",
          unit: "each",
          category: "general",
          defaultPrice: 1,
          isActive: true,
        }),
      );
    });
  });

  describe("stock (branch-scoped)", () => {
    it("allows a member with unrestricted branchIds ([]) to read any branch's stock", async () => {
      await seedCompanyAndInventory("company-1", "owner-1");
      const ownerDb = testEnv.authenticatedContext("owner-1").firestore();

      await assertSucceeds(getDoc(doc(ownerDb, "companies", "company-1", "stock", "branch-1_item-1")));
    });

    it("allows a member scoped to the matching branch to read its stock", async () => {
      await seedCompanyAndInventory("company-1", "owner-1");
      await addScopedMember("company-1", "employee-1", ["branch-1"]);
      const employeeDb = testEnv.authenticatedContext("employee-1").firestore();

      await assertSucceeds(getDoc(doc(employeeDb, "companies", "company-1", "stock", "branch-1_item-1")));
    });

    it("denies a member scoped to a different branch from reading this branch's stock", async () => {
      await seedCompanyAndInventory("company-1", "owner-1");
      await addScopedMember("company-1", "employee-1", ["branch-2"]);
      const employeeDb = testEnv.authenticatedContext("employee-1").firestore();

      await assertFails(getDoc(doc(employeeDb, "companies", "company-1", "stock", "branch-1_item-1")));
    });

    it("denies a non-member entirely", async () => {
      await seedCompanyAndInventory("company-1", "owner-1");
      const strangerDb = testEnv.authenticatedContext("stranger-1").firestore();

      await assertFails(getDoc(doc(strangerDb, "companies", "company-1", "stock", "branch-1_item-1")));
    });

    it("denies any direct client write", async () => {
      await seedCompanyAndInventory("company-1", "owner-1");
      const ownerDb = testEnv.authenticatedContext("owner-1").firestore();

      await assertFails(updateDoc(doc(ownerDb, "companies", "company-1", "stock", "branch-1_item-1"), { quantityOnHand: 999 }));
      await assertFails(deleteDoc(doc(ownerDb, "companies", "company-1", "stock", "branch-1_item-1")));
    });

    it("lets a superAdmin claim holder read stock with no membership at all", async () => {
      await seedCompanyAndInventory("company-1", "owner-1");
      const superAdminDb = testEnv.authenticatedContext("superadmin-1", { superAdmin: true }).firestore();

      await assertSucceeds(getDoc(doc(superAdminDb, "companies", "company-1", "stock", "branch-1_item-1")));
    });
  });

  describe("inventoryMovements (branch-scoped, append-only)", () => {
    it("allows a member scoped to the matching branch to read its movements", async () => {
      await seedCompanyAndInventory("company-1", "owner-1");
      await addScopedMember("company-1", "employee-1", ["branch-1"]);
      const employeeDb = testEnv.authenticatedContext("employee-1").firestore();

      await assertSucceeds(getDoc(doc(employeeDb, "companies", "company-1", "inventoryMovements", "movement-1")));
    });

    it("denies a member scoped to a different branch from reading this branch's movements", async () => {
      await seedCompanyAndInventory("company-1", "owner-1");
      await addScopedMember("company-1", "employee-1", ["branch-2"]);
      const employeeDb = testEnv.authenticatedContext("employee-1").firestore();

      await assertFails(getDoc(doc(employeeDb, "companies", "company-1", "inventoryMovements", "movement-1")));
    });

    it("denies any direct client write, including to an existing movement", async () => {
      await seedCompanyAndInventory("company-1", "owner-1");
      const ownerDb = testEnv.authenticatedContext("owner-1").firestore();

      await assertFails(
        updateDoc(doc(ownerDb, "companies", "company-1", "inventoryMovements", "movement-1"), { quantityDelta: 999 }),
      );
      await assertFails(deleteDoc(doc(ownerDb, "companies", "company-1", "inventoryMovements", "movement-1")));
    });
  });
});
