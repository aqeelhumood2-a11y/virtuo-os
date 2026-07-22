// Core platform public barrel. Auth (1B), the Multi-Tenant Organization
// Model (1C), Roles & Permissions (1D), the Inventory Engine (1E), the
// Order Engine (1F), and Audit Logs & Notifications (1G) are implemented
// so far.
export {
  signUpAction,
  signInAction,
  signOutAction,
  requestPasswordResetAction,
  mintClientAuthTokenAction,
} from "./auth/actions";
export { getSession, requireSession } from "./auth/session";
export type { AuthFormState, AuthSession } from "./auth/types";

export { listAuditLogs, listAuditLogsPage, writeAuditInTransaction } from "./audit-logs";
export type { AuditAction, AuditLogEntry, AuditLogParams, AuditTargetType } from "./audit-logs";

export {
  createNotification,
  createNotificationInTransaction,
  listNotifications,
  listNotificationsPage,
  markAllAsRead,
  markAsRead,
  sendWhatsAppMessage,
  verifyWhatsAppCredential,
  WhatsAppSendError,
} from "./notifications";
export type {
  CreateNotificationInput,
  Notification,
  NotificationChannel,
  RelatedEntity,
  WhatsAppChannelConfig,
} from "./notifications";

export type { Page, PageOptions } from "@/shared/types";

export {
  createCompanyAction,
  suspendCompanyAction,
  updateBrandingAction,
  updateCompanyAction,
} from "./companies/actions";
export { setCompanyStatus, updateCompanyName } from "./companies/company";
export { getCompanyBranding, updateCompanyBranding } from "./companies/company-settings";
export type { CompanyBranding, CompanySettingsFormState } from "./companies/company-settings.types";
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
export { listBranches } from "./companies/branches";
export type {
  Branch,
  Company,
  CompanyActionFormState,
  CompanyAuditAction,
  MemberActionFormState,
  Membership,
  MembershipAuditAction,
  MembershipRole,
  OnboardingFormState,
  OnboardingResult,
} from "./companies/types";

export { hasCapability, isSuperAdmin, requireCapability, requireSuperAdmin } from "./roles-permissions/guard";
export { ROLE_CAPABILITIES, outranks } from "./roles-permissions/matrix";
export type { Capability, Role } from "./roles-permissions/types";

export {
  adjustStock,
  applyStockChangeInTransaction,
  commitStockChangePlan,
  createItem,
  deactivateItem,
  getItem,
  getItemByBarcode,
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
  InventoryAuditAction,
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
  OrderLineNotFoundError,
  OrderNotEditableError,
  OrderNotFoundError,
  removeOrderLine,
  updateOrderLineQuantity,
  voidOrder,
} from "./order-engine";
export type {
  CreateOrderInput,
  CreateOrderOptions,
  Order,
  OrderAuditAction,
  OrderLine,
  OrderLineInput,
  OrderStatus,
  OrderTotals,
} from "./order-engine";

export { updateDisplayNameAction } from "./users/actions";
export { getUserProfile } from "./users/profile";
export type { ProfileFormState, UserProfile } from "./users/types";
