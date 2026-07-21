"use client";

import { useActionState } from "react";

import type { ConnectorConnection, ConnectorContract } from "@/platform";
import { Button } from "@/shared/ui";

import { connectConnectorAction, disconnectConnectorAction } from "./actions";
import type { ConnectorsManagementFormState } from "./actions";

const initialState: ConnectorsManagementFormState = {};

function ConnectForm({ csrfToken, companyId, connectorId }: { csrfToken: string; companyId: string; connectorId: string }) {
  const [state, action, pending] = useActionState(connectConnectorAction, initialState);

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="connectorId" value={connectorId} />
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
          <li key={connector.id} className="flex items-center justify-between gap-2 border-b border-neutral-100 pb-3">
            <span className="text-neutral-900">
              {connector.displayName} · {connection?.status ?? "disconnected"}
            </span>
            {canManage ? (
              isConnected ? (
                <DisconnectForm csrfToken={csrfToken} companyId={companyId} connectorId={connector.id} />
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
