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

// Exercises the real firestore.rules against the real Firestore Emulator,
// using Google's official rules-testing package -- there is no way to
// actually validate Security Rules syntax/behavior against hand-written
// mocks. Run via `npm run test:emulator`; skipped cleanly under plain
// `npm run test` when no emulator is running.
const IS_EMULATOR = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe.skipIf(!IS_EMULATOR)("Firestore security rules: users/companies/branches/memberships", () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-rules-test",
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

  async function seedCompanyWithOwner(companyId: string, ownerUid: string) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "companies", companyId), {
        name: "Acme",
        ownerId: ownerUid,
        status: "active",
      });
      await setDoc(doc(db, "companies", companyId, "branches", "branch-1"), {
        name: "Main",
        isActive: true,
        isDefault: true,
      });
      await setDoc(doc(db, "companies", companyId, "memberships", ownerUid), {
        uid: ownerUid,
        role: "Owner",
        branchIds: [],
        status: "active",
      });
    });
  }

  describe("unauthorized reads", () => {
    it("denies all access when unauthenticated", async () => {
      await seedCompanyWithOwner("company-1", "owner-1");
      const unauthedDb = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(unauthedDb, "companies", "company-1")));
    });

    it("denies a non-member from reading the company, its branches, or its roster", async () => {
      await seedCompanyWithOwner("company-1", "owner-1");
      const strangerDb = testEnv.authenticatedContext("stranger-1").firestore();
      await assertFails(getDoc(doc(strangerDb, "companies", "company-1")));
      await assertFails(getDoc(doc(strangerDb, "companies", "company-1", "branches", "branch-1")));
      await assertFails(getDoc(doc(strangerDb, "companies", "company-1", "memberships", "owner-1")));
    });
  });

  describe("membership lookup / owner authorization / non-owner denial", () => {
    it("allows an active member to read their company, its branches, and its roster", async () => {
      await seedCompanyWithOwner("company-1", "owner-1");
      const ownerDb = testEnv.authenticatedContext("owner-1").firestore();
      await assertSucceeds(getDoc(doc(ownerDb, "companies", "company-1")));
      await assertSucceeds(getDoc(doc(ownerDb, "companies", "company-1", "branches", "branch-1")));
      await assertSucceeds(getDoc(doc(ownerDb, "companies", "company-1", "memberships", "owner-1")));
    });

    it("allows the Owner to update name/status", async () => {
      await seedCompanyWithOwner("company-1", "owner-1");
      const ownerDb = testEnv.authenticatedContext("owner-1").firestore();
      await assertSucceeds(updateDoc(doc(ownerDb, "companies", "company-1"), { name: "New Name" }));
      await assertSucceeds(
        updateDoc(doc(ownerDb, "companies", "company-1"), { status: "suspended" }),
      );
    });

    it("denies a non-owner, non-manager member from updating the company at all", async () => {
      await seedCompanyWithOwner("company-1", "owner-1");
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "companies", "company-1", "memberships", "employee-1"), {
          uid: "employee-1",
          role: "Employee",
          branchIds: [],
          status: "active",
        });
      });
      const employeeDb = testEnv.authenticatedContext("employee-1").firestore();
      await assertFails(updateDoc(doc(employeeDb, "companies", "company-1"), { name: "Hacked" }));
      await assertFails(updateDoc(doc(employeeDb, "companies", "company-1"), { status: "suspended" }));
    });

    it("allows a Manager to rename the company but not suspend it (1D capability split)", async () => {
      await seedCompanyWithOwner("company-1", "owner-1");
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "companies", "company-1", "memberships", "manager-1"), {
          uid: "manager-1",
          role: "Manager",
          branchIds: [],
          status: "active",
        });
      });
      const managerDb = testEnv.authenticatedContext("manager-1").firestore();
      await assertSucceeds(updateDoc(doc(managerDb, "companies", "company-1"), { name: "Renamed by Manager" }));
      await assertFails(updateDoc(doc(managerDb, "companies", "company-1"), { status: "suspended" }));
    });

    it("denies updating restricted fields even for the Owner", async () => {
      await seedCompanyWithOwner("company-1", "owner-1");
      const ownerDb = testEnv.authenticatedContext("owner-1").firestore();
      await assertFails(
        updateDoc(doc(ownerDb, "companies", "company-1"), { ownerId: "someone-else" }),
      );
      await assertFails(
        updateDoc(doc(ownerDb, "companies", "company-1"), { name: "New", ownerId: "someone-else" }),
      );
    });
  });

  describe("SuperAdmin read bypass (1D)", () => {
    it("lets a superAdmin claim holder read a company, its branches, and its roster with no membership", async () => {
      await seedCompanyWithOwner("company-1", "owner-1");
      const superAdminDb = testEnv.authenticatedContext("superadmin-1", { superAdmin: true }).firestore();

      await assertSucceeds(getDoc(doc(superAdminDb, "companies", "company-1")));
      await assertSucceeds(getDoc(doc(superAdminDb, "companies", "company-1", "branches", "branch-1")));
      await assertSucceeds(getDoc(doc(superAdminDb, "companies", "company-1", "memberships", "owner-1")));
    });

    it("still denies writes for a superAdmin claim holder (no write capability modeled in 1D)", async () => {
      await seedCompanyWithOwner("company-1", "owner-1");
      const superAdminDb = testEnv.authenticatedContext("superadmin-1", { superAdmin: true }).firestore();

      await assertFails(updateDoc(doc(superAdminDb, "companies", "company-1"), { name: "Hacked" }));
    });

    it("does not grant the bypass without the superAdmin claim", async () => {
      await seedCompanyWithOwner("company-1", "owner-1");
      const strangerDb = testEnv.authenticatedContext("stranger-1", { superAdmin: false }).firestore();

      await assertFails(getDoc(doc(strangerDb, "companies", "company-1")));
    });
  });

  describe("cross-company isolation", () => {
    it("denies a member of company A from reading or writing anything under company B", async () => {
      await seedCompanyWithOwner("company-a", "owner-a");
      await seedCompanyWithOwner("company-b", "owner-b");
      const memberADb = testEnv.authenticatedContext("owner-a").firestore();

      await assertFails(getDoc(doc(memberADb, "companies", "company-b")));
      await assertFails(getDoc(doc(memberADb, "companies", "company-b", "branches", "branch-1")));
      await assertFails(getDoc(doc(memberADb, "companies", "company-b", "memberships", "owner-b")));
      await assertFails(updateDoc(doc(memberADb, "companies", "company-b"), { name: "Hacked" }));
    });
  });

  describe("unauthorized writes / no wildcard write permissions", () => {
    it("denies any direct client write to companies, branches, or memberships", async () => {
      await seedCompanyWithOwner("company-1", "owner-1");
      const ownerDb = testEnv.authenticatedContext("owner-1").firestore();

      await assertFails(setDoc(doc(ownerDb, "companies", "new-company"), { name: "x" }));
      await assertFails(
        setDoc(doc(ownerDb, "companies", "company-1", "branches", "new-branch"), {
          name: "x",
          isActive: true,
          isDefault: false,
        }),
      );
      await assertFails(
        setDoc(doc(ownerDb, "companies", "company-1", "memberships", "new-member"), {
          uid: "new-member",
          role: "Employee",
          branchIds: [],
          status: "active",
        }),
      );
      await assertFails(deleteDoc(doc(ownerDb, "companies", "company-1")));
    });

    it("denies any direct client write to users, even the caller's own document", async () => {
      const selfDb = testEnv.authenticatedContext("user-1").firestore();
      await assertFails(setDoc(doc(selfDb, "users", "user-1"), { displayName: "Alice" }));
    });
  });

  describe("users/{uid} self-only read", () => {
    it("allows a user to read only their own profile document", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "users", "user-1"), {
          uid: "user-1",
          email: "a@example.com",
          status: "active",
        });
      });

      const selfDb = testEnv.authenticatedContext("user-1").firestore();
      await assertSucceeds(getDoc(doc(selfDb, "users", "user-1")));

      const otherDb = testEnv.authenticatedContext("user-2").firestore();
      await assertFails(getDoc(doc(otherDb, "users", "user-1")));
    });
  });

  describe("default deny for unmatched paths", () => {
    it("denies access to a hypothetical undeclared collection", async () => {
      const someDb = testEnv.authenticatedContext("user-1").firestore();
      await assertFails(getDoc(doc(someDb, "somethingNotDeclared", "doc-1")));
    });
  });
});
