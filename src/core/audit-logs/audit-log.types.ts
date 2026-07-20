// The fixed vocabulary of auditable actions across Core, one entry per
// mutation path in Phases 1C-1F. Extend here (never with a free-form
// string) when a new mutation is added -- same reasoning as
// inventory-engine's MovementType union.
export type AuditAction =
  | "company.onboarded"
  | "company.updated"
  | "company.suspended"
  | "company.reactivated"
  | "membership.roleUpdated"
  | "membership.deactivated"
  | "inventory.itemCreated"
  | "inventory.itemUpdated"
  | "inventory.itemDeactivated"
  | "inventory.stockReceived"
  | "inventory.stockWasted"
  | "inventory.stockAdjusted"
  | "inventory.stockCounted"
  | "inventory.stockTransferred"
  | "inventory.stockSold"
  | "order.created"
  | "order.lineAdded"
  | "order.completed"
  | "order.voided";

export type AuditTargetType = "company" | "membership" | "inventoryItem" | "stock" | "order";

export type AuditLogEntry = {
  id: string;
  actorId: string;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  branchId?: string;
  // Small, shallow snapshots only (a role string, a status, a quantity) --
  // never a full document or a large array (e.g. an order's line items).
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
};
