"use client";

import Link from "next/link";
import { useActionState } from "react";

import { requestPasswordResetAction } from "@/core/auth/actions";
import type { AuthFormState } from "@/core/auth/types";
import { Button, FormField, Input } from "@/shared/ui";

const initialState: AuthFormState = {};

export function ResetPasswordForm({ csrfToken }: { csrfToken: string }) {
  const [state, action, pending] = useActionState(requestPasswordResetAction, initialState);

  return (
    <form action={action} className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-neutral-900">Reset password</h1>
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <FormField label="Email">
        <Input type="email" name="email" required autoComplete="email" />
      </FormField>
      {state.error ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p role="status" className="text-sm text-neutral-600">
          {state.success}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </Button>
      <p className="text-sm text-neutral-600">
        <Link href="/login">Back to sign in</Link>
      </p>
    </form>
  );
}
