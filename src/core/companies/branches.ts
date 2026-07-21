import "server-only";

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
export async function listBranches(companyId: string): Promise<Branch[]> {
  await requireCapability(companyId, "branch.view");
  const snap = await branchesCollection(companyId).get();
  return snap.docs.map((doc) => toBranch(doc.id, doc.data()));
}
