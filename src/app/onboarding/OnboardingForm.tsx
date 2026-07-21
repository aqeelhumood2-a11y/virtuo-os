"use client";

import { useActionState } from "react";

import { createCompanyAction } from "@/core/companies/actions";
import type { OnboardingFormState } from "@/core/companies/types";
import { Button, FormField, Input } from "@/shared/ui";

const initialState: OnboardingFormState = {};

export function OnboardingForm({ csrfToken }: { csrfToken: string }) {
  const [state, action, pending] = useActionState(createCompanyAction, initialState);

  return (
    <form action={action} className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-neutral-900">Create your company</h1>
      <p className="text-sm text-neutral-600">
        This creates your company, a default branch, and makes you the Owner.
      </p>
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <FormField label="Company name">
        <Input type="text" name="companyName" required autoComplete="organization" />
      </FormField>
      {state.error ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create company"}
      </Button>
    </form>
  );
}
