import type { Capability, Role } from "@/core/roles-permissions/types";

export type MembershipRole = Role;

export type Company = {
  id: string;
  name: string;
  ownerId: string;
  status: "active" | "suspended";
};

export type Branch = {
  id: string;
  name: string;
  isActive: boolean;
  isDefault: boolean;
};

export type Membership = {
  uid: string;
  role: MembershipRole;
  branchIds: string[];
  status: "active" | "invited" | "disabled";
  // Per-user capability grants beyond the role's default set. A data-model
  // allowance from ARCHITECTURE.md §5, reserved for a future override UI --
  // no guard reads this yet, so it has no effect in 1D.
  capabilityOverrides?: Capability[];
};

export type OnboardingResult = {
  companyId: string;
  branchId: string;
};

export type OnboardingFormState = {
  error?: string;
  success?: string;
};

export type MemberActionFormState = {
  error?: string;
  success?: string;
};

export type CompanyActionFormState = {
  error?: string;
  success?: string;
};

// Colocated with the rest of this module's own vocabulary (Company,
// Membership) rather than centrally maintained in core/audit-logs -- adding
// a new company/membership mutation means extending these two unions right
// here, next to the code that produces them, never editing a file in a
// different module. core/audit-logs/audit-log.types.ts unions these into
// the public AuditAction type; see the comment there.
export type CompanyAuditAction =
  | "company.onboarded"
  | "company.updated"
  | "company.suspended"
  | "company.reactivated";

export type MembershipAuditAction = "membership.roleUpdated" | "membership.deactivated";
