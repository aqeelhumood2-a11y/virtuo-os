"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { CSRF_COOKIE_NAME } from "@/core/auth/constants";
import { csrfTokensMatch } from "@/core/auth/csrf";
import {
  ConnectorAuthError,
  ConnectorNotConnectedError,
  ConnectorNotEntitledError,
  ConnectorNotRegisteredError,
  connectConnector,
  disconnectConnector,
  syncConnector,
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

// configJson is a client-assembled JSON blob of whatever fields the chosen
// connector needs (e.g. { shopDomain, accessToken } for Shopify) -- the
// same "submit one JSON-encoded blob, parse+validate server-side" idiom
// Retail's checkoutAction established for its own cart, reused here so
// this Server Action stays connector-agnostic (Settings must not know any
// one connector's config shape). Empty/omitted for connectors that need no
// config, same as the Phase 2 stub.
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

  const configJson = formData.get("configJson");
  let config: Record<string, unknown> = {};
  if (typeof configJson === "string" && configJson.trim() !== "") {
    try {
      const value: unknown = JSON.parse(configJson);
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return { error: "Configuration must be a JSON object." };
      }
      config = value as Record<string, unknown>;
    } catch {
      return { error: "Configuration is not valid JSON." };
    }
  }

  try {
    await connectConnector(parsed.data.companyId, parsed.data.connectorId, config);
  } catch (error) {
    if (error instanceof ConnectorNotEntitledError) {
      return { error: "Your plan doesn't include this connector." };
    }
    if (error instanceof ConnectorNotRegisteredError) {
      return { error: "That connector doesn't exist." };
    }
    if (error instanceof ConnectorAuthError) {
      return { error: error.message };
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

export async function syncConnectorAction(
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
    const summary = await syncConnector(parsed.data.companyId, parsed.data.connectorId);
    revalidatePath(`/${parsed.data.companyId}/settings`);
    return {
      success: `Synced: ${summary.productsSynced} product(s), ${summary.ordersPushed} order(s) pushed${summary.ordersFailed > 0 ? `, ${summary.ordersFailed} failed` : ""}.`,
    };
  } catch (error) {
    if (error instanceof ConnectorNotConnectedError) {
      return { error: "Connect this connector before syncing." };
    }
    if (error instanceof ConnectorNotRegisteredError) {
      return { error: "That connector doesn't exist." };
    }
    if (error instanceof ConnectorAuthError) {
      return { error: error.message };
    }
    console.error("Connector sync failed:", error);
    return { error: "Sync failed. Please try again." };
  }
}
