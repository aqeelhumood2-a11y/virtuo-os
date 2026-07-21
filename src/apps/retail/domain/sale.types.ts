// A retail sale is a plain Core Order -- unlike Restaurant (which needs
// order type/table/guest count/kitchen note, fields Core cannot own),
// Retail has no data Core doesn't already model. Payment/tender is
// explicitly out of scope for this phase (see docs/phases/PHASE_4_PLAN.md),
// so there is nothing left for Retail to own: no domain type beyond this
// plain input shape, no App-owned Firestore collection, no App-specific
// audit vocabulary.
export type SaleLineInput = {
  itemId: string;
  itemNameSnapshot: string;
  quantity: number;
  unitPrice: number;
};

export type CreateSaleParams = {
  draftId: string;
  branchId: string;
  lines: SaleLineInput[];
};
