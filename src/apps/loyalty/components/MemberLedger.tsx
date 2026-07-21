import type { LoyaltyLedgerEntry, LoyaltyMember } from "../domain/loyalty.types";

export function MemberLedger({
  companyId,
  member,
  entries,
}: {
  companyId: string;
  member: LoyaltyMember;
  entries: LoyaltyLedgerEntry[];
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-8">
      <h1 className="text-lg font-semibold text-neutral-900">{member.name}</h1>
      <p className="text-sm text-neutral-600">
        {member.contactRef ? `${member.contactRef} · ` : ""}
        {member.pointsBalance} points
      </p>

      <div className="flex flex-col gap-2">
        {entries.map((entry) => (
          <div key={entry.id} className="flex items-center justify-between rounded-md border border-neutral-200 p-3 text-sm">
            <span className="text-neutral-900">
              {entry.type}
              {entry.orderId ? ` · order ${entry.orderId}` : ""}
            </span>
            <span className="font-medium text-neutral-900">
              {entry.points > 0 ? "+" : ""}
              {entry.points} pts
            </span>
          </div>
        ))}
        {entries.length === 0 ? <p className="text-sm text-neutral-600">No ledger entries yet.</p> : null}
      </div>

      <a href={`/${companyId}/apps/loyalty`} className="text-sm text-brand-600 hover:underline">
        Back to members
      </a>
    </main>
  );
}
