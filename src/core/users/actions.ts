"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { CSRF_COOKIE_NAME } from "@/core/auth/constants";
import { csrfTokensMatch } from "@/core/auth/csrf";
import { requireSession } from "@/core/auth/session";
import { adminDb } from "@/lib/firebase/admin";

import type { ProfileFormState } from "./types";

const displayNameSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
});

async function verifyCsrf(formData: FormData): Promise<boolean> {
  const submitted = formData.get("csrfToken");
  if (typeof submitted !== "string") return false;

  const cookieStore = await cookies();
  const expected = cookieStore.get(CSRF_COOKIE_NAME)?.value;
  return csrfTokensMatch(submitted, expected ?? "");
}

// Users may update only their own displayName, on their own document
// (users/{theirUid} -- never any other uid, never any other field).
export async function updateDisplayNameAction(
  _prevState: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  if (!(await verifyCsrf(formData))) {
    return { error: "Your session has expired. Please refresh the page and try again." };
  }

  const session = await requireSession();

  const parsed = displayNameSchema.safeParse({ displayName: formData.get("displayName") });
  if (!parsed.success) {
    return { error: "Please enter a valid name." };
  }

  await adminDb
    .collection("users")
    .doc(session.uid)
    .set({ displayName: parsed.data.displayName }, { merge: true });

  redirect("/account");
}
