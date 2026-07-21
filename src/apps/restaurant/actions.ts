"use server";

import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { CSRF_COOKIE_NAME } from "@/core/auth/constants";
import { csrfTokensMatch } from "@/core/auth/csrf";
import {
  BranchAccessDeniedError,
  InvalidOrderTransitionError,
  OrderLineNotFoundError,
  OrderNotEditableError,
  OrderNotFoundError,
  requireCompanyMembership,
} from "@/core";

import {
  addLine,
  completeTicket,
  createTicket,
  removeLine,
  updateLineQuantity,
  voidTicket,
} from "./application/order-ticket.service";

export type RestaurantActionFormState = {
  error?: string;
  success?: string;
};

async function verifyCsrf(formData: FormData): Promise<boolean> {
  const submitted = formData.get("csrfToken");
  if (typeof submitted !== "string") return false;

  const cookieStore = await cookies();
  const expected = cookieStore.get(CSRF_COOKIE_NAME)?.value;
  return csrfTokensMatch(submitted, expected ?? "");
}

function mapError(error: unknown): string {
  if (
    error instanceof BranchAccessDeniedError ||
    error instanceof OrderNotEditableError ||
    error instanceof OrderNotFoundError ||
    error instanceof OrderLineNotFoundError ||
    error instanceof InvalidOrderTransitionError
  ) {
    return error.message;
  }
  console.error("Restaurant action failed:", error);
  return "Something went wrong. Please try again.";
}

const startOrderSchema = z.object({
  companyId: z.string().trim().min(1),
  branchId: z.string().trim().min(1),
  orderType: z.enum(["dineIn", "takeaway", "delivery"]),
  tableRef: z.string().trim().optional(),
  guestCount: z.coerce.number().int().positive().optional(),
  kitchenNote: z.string().trim().optional(),
  itemId: z.string().trim().min(1),
  itemNameSnapshot: z.string().trim().min(1),
  unitPrice: z.coerce.number().nonnegative(),
});

// Thin wrapper only: CSRF check, form parsing, calling the App's own
// application-layer service, mapping thrown errors, revalidatePath -- same
// shape as settings/apps-management/actions.ts. draftId is minted here
// (server-side, once per submission) rather than trusted from client input,
// so a resubmission of the exact same POST (browser retry, accidental
// double-click before the response returns) reuses the same key only when
// the client itself resubmits the hidden field it was given back -- see
// components/MenuBrowser.tsx.
export async function startOrderAction(
  _prevState: RestaurantActionFormState,
  formData: FormData,
): Promise<RestaurantActionFormState> {
  if (!(await verifyCsrf(formData))) {
    return { error: "Your session has expired. Please refresh the page and try again." };
  }

  const parsed = startOrderSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid request." };

  const draftIdField = formData.get("draftId");
  const draftId = typeof draftIdField === "string" && draftIdField.length > 0 ? draftIdField : randomUUID();

  try {
    await createTicket(parsed.data.companyId, {
      draftId,
      branchId: parsed.data.branchId,
      orderType: parsed.data.orderType,
      tableRef: parsed.data.tableRef || null,
      guestCount: parsed.data.guestCount ?? null,
      kitchenNote: parsed.data.kitchenNote || null,
      lines: [
        {
          itemId: parsed.data.itemId,
          itemNameSnapshot: parsed.data.itemNameSnapshot,
          quantity: 1,
          unitPrice: parsed.data.unitPrice,
        },
      ],
    });
  } catch (error) {
    return { error: mapError(error) };
  }

  revalidatePath(`/${parsed.data.companyId}/apps/restaurant`);
  return { success: "Order started." };
}

const orderLineActionSchema = z.object({
  companyId: z.string().trim().min(1),
  orderId: z.string().trim().min(1),
  itemId: z.string().trim().min(1),
  itemNameSnapshot: z.string().trim().min(1),
  unitPrice: z.coerce.number().nonnegative(),
});

