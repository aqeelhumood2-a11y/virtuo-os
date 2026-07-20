"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { CSRF_COOKIE_NAME } from "./constants";
import { csrfTokensMatch } from "./csrf";
import {
  sendPasswordResetEmail,
  signInWithPassword,
  signUp as identityToolkitSignUp,
  toSafeAuthError,
} from "./identity-toolkit";
import { checkRateLimit } from "./rate-limit";
import { clearSession, createSession } from "./session";
import type { AuthFormState } from "./types";

const CSRF_ERROR: AuthFormState = {
  error: "Your session has expired. Please refresh the page and try again.",
};
const RATE_LIMIT_ERROR: AuthFormState = {
  error: "Too many attempts. Please try again later.",
};
const CREDENTIALS_ERROR: AuthFormState = { error: "Invalid email or password." };

async function verifyCsrf(formData: FormData): Promise<boolean> {
  const submitted = formData.get("csrfToken");
  if (typeof submitted !== "string") return false;

  const cookieStore = await cookies();
  const expected = cookieStore.get(CSRF_COOKIE_NAME)?.value;
  return csrfTokensMatch(submitted, expected ?? "");
}

const signUpSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
});

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

const resetSchema = z.object({
  email: z.email(),
});

export async function signUpAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await verifyCsrf(formData))) return CSRF_ERROR;

  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: "Please enter a valid email and a password of at least 8 characters." };
  }

  const rate = checkRateLimit("signUp", parsed.data.email.toLowerCase());
  if (!rate.allowed) return RATE_LIMIT_ERROR;

  try {
    const { idToken } = await identityToolkitSignUp(parsed.data.email, parsed.data.password);
    await createSession(idToken);
  } catch (error) {
    return { error: toSafeAuthError(error).message };
  }

  redirect("/account");
}

export async function signInAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await verifyCsrf(formData))) return CSRF_ERROR;

  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return CREDENTIALS_ERROR;

  const rate = checkRateLimit("signIn", parsed.data.email.toLowerCase());
  if (!rate.allowed) return RATE_LIMIT_ERROR;

  try {
    const { idToken } = await signInWithPassword(parsed.data.email, parsed.data.password);
    await createSession(idToken);
  } catch (error) {
    return { error: toSafeAuthError(error).message };
  }

  redirect("/account");
}

export async function signOutAction(formData: FormData): Promise<void> {
  if (await verifyCsrf(formData)) {
    await clearSession();
    redirect("/login");
  }

  // CSRF failure on sign-out fails closed: leave the session intact rather
  // than act on an unverified request, and send the user back to a safe page.
  redirect("/account");
}

export async function requestPasswordResetAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await verifyCsrf(formData))) return CSRF_ERROR;

  const GENERIC_SUCCESS: AuthFormState = {
    success: "If an account exists for that email, a password reset link has been sent.",
  };

  const parsed = resetSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { error: "Please enter a valid email address." };
  }

  const rate = checkRateLimit("passwordReset", parsed.data.email.toLowerCase());
  if (!rate.allowed) return RATE_LIMIT_ERROR;

  try {
    await sendPasswordResetEmail(parsed.data.email);
  } catch (error) {
    // Never surfaced to the caller -- logged only, so a genuine outage is
    // still observable server-side without revealing account existence or
    // internal error detail to the client.
    console.error("Password reset request failed:", toSafeAuthError(error).code);
  }

  return GENERIC_SUCCESS;
}
