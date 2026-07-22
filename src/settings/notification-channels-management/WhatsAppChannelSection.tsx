"use client";

import { useActionState } from "react";

import type { WhatsAppChannelConnection } from "@/platform";
import { Button } from "@/shared/ui";

import { connectWhatsAppAction, disconnectWhatsAppAction, syncWhatsAppAction } from "./actions";
import type { NotificationChannelsFormState } from "./actions";

const initialState: NotificationChannelsFormState = {};

function ConnectForm({ csrfToken, companyId }: { csrfToken: string; companyId: string }) {
  const [state, action, pending] = useActionState(connectWhatsAppAction, initialState);

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <input type="hidden" name="companyId" value={companyId} />
      <label className="flex flex-col gap-1 text-xs text-neutral-700">
        Phone Number ID
        <input name="phoneNumberId" className="rounded border border-neutral-300 p-2 text-sm" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-neutral-700">
        Access Token
        <input name="accessToken" type="password" className="rounded border border-neutral-300 p-2 text-sm" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-neutral-700">
        Destination Phone Number
        <input name="toPhoneNumber" className="rounded border border-neutral-300 p-2 text-sm" />
      </label>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Connecting…" : "Connect"}
      </Button>
      {state.error ? (
        <span role="alert" className="text-xs text-red-600">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

function DisconnectForm({ csrfToken, companyId }: { csrfToken: string; companyId: string }) {
  const [state, action, pending] = useActionState(disconnectWhatsAppAction, initialState);

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <input type="hidden" name="companyId" value={companyId} />
      <Button type="submit" variant="ghost" disabled={pending}>
        {pending ? "Disconnecting…" : "Disconnect"}
      </Button>
      {state.error ? (
        <span role="alert" className="text-xs text-red-600">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

function SyncNowForm({ csrfToken, companyId }: { csrfToken: string; companyId: string }) {
  const [state, action, pending] = useActionState(syncWhatsAppAction, initialState);

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <input type="hidden" name="companyId" value={companyId} />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Syncing…" : "Sync Now"}
      </Button>
      {state.error ? <span className="text-xs text-red-600">{state.error}</span> : null}
      {state.success ? <span className="text-xs text-neutral-600">{state.success}</span> : null}
    </form>
  );
}

// UI-level guard only -- the real enforcement is requirePlatformCapability()
// re-checked server-side inside platform/notification-channels on every
// submit, same convention as ConnectorsList.
export function WhatsAppChannelSection({
  csrfToken,
  companyId,
  connection,
  canManage,
}: {
  csrfToken: string;
  companyId: string;
  connection: WhatsAppChannelConnection | null;
  canManage: boolean;
}) {
  const isConnected = connection?.status === "connected";

  return (
    <div className="flex flex-col gap-3 text-left text-sm">
      <span className="text-neutral-900">
        WhatsApp &middot; {connection?.status ?? "disconnected"}
        {connection?.lastSyncAt ? ` · last synced ${connection.lastSyncAt}` : ""}
      </span>
      {canManage ? (
        isConnected ? (
          <div className="flex items-center gap-2">
            <SyncNowForm csrfToken={csrfToken} companyId={companyId} />
            <DisconnectForm csrfToken={csrfToken} companyId={companyId} />
          </div>
        ) : (
          <ConnectForm csrfToken={csrfToken} companyId={companyId} />
        )
      ) : null}
    </div>
  );
}
