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

// Mirrors tests/security-rules/restaurant.test.ts's setup -- see that file
// for why this is skipped outside the emulator, and why each rules-test
// file needs its own unique projectId.
const IS_EMULATOR = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe.skipIf(!IS_EMULATOR)("Firestore security rules: Loyalty App (4.2)", () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-rules-test-loyalty",
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

  async function seedCompanyAndLoyaltyData(companyId: string, ownerUid: string) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "companies", companyId), { name: "Acme", ownerId: ownerUid, status: "active" });
      await setDoc(doc(db, "companies", companyId, "memberships", ownerUid), {
        uid: ownerUid,
        role: "Owner",
        branchIds: [],
        status: "active",
      });
      await setDoc(doc(db, "companies", companyId, "apps", "loyalty"), { enabled: true });
      await setDoc(doc(db, "companies", companyId, "apps", "loyalty", "members", "member-1"), {
        name: "Jane Doe",
        contactRef: null,
        pointsBalance: 10,
      });
      await setDoc(doc(db, "companies", companyId, "apps", "loyalty", "ledger", "entry-1"), {
        memberId: "member-1",
        type: "earned",
        points: 10,
        orderId: "order-1",
        reason: null,
        actorId: ownerUid,
      });
      await setDoc(doc(db, "companies", companyId, "apps", "loyalty", "attributions", "order-1"), {
        memberId: "member-1",
        attributedBy: ownerUid,
      });
      await setDoc(doc(db, "companies", companyId, "apps", "loyalty", "syncCursor", "default"), {
        lastProcessedLogId: "log-1",
      });
    });
  }

  describe("members / ledger / attributions", () => {
    it("allows any active member to read", async () => {
      await seedCompanyAndLoyaltyData("company-1", "owner-1");
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "companies", "company-1", "memberships", "employee-1"), {
          uid: "employee-1",
          role: "Employee",
          branchIds: [],
          status: "active",
        });
      });
      const employeeDb = testEnv.authenticatedContext("employee-1").firestore();

      await assertSucceeds(getDoc(doc(employeeDb, "companies", "company-1", "apps", "loyalty", "members", "member-1")));
      await assertSucceeds(getDoc(doc(employeeDb, "companies", "company-1", "apps", "loyalty", "ledger", "entry-1")));
      await assertSucceeds(
        getDoc(doc(employeeDb, "companies", "company-1", "apps", "loyalty", "attributions", "order-1")),
      );
    });

    it("denies a non-member entirely", async () => {
      await seedCompanyAndLoyaltyData("company-1", "owner-1");
      const strangerDb = testEnv.authenticatedContext("stranger-1").firestore();

      await assertFails(getDoc(doc(strangerDb, "companies", "company-1", "apps", "loyalty", "members", "member-1")));
      await assertFails(getDoc(doc(strangerDb, "companies", "company-1", "apps", "loyalty", "ledger", "entry-1")));
      await assertFails(
        getDoc(doc(strangerDb, "companies", "company-1", "apps", "loyalty", "attributions", "order-1")),
      );
    });

    it("denies any direct client write", async () => {
      await seedCompanyAndLoyaltyData("company-1", "owner-1");
      const ownerDb = testEnv.authenticatedContext("owner-1").firestore();

      await assertFails(
        updateDoc(doc(ownerDb, "companies", "company-1", "apps", "loyalty", "members", "member-1"), {
          pointsBalance: 999,
        }),
      );
      await assertFails(deleteDoc(doc(ownerDb, "companies", "company-1", "apps", "loyalty", "ledger", "entry-1")));
      await assertFails(
        setDoc(doc(ownerDb, "companies", "company-1", "apps", "loyalty", "attributions", "order-2"), {
          memberId: "member-1",
          attributedBy: "owner-1",
        }),
      );
    });

    it("lets a superAdmin claim holder read with no membership at all", async () => {
      await seedCompanyAndLoyaltyData("company-1", "owner-1");
      const superAdminDb = testEnv.authenticatedContext("superadmin-1", { superAdmin: true }).firestore();

      await assertSucceeds(
        getDoc(doc(superAdminDb, "companies", "company-1", "apps", "loyalty", "members", "member-1")),
      );
    });
  });

  describe("syncCursor", () => {
    it("denies a regular member read", async () => {
      await seedCompanyAndLoyaltyData("company-1", "owner-1");
      const ownerDb = testEnv.authenticatedContext("owner-1").firestore();

      await assertFails(getDoc(doc(ownerDb, "companies", "company-1", "apps", "loyalty", "syncCursor", "default")));
    });

    it("allows a superAdmin claim holder to read it", async () => {
      await seedCompanyAndLoyaltyData("company-1", "owner-1");
      const superAdminDb = testEnv.authenticatedContext("superadmin-1", { superAdmin: true }).firestore();

      await assertSucceeds(
        getDoc(doc(superAdminDb, "companies", "company-1", "apps", "loyalty", "syncCursor", "default")),
      );
    });

    it("denies any direct client write", async () => {
      await seedCompanyAndLoyaltyData("company-1", "owner-1");
      const ownerDb = testEnv.authenticatedContext("owner-1").firestore();

      await assertFails(
        setDoc(doc(ownerDb, "companies", "company-1", "apps", "loyalty", "syncCursor", "default"), {
          lastProcessedLogId: "log-999",
        }),
      );
    });
  });
});
