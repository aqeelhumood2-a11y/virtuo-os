"use client";

import Link from "next/link";
import { useActionState } from "react";

import { signInAction } from "@/core/auth/actions";
import type { AuthFormState } from "@/core/auth/types";
import { Button, FormField, Input } from "@/shared/ui";

const initialState: AuthFormState = {};

export function LoginForm({ csrfToken }: { csrfToken: string }) {
  const [state, action, pending] = useActionState(signInAction, initialState);

  return (
    <form action={action} className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-neutral-900">Sign in</h1>
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <FormField label="Email">
        <Input type="email" name="email" required autoComplete="email" />
      </FormField>
      <FormField label="Password">
        <Input type="password" name="password" required autoComplete="current-password" />
      </FormField>
      {state.error ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <div className="flex justify-between text-sm text-neutral-600">
        <Link href="/register">Create account</Link>
        <Link href="/reset-password">Forgot password?</Link>
      </div>
    </form>
  );
}
