import { describe, expect, it } from "vitest";

import { canTransition } from "./state-machine";

describe("canTransition", () => {
  it("allows pending -> completed", () => {
    expect(canTransition("pending", "completed")).toBe(true);
  });

  it("allows pending -> voided", () => {
    expect(canTransition("pending", "voided")).toBe(true);
  });

  it("allows completed -> voided", () => {
    expect(canTransition("completed", "voided")).toBe(true);
  });

  it("denies completed -> pending (no un-completing an order)", () => {
    expect(canTransition("completed", "pending")).toBe(false);
  });

  it("denies completed -> completed (no double-completion)", () => {
    expect(canTransition("completed", "completed")).toBe(false);
  });

  it("denies any transition out of voided (terminal state)", () => {
    expect(canTransition("voided", "pending")).toBe(false);
    expect(canTransition("voided", "completed")).toBe(false);
    expect(canTransition("voided", "voided")).toBe(false);
  });

  it("denies pending -> pending (no-op is not a transition)", () => {
    expect(canTransition("pending", "pending")).toBe(false);
  });
});
