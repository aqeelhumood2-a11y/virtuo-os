import { describe, expect, it } from "vitest";

import { computeLineTotal, computeTotals } from "./pricing";

describe("computeLineTotal", () => {
  it("multiplies quantity by unit price", () => {
    expect(computeLineTotal(3, 9.99)).toBeCloseTo(29.97);
  });
});

describe("computeTotals", () => {
  it("sums line totals into a subtotal, defaulting tax/discount to zero", () => {
    expect(computeTotals({ lineTotals: [10, 20, 5] })).toEqual({
      subtotal: 35,
      tax: 0,
      discount: 0,
      total: 35,
    });
  });

  it("adds tax and subtracts discount from the subtotal", () => {
    expect(computeTotals({ lineTotals: [100], tax: 8, discount: 10 })).toEqual({
      subtotal: 100,
      tax: 8,
      discount: 10,
      total: 98,
    });
  });

  it("returns a zero subtotal/total for no lines", () => {
    expect(computeTotals({ lineTotals: [] })).toEqual({
      subtotal: 0,
      tax: 0,
      discount: 0,
      total: 0,
    });
  });
});
