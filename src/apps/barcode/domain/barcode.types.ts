// Scan-to-sell reuses the exact same "cart of lines, checkout as one plain
// Core Order" shape Retail's own domain type established -- Barcode has no
// data Core doesn't already model either (payment/tender remains out of
// scope, same as Retail; see docs/phases/PHASE_4_PLAN.md). Deliberately not
// imported from Retail (Apps don't import each other's internals) -- this
// is a duplicate of the same small, stable shape, not a shared dependency.
export type QuickSaleLineInput = {
  itemId: string;
  itemNameSnapshot: string;
  quantity: number;
  unitPrice: number;
};

export type QuickSaleParams = {
  draftId: string;
  branchId: string;
  lines: QuickSaleLineInput[];
};
