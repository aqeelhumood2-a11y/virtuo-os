import type { OrderTotals } from "./types";

// No real tax-rate logic here -- that's a future Settings/vertical concern.
// Core just sums whatever tax/discount figures the caller supplies.
export function computeLineTotal(quantity: number, unitPrice: number): number {
  return quantity * unitPrice;
}

export type ComputeTotalsInput = {
  lineTotals: number[];
  tax?: number;
  discount?: number;
};

export function computeTotals({ lineTotals, tax = 0, discount = 0 }: ComputeTotalsInput): OrderTotals {
  const subtotal = lineTotals.reduce((sum, lineTotal) => sum + lineTotal, 0);
  const total = subtotal + tax - discount;
  return { subtotal, tax, discount, total };
}
