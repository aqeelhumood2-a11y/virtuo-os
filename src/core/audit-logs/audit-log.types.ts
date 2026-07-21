import type { CompanyAuditAction, MembershipAuditAction } from "@/core/companies/types";
import type { InventoryAuditAction } from "@/core/inventory-engine/domain/types";
import type { OrderAuditAction } from "@/core/order-engine/domain/types";

// The fixed vocabulary of auditable actions across Core, assembled from
// each domain module's own action union rather than maintained as one flat
// list here. Adding a new mutation means extending the *owning* module's
// type (CompanyAuditAction, InventoryAuditAction, ...), right next to the
// enum/union that already drives it (e.g. MovementType) -- never editing
// this file, and never a free-form string. This file only re-exports the
// union; it never defines a new action literal itself.
export type AuditAction = CompanyAuditAction | MembershipAuditAction | InventoryAuditAction | OrderAuditAction;

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
