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

// Mirrors tests/security-rules/loyalty.test.ts's setup for members/ledger --
// queryLog is company-wide (not branch-scoped), same low-sensitivity
// visibility tier.
const IS_EMULATOR = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe.skipIf(!IS_EMULATOR)("Firestore security rules: AI Assistant App (6.4)", () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-rules-test-ai-assistant",
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

  async function seedCompanyAndQueryLog(companyId: string, ownerUid: string) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "companies", companyId), { name: "Acme", ownerId: ownerUid, status: "active" });
      await setDoc(doc(db, "companies", companyId, "memberships", ownerUid), {
        uid: ownerUid,
        role: "Owner",
        branchIds: [],
        status: "active",
      });
      await setDoc(doc(db, "companies", companyId, "memberships", "employee-1"), {
        uid: "employee-1",
        role: "Employee",
        branchIds: [],
        status: "active",
      });
      await setDoc(doc(db, "companies", companyId, "apps", "ai-assistant"), { enabled: true });
      await setDoc(doc(db, "companies", companyId, "apps", "ai-assistant", "queryLog", "log-1"), {
        question: "How much stock of Widget do we have?",
        answer: "You have 5 Widgets in stock.",
        actorId: ownerUid,
      });
    });
  }

  describe("apps/ai-assistant/queryLog", () => {
    it("allows any active member to read", async () => {
      await seedCompanyAndQueryLog("company-1", "owner-1");
      const employeeDb = testEnv.authenticatedContext("employee-1").firestore();

      await assertSucceeds(getDoc(doc(employeeDb, "companies", "company-1", "apps", "ai-assistant", "queryLog", "log-1")));
    });

    it("denies a non-member entirely", async () => {
      await seedCompanyAndQueryLog("company-1", "owner-1");
      const strangerDb = testEnv.authenticatedContext("stranger-1").firestore();

      await assertFails(getDoc(doc(strangerDb, "companies", "company-1", "apps", "ai-assistant", "queryLog", "log-1")));
    });

    it("denies any direct client write", async () => {
      await seedCompanyAndQueryLog("company-1", "owner-1");
      const ownerDb = testEnv.authenticatedContext("owner-1").firestore();

      await assertFails(
        updateDoc(doc(ownerDb, "companies", "company-1", "apps", "ai-assistant", "queryLog", "log-1"), { answer: "tampered" }),
      );
    });

    it("lets a superAdmin claim holder read it with no membership at all", async () => {
      await seedCompanyAndQueryLog("company-1", "owner-1");
      const superAdminDb = testEnv.authenticatedContext("superadmin-1", { superAdmin: true }).firestore();

      await assertSucceeds(
        getDoc(doc(superAdminDb, "companies", "company-1", "apps", "ai-assistant", "queryLog", "log-1")),
      );
    });
  });
});
