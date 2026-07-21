import "server-only";

import { redirect } from "next/navigation";

import { requireCompanyMembership } from "@/core/companies/membership";
import type { CompanyMembershipContext } from "@/core/companies/membership";
import type { Role } from "@/core/roles-permissions/types";

import type { AppInstallCapability } from "../app-installs/app-install.types";
import type { ConnectorCapability } from "../connector-connections/connector-connection.types";
import type { LicenseCapability } from "../licenses/license.types";

// Platform's own capability vocabulary and role matrix -- entirely
// separate from core/roles-permissions' Capability/ROLE_CAPABILITIES,
// which are never edited for anything Platform needs. Reuses only Core's
// Role type and requireCompanyMembership() (pure tenancy primitives, not
// RBAC business knowledge) -- Core has zero awareness that "apps",
// "connectors", or "licenses" are concepts. See docs/phases/PHASE_2_PLAN.md §8.
export type PlatformCapability = AppInstallCapability | ConnectorCapability | LicenseCapability;

const PLATFORM_ROLE_CAPABILITIES: Record<Role, PlatformCapability[]> = {
  Owner: ["apps.view", "apps.install", "connectors.view", "connectors.manage", "licenses.view"],
  Manager: ["apps.view", "connectors.view", "licenses.view"],
  Supervisor: [],
  Employee: [],
};

export function hasPlatformCapability(role: Role, capability: PlatformCapability): boolean {
  return PLATFORM_ROLE_CAPABILITIES[role].includes(capability);
}

// The Platform-side equivalent of core/roles-permissions' requireCapability
// -- same shape (re-derive membership, check a capability, redirect to
// /account if missing), just checked against Platform's own matrix instead
// of Core's.
export async function requirePlatformCapability(
  companyId: string,
  capability: PlatformCapability,
): Promise<CompanyMembershipContext> {
  const context = await requireCompanyMembership(companyId);

  if (!hasPlatformCapability(context.membership.role, capability)) {
    redirect("/account");
  }

  return context;
}
