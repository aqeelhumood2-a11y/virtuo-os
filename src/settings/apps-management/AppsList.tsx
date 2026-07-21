"use client";

import { useActionState } from "react";

import type { AppManifest } from "@/app-registry";
import { Button } from "@/shared/ui";

import { installAppAction, uninstallAppAction } from "./actions";
import type { AppsManagementFormState } from "./actions";

const initialState: AppsManagementFormState = {};

function InstallForm({ csrfToken, companyId, appId }: { csrfToken: string; companyId: string; appId: string }) {
  const [state, action, pending] = useActionState(installAppAction, initialState);

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="appId" value={appId} />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Installing…" : "Install"}
      </Button>
      {state.error ? (
        <span role="alert" className="text-xs text-red-600">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

function UninstallForm({ csrfToken, companyId, appId }: { csrfToken: string; companyId: string; appId: string }) {
  const [state, action, pending] = useActionState(uninstallAppAction, initialState);

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="appId" value={appId} />
      <Button type="submit" variant="ghost" disabled={pending}>
        {pending ? "Uninstalling…" : "Uninstall"}
      </Button>
      {state.error ? (
        <span role="alert" className="text-xs text-red-600">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

// UI-level guard only (hide the mutation controls) -- the real enforcement
// is requirePlatformCapability() re-checked server-side inside
// platform/app-installs on every submit, same convention as
// account/MembersList.tsx.
export function AppsList({
  csrfToken,
  companyId,
  apps,
  installedAppIds,
  canInstall,
}: {
  csrfToken: string;
  companyId: string;
  apps: AppManifest[];
  installedAppIds: string[];
  canInstall: boolean;
}) {
  if (apps.length === 0) {
    return <p className="text-sm text-neutral-600">No apps are available yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-3 text-left text-sm">
      {apps.map((app) => {
        const installed = installedAppIds.includes(app.id);
        return (
          <li key={app.id} className="flex items-center justify-between gap-2 border-b border-neutral-100 pb-3">
            <span className="text-neutral-900">{app.displayName}</span>
            {canInstall ? (
              installed ? (
                <UninstallForm csrfToken={csrfToken} companyId={companyId} appId={app.id} />
              ) : (
                <InstallForm csrfToken={csrfToken} companyId={companyId} appId={app.id} />
              )
            ) : (
              <span className="text-neutral-500">{installed ? "Installed" : "Not installed"}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
