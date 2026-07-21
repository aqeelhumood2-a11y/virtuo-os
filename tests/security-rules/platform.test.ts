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

describe.skipIf(!IS_EMULATOR)("Firestore security rules: licenses/apps/connectors/settings (Phase 2)", () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      // Own unique projectId -- see inventory.test.ts's comment on why
      // sharing one across rules-test files causes intermittent failures
      // when Vitest runs them in parallel against the same emulator.
      projectId: "demo-rules-test-platform",
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
      await setDoc(doc(db, "companies", companyId, "licenses", "default"), {
        plan: "pro",
        entitledApps: ["restaurant"],
        entitledConnectors: ["custom-api"],
        seats: 5,
        renewsAt: null,
      });
      await setDoc(doc(db, "companies", companyId, "apps", "restaurant"), {
        enabled: true,
        installedAt: null,
      });
      await setDoc(doc(db, "companies", companyId, "connectors", "custom-api"), {
        status: "connected",
      });
      await setDoc(doc(db, "companies", companyId, "connectors", "shopify", "productMappings", "ext-1"), {
        itemId: "item-1",
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
      });
      await setDoc(doc(db, "companies", companyId, "connectors", "shopify", "outboundOrderMappings", "order-1"), {
        status: "pushed",
        externalOrderId: "999",
        reservedAt: "2026-01-01T00:00:00.000Z",
        pushedAt: "2026-01-01T00:00:01.000Z",
      });
      await setDoc(doc(db, "companies", companyId, "settings", "branding"), {
        logoUrl: null,
        primaryColor: "#336699",
      });
    });
  }

  describe("licenses/{licenseId}: licenses.view gating", () => {
    it("allows Owner and Manager to read", async () => {
      await seedCompanyWithRoster("company-1");
      const ownerDb = testEnv.authenticatedContext("owner-1").firestore();
      const managerDb = testEnv.authenticatedContext("manager-1").firestore();

      await assertSucceeds(getDoc(doc(ownerDb, "companies", "company-1", "licenses", "default")));
      await assertSucceeds(getDoc(doc(managerDb, "companies", "company-1", "licenses", "default")));
    });

    it("denies Employee (no licenses.view)", async () => {
      await seedCompanyWithRoster("company-1");
      const employeeDb = testEnv.authenticatedContext("employee-1").firestore();

      await assertFails(getDoc(doc(employeeDb, "companies", "company-1", "licenses", "default")));
    });

    it("denies a non-member entirely", async () => {
      await seedCompanyWithRoster("company-1");
      const strangerDb = testEnv.authenticatedContext("stranger-1").firestore();

      await assertFails(getDoc(doc(strangerDb, "companies", "company-1", "licenses", "default")));
    });

    it("lets a superAdmin claim holder read regardless of membership", async () => {
      await seedCompanyWithRoster("company-1");
      const superAdminDb = testEnv.authenticatedContext("superadmin-1", { superAdmin: true }).firestore();

      await assertSucceeds(getDoc(doc(superAdminDb, "companies", "company-1", "licenses", "default")));
    });

    it("denies every direct client write, even for the Owner -- licenses are ops-provisioned only", async () => {
      await seedCompanyWithRoster("company-1");
      const ownerDb = testEnv.authenticatedContext("owner-1").firestore();

      await assertFails(
        updateDoc(doc(ownerDb, "companies", "company-1", "licenses", "default"), { seats: 100 }),
      );
    });
  });

  describe("apps/{appId}: any active member can read, no capability required", () => {
    it("allows Owner, Manager, and Employee to read", async () => {
      await seedCompanyWithRoster("company-1");
      for (const uid of ["owner-1", "manager-1", "employee-1"]) {
        const db = testEnv.authenticatedContext(uid).firestore();
        await assertSucceeds(getDoc(doc(db, "companies", "company-1", "apps", "restaurant")));
      }
    });

    it("denies a non-member", async () => {
      await seedCompanyWithRoster("company-1");
      const strangerDb = testEnv.authenticatedContext("stranger-1").firestore();

      await assertFails(getDoc(doc(strangerDb, "companies", "company-1", "apps", "restaurant")));
    });

    it("denies every direct client write -- install state changes only through platform/app-installs", async () => {
      await seedCompanyWithRoster("company-1");
      const ownerDb = testEnv.authenticatedContext("owner-1").firestore();

      await assertFails(
        updateDoc(doc(ownerDb, "companies", "company-1", "apps", "restaurant"), { enabled: false }),
      );
      await assertFails(
        setDoc(doc(ownerDb, "companies", "company-1", "apps", "new-app"), { enabled: true }),
      );
      await assertFails(deleteDoc(doc(ownerDb, "companies", "company-1", "apps", "restaurant")));
    });
  });

  describe("connectors/{connectorId}: same visibility tier as apps", () => {
    it("allows any active member to read", async () => {
      await seedCompanyWithRoster("company-1");
      const employeeDb = testEnv.authenticatedContext("employee-1").firestore();

      await assertSucceeds(getDoc(doc(employeeDb, "companies", "company-1", "connectors", "custom-api")));
    });

    it("denies a non-member", async () => {
      await seedCompanyWithRoster("company-1");
      const strangerDb = testEnv.authenticatedContext("stranger-1").firestore();

      await assertFails(getDoc(doc(strangerDb, "companies", "company-1", "connectors", "custom-api")));
    });

    it("denies every direct client write", async () => {
      await seedCompanyWithRoster("company-1");
      const ownerDb = testEnv.authenticatedContext("owner-1").firestore();

      await assertFails(
        updateDoc(doc(ownerDb, "companies", "company-1", "connectors", "custom-api"), { status: "disconnected" }),
      );
    });
  });

  describe("connectors/{connectorId}/productMappings/{externalId}: Phase 5 sync mappings", () => {
    it("allows any active member to read", async () => {
      await seedCompanyWithRoster("company-1");
      const employeeDb = testEnv.authenticatedContext("employee-1").firestore();

      await assertSucceeds(getDoc(doc(employeeDb, "companies", "company-1", "connectors", "shopify", "productMappings", "ext-1")));
    });

    it("denies a non-member", async () => {
      await seedCompanyWithRoster("company-1");
      const strangerDb = testEnv.authenticatedContext("stranger-1").firestore();

      await assertFails(getDoc(doc(strangerDb, "companies", "company-1", "connectors", "shopify", "productMappings", "ext-1")));
    });

    it("denies every direct client write, even for the Owner -- only syncConnector() (Admin SDK) writes these", async () => {
      await seedCompanyWithRoster("company-1");
      const ownerDb = testEnv.authenticatedContext("owner-1").firestore();

      await assertFails(
        updateDoc(doc(ownerDb, "companies", "company-1", "connectors", "shopify", "productMappings", "ext-1"), { itemId: "item-2" }),
      );
    });
  });

  describe("connectors/{connectorId}/outboundOrderMappings/{orderId}: Phase 5 sync mappings", () => {
    it("allows any active member to read", async () => {
      await seedCompanyWithRoster("company-1");
      const employeeDb = testEnv.authenticatedContext("employee-1").firestore();

      await assertSucceeds(
        getDoc(doc(employeeDb, "companies", "company-1", "connectors", "shopify", "outboundOrderMappings", "order-1")),
      );
    });

    it("denies a non-member", async () => {
      await seedCompanyWithRoster("company-1");
      const strangerDb = testEnv.authenticatedContext("stranger-1").firestore();

      await assertFails(
        getDoc(doc(strangerDb, "companies", "company-1", "connectors", "shopify", "outboundOrderMappings", "order-1")),
      );
    });

    it("denies every direct client write, even for the Owner", async () => {
      await seedCompanyWithRoster("company-1");
      const ownerDb = testEnv.authenticatedContext("owner-1").firestore();

      await assertFails(
        updateDoc(doc(ownerDb, "companies", "company-1", "connectors", "shopify", "outboundOrderMappings", "order-1"), {
          status: "reserved",
        }),
      );
    });
  });

  describe("settings/{settingId}: company tenant configuration (branding)", () => {
    it("allows any active member to read", async () => {
      await seedCompanyWithRoster("company-1");
      const managerDb = testEnv.authenticatedContext("manager-1").firestore();

      await assertSucceeds(getDoc(doc(managerDb, "companies", "company-1", "settings", "branding")));
    });

    it("denies a non-member", async () => {
      await seedCompanyWithRoster("company-1");
      const strangerDb = testEnv.authenticatedContext("stranger-1").firestore();

      await assertFails(getDoc(doc(strangerDb, "companies", "company-1", "settings", "branding")));
    });

    it("denies every direct client write, even for the Owner -- branding changes only through updateCompanyBranding", async () => {
      await seedCompanyWithRoster("company-1");
      const ownerDb = testEnv.authenticatedContext("owner-1").firestore();

      await assertFails(
        updateDoc(doc(ownerDb, "companies", "company-1", "settings", "branding"), { primaryColor: "#000000" }),
      );
    });
  });
});
