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

import { addLine, completeSale, createSale, removeLine, updateLineQuantity, voidSale } from "./application/sale.service";

export type RetailActionFormState = {
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
  console.error("Retail action failed:", error);
  return "Something went wrong. Please try again.";
}

const saleLineSchema = z.object({
  itemId: z.string().trim().min(1),
  itemNameSnapshot: z.string().trim().min(1),
  quantity: z.coerce.number().int().positive(),
  unitPrice: z.coerce.number().nonnegative(),
});

const checkoutSchema = z.object({
  companyId: z.string().trim().min(1),
  branchId: z.string().trim().min(1),
  linesJson: z.string().min(1),
});

// Thin wrapper only: CSRF check, form parsing, calling the App's own
// application-layer service, mapping thrown errors, revalidatePath -- same
// shape as apps/restaurant/actions.ts. Unlike Restaurant's startOrderAction
// (which submits one item at a time), the cart here is built entirely
// client-side (components/ItemBrowser.tsx) and submitted as a single JSON
// payload, since a retail sale's lines are all known before checkout.
export async function checkoutAction(
  _prevState: RetailActionFormState,
  formData: FormData,
): Promise<RetailActionFormState> {
  if (!(await verifyCsrf(formData))) {
    return { error: "Your session has expired. Please refresh the page and try again." };
  }

  const parsed = checkoutSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid request." };

  let rawLines: unknown;
  try {
    rawLines = JSON.parse(parsed.data.linesJson);
  } catch {
    return { error: "Invalid request." };
  }
  const linesParsed = z.array(saleLineSchema).min(1).safeParse(rawLines);
  if (!linesParsed.success) return { error: "Invalid request." };

  const draftIdField = formData.get("draftId");
  const draftId = typeof draftIdField === "string" && draftIdField.length > 0 ? draftIdField : randomUUID();

  try {
    await createSale(parsed.data.companyId, {
      draftId,
      branchId: parsed.data.branchId,
      lines: linesParsed.data,
    });
  } catch (error) {
    return { error: mapError(error) };
  }

  revalidatePath(`/${parsed.data.companyId}/apps/retail`);
  return { success: "Sale started." };
}

const saleLineActionSchema = z.object({
  companyId: z.string().trim().min(1),
  orderId: z.string().trim().min(1),
  itemId: z.string().trim().min(1),
  itemNameSnapshot: z.string().trim().min(1),
  unitPrice: z.coerce.number().nonnegative(),
});

export async function addLineAction(
  _prevState: RetailActionFormState,
  formData: FormData,
): Promise<RetailActionFormState> {
  if (!(await verifyCsrf(formData))) {
    return { error: "Your session has expired. Please refresh the page and try again." };
  }

  const parsed = saleLineActionSchema.safeParse(Object.fromEntries(formData));
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

  revalidatePath(`/${parsed.data.companyId}/apps/retail/sale/${parsed.data.orderId}`);
  return { success: "Item added." };
}

const updateQuantitySchema = z.object({
  companyId: z.string().trim().min(1),
  orderId: z.string().trim().min(1),
  lineId: z.string().trim().min(1),
  quantity: z.coerce.number().int().positive(),
});

export async function updateQuantityAction(
  _prevState: RetailActionFormState,
  formData: FormData,
): Promise<RetailActionFormState> {
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

  revalidatePath(`/${parsed.data.companyId}/apps/retail/sale/${parsed.data.orderId}`);
  return { success: "Quantity updated." };
}

const saleLineIdActionSchema = z.object({
  companyId: z.string().trim().min(1),
  orderId: z.string().trim().min(1),
  lineId: z.string().trim().min(1),
});

export async function removeLineAction(
  _prevState: RetailActionFormState,
  formData: FormData,
): Promise<RetailActionFormState> {
  if (!(await verifyCsrf(formData))) {
    return { error: "Your session has expired. Please refresh the page and try again." };
  }

  const parsed = saleLineIdActionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid request." };

  try {
    await removeLine(parsed.data.companyId, parsed.data.orderId, parsed.data.lineId);
  } catch (error) {
    return { error: mapError(error) };
  }

  revalidatePath(`/${parsed.data.companyId}/apps/retail/sale/${parsed.data.orderId}`);
  return { success: "Item removed." };
}

const saleActionSchema = z.object({
  companyId: z.string().trim().min(1),
  orderId: z.string().trim().min(1),
});

export async function completeSaleAction(
  _prevState: RetailActionFormState,
  formData: FormData,
): Promise<RetailActionFormState> {
  if (!(await verifyCsrf(formData))) {
    return { error: "Your session has expired. Please refresh the page and try again." };
  }

  const parsed = saleActionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid request." };

  try {
    await completeSale(parsed.data.companyId, parsed.data.orderId);
  } catch (error) {
    return { error: mapError(error) };
  }

  revalidatePath(`/${parsed.data.companyId}/apps/retail`);
  return { success: "Sale completed." };
}

export async function voidSaleAction(
  _prevState: RetailActionFormState,
  formData: FormData,
): Promise<RetailActionFormState> {
  if (!(await verifyCsrf(formData))) {
    return { error: "Your session has expired. Please refresh the page and try again." };
  }

  const parsed = saleActionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid request." };

  try {
    const { session } = await requireCompanyMembership(parsed.data.companyId);
    await voidSale(parsed.data.companyId, parsed.data.orderId, session.uid);
  } catch (error) {
    return { error: mapError(error) };
  }

  revalidatePath(`/${parsed.data.companyId}/apps/retail`);
  return { success: "Sale voided." };
}
