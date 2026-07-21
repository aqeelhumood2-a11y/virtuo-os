import type { LoyaltyMember } from "../domain/loyalty.types";

export function MemberList({ companyId, members }: { companyId: string; members: LoyaltyMember[] }) {
  return (
    <div className="flex flex-col gap-2">
      {members.map((member) => (
        <a
          key={member.id}
          href={`/${companyId}/apps/loyalty/member/${member.id}`}
          className="flex items-center justify-between rounded-md border border-neutral-200 p-3 text-sm hover:bg-neutral-50"
        >
          <span className="text-neutral-900">
            {member.name}
            {member.contactRef ? ` · ${member.contactRef}` : ""}
          </span>
          <span className="font-medium text-neutral-900">{member.pointsBalance} pts</span>
        </a>
      ))}
      {members.length === 0 ? <p className="text-sm text-neutral-600">No members enrolled yet.</p> : null}
    </div>
  );
}
