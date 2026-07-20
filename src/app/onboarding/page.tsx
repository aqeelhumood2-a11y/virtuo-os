import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { CSRF_COOKIE_NAME } from "@/core/auth/constants";
import { requireSession } from "@/core/auth/session";
import { listMyCompanies } from "@/core/companies/membership";
import { Card } from "@/shared/ui";

import { OnboardingForm } from "./OnboardingForm";

export default async function OnboardingPage() {
  const session = await requireSession();

  const companies = await listMyCompanies(session.uid);
  if (companies.length > 0) {
    redirect("/account");
  }

  const cookieStore = await cookies();
  const csrfToken = cookieStore.get(CSRF_COOKIE_NAME)?.value ?? "";

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <OnboardingForm csrfToken={csrfToken} />
      </Card>
    </main>
  );
}
