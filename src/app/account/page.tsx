import Link from "next/link";
import { cookies } from "next/headers";

import { CSRF_COOKIE_NAME } from "@/core/auth/constants";
import { requireSession } from "@/core/auth/session";
import { listCompanyMembers } from "@/core/companies/membership";
import { getMyCompanySummary } from "@/core/companies/queries";
import { hasCapability } from "@/core/roles-permissions/guard";
import { getUserProfile } from "@/core/users/profile";
import { Card } from "@/shared/ui";

import { DisplayNameForm } from "./DisplayNameForm";
import { MembersList } from "./MembersList";
import { SignOutButton } from "./SignOutButton";

export default async function AccountPage() {
  const session = await requireSession();
  const cookieStore = await cookies();
  const csrfToken = cookieStore.get(CSRF_COOKIE_NAME)?.value ?? "";

  const [profile, companySummary] = await Promise.all([
    getUserProfile(session.uid),
    getMyCompanySummary(session.uid),
  ]);

  const canViewMembers = companySummary ? hasCapability(companySummary.role, "membership.view") : false;
  const members =
    companySummary && canViewMembers ? await listCompanyMembers(companySummary.companyId) : [];

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <Card className="w-full max-w-sm text-center">
        <h1 className="text-lg font-semibold text-neutral-900">Signed in</h1>
        <p className="mt-2 text-sm text-neutral-600">{session.email ?? session.uid}</p>

        {companySummary ? (
          <p className="mt-4 text-sm text-neutral-600">
            Company: {companySummary.companyName} · Role: {companySummary.role}
            {companySummary.branchName ? ` · Branch: ${companySummary.branchName}` : ""}
          </p>
        ) : (
          <p className="mt-4 text-sm text-neutral-600">
            You don&apos;t belong to a company yet.{" "}
            <Link href="/onboarding" className="underline">
              Create one
            </Link>
            .
          </p>
        )}

        <p className="mt-4 text-sm text-neutral-600">
          This is a technical placeholder confirming the authentication and
          onboarding flows work. No business functionality has been built yet.
        </p>

        {companySummary && canViewMembers ? (
          <div className="mt-6 border-t border-neutral-200 pt-4">
            <h2 className="text-sm font-semibold text-neutral-900">Team</h2>
            <div className="mt-3">
              <MembersList
                csrfToken={csrfToken}
                companyId={companySummary.companyId}
                members={members}
                actorUid={session.uid}
                actorRole={companySummary.role}
                canUpdateRole={hasCapability(companySummary.role, "membership.updateRole")}
                canDeactivate={hasCapability(companySummary.role, "membership.deactivate")}
              />
            </div>
          </div>
        ) : null}

        <div className="mt-6 border-t border-neutral-200 pt-4">
          <DisplayNameForm csrfToken={csrfToken} currentDisplayName={profile?.displayName ?? null} />
        </div>

        <div className="mt-4">
          <SignOutButton csrfToken={csrfToken} />
        </div>
      </Card>
    </main>
  );
}
