import type { LoyaltyMember } from "../domain/loyalty.types";
import { AttributeOrderForm } from "./AttributeOrderForm";
import { EnrollMemberForm } from "./EnrollMemberForm";
import { MemberList } from "./MemberList";
import { SyncNowButton } from "./SyncNowButton";

export function LoyaltyDashboard({
  companyId,
  csrfToken,
  members,
  canSync,
}: {
  companyId: string;
  csrfToken: string;
  members: LoyaltyMember[];
  canSync: boolean;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <h1 className="text-lg font-semibold text-neutral-900">Loyalty</h1>

      {canSync ? <SyncNowButton companyId={companyId} csrfToken={csrfToken} /> : null}

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-neutral-900">Members</h2>
        <MemberList companyId={companyId} members={members} />
      </div>

      <EnrollMemberForm companyId={companyId} csrfToken={csrfToken} />

      {members.length > 0 ? <AttributeOrderForm companyId={companyId} csrfToken={csrfToken} members={members} /> : null}
    </main>
  );
}
