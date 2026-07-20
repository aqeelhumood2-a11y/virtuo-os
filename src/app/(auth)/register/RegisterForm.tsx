"use client";

import Link from "next/link";
import { useActionState } from "react";

import { signUpAction } from "@/core/auth/actions";
import type { AuthFormState } from "@/core/auth/types";
import { Button, FormField, Input } from "@/shared/ui";

const initialState: AuthFormState = {};

export function RegisterForm({ csrfToken }: { csrfToken: string }) {
  const [state, action, pending] = useActionState(signUpAction, initialState);

  return (
    <form action={action} className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-neutral-900">Create account</h1>
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <FormField label="Email">
        <Input type="email" name="email" required autoComplete="email" />
      </FormField>
      <FormField label="Password">
        <Input
          type="password"
          name="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </FormField>
      {state.error ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
      <p className="text-sm text-neutral-600">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </form>
  );
}
