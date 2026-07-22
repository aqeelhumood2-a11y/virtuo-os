"use server";

import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { CSRF_COOKIE_NAME } from "@/core/auth/constants";
import { csrfTokensMatch } from "@/core/auth/csrf";
import { BranchAccessDeniedError } from "@/core";
import type { InventoryItem } from "@/core";

import { lookupByBarcode, quickSale } from "./application/barcode.service";

export type BarcodeActionFormState = {
  error?: string;
  success?: string;
  item?: InventoryItem;
};

async function verifyCsrf(formData: FormData): Promise<boolean> {
  const submitted = formData.get("csrfToken");
  if (typeof submitted !== "string") return false;

  const cookieStore = await cookies();
  const expected = cookieStore.get(CSRF_COOKIE_NAME)?.value;
  return csrfTokensMatch(submitted, expected ?? "");
}

function mapError(error: unknown): string {
  if (error instanceof BranchAccessDeniedError) return error.message;
  console.error("Barcode action failed:", error);
  return "Something went wrong. Please try again.";
}

const lookupSchema = z.object({
  companyId: z.string().trim().min(1),
  barcode: z.string().trim().min(1),
});

export async function lookupBarcodeAction(
  _prevState: BarcodeActionFormState,
  formData: FormData,
): Promise<BarcodeActionFormState> {
  if (!(await verifyCsrf(formData))) {
    return { error: "Your session has expired. Please refresh the page and try again." };
  }

  const parsed = lookupSchema.safeParse({ companyId: formData.get("companyId"), barcode: formData.get("barcode") });
  if (!parsed.success) return { error: "Invalid request." };

  try {
    const item = await lookupByBarcode(parsed.data.companyId, parsed.data.barcode);
    if (!item) return { error: `No item found for barcode "${parsed.data.barcode}".` };
    return { success: "Item found.", item };
  } catch (error) {
    return { error: mapError(error) };
  }
}

const quickSaleLineSchema = z.object({
  itemId: z.string().trim().min(1),
  itemNameSnapshot: z.string().trim().min(1),
  quantity: z.coerce.number().int().positive(),
  unitPrice: z.coerce.number().nonnegative(),
});

const quickSaleSchema = z.object({
  companyId: z.string().trim().min(1),
  branchId: z.string().trim().min(1),
  linesJson: z.string().min(1),
});

// Same "client builds the cart, submits one JSON blob" idiom Retail's
// checkoutAction established -- reused here, not imported, since Apps
// don't import each other's internals.
export async function quickSaleAction(
  _prevState: BarcodeActionFormState,
  formData: FormData,
): Promise<BarcodeActionFormState> {
  if (!(await verifyCsrf(formData))) {
    return { error: "Your session has expired. Please refresh the page and try again." };
  }

  const parsed = quickSaleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid request." };

  let rawLines: unknown;
  try {
    rawLines = JSON.parse(parsed.data.linesJson);
  } catch {
    return { error: "Invalid request." };
  }
  const linesParsed = z.array(quickSaleLineSchema).min(1).safeParse(rawLines);
  if (!linesParsed.success) return { error: "Invalid request." };

  const draftIdField = formData.get("draftId");
  const draftId = typeof draftIdField === "string" && draftIdField.length > 0 ? draftIdField : randomUUID();

  try {
    await quickSale(parsed.data.companyId, { draftId, branchId: parsed.data.branchId, lines: linesParsed.data });
  } catch (error) {
    return { error: mapError(error) };
  }

  revalidatePath(`/${parsed.data.companyId}/apps/barcode`);
  return { success: "Sale completed." };
}
