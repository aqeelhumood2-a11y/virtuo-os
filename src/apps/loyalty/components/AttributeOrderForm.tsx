"use client";

import { useActionState } from "react";

import type { LoyaltyMember } from "@/apps/loyalty/domain/loyalty.types";
import { Button, FormField, Input } from "@/shared/ui";

import { attributeOrderAction, type LoyaltyActionFormState } from "../actions";

const initialState: LoyaltyActionFormState = {};

export function AttributeOrderForm({
  companyId,
  csrfToken,
  members,
}: {
  companyId: string;
  csrfToken: string;
  members: LoyaltyMember[];
}) {
  const [state, action, pending] = useActionState(attributeOrderAction, initialState);

  return (
    <form action={action} className="flex flex-col gap-3 rounded-md border border-neutral-200 p-3">
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <input type="hidden" name="companyId" value={companyId} />
      <FormField label="Order ID" error={state.error}>
        <Input name="orderId" placeholder="Completed order's ID" required />
      </FormField>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-neutral-900">
        Member
        <select
          name="memberId"
          required
          className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900"
        >
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" disabled={pending || members.length === 0}>
        {pending ? "Attributing…" : "Attribute order"}
      </Button>
      {state.success ? <p className="text-sm text-green-700">{state.success}</p> : null}
    </form>
  );
}
