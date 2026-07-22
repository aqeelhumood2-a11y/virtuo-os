"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireCompanyMembership } from "@/core";
import { CSRF_COOKIE_NAME } from "@/core/auth/constants";
import { csrfTokensMatch } from "@/core/auth/csrf";

import { AiAssistantNotConfiguredError } from "./application/llm-client";
import { answerQuestion } from "./application/query-orchestrator.service";

export type AiAssistantActionFormState = {
  error?: string;
  answer?: string;
};

async function verifyCsrf(formData: FormData): Promise<boolean> {
  const submitted = formData.get("csrfToken");
  if (typeof submitted !== "string") return false;

  const cookieStore = await cookies();
  const expected = cookieStore.get(CSRF_COOKIE_NAME)?.value;
  return csrfTokensMatch(submitted, expected ?? "");
}

const askSchema = z.object({
  companyId: z.string().trim().min(1),
  branchId: z.string().trim().min(1),
  question: z.string().trim().min(1).max(500),
});

export async function askQuestionAction(
  _prevState: AiAssistantActionFormState,
  formData: FormData,
): Promise<AiAssistantActionFormState> {
  if (!(await verifyCsrf(formData))) {
    return { error: "Your session has expired. Please refresh the page and try again." };
  }

  const parsed = askSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Please enter a question (up to 500 characters)." };

  try {
    const { session, membership } = await requireCompanyMembership(parsed.data.companyId);
    const answer = await answerQuestion(parsed.data.companyId, session.uid, membership.role, parsed.data.branchId, parsed.data.question);
    revalidatePath(`/${parsed.data.companyId}/apps/ai-assistant`);
    return { answer };
  } catch (error) {
    if (error instanceof AiAssistantNotConfiguredError) return { error: error.message };
    console.error("AI Assistant action failed:", error);
    return { error: "Something went wrong. Please try again." };
  }
}
