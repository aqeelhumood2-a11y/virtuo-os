// 'sale' is a documented future movement type, produced only by the Order
// Engine (Phase 1F) deducting stock on a completed sale -- no 1E function
// ever writes it. See docs/DATABASE.md.
export type MovementType = "receive" | "adjust" | "transfer" | "waste" | "sale";

export type InventoryItem = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  category: string;
  defaultPrice: number;
  isActive: boolean;
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
