import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const csrfTokensMatchMock = vi.fn();
const lookupByBarcodeMock = vi.fn();
const quickSaleMock = vi.fn();

let csrfCookieValue: string | undefined;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "csrf_token" && csrfCookieValue ? { value: csrfCookieValue } : undefined),
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/core/auth/csrf", () => ({
  csrfTokensMatch: (a: string, b: string) => csrfTokensMatchMock(a, b),
}));

vi.mock("@/core", () => ({
  BranchAccessDeniedError: class BranchAccessDeniedError extends Error {},
}));

vi.mock("./application/barcode.service", () => ({
  lookupByBarcode: (...args: unknown[]) => lookupByBarcodeMock(...args),
  quickSale: (...args: unknown[]) => quickSaleMock(...args),
}));

import { lookupBarcodeAction, quickSaleAction } from "./actions";

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  csrfCookieValue = "valid-csrf-token";
  csrfTokensMatchMock.mockReturnValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("lookupBarcodeAction", () => {
  const validForm = () => formData({ companyId: "company-1", barcode: "012345678905", csrfToken: "valid-csrf-token" });

  it("rejects when the CSRF token does not match", async () => {
    csrfTokensMatchMock.mockReturnValue(false);
    const result = await lookupBarcodeAction({}, validForm());

    expect(result.error).toMatch(/session has expired/i);
    expect(lookupByBarcodeMock).not.toHaveBeenCalled();
  });

  it("returns the found item on success", async () => {
    lookupByBarcodeMock.mockResolvedValue({ id: "item-1", sku: "SKU-1", name: "Widget", unit: "each", category: "general", defaultPrice: 9.99, isActive: true });
    const result = await lookupBarcodeAction({}, validForm());

    expect(lookupByBarcodeMock).toHaveBeenCalledWith("company-1", "012345678905");
    expect(result.item?.id).toBe("item-1");
  });

  it("reports a clear error when nothing matches", async () => {
    lookupByBarcodeMock.mockResolvedValue(null);
    const result = await lookupBarcodeAction({}, validForm());

    expect(result.error).toMatch(/no item found/i);
  });
});

describe("quickSaleAction", () => {
  const validForm = () =>
    formData({
      companyId: "company-1",
      branchId: "branch-1",
      linesJson: JSON.stringify([{ itemId: "item-1", itemNameSnapshot: "Widget", quantity: 1, unitPrice: 9.99 }]),
      csrfToken: "valid-csrf-token",
    });

  it("rejects when the CSRF token does not match", async () => {
    csrfTokensMatchMock.mockReturnValue(false);
    const result = await quickSaleAction({}, validForm());

    expect(result.error).toMatch(/session has expired/i);
    expect(quickSaleMock).not.toHaveBeenCalled();
  });

  it("rejects invalid linesJson", async () => {
    const result = await quickSaleAction(
      {},
      formData({ companyId: "company-1", branchId: "branch-1", linesJson: "{not json", csrfToken: "valid-csrf-token" }),
    );

    expect(result.error).toBeDefined();
    expect(quickSaleMock).not.toHaveBeenCalled();
  });

  it("calls quickSale with the parsed cart and reports success", async () => {
    quickSaleMock.mockResolvedValue({ id: "order-1" });
    const result = await quickSaleAction({}, validForm());

    expect(quickSaleMock).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        branchId: "branch-1",
        lines: [{ itemId: "item-1", itemNameSnapshot: "Widget", quantity: 1, unitPrice: 9.99 }],
      }),
    );
    expect(result.success).toBeDefined();
  });
});
