export type OrderStatus = "pending" | "completed" | "voided";

export type OrderTotals = {
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
};

export type Order = {
  id: string;
  branchId: string;
  // Free-form tag naming which App created this order (e.g. "retail",
  // "restaurant") -- Core has no App registry until Phase 3, so this is
  // just recorded, never validated against a known set.
  appId: string;
  status: OrderStatus;
  customerRef?: string;
  totals: OrderTotals;
  createdBy: string;
};

export type OrderLine = {
  id: string;
  // Denormalized from the parent order at write time -- lets
  // firestore.rules branch-scope a line read without a parent lookup, the
  // same reason `inventoryMovements` carries its own branchId (1E).
  branchId: string;
  itemId: string;
  itemNameSnapshot: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};
