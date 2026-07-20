import { InsufficientStockError } from "./errors";

// The one invariant every stock mutation must satisfy: quantityOnHand can
// never go negative. Pure and side-effect-free so it can run both inside
// and outside a Firestore transaction with identical behavior.
export function assertSufficientStock(quantityOnHand: number, quantityDelta: number): void {
  if (quantityOnHand + quantityDelta < 0) {
    throw new InsufficientStockError();
  }
}

// A physical count doesn't supply a delta directly -- it supplies the
// counted truth, and the delta is derived from what the system already
// believed. Kept separate from the transaction so the math has no I/O.
export function computeCountDelta(quantityOnHand: number, countedQuantity: number): number {
  return countedQuantity - quantityOnHand;
}
