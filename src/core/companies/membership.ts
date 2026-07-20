import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { adminDb } from "@/lib/firebase/admin";
import { requireSession } from "@/core/auth/session";

import type { AuthSession } from "@/core/auth/types";
import type { Membership, MembershipRole } from "./types";

// Direct document read -- O(1), the same mechanism the Security Rules use
// (companies/{companyId}/memberships/{uid}). This is the authoritative
// server-side membership lookup; nothing about a caller's role or
// branchIds is ever taken from client input.
export async function getMembership(companyId: string, uid: string): Promise<Membership | null> {
  const snap = await adminDb
    .collection("companies")
    .doc(companyId)
    .collection("memberships")
    .doc(uid)
    .get();

  if (!snap.exists) return null;

  const data = snap.data();
  if (!data || data.status !== "active") return null;

  return {
    uid: data.uid,
    role: data.role,
    branchIds: Array.isArray(data.branchIds) ? data.branchIds : [],
    status: data.status,
  };
}

export type CompanyMembershipContext = {
  session: AuthSession;
  membership: Membership;
};

// The single authorization entry point for anything scoped to a company.
// Re-derives the uid from the verified session (never the client), then
// re-derives the membership from a direct Firestore read (never the
// client) before anything proceeds. A companyId arriving from a route
// param or form field is treated as an unauthenticated hint until this
// function confirms it. Cached per-request like requireSession(), so
// repeated calls within one render/action don't repeat the Firestore read.
//
// Distinct from requireSession(): an authenticated user who isn't a member
// of the requested company is not "unauthenticated" -- redirecting to
// /login would be wrong. They're sent to /account instead.
export const requireCompanyMembership = cache(
  async (companyId: string): Promise<CompanyMembershipContext> => {
    const session = await requireSession();
    const membership = await getMembership(companyId, session.uid);

    if (!membership) {
      redirect("/account");
    }

    return { session, membership };
  },
);

export function hasBranchAccess(
  membership: Pick<Membership, "branchIds">,
  branchId: string,
): boolean {
  return membership.branchIds.length === 0 || membership.branchIds.includes(branchId);
}

export type CompanyMembershipSummary = { companyId: string; role: Membership["role"] };

// "What companies do I belong to" -- the collection-group query mechanism,
// distinct from the direct-document-read mechanism above. Requires the
// collection-group index on memberships.uid (see firestore.indexes.json).
export async function listMyCompanies(uid: string): Promise<CompanyMembershipSummary[]> {
  const snap = await adminDb
    .collectionGroup("memberships")
    .where("uid", "==", uid)
    .where("status", "==", "active")
    .get();

  return snap.docs.map((doc) => ({
    companyId: doc.ref.parent.parent!.id,
    role: doc.data().role,
  }));
}

// The team roster for a single company -- backs the membership.view-gated
// member list in 1D. A single equality filter (status), so it needs no
// composite index beyond what 1C already declared.
export async function listCompanyMembers(companyId: string): Promise<Membership[]> {
  const snap = await adminDb
    .collection("companies")
    .doc(companyId)
    .collection("memberships")
    .where("status", "==", "active")
    .get();

  return snap.docs.map((doc) => {
    const data = doc.data();
    return {
      uid: data.uid,
      role: data.role,
      branchIds: Array.isArray(data.branchIds) ? data.branchIds : [],
      status: data.status,
    };
  });
}

// Filtered in application code rather than with a second `where('role', ==,
// 'Owner')` clause -- a company's roster is small, and this avoids needing
// a second composite index for a check that only runs on role-change/
// deactivation (see docs/DATABASE.md on indexes being a separate deploy
// step, not something to add without a real, already-written query).
async function countActiveOwners(companyId: string): Promise<number> {
  const members = await listCompanyMembers(companyId);
  return members.filter((member) => member.role === "Owner").length;
}

export async function isLastActiveOwner(companyId: string, uid: string): Promise<boolean> {
  const membership = await getMembership(companyId, uid);
  if (!membership || membership.role !== "Owner") return false;

  const ownerCount = await countActiveOwners(companyId);
  return ownerCount <= 1;
}

// Both of these are Admin-SDK-only mutations -- firestore.rules denies
// direct client writes to memberships unconditionally (see 1C), so the
// capability check in core/companies/members-actions.ts is the real
// authorization boundary, not a Security Rule.
export async function updateMembershipRole(
  companyId: string,
  uid: string,
  role: MembershipRole,
): Promise<void> {
  await adminDb
    .collection("companies")
    .doc(companyId)
    .collection("memberships")
    .doc(uid)
    .update({ role });
}

export async function deactivateMembership(companyId: string, uid: string): Promise<void> {
  await adminDb
    .collection("companies")
    .doc(companyId)
    .collection("memberships")
    .doc(uid)
    .update({ status: "disabled" });
}
