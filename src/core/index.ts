// Core platform public barrel. Auth (1B), the Multi-Tenant Organization
// Model (1C), and Roles & Permissions (1D) are implemented so far. The
// Inventory Engine, the Order Engine, Audit Logs, and Notifications remain
// reserved for later phases.
export {
  signUpAction,
  signInAction,
  signOutAction,
  requestPasswordResetAction,
} from "./auth/actions";
export { getSession, requireSession } from "./auth/session";
export type { AuthFormState, AuthSession } from "./auth/types";

export { createCompanyAction } from "./companies/actions";
export { deactivateMemberAction, updateMemberRoleAction } from "./companies/members-actions";
export { AlreadyOnboardedError, runOnboardingTransaction } from "./companies/onboarding";
export {
  getMembership,
  hasBranchAccess,
  isLastActiveOwner,
  listCompanyMembers,
  listMyCompanies,
  requireCompanyMembership,
} from "./companies/membership";
export { getMyCompanySummary } from "./companies/queries";
export type {
  Branch,
  Company,
  MemberActionFormState,
  Membership,
  MembershipRole,
  OnboardingFormState,
  OnboardingResult,
} from "./companies/types";

export { hasCapability, isSuperAdmin, requireCapability } from "./roles-permissions/guard";
export { ROLE_CAPABILITIES, outranks } from "./roles-permissions/matrix";
export type { Capability, Role } from "./roles-permissions/types";

export { updateDisplayNameAction } from "./users/actions";
export { getUserProfile } from "./users/profile";
export type { ProfileFormState, UserProfile } from "./users/types";
