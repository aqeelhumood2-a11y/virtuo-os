"use client";

import { useActionState } from "react";

import { Button } from "@/shared/ui";

import { syncAccrualsAction, type LoyaltyActionFormState } from "../actions";

const initialState: LoyaltyActionFormState = {};

// Only ever rendered when the caller has audit.view (see
// routes/LoyaltyAppRoot.tsx) -- the real enforcement is Core's own
// listAuditLogsPage inside syncAccruals, this is just the UI-level guard
// (hide, never the sole enforcement, per the project's own Phase 1D rule).
export function SyncNowButton({ companyId, csrfToken }: { companyId: string; csrfToken: string }) {
  const [state, action, pending] = useActionState(syncAccrualsAction, initialState);

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <input type="hidden" name="companyId" value={companyId} />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Syncing…" : "Sync now"}
      </Button>
      {state.success ? <p className="text-sm text-green-700">{state.success}</p> : null}
      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
    </form>
  );
}
