"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { CSRF_COOKIE_NAME } from "@/core/auth/constants";
import { csrfTokensMatch } from "@/core/auth/csrf";
import { checkRateLimit } from "@/core/auth/rate-limit";
import { requireSession } from "@/core/auth/session";

import { RATE_LIMIT_ACTION_ONBOARDING } from "./constants";
import { setCompanyStatus, updateCompanyName } from "./company";
import { AlreadyOnboardedError, runOnboardingTransaction } from "./onboarding";
import type { CompanyActionFormState, OnboardingFormState } from "./types";

const onboardingSchema = z.object({
  companyName: z.string().trim().min(1).max(200),
});

const updateCompanySchema = z.object({
  companyId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(200),
});

const suspendCompanySchema = z.object({
  companyId: z.string().trim().min(1),
  status: z.enum(["active", "suspended"]),
});

async function verifyCsrf(formData: FormData): Promise<boolean> {
  const submitted = formData.get("csrfToken");
  if (typeof submitted !== "string") return false;

  const cookieStore = await cookies();
  const expected = cookieStore.get(CSRF_COOKIE_NAME)?.value;
  return csrfTokensMatch(submitted, expected ?? "");
}

export async function createCompanyAction(
  _prevState: OnboardingFormState,
  formData: FormData,
): Promise<OnboardingFormState> {
  if (!(await verifyCsrf(formData))) {
    return { error: "Your session has expired. Please refresh the page and try again." };
  }

  // The only trusted identity input for this whole action -- redirects to
  // /login if there's no valid session. The company name is the only
  // client-supplied data; nothing else (uid, companyId, role) is ever
  // accepted from the request.
  const session = await requireSession();

  const parsed = onboardingSchema.safeParse({ companyName: formData.get("companyName") });
  if (!parsed.success) {
    return { error: "Please enter a company name." };
  }

  const rate = checkRateLimit(RATE_LIMIT_ACTION_ONBOARDING, session.uid);
  if (!rate.allowed) {
    return { error: "Too many attempts. Please try again later." };
  }

  try {
    await runOnboardingTransaction({
      uid: session.uid,
      email: session.email,
      companyName: parsed.data.companyName,
    });
  } catch (error) {
    if (error instanceof AlreadyOnboardedError) {
      return { error: "You already belong to a company." };
    }
    console.error("Onboarding failed:", error);
    return { error: "Something went wrong. Please try again." };
  }

  redirect("/account");
}

// Replaces 1D's direct-client-write path for renaming a company (1G) --
// see docs/phases/PHASE_1G_PLAN.md §2 for why: a direct write has no
// server-side interception point to audit-log from. requireCapability
// inside updateCompanyName() re-derives the actor and re-checks
// company.update; companyId here is an unauthenticated hint until then.
export async function updateCompanyAction(
  _prevState: CompanyActionFormState,
  formData: FormData,
): Promise<CompanyActionFormState> {
  if (!(await verifyCsrf(formData))) {
    return { error: "Your session has expired. Please refresh the page and try again." };
  }

  const parsed = updateCompanySchema.safeParse({
    companyId: formData.get("companyId"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    return { error: "Please enter a company name." };
  }

  try {
    await updateCompanyName(parsed.data.companyId, parsed.data.name);
  } catch (error) {
    console.error("Company update failed:", error);
    return { error: "Something went wrong. Please try again." };
  }

  revalidatePath("/account");
  return { success: "Company updated." };
}

// Replaces 1D's direct-client-write path for suspending/reactivating a
// company (1G) -- same reasoning as updateCompanyAction above.
export async function suspendCompanyAction(
  _prevState: CompanyActionFormState,
  formData: FormData,
): Promise<CompanyActionFormState> {
  if (!(await verifyCsrf(formData))) {
    return { error: "Your session has expired. Please refresh the page and try again." };
  }

  const parsed = suspendCompanySchema.safeParse({
    companyId: formData.get("companyId"),
    status: formData.get("status"),
  });
  if (!parsed.success) {
    return { error: "Invalid request." };
  }

  try {
    await setCompanyStatus(parsed.data.companyId, parsed.data.status);
  } catch (error) {
    console.error("Company status change failed:", error);
    return { error: "Something went wrong. Please try again." };
  }

  revalidatePath("/account");
  return {
    success: parsed.data.status === "suspended" ? "Company suspended." : "Company reactivated.",
  };
}
