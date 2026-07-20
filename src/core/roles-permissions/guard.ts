import "server-only";

import { redirect } from "next/navigation";

import { requireCompanyMembership } from "@/core/companies/membership";
import type { CompanyMembershipContext } from "@/core/companies/membership";
import type { AuthSession } from "@/core/auth/types";

import { ROLE_CAPABILITIES } from "./matrix";
import type { Capability, Role } from "./types";

export function hasCapability(role: Role, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}

// SuperAdmin is a global bypass, never a membership role -- it grants no
// capabilities of its own in 1D (no write path checks it) and is exposed
// here only for the read-side bypass mirrored in firestore.rules and any
// future ops-only surface. See ARCHITECTURE.md §5.
export function isSuperAdmin(session: Pick<AuthSession, "superAdmin">): boolean {
  return session.superAdmin === true;
}

// The single authorization entry point for anything capability-gated.
// Composes on requireCompanyMembership() (which already re-derives uid and
// membership from Firestore, never from the client or from custom-claims
// cache) and adds the capability check on top. An authenticated member who
// lacks the capability is not "unauthenticated" -- same redirect-to-/account
// outcome as requireCompanyMembership uses for "not a member at all."
export async function requireCapability(
  companyId: string,
  capability: Capability,
): Promise<CompanyMembershipContext> {
  const context = await requireCompanyMembership(companyId);

  if (!hasCapability(context.membership.role, capability)) {
    redirect("/account");
  }

  return context;
}
