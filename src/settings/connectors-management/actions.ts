"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { CSRF_COOKIE_NAME } from "@/core/auth/constants";
import { csrfTokensMatch } from "@/core/auth/csrf";
import {
  ConnectorNotEntitledError,
  ConnectorNotRegisteredError,
  connectConnector,
  disconnectConnector,
} from "@/platform";

export type ConnectorsManagementFormState = {
  error?: string;
  success?: string;
};

const connectorActionSchema = z.object({
  companyId: z.string().trim().min(1),
  connectorId: z.string().trim().min(1),
});

async function verifyCsrf(formData: FormData): Promise<boolean> {
  const submitted = formData.get("csrfToken");
  if (typeof submitted !== "string") return false;

  const cookieStore = await cookies();
  const expected = cookieStore.get(CSRF_COOKIE_NAME)?.value;
  return csrfTokensMatch(submitted, expected ?? "");
}

// Thin wrapper only -- same shape as apps-management/actions.ts. Config is
// empty in Phase 2 (the stub connector needs none); a real connector later
// would extend the form with its own fields, still parsed here and passed
// through to connectConnector() untouched.
export async function connectConnectorAction(
  _prevState: ConnectorsManagementFormState,
  formData: FormData,
): Promise<ConnectorsManagementFormState> {
  if (!(await verifyCsrf(formData))) {
    return { error: "Your session has expired. Please refresh the page and try again." };
  }

  const parsed = connectorActionSchema.safeParse({
    companyId: formData.get("companyId"),
    connectorId: formData.get("connectorId"),
  });
  if (!parsed.success) {
    return { error: "Invalid request." };
  }

  try {
    await connectConnector(parsed.data.companyId, parsed.data.connectorId, {});
  } catch (error) {
    if (error instanceof ConnectorNotEntitledError) {
      return { error: "Your plan doesn't include this connector." };
    }
    if (error instanceof ConnectorNotRegisteredError) {
      return { error: "That connector doesn't exist." };
    }
    console.error("Connector connect failed:", error);
    return { error: "Something went wrong. Please try again." };
  }

  revalidatePath(`/${parsed.data.companyId}/settings`);
  return { success: "Connector connected." };
}

export async function disconnectConnectorAction(
  _prevState: ConnectorsManagementFormState,
  formData: FormData,
): Promise<ConnectorsManagementFormState> {
  if (!(await verifyCsrf(formData))) {
    return { error: "Your session has expired. Please refresh the page and try again." };
  }

  const parsed = connectorActionSchema.safeParse({
    companyId: formData.get("companyId"),
    connectorId: formData.get("connectorId"),
  });
  if (!parsed.success) {
    return { error: "Invalid request." };
  }

  try {
    await disconnectConnector(parsed.data.companyId, parsed.data.connectorId);
  } catch (error) {
    console.error("Connector disconnect failed:", error);
    return { error: "Something went wrong. Please try again." };
  }

  revalidatePath(`/${parsed.data.companyId}/settings`);
  return { success: "Connector disconnected." };
}
