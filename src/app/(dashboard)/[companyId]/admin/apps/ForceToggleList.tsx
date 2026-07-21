"use client";

import { useActionState } from "react";

import type { AppManifest } from "@/app-registry";
import { Button } from "@/shared/ui";

import { forceToggleAppAction } from "./actions";
import type { AdminAppsFormState } from "./actions";

const initialState: AdminAppsFormState = {};

function ForceToggleForm({
  csrfToken,
  companyId,
  appId,
  enabled,
}: {
  csrfToken: string;
  companyId: string;
  appId: string;
  enabled: boolean;
}) {
  const [state, action, pending] = useActionState(forceToggleAppAction, initialState);

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="appId" value={appId} />
      <input type="hidden" name="enabled" value={String(!enabled)} />
      <Button type="submit" variant={enabled ? "ghost" : "secondary"} disabled={pending}>
        {pending ? "Saving…" : enabled ? "Force disable" : "Force enable"}
      </Button>
      {state.error ? (
        <span role="alert" className="text-xs text-red-600">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

// Super Admin only -- bypasses apps.install and license entitlement
// entirely (see forceToggleApp() in platform/app-installs). UI-level
// gating is redundant here in practice (the page itself already calls
// requireSuperAdmin() before rendering this at all), kept simple rather
// than duplicating that check client-side.
export function ForceToggleList({
  csrfToken,
  companyId,
  apps,
  installedAppIds,
}: {
  csrfToken: string;
  companyId: string;
  apps: AppManifest[];
  installedAppIds: string[];
}) {
  if (apps.length === 0) {
    return <p className="text-sm text-neutral-600">No apps are registered yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-3 text-left text-sm">
      {apps.map((app) => {
        const enabled = installedAppIds.includes(app.id);
        return (
          <li key={app.id} className="flex items-center justify-between gap-2 border-b border-neutral-100 pb-3">
            <span className="text-neutral-900">
              {app.displayName} · {enabled ? "enabled" : "disabled"}
            </span>
            <ForceToggleForm csrfToken={csrfToken} companyId={companyId} appId={app.id} enabled={enabled} />
          </li>
        );
      })}
    </ul>
  );
}