export async function addLineAction(
  _prevState: RestaurantActionFormState,
  formData: FormData,
): Promise<RestaurantActionFormState> {
  if (!(await verifyCsrf(formData))) {
    return { error: "Your session has expired. Please refresh the page and try again." };
  }

  const parsed = orderLineActionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid request." };

  try {
    await addLine(parsed.data.companyId, parsed.data.orderId, {
      itemId: parsed.data.itemId,
      itemNameSnapshot: parsed.data.itemNameSnapshot,
      quantity: 1,
      unitPrice: parsed.data.unitPrice,
    });
  } catch (error) {
    return { error: mapError(error) };
  }

  revalidatePath(`/${parsed.data.companyId}/apps/restaurant/ticket/${parsed.data.orderId}`);
  return { success: "Item added." };
}

const updateQuantitySchema = z.object({
  companyId: z.string().trim().min(1),
  orderId: z.string().trim().min(1),
  lineId: z.string().trim().min(1),
  quantity: z.coerce.number().int().positive(),
});

export async function updateQuantityAction(
  _prevState: RestaurantActionFormState,
  formData: FormData,
): Promise<RestaurantActionFormState> {
  if (!(await verifyCsrf(formData))) {
    return { error: "Your session has expired. Please refresh the page and try again." };
  }

  const parsed = updateQuantitySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid request." };

  try {
    await updateLineQuantity(parsed.data.companyId, parsed.data.orderId, parsed.data.lineId, parsed.data.quantity);
  } catch (error) {
    return { error: mapError(error) };
  }

  revalidatePath(`/${parsed.data.companyId}/apps/restaurant/ticket/${parsed.data.orderId}`);
  return { success: "Quantity updated." };
}

const orderLineIdActionSchema = z.object({
  companyId: z.string().trim().min(1),
  orderId: z.string().trim().min(1),
  lineId: z.string().trim().min(1),
});

export async function removeLineAction(
  _prevState: RestaurantActionFormState,
  formData: FormData,
): Promise<RestaurantActionFormState> {
  if (!(await verifyCsrf(formData))) {
    return { error: "Your session has expired. Please refresh the page and try again." };
  }

  const parsed = orderLineIdActionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid request." };

  try {
    await removeLine(parsed.data.companyId, parsed.data.orderId, parsed.data.lineId);
  } catch (error) {
    return { error: mapError(error) };
  }

  revalidatePath(`/${parsed.data.companyId}/apps/restaurant/ticket/${parsed.data.orderId}`);
  return { success: "Item removed." };
}

const orderActionSchema = z.object({
  companyId: z.string().trim().min(1),
  orderId: z.string().trim().min(1),
});

export async function completeOrderAction(
  _prevState: RestaurantActionFormState,
  formData: FormData,
): Promise<RestaurantActionFormState> {
  if (!(await verifyCsrf(formData))) {
    return { error: "Your session has expired. Please refresh the page and try again." };
  }

  const parsed = orderActionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid request." };

  try {
    await completeTicket(parsed.data.companyId, parsed.data.orderId);
  } catch (error) {
    return { error: mapError(error) };
  }

  revalidatePath(`/${parsed.data.companyId}/apps/restaurant`);
  return { success: "Order completed." };
}

export async function voidOrderAction(
  _prevState: RestaurantActionFormState,
  formData: FormData,
): Promise<RestaurantActionFormState> {
  if (!(await verifyCsrf(formData))) {
    return { error: "Your session has expired. Please refresh the page and try again." };
  }

  const parsed = orderActionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid request." };

  try {
    const { session } = await requireCompanyMembership(parsed.data.companyId);
    await voidTicket(parsed.data.companyId, parsed.data.orderId, session.uid);
  } catch (error) {
    return { error: mapError(error) };
  }

  revalidatePath(`/${parsed.data.companyId}/apps/restaurant`);
  return { success: "Order voided." };
}
