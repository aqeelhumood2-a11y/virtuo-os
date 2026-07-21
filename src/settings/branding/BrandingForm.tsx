"use client";

import { useActionState } from "react";

import { updateBrandingAction } from "@/core/companies/actions";
import type { CompanySettingsFormState } from "@/core/companies/company-settings.types";
import { Button, FormField, Input } from "@/shared/ui";

const initialState: CompanySettingsFormState = {};

export function BrandingForm({
  csrfToken,
  companyId,
  logoUrl,
  primaryColor,
}: {
  csrfToken: string;
  companyId: string;
  logoUrl: string | null;
  primaryColor: string | null;
}) {
  const [state, action, pending] = useActionState(updateBrandingAction, initialState);

  return (
    <form action={action} className="flex flex-col gap-3 text-left">
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <input type="hidden" name="companyId" value={companyId} />
      <FormField label="Logo URL">
        <Input type="url" name="logoUrl" defaultValue={logoUrl ?? ""} placeholder="https://…" />
      </FormField>
      <FormField label="Primary color" error={state.error}>
        <Input type="text" name="primaryColor" defaultValue={primaryColor ?? ""} placeholder="#336699" />
      </FormField>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save branding"}
      </Button>
      {state.success ? <p className="text-sm text-green-700">{state.success}</p> : null}
    </form>
  );
}
