import { describe, expect, it } from "vitest";

import { InsufficientStockError } from "./errors";
import { assertSufficientStock, computeCountDelta } from "./stock-math";

describe("assertSufficientStock", () => {
  it("allows a delta that keeps quantityOnHand at or above zero", () => {
    expect(() => assertSufficientStock(10, -10)).not.toThrow();
    expect(() => assertSufficientStock(10, -5)).not.toThrow();
    expect(() => assertSufficientStock(0, 5)).not.toThrow();
  });

  it("throws InsufficientStockError when the delta would go negative", () => {
    expect(() => assertSufficientStock(5, -6)).toThrow(InsufficientStockError);
    expect(() => assertSufficientStock(0, -1)).toThrow(InsufficientStockError);
  });
});

describe("computeCountDelta", () => {
  it("returns the difference between the counted and recorded quantity", () => {
    expect(computeCountDelta(10, 12)).toBe(2);
    expect(computeCountDelta(10, 7)).toBe(-3);
  });

  it("returns zero when the count matches the recorded quantity", () => {
    expect(computeCountDelta(10, 10)).toBe(0);
  });
});
