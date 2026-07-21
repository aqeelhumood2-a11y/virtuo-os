import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const csrfTokensMatchMock = vi.fn();
const createSaleMock = vi.fn();
const addLineMock = vi.fn();
const updateLineQuantityMock = vi.fn();
const removeLineMock = vi.fn();
const completeSaleMock = vi.fn();
const voidSaleMock = vi.fn();
const requireCompanyMembershipMock = vi.fn();

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

vi.mock("@/core", async () => {
  const actual = await vi.importActual<typeof import("@/core")>("@/core");
  return {
    ...actual,
    requireCompanyMembership: (...args: unknown[]) => requireCompanyMembershipMock(...args),
  };
});

vi.mock("./application/sale.service", () => ({
  createSale: (...args: unknown[]) => createSaleMock(...args),
  addLine: (...args: unknown[]) => addLineMock(...args),
  updateLineQuantity: (...args: unknown[]) => updateLineQuantityMock(...args),
  removeLine: (...args: unknown[]) => removeLineMock(...args),
  completeSale: (...args: unknown[]) => completeSaleMock(...args),
  voidSale: (...args: unknown[]) => voidSaleMock(...args),
}));

import { OrderNotEditableError } from "@/core";

import {
  addLineAction,
  checkoutAction,
  completeSaleAction,
  removeLineAction,
  updateQuantityAction,
  voidSaleAction,
} from "./actions";

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  csrfCookieValue = "valid-csrf-token";
  csrfTokensMatchMock.mockReturnValue(true);
  requireCompanyMembershipMock.mockResolvedValue({
    session: { uid: "owner-1", email: null, superAdmin: false },
    membership: { uid: "owner-1", role: "Owner", branchIds: [], status: "active" },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("checkoutAction", () => {
  const cartLines = [
    { itemId: "item-1", itemNameSnapshot: "Widget", quantity: 2, unitPrice: 5 },
    { itemId: "item-2", itemNameSnapshot: "Gadget", quantity: 1, unitPrice: 10 },
  ];
  const validForm = () =>
    formData({
      csrfToken: "valid-csrf-token",
      companyId: "company-1",
      branchId: "branch-1",
      draftId: "draft-1",
      linesJson: JSON.stringify(cartLines),
    });

  it("rejects when the CSRF token does not match", async () => {
    csrfTokensMatchMock.mockReturnValue(false);
    const result = await checkoutAction({}, validForm());

    expect(result.error).toMatch(/session has expired/i);
    expect(createSaleMock).not.toHaveBeenCalled();
  });

  it("parses the JSON cart and calls createSale with every line", async () => {
    const result = await checkoutAction({}, validForm());

    expect(createSaleMock).toHaveBeenCalledWith("company-1", {
      draftId: "draft-1",
      branchId: "branch-1",
      lines: cartLines,
    });
    expect(result.success).toBeDefined();
  });

  it("rejects an empty cart", async () => {
    const form = validForm();
    form.set("linesJson", JSON.stringify([]));
    const result = await checkoutAction({}, form);

    expect(result.error).toBe("Invalid request.");
    expect(createSaleMock).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const form = validForm();
    form.set("linesJson", "not json");
    const result = await checkoutAction({}, form);

    expect(result.error).toBe("Invalid request.");
    expect(createSaleMock).not.toHaveBeenCalled();
  });

  it("maps a thrown domain error to its own message", async () => {
    createSaleMock.mockRejectedValue(new OrderNotEditableError());
    const result = await checkoutAction({}, validForm());

    expect(result.error).toMatch(/pending order can be edited/i);
  });
});

describe("addLineAction", () => {
  it("calls addLine with the validated fields", async () => {
    const result = await addLineAction(
      {},
      formData({
        csrfToken: "valid-csrf-token",
        companyId: "company-1",
        orderId: "order-1",
        itemId: "item-2",
        itemNameSnapshot: "Fries",
        unitPrice: "4",
      }),
    );

    expect(addLineMock).toHaveBeenCalledWith("company-1", "order-1", {
      itemId: "item-2",
      itemNameSnapshot: "Fries",
      quantity: 1,
      unitPrice: 4,
    });
    expect(result.success).toBeDefined();
  });
});

describe("updateQuantityAction", () => {
  it("calls updateLineQuantity with the parsed quantity", async () => {
    const result = await updateQuantityAction(
      {},
      formData({
        csrfToken: "valid-csrf-token",
        companyId: "company-1",
        orderId: "order-1",
        lineId: "line-1",
        quantity: "3",
      }),
    );

    expect(updateLineQuantityMock).toHaveBeenCalledWith("company-1", "order-1", "line-1", 3);
    expect(result.success).toBeDefined();
  });
});

describe("removeLineAction", () => {
  it("calls removeLine with the validated ids", async () => {
    const result = await removeLineAction(
      {},
      formData({ csrfToken: "valid-csrf-token", companyId: "company-1", orderId: "order-1", lineId: "line-1" }),
    );

    expect(removeLineMock).toHaveBeenCalledWith("company-1", "order-1", "line-1");
    expect(result.success).toBeDefined();
  });
});

describe("completeSaleAction", () => {
  it("calls completeSale", async () => {
    const result = await completeSaleAction(
      {},
      formData({ csrfToken: "valid-csrf-token", companyId: "company-1", orderId: "order-1" }),
    );

    expect(completeSaleMock).toHaveBeenCalledWith("company-1", "order-1");
    expect(result.success).toBeDefined();
  });
});

describe("voidSaleAction", () => {
  it("resolves the actor via requireCompanyMembership, then calls voidSale with it", async () => {
    const result = await voidSaleAction(
      {},
      formData({ csrfToken: "valid-csrf-token", companyId: "company-1", orderId: "order-1" }),
    );

    expect(requireCompanyMembershipMock).toHaveBeenCalledWith("company-1");
    expect(voidSaleMock).toHaveBeenCalledWith("company-1", "order-1", "owner-1");
    expect(result.success).toBeDefined();
  });
});
