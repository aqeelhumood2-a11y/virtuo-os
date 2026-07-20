import "server-only";

import { adminDb } from "@/lib/firebase/admin";

import { listMyCompanies } from "./membership";

export type MyCompanySummary = {
  companyId: string;
  companyName: string;
  role: string;
  branchName: string | null;
};

// A small, page-specific read used only by the /account placeholder to
// show "Company: X - Role: Y - Branch: Z". 1C's onboarding produces at
// most one company per user (see docs/phases/PHASE_1C_PLAN.md §0.1), so
// this takes the first membership rather than exposing a list here.
export async function getMyCompanySummary(uid: string): Promise<MyCompanySummary | null> {
  const memberships = await listMyCompanies(uid);
  const first = memberships[0];
  if (!first) return null;

  const companySnap = await adminDb.collection("companies").doc(first.companyId).get();
  const companyName = companySnap.exists ? (companySnap.data()?.name ?? first.companyId) : first.companyId;

  const branchesSnap = await adminDb
    .collection("companies")
    .doc(first.companyId)
    .collection("branches")
    .where("isDefault", "==", true)
    .limit(1)
    .get();
  const branchName = branchesSnap.empty ? null : (branchesSnap.docs[0].data().name ?? null);

  return {
    companyId: first.companyId,
    companyName,
    role: first.role,
    branchName,
  };
}
