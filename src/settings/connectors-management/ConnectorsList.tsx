"use client";

import { useActionState } from "react";

import type { ConnectorConnection, ConnectorContract } from "@/platform";
import { Button } from "@/shared/ui";

import { connectConnectorAction, disconnectConnectorAction, syncConnectorAction } from "./actions";
import type { ConnectorsManagementFormState } from "./actions";

const initialState: ConnectorsManagementFormState = {};

// A plain JSON-blob textarea, not per-connector-shaped fields -- Settings
// never hardcodes any one connector's config shape (Shopify needs
// shopDomain/accessToken, Square needs accessToken/locationId, Odoo needs
// url/db/username/apiKey); the Server Action forwards whatever's typed
// here untouched. A deliberately minimal first-cut UI, same "minimal
// first slice" precedent as every prior App/Platform surface -- see
// docs/phases/PHASE_5_PLAN.md §9.
function ConnectForm({ csrfToken, companyId, connectorId }: { csrfToken: string; companyId: string; connectorId: string }) {
  const [state, action, pending] = useActionState(connectConnectorAction, initialState);

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="connectorId" value={connectorId} />
      <textarea
        name="configJson"
        placeholder={'{"shopDomain": "...", "accessToken": "..."}'}
        rows={2}
        className="w-full rounded border border-neutral-300 p-2 font-mono text-xs"
      />
      <div className="flex items-center gap-2">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Connecting…" : "Connect"}
        </Button>
        {state.error ? (
          <span role="alert" className="text-xs text-red-600">
            {state.error}
          </span>
        ) : null}
      </div>
    </form>
  );
}

function DisconnectForm({ csrfToken, companyId, connectorId }: { csrfToken: string; companyId: string; connectorId: string }) {
  const [state, action, pending] = useActionState(disconnectConnectorAction, initialState);

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="connectorId" value={connectorId} />
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

function SyncNowForm({ csrfToken, companyId, connectorId }: { csrfToken: string; companyId: string; connectorId: string }) {
  const [state, action, pending] = useActionState(syncConnectorAction, initialState);

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="connectorId" value={connectorId} />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Syncing…" : "Sync Now"}
      </Button>
      {state.error ? (
        <span role="alert" className="text-xs text-red-600">
          {state.error}
        </span>
      ) : null}
      {state.success ? <span className="text-xs text-neutral-600">{state.success}</span> : null}
    </form>
  );
}

// UI-level guard only -- the real enforcement is requirePlatformCapability()
// re-checked server-side inside platform/connector-connections on every
// submit, same convention as account/MembersList.tsx.
export function ConnectorsList({
  csrfToken,
  companyId,
  connectors,
  connections,
  canManage,
}: {
  csrfToken: string;
  companyId: string;
  connectors: ConnectorContract[];
  connections: ConnectorConnection[];
  canManage: boolean;
}) {
  if (connectors.length === 0) {
    return <p className="text-sm text-neutral-600">No connectors are available yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-3 text-left text-sm">
      {connectors.map((connector) => {
        const connection = connections.find((c) => c.connectorId === connector.id);
        const isConnected = connection?.status === "connected";
        return (
          <li key={connector.id} className="flex flex-col gap-2 border-b border-neutral-100 pb-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-neutral-900">
                {connector.displayName} · {connection?.status ?? "disconnected"}
                {connection?.lastSyncAt ? ` · last synced ${connection.lastSyncAt}` : ""}
              </span>
            </div>
            {canManage ? (
              isConnected ? (
                <div className="flex items-center gap-2">
                  <SyncNowForm csrfToken={csrfToken} companyId={companyId} connectorId={connector.id} />
                  <DisconnectForm csrfToken={csrfToken} companyId={companyId} connectorId={connector.id} />
                </div>
              ) : (
                <ConnectForm csrfToken={csrfToken} companyId={companyId} connectorId={connector.id} />
              )
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
