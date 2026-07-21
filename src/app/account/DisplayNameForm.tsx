"use client";

import { useActionState } from "react";

import { updateDisplayNameAction } from "@/core/users/actions";
import type { ProfileFormState } from "@/core/users/types";
import { Button, FormField, Input } from "@/shared/ui";

const initialState: ProfileFormState = {};

export function DisplayNameForm({
  csrfToken,
  currentDisplayName,
}: {
  csrfToken: string;
  currentDisplayName: string | null;
}) {
  const [state, action, pending] = useActionState(updateDisplayNameAction, initialState);

  return (
    <form action={action} className="flex flex-col gap-3 text-left">
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <FormField label="Display name">
        <Input type="text" name="displayName" defaultValue={currentDisplayName ?? ""} required />
      </FormField>
      {state.error ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Saving…" : "Save name"}
      </Button>
    </form>
  );
}
