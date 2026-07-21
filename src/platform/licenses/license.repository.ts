import "server-only";

import { adminDb } from "@/lib/firebase/admin";

import type { License } from "./license.types";

// One active license doc per company -- "default" is a stable, singleton
// doc ID (no license-selection UI exists in Phase 2; a company has exactly
// one active plan). Provisioned by ops/SuperAdmin tooling, never through an
// in-app mutation -- see docs/phases/PHASE_2_PLAN.md §11.
function licenseDoc(companyId: string) {
  return adminDb.collection("companies").doc(companyId).collection("licenses").doc("default");
}

export async function getCompanyLicense(companyId: string): Promise<License | null> {
  const snap = await licenseDoc(companyId).get();
  if (!snap.exists) return null;

  const data = snap.data()!;
  return {
    plan: data.plan,
    entitledApps: Array.isArray(data.entitledApps) ? data.entitledApps : [],
    entitledConnectors: Array.isArray(data.entitledConnectors) ? data.entitledConnectors : [],
    seats: typeof data.seats === "number" ? data.seats : 0,
    renewsAt: data.renewsAt ?? null,
  };
}

// A company with no license doc at all is entitled to nothing -- fails
// closed, not open.
export async function isAppEntitled(companyId: string, appId: string): Promise<boolean> {
  const license = await getCompanyLicense(companyId);
  return license?.entitledApps.includes(appId) ?? false;
}

export async function isConnectorEntitled(companyId: string, connectorId: string): Promise<boolean> {
  const license = await getCompanyLicense(companyId);
  return license?.entitledConnectors.includes(connectorId) ?? false;
}
