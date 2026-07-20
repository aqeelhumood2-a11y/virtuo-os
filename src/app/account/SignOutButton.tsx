"use client";

import { signOutAction } from "@/core/auth/actions";
import { Button } from "@/shared/ui";

export function SignOutButton({ csrfToken }: { csrfToken: string }) {
  return (
    <form action={signOutAction}>
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <Button type="submit" variant="secondary">
        Sign out
      </Button>
    </form>
  );
}
