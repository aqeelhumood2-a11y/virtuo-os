"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { WhatsAppSendError } from "@/core";
import { CSRF_COOKIE_NAME } from "@/core/auth/constants";
import { csrfTokensMatch } from "@/core/auth/csrf";
import {
  WhatsAppChannelNotConnectedError,
  connectWhatsAppChannel,
  disconnectWhatsAppChannel,
  syncWhatsAppNotifications,
} from "@/platform";

export type NotificationChannelsFormState = {
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

const connectSchema = z.object({
  companyId: z.string().trim().min(1),
  phoneNumberId: z.string().trim().min(1),
  accessToken: z.string().trim().min(1),
  toPhoneNumber: z.string().trim().min(1),
});

export async function connectWhatsAppAction(
  _prevState: NotificationChannelsFormState,
  formData: FormData,
): Promise<NotificationChannelsFormState> {
  if (!(await verifyCsrf(formData))) {
    return { error: "Your session has expired. Please refresh the page and try again." };
  }

  const parsed = connectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Please fill in every field." };

  try {
    await connectWhatsAppChannel(parsed.data.companyId, {
      phoneNumberId: parsed.data.phoneNumberId,
      accessToken: parsed.data.accessToken,
      toPhoneNumber: parsed.data.toPhoneNumber,
    });
  } catch (error) {
    if (error instanceof WhatsAppSendError) return { error: error.message };
    console.error("WhatsApp connect failed:", error);
    return { error: "Something went wrong. Please try again." };
  }

  revalidatePath(`/${parsed.data.companyId}/settings`);
  return { success: "WhatsApp connected." };
}

const companyOnlySchema = z.object({ companyId: z.string().trim().min(1) });

export async function disconnectWhatsAppAction(
  _prevState: NotificationChannelsFormState,
  formData: FormData,
): Promise<NotificationChannelsFormState> {
  if (!(await verifyCsrf(formData))) {
    return { error: "Your session has expired. Please refresh the page and try again." };
  }

  const parsed = companyOnlySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid request." };

  try {
    await disconnectWhatsAppChannel(parsed.data.companyId);
  } catch (error) {
    console.error("WhatsApp disconnect failed:", error);
    return { error: "Something went wrong. Please try again." };
  }

  revalidatePath(`/${parsed.data.companyId}/settings`);
  return { success: "WhatsApp disconnected." };
}

export async function syncWhatsAppAction(
  _prevState: NotificationChannelsFormState,
  formData: FormData,
): Promise<NotificationChannelsFormState> {
  if (!(await verifyCsrf(formData))) {
    return { error: "Your session has expired. Please refresh the page and try again." };
  }

  const parsed = companyOnlySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid request." };

  try {
    const summary = await syncWhatsAppNotifications(parsed.data.companyId);
    revalidatePath(`/${parsed.data.companyId}/settings`);
    return { success: `Sent ${summary.messagesSent} message(s).` };
  } catch (error) {
    if (error instanceof WhatsAppChannelNotConnectedError) return { error: error.message };
    console.error("WhatsApp sync failed:", error);
    return { error: "Sync failed. Please try again." };
  }
}
