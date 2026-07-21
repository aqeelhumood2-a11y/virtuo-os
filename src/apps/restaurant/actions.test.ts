import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const csrfTokensMatchMock = vi.fn();
const createTicketMock = vi.fn();
const addLineMock = vi.fn();
const updateLineQuantityMock = vi.fn();
const removeLineMock = vi.fn();
const completeTicketMock = vi.fn();
const voidTicketMock = vi.fn();
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

vi.mock("./application/order-ticket.service", () => ({
  createTicket: (...args: unknown[]) => createTicketMock(...args),
  addLine: (...args: unknown[]) => addLineMock(...args),
  updateLineQuantity: (...args: unknown[]) => updateLineQuantityMock(...args),
  removeLine: (...args: unknown[]) => removeLineMock(...args),
  completeTicket: (...args: unknown[]) => completeTicketMock(...args),
  voidTicket: (...args: unknown[]) => voidTicketMock(...args),
}));

import { OrderNotEditableError } from "@/core";

import {
  addLineAction,
  completeOrderAction,
  removeLineAction,
  startOrderAction,
  updateQuantityAction,
  voidOrderAction,
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

describe("startOrderAction", () => {
  const validForm = () =>
    formData({
      csrfToken: "valid-csrf-token",
      companyId: "company-1",
      branchId: "branch-1",
      orderType: "dineIn",
      tableRef: "Table 4",
      itemId: "item-1",
      itemNameSnapshot: "Burger",
      unitPrice: "10",
      draftId: "draft-1",
    });

  it("rejects when the CSRF token does not match", async () => {
    csrfTokensMatchMock.mockReturnValue(false);
    const result = await startOrderAction({}, validForm());

    expect(result.error).toMatch(/session has expired/i);
    expect(createTicketMock).not.toHaveBeenCalled();
  });

  it("calls createTicket with a single line built from the chosen item, reusing the client's draftId", async () => {
    const result = await startOrderAction({}, validForm());

    expect(createTicketMock).toHaveBeenCalledWith("company-1", {
      draftId: "draft-1",
      branchId: "branch-1",
      orderType: "dineIn",
      tableRef: "Table 4",
      guestCount: null,
      kitchenNote: null,
      lines: [{ itemId: "item-1", itemNameSnapshot: "Burger", quantity: 1, unitPrice: 10 }],
    });
    expect(result.success).toBeDefined();
  });

  it("maps a thrown domain error to its own message", async () => {
    createTicketMock.mockRejectedValue(new OrderNotEditableError());
    const result = await startOrderAction({}, validForm());

    expect(result.error).toMatch(/pending order can be edited/i);
  });

  it("rejects an invalid orderType", async () => {
    const form = validForm();
    form.set("orderType", "brunch");
    const result = await startOrderAction({}, form);

    expect(result.error).toBe("Invalid request.");
    expect(createTicketMock).not.toHaveBeenCalled();
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

describe("completeOrderAction", () => {
  it("calls completeTicket", async () => {
    const result = await completeOrderAction(
      {},
      formData({ csrfToken: "valid-csrf-token", companyId: "company-1", orderId: "order-1" }),
    );

    expect(completeTicketMock).toHaveBeenCalledWith("company-1", "order-1");
    expect(result.success).toBeDefined();
  });
});

describe("voidOrderAction", () => {
  it("resolves the actor via requireCompanyMembership, then calls voidTicket excluding no one but passing the actor", async () => {
    const result = await voidOrderAction(
      {},
      formData({ csrfToken: "valid-csrf-token", companyId: "company-1", orderId: "order-1" }),
    );

    expect(requireCompanyMembershipMock).toHaveBeenCalledWith("company-1");
    expect(voidTicketMock).toHaveBeenCalledWith("company-1", "order-1", "owner-1");
    expect(result.success).toBeDefined();
  });
});
