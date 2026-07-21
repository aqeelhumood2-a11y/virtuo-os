"use client";

import { useActionState } from "react";

import { Button, FormField, Input } from "@/shared/ui";

import { enrollMemberAction, type LoyaltyActionFormState } from "../actions";

const initialState: LoyaltyActionFormState = {};

export function EnrollMemberForm({ companyId, csrfToken }: { companyId: string; csrfToken: string }) {
  const [state, action, pending] = useActionState(enrollMemberAction, initialState);

  return (
    <form action={action} className="flex flex-col gap-3 rounded-md border border-neutral-200 p-3">
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <input type="hidden" name="companyId" value={companyId} />
      <FormField label="Name" error={state.error}>
        <Input name="name" placeholder="Jane Doe" required />
      </FormField>
      <FormField label="Contact (optional)">
        <Input name="contactRef" placeholder="phone or email" />
      </FormField>
      <Button type="submit" disabled={pending}>
        {pending ? "Enrolling…" : "Enroll member"}
      </Button>
      {state.success ? <p className="text-sm text-green-700">{state.success}</p> : null}
    </form>
  );
}
