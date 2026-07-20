// Core platform public barrel. Auth (1B) and the Multi-Tenant Organization
// Model -- Users/Companies/Branches/Memberships (1C) -- are implemented so
// far. Roles & Permissions (beyond the bare 'Owner' special-case), the
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
export { AlreadyOnboardedError, runOnboardingTransaction } from "./companies/onboarding";
export {
  getMembership,
  hasBranchAccess,
  listMyCompanies,
  requireCompanyMembership,
} from "./companies/membership";
export { getMyCompanySummary } from "./companies/queries";
export type {
  Branch,
  Company,
  Membership,
  MembershipRole,
  OnboardingFormState,
  OnboardingResult,
} from "./companies/types";

export { updateDisplayNameAction } from "./users/actions";
export { getUserProfile } from "./users/profile";
export type { ProfileFormState, UserProfile } from "./users/types";
