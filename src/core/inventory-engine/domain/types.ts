// 'sale' is a documented future movement type, produced only by the Order
// Engine (Phase 1F) deducting stock on a completed sale -- no 1E function
// ever writes it. See docs/DATABASE.md.
export type MovementType = "receive" | "adjust" | "transfer" | "waste" | "sale";

// Colocated with MovementType rather than centrally maintained in
// core/audit-logs -- adding a new inventory mutation means extending this
// union right here, next to the code that produces it, never editing a
// file in a different module. core/audit-logs/audit-log.types.ts unions
// this into the public AuditAction type; see the comment there.
export type InventoryAuditAction =
  | "inventory.itemCreated"
  | "inventory.itemUpdated"
  | "inventory.itemDeactivated"
  | "inventory.stockReceived"
  | "inventory.stockWasted"
  | "inventory.stockAdjusted"
  | "inventory.stockCounted"
  | "inventory.stockTransferred"
  | "inventory.stockSold";

export type InventoryItem = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  category: string;
  defaultPrice: number;
  isActive: boolean;
  // Optional, additive (Phase 6 -- Barcode App). Deliberately distinct from
  // sku: a barcode is the physical symbology (UPC/EAN/etc.) a scanner
  // reads, which frequently differs from an item's own internal catalog
  // code. Business-agnostic the same way sku/unit/category are -- not a
  // Barcode-App-specific field bolted on, a genuine Core concept the App
  // merely happens to be the first to need. See docs/phases/PHASE_6_PLAN.md §4.
  barcode?: string;
};

export type Stock = {
  id: string; // `${branchId}_${itemId}` -- see infrastructure/refs.ts
  branchId: string;
  itemId: string;
  quantityOnHand: number;
  reorderPoint: number;
};

export type InventoryMovement = {
  id: string;
  itemId: string;
  branchId: string;
  type: MovementType;
  quantityDelta: number;
  itemNameSnapshot: string;
  reason: string;
  performedBy: string;
  // Only present on the paired 'transfer' movements written by
  // transferStock() -- links the source (-quantity) and destination
  // (+quantity) entries of the same transfer.
  transferGroupId?: string;
};
