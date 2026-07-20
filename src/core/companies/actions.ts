"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { CSRF_COOKIE_NAME } from "@/core/auth/constants";
import { csrfTokensMatch } from "@/core/auth/csrf";
import { checkRateLimit } from "@/core/auth/rate-limit";
import { requireSession } from "@/core/auth/session";

import { RATE_LIMIT_ACTION_ONBOARDING } from "./constants";
import { AlreadyOnboardedError, runOnboardingTransaction } from "./onboarding";
import type { OnboardingFormState } from "./types";

const onboardingSchema = z.object({
  companyName: z.string().trim().min(1).max(200),
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
