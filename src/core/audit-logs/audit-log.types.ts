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

export type AuditTargetType = "company" | "membership" | "inventoryItem" | "stock" | "order" | "companySettings";

// action/targetType are deliberately `string`, not `AuditAction`/
// `AuditTargetType` -- since Phase 2, this collection is written not only
// by Core (whose own call sites are still checked against the closed
// AuditAction/AuditTargetType unions via writeAuditInTransaction's default
// type parameters, see audit-logger.ts) but also by Platform, which owns
// its own separate closed vocabulary Core never imports. A read of "any
// entry in this company's log, regardless of which layer wrote it" can't
// honestly claim every entry's action is one of Core's own literals.
export type AuditLogEntry = {
  id: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  branchId?: string;
  // Small, shallow snapshots only (a role string, a status, a quantity) --
  // never a full document or a large array (e.g. an order's line items).
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
};
