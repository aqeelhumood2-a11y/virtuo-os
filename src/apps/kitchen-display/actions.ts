"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireCompanyMembership } from "@/core";
import { CSRF_COOKIE_NAME } from "@/core/auth/constants";
import { csrfTokensMatch } from "@/core/auth/csrf";

import { advanceStage, OrderNotFoundError } from "./application/kitchen-display.service";

export type KitchenDisplayActionFormState = {
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

const advanceStageSchema = z.object({
  companyId: z.string().trim().min(1),
  orderId: z.string().trim().min(1),
  stage: z.enum(["queued", "preparing", "ready"]),
});

export async function advanceStageAction(
  _prevState: KitchenDisplayActionFormState,
  formData: FormData,
): Promise<KitchenDisplayActionFormState> {
  if (!(await verifyCsrf(formData))) {
    return { error: "Your session has expired. Please refresh the page and try again." };
  }

  const parsed = advanceStageSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid request." };

  try {
    const { session } = await requireCompanyMembership(parsed.data.companyId);
    await advanceStage(parsed.data.companyId, parsed.data.orderId, parsed.data.stage, session.uid);
  } catch (error) {
    if (error instanceof OrderNotFoundError) return { error: error.message };
    console.error("Kitchen Display action failed:", error);
    return { error: "Something went wrong. Please try again." };
  }

  revalidatePath(`/${parsed.data.companyId}/apps/kitchen-display`);
  return { success: "Stage updated." };
}
