import "server-only";

import { cache } from "react";
import type { DocumentData } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import { requireCapability } from "@/core/roles-permissions";

import type { Branch } from "./types";

function branchesCollection(companyId: string) {
  return adminDb.collection("companies").doc(companyId).collection("branches");
}

function toBranch(id: string, data: DocumentData): Branch {
  return {
    id,
    name: data.name,
    isActive: data.isActive === true,
    isDefault: data.isDefault === true,
  };
}

// A small, previously-missing read query: 1C only ever created a single
// default branch and queried it ad hoc for a summary (queries.ts's
// getMyCompanySummary), so no general "list every branch" entry point
// existed until Phase 3's Restaurant App needed one for its own branch
// picker. Gated by the same branch.view capability the matrix has carried
// since 1D -- a pure additive read, no change to any existing caller.
//
// Phase 7: wrapped in React's cache() the same way core/auth/session.ts's
// getSession() and core/companies/membership.ts's requireCompanyMembership()
// already are -- several Apps (Restaurant, Retail, AI Assistant) call this
// for the same companyId from independent Server Components within one
// request/render pass, and the branch list itself is per-request-static
// (nothing in a single request mutates it), so deduping the Firestore read
// is free and carries no staleness risk beyond the request's own lifetime.
export const listBranches = cache(async (companyId: string): Promise<Branch[]> => {
  await requireCapability(companyId, "branch.view");
  const snap = await branchesCollection(companyId).get();
  return snap.docs.map((doc) => toBranch(doc.id, doc.data()));
});
