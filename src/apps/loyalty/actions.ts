"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { CSRF_COOKIE_NAME } from "@/core/auth/constants";
import { csrfTokensMatch } from "@/core/auth/csrf";
import { requireCompanyMembership } from "@/core";

import { MemberNotFoundError, OrderAlreadyAttributedError, OrderNotFoundError } from "./domain/errors";
import { attributeOrderToMember, enrollMember, syncAccruals } from "./application/loyalty.service";

export type LoyaltyActionFormState = {
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
  if (error instanceof MemberNotFoundError || error instanceof OrderNotFoundError || error instanceof OrderAlreadyAttributedError) {
    return error.message;
  }
  console.error("Loyalty action failed:", error);
  return "Something went wrong. Please try again.";
}

const enrollMemberSchema = z.object({
  companyId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  contactRef: z.string().trim().optional(),
});

// Thin wrapper only: CSRF check, form parsing, calling the App's own
// application-layer service, mapping thrown errors, revalidatePath -- same
// shape as apps/restaurant and apps/retail's own actions.ts. The actor is
// derived from the verified session (requireCompanyMembership), never
// trusted from form data.
export async function enrollMemberAction(
  _prevState: LoyaltyActionFormState,
  formData: FormData,
): Promise<LoyaltyActionFormState> {
  if (!(await verifyCsrf(formData))) {
    return { error: "Your session has expired. Please refresh the page and try again." };
  }

  const parsed = enrollMemberSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid request." };

  try {
    const { session } = await requireCompanyMembership(parsed.data.companyId);
    await enrollMember(parsed.data.companyId, session.uid, {
      name: parsed.data.name,
      contactRef: parsed.data.contactRef || null,
    });
  } catch (error) {
    return { error: mapError(error) };
  }

  revalidatePath(`/${parsed.data.companyId}/apps/loyalty`);
  return { success: "Member enrolled." };
}

const attributeOrderSchema = z.object({
  companyId: z.string().trim().min(1),
  orderId: z.string().trim().min(1),
  memberId: z.string().trim().min(1),
});

export async function attributeOrderAction(
  _prevState: LoyaltyActionFormState,
  formData: FormData,
): Promise<LoyaltyActionFormState> {
  if (!(await verifyCsrf(formData))) {
    return { error: "Your session has expired. Please refresh the page and try again." };
  }

  const parsed = attributeOrderSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid request." };

  try {
    const { session } = await requireCompanyMembership(parsed.data.companyId);
    await attributeOrderToMember(parsed.data.companyId, parsed.data.orderId, parsed.data.memberId, session.uid);
  } catch (error) {
    return { error: mapError(error) };
  }

  revalidatePath(`/${parsed.data.companyId}/apps/loyalty`);
  return { success: "Order attributed." };
}

const syncAccrualsSchema = z.object({
  companyId: z.string().trim().min(1),
});

// The manual "Sync Now" path (the automatic-on-mount path calls
// syncAccruals directly from routes/LoyaltyAppRoot.tsx, not through this
// Server Action). Authorization is enforced entirely by Core's own
// listAuditLogsPage (audit.view, Owner/Manager) inside syncAccruals itself
// -- no capability check is duplicated here. The UI only renders this
// action's form for a caller who already has audit.view (see
// components/SyncNowButton.tsx), so this path is not normally reachable by
// a caller who'd fail that check.
export async function syncAccrualsAction(
  _prevState: LoyaltyActionFormState,
  formData: FormData,
): Promise<LoyaltyActionFormState> {
  if (!(await verifyCsrf(formData))) {
    return { error: "Your session has expired. Please refresh the page and try again." };
  }

  const parsed = syncAccrualsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid request." };

  let result;
  try {
    result = await syncAccruals(parsed.data.companyId);
  } catch (error) {
    return { error: mapError(error) };
  }

  revalidatePath(`/${parsed.data.companyId}/apps/loyalty`);
  return { success: `Synced: ${result.accruedCount} accrued, ${result.skippedCount} skipped.` };
}
