import { cookies } from "next/headers";

import { requireSession } from "@/core/auth/session";
import { CSRF_COOKIE_NAME } from "@/core/auth/constants";
import { Card } from "@/shared/ui";

import { SignOutButton } from "./SignOutButton";

export default async function AccountPage() {
  const session = await requireSession();
  const cookieStore = await cookies();
  const csrfToken = cookieStore.get(CSRF_COOKIE_NAME)?.value ?? "";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <Card className="w-full max-w-sm text-center">
        <h1 className="text-lg font-semibold text-neutral-900">Signed in</h1>
        <p className="mt-2 text-sm text-neutral-600">
          {session.email ?? session.uid}
        </p>
        <p className="mt-4 text-sm text-neutral-600">
          This is a technical placeholder confirming the authentication flow
          works. No business functionality has been built yet.
        </p>
        <div className="mt-4">
          <SignOutButton csrfToken={csrfToken} />
        </div>
      </Card>
    </main>
  );
}
