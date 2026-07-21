"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { CSRF_COOKIE_NAME } from "@/core/auth/constants";
import { csrfTokensMatch } from "@/core/auth/csrf";
import { forceToggleApp } from "@/platform";

export type AdminAppsFormState = {
  error?: string;
  success?: string;
};

const forceToggleSchema = z.object({
  companyId: z.string().trim().min(1),
  appId: z.string().trim().min(1),
  enabled: z.enum(["true", "false"]),
});

async function verifyCsrf(formData: FormData): Promise<boolean> {
  const submitted = formData.get("csrfToken");
  if (typeof submitted !== "string") return false;

  const cookieStore = await cookies();
  const expected = cookieStore.get(CSRF_COOKIE_NAME)?.value;
  return csrfTokensMatch(submitted, expected ?? "");
}

// Co-located with this admin route rather than in settings/ or platform/ --
// this is a cross-company ops screen, not a per-company Settings surface.
// Thin wrapper only: forceToggleApp() itself is the requireSuperAdmin()-gated
// business logic. See docs/phases/PHASE_2_PLAN.md §3.
export async function forceToggleAppAction(
  _prevState: AdminAppsFormState,
  formData: FormData,
): Promise<AdminAppsFormState> {
  if (!(await verifyCsrf(formData))) {
    return { error: "Your session has expired. Please refresh the page and try again." };
  }

  const parsed = forceToggleSchema.safeParse({
    companyId: formData.get("companyId"),
    appId: formData.get("appId"),
    enabled: formData.get("enabled"),
  });
  if (!parsed.success) {
    return { error: "Invalid request." };
  }

  try {
    await forceToggleApp(parsed.data.companyId, parsed.data.appId, parsed.data.enabled === "true");
  } catch (error) {
    console.error("Force-toggle failed:", error);
    return { error: "Something went wrong. Please try again." };
  }

  revalidatePath(`/${parsed.data.companyId}/admin/apps`);
  return { success: "App toggled." };
}
