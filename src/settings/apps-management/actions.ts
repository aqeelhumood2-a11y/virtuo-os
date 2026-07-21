"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { CSRF_COOKIE_NAME } from "@/core/auth/constants";
import { csrfTokensMatch } from "@/core/auth/csrf";
import { AppNotEntitledError, AppNotRegisteredError, installApp, uninstallApp } from "@/platform";

export type AppsManagementFormState = {
  error?: string;
  success?: string;
};

const appActionSchema = z.object({
  companyId: z.string().trim().min(1),
  appId: z.string().trim().min(1),
});

async function verifyCsrf(formData: FormData): Promise<boolean> {
  const submitted = formData.get("csrfToken");
  if (typeof submitted !== "string") return false;

  const cookieStore = await cookies();
  const expected = cookieStore.get(CSRF_COOKIE_NAME)?.value;
  return csrfTokensMatch(submitted, expected ?? "");
}

// Thin wrapper only: CSRF check, form parsing, calling Platform's service,
// mapping its thrown errors to a form-state message, revalidatePath.
// Authorization (requirePlatformCapability) and the entitlement/catalog
// checks all live inside platform/app-installs' installApp() itself, not
// here -- see docs/phases/PHASE_2_PLAN.md §2.
export async function installAppAction(
  _prevState: AppsManagementFormState,
  formData: FormData,
): Promise<AppsManagementFormState> {
  if (!(await verifyCsrf(formData))) {
    return { error: "Your session has expired. Please refresh the page and try again." };
  }

  const parsed = appActionSchema.safeParse({
    companyId: formData.get("companyId"),
    appId: formData.get("appId"),
  });
  if (!parsed.success) {
    return { error: "Invalid request." };
  }

  try {
    await installApp(parsed.data.companyId, parsed.data.appId);
  } catch (error) {
    if (error instanceof AppNotEntitledError) {
      return { error: "Your plan doesn't include this app." };
    }
    if (error instanceof AppNotRegisteredError) {
      return { error: "That app doesn't exist." };
    }
    console.error("App install failed:", error);
    return { error: "Something went wrong. Please try again." };
  }

  revalidatePath(`/${parsed.data.companyId}/settings`);
  return { success: "App installed." };
}

export async function uninstallAppAction(
  _prevState: AppsManagementFormState,
  formData: FormData,
): Promise<AppsManagementFormState> {
  if (!(await verifyCsrf(formData))) {
    return { error: "Your session has expired. Please refresh the page and try again." };
  }

  const parsed = appActionSchema.safeParse({
    companyId: formData.get("companyId"),
    appId: formData.get("appId"),
  });
  if (!parsed.success) {
    return { error: "Invalid request." };
  }

  try {
    await uninstallApp(parsed.data.companyId, parsed.data.appId);
  } catch (error) {
    console.error("App uninstall failed:", error);
    return { error: "Something went wrong. Please try again." };
  }

  revalidatePath(`/${parsed.data.companyId}/settings`);
  return { success: "App uninstalled." };
}
