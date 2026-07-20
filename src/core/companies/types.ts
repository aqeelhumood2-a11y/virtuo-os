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
