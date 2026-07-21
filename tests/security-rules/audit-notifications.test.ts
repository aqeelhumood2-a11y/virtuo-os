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

describe.skipIf(!IS_EMULATOR)("Firestore security rules: auditLogs/notifications (1G)", () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      // Own unique projectId -- see inventory.test.ts's comment on why
      // sharing one across rules-test files causes intermittent failures
      // when Vitest runs them in parallel against the same emulator.
      projectId: "demo-rules-test-audit",
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

  async function seedCompanyWithRoster(companyId: string) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "companies", companyId), { name: "Acme", ownerId: "owner-1", status: "active" });
      await setDoc(doc(db, "companies", companyId, "memberships", "owner-1"), {
        uid: "owner-1",
        role: "Owner",
        branchIds: [],
        status: "active",
      });
      await setDoc(doc(db, "companies", companyId, "memberships", "manager-1"), {
        uid: "manager-1",
        role: "Manager",
        branchIds: [],
        status: "active",
      });
      await setDoc(doc(db, "companies", companyId, "memberships", "employee-1"), {
        uid: "employee-1",
        role: "Employee",
        branchIds: [],
        status: "active",
      });
      await setDoc(doc(db, "companies", companyId, "memberships", "supervisor-1"), {
        uid: "supervisor-1",
        role: "Supervisor",
        branchIds: [],
        status: "active",
      });
      await setDoc(doc(db, "companies", companyId, "auditLogs", "log-1"), {
        actorId: "owner-1",
        action: "company.updated",
        targetType: "company",
        targetId: companyId,
        after: { name: "Acme" },
      });
    });
  }

  describe("auditLogs/{logId}: audit.view gating", () => {
    it("allows the Owner and Manager to read (both hold audit.view)", async () => {
      await seedCompanyWithRoster("company-1");
      const ownerDb = testEnv.authenticatedContext("owner-1").firestore();
      const managerDb = testEnv.authenticatedContext("manager-1").firestore();

      await assertSucceeds(getDoc(doc(ownerDb, "companies", "company-1", "auditLogs", "log-1")));
      await assertSucceeds(getDoc(doc(managerDb, "companies", "company-1", "auditLogs", "log-1")));
    });

    it("denies Supervisor and Employee (neither holds audit.view)", async () => {
      await seedCompanyWithRoster("company-1");
      const supervisorDb = testEnv.authenticatedContext("supervisor-1").firestore();
      const employeeDb = testEnv.authenticatedContext("employee-1").firestore();

      await assertFails(getDoc(doc(supervisorDb, "companies", "company-1", "auditLogs", "log-1")));
      await assertFails(getDoc(doc(employeeDb, "companies", "company-1", "auditLogs", "log-1")));
    });

    it("denies a non-member entirely", async () => {
      await seedCompanyWithRoster("company-1");
      const strangerDb = testEnv.authenticatedContext("stranger-1").firestore();

      await assertFails(getDoc(doc(strangerDb, "companies", "company-1", "auditLogs", "log-1")));
    });

    it("lets a superAdmin claim holder read regardless of membership", async () => {
      await seedCompanyWithRoster("company-1");
      const superAdminDb = testEnv.authenticatedContext("superadmin-1", { superAdmin: true }).firestore();

      await assertSucceeds(getDoc(doc(superAdminDb, "companies", "company-1", "auditLogs", "log-1")));
    });

    it("denies every direct client write, even for the Owner -- the log is written server-side only", async () => {
      await seedCompanyWithRoster("company-1");
      const ownerDb = testEnv.authenticatedContext("owner-1").firestore();

      await assertFails(
        setDoc(doc(ownerDb, "companies", "company-1", "auditLogs", "new-log"), {
          actorId: "owner-1",
          action: "company.updated",
          targetType: "company",
          targetId: "company-1",
        }),
      );
      await assertFails(
        updateDoc(doc(ownerDb, "companies", "company-1", "auditLogs", "log-1"), { actorId: "someone-else" }),
      );
      await assertFails(deleteDoc(doc(ownerDb, "companies", "company-1", "auditLogs", "log-1")));
    });
  });

  describe("users/{uid}/notifications/{notificationId}: self-only read, no writes", () => {
    async function seedNotification(uid: string) {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "users", uid, "notifications", "notif-1"), {
          title: "Your role was updated",
          body: "Your role is now Manager.",
          channel: "in-app",
          readAt: null,
        });
      });
    }

    it("allows a user to read only their own notifications", async () => {
      await seedNotification("user-1");
      const selfDb = testEnv.authenticatedContext("user-1").firestore();
      const otherDb = testEnv.authenticatedContext("user-2").firestore();

      await assertSucceeds(getDoc(doc(selfDb, "users", "user-1", "notifications", "notif-1")));
      await assertFails(getDoc(doc(otherDb, "users", "user-1", "notifications", "notif-1")));
    });

    it("denies an unauthenticated read", async () => {
      await seedNotification("user-1");
      const unauthedDb = testEnv.unauthenticatedContext().firestore();

      await assertFails(getDoc(doc(unauthedDb, "users", "user-1", "notifications", "notif-1")));
    });

    it("has no superAdmin read bypass -- notifications are per-user, not per-company", async () => {
      await seedNotification("user-1");
      const superAdminDb = testEnv.authenticatedContext("superadmin-1", { superAdmin: true }).firestore();

      await assertFails(getDoc(doc(superAdminDb, "users", "user-1", "notifications", "notif-1")));
    });

    it("denies every direct client write, even the caller marking their own notification read", async () => {
      await seedNotification("user-1");
      const selfDb = testEnv.authenticatedContext("user-1").firestore();

      await assertFails(updateDoc(doc(selfDb, "users", "user-1", "notifications", "notif-1"), { readAt: null }));
      await assertFails(
        setDoc(doc(selfDb, "users", "user-1", "notifications", "notif-2"), {
          title: "x",
          body: "y",
          channel: "in-app",
          readAt: null,
        }),
      );
      await assertFails(deleteDoc(doc(selfDb, "users", "user-1", "notifications", "notif-1")));
    });
  });
});
