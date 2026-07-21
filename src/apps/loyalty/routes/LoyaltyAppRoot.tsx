import { cookies } from "next/headers";

import { hasCapability, requireCompanyMembership } from "@/core";
import { CSRF_COOKIE_NAME } from "@/core/auth/constants";

import {
  getMemberBalance,
  listAllMembers,
  listLedgerEntriesForMember,
  syncAccruals,
} from "../application/loyalty.service";
import { LoyaltyDashboard } from "../components/LoyaltyDashboard";
import { MemberLedger } from "../components/MemberLedger";

// The single dispatch point the Next.js route layer's routeKey -> Component
// map (app-roots.ts) points "loyalty" at -- same mechanism as Restaurant's
// and Retail's own AppRoot components.
export async function LoyaltyAppRoot({ companyId, slug }: { companyId: string; slug?: string[] }) {
  const { membership } = await requireCompanyMembership(companyId);
  const cookieStore = await cookies();
  const csrfToken = cookieStore.get(CSRF_COOKIE_NAME)?.value ?? "";

  // Lazy, on-demand sync (Phase 4.2 §13.1): triggered automatically here,
  // on every mount, for a caller who already has audit.view -- never a new
  // scheduler/event mechanism. hasCapability() is a plain boolean check
  // (no redirect), so a caller without audit.view simply skips this and
  // still sees the read-only dashboard below; the "Sync Now" button is
  // separately gated the same way (components/SyncNowButton.tsx).
  const canSync = hasCapability(membership.role, "audit.view");
  if (canSync) {
    try {
      await syncAccruals(companyId);
    } catch (error) {
      // Best-effort: a failed auto-sync must never block the page itself
      // from rendering -- the manual "Sync Now" action remains available.
      console.error("Loyalty auto-sync failed:", error);
    }
  }

  const [section, param] = slug ?? [];

  if (section === "member" && param) {
    const member = await getMemberBalance(companyId, param);
    if (!member) {
      return (
        <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-8 text-center">
          <h1 className="text-lg font-semibold text-neutral-900">Member not found</h1>
        </main>
      );
    }
    const entries = await listLedgerEntriesForMember(companyId, param);
    return <MemberLedger companyId={companyId} member={member} entries={entries} />;
  }

  const members = await listAllMembers(companyId);
  return <LoyaltyDashboard companyId={companyId} csrfToken={csrfToken} members={members} canSync={canSync} />;
}
