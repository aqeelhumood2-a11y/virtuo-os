// Core platform public barrel. Auth (1B), the Multi-Tenant Organization
// Model (1C), Roles & Permissions (1D), the Inventory Engine (1E), and the
// Order Engine (1F) are implemented so far. Audit Logs and Notifications
// remain reserved for later phases.
export {
  signUpAction,
  signInAction,
  signOutAction,
  requestPasswordResetAction,
} from "./auth/actions";
export { getSession, requireSession } from "./auth/session";
export type { AuthFormState, AuthSession } from "./auth/types";

export { createCompanyAction } from "./companies/actions";
export { BranchAccessDeniedError } from "./companies/errors";
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

export {
  adjustStock,
  applyStockChangeInTransaction,
  commitStockChangePlan,
  createItem,
  deactivateItem,
  getItem,
  getStockLevel,
  InsufficientStockError,
  ItemNotFoundError,
  listItems,
  listMovementsForBranch,
  listStockForBranch,
  planStockChange,
  receiveStock,
  recordStockCount,
  transferStock,
  updateItem,
  wasteStock,
} from "./inventory-engine";
export type {
  ApplyStockChangeParams,
  CreateItemInput,
  InventoryItem,
  InventoryMovement,
  MovementType,
  Stock,
  StockChangePlan,
  UpdateItemInput,
} from "./inventory-engine";

export {
  addOrderLine,
  canTransition,
  completeOrder,
  computeLineTotal,
  computeTotals,
  createOrder,
  getOrder,
  InvalidOrderTransitionError,
  listOrderLines,
  listOrdersForBranch,
  OrderNotEditableError,
  OrderNotFoundError,
  voidOrder,
} from "./order-engine";
export type { CreateOrderInput, Order, OrderLine, OrderLineInput, OrderStatus, OrderTotals } from "./order-engine";

export { updateDisplayNameAction } from "./users/actions";
export { getUserProfile } from "./users/profile";
export type { ProfileFormState, UserProfile } from "./users/types";
