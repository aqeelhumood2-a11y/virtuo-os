import "server-only";

import { FieldValue, type Transaction } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import { writeAuditInTransaction } from "@/core/audit-logs";
import { requireCapability } from "@/core/roles-permissions";

import { requireCompanyMembership } from "./membership";
import type { CompanyBranding } from "./company-settings.types";

// companies/{companyId}/settings/{settingId} -- one document per settings
// category (branding now; localization/tax/numbering/receipts/currencies/
// printing/regional later), never one merged document. Kept in
// core/companies rather than as a field on Company itself: Company would
// otherwise keep accumulating unrelated fields as each category is added,
// and every category here is genuinely tenant-configuration data (same
// tier as branches/memberships), not a commercial concept -- so it stays
// in Core, not Platform. See docs/phases/PHASE_2_PLAN.md §3/§9.
function companySettingsDoc(companyId: string, settingId: string) {
  return adminDb.collection("companies").doc(companyId).collection("settings").doc(settingId);
}

// Any active member can see branding (a logo/color the whole team already
// sees in the product) -- same visibility tier as branches, not gated by a
// specific capability.
export async function getCompanyBranding(companyId: string): Promise<CompanyBranding> {
  await requireCompanyMembership(companyId);
  const snap = await companySettingsDoc(companyId, "branding").get();
  if (!snap.exists) return {};

  const data = snap.data();
  return {
    logoUrl: data?.logoUrl ?? undefined,
    primaryColor: data?.primaryColor ?? undefined,
  };
}

// Reuses company.update -- editing branding is the same sensitivity tier
// as renaming the company (Owner + Manager), not a new capability.
export async function updateCompanyBranding(companyId: string, branding: CompanyBranding): Promise<void> {
  const { session } = await requireCapability(companyId, "company.update");
  const ref = companySettingsDoc(companyId, "branding");

  await adminDb.runTransaction(async (transaction: Transaction) => {
    const snap = await transaction.get(ref);
    const before = snap.exists ? snap.data() : undefined;

    transaction.set(
      ref,
      {
        logoUrl: branding.logoUrl ?? null,
        primaryColor: branding.primaryColor ?? null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    writeAuditInTransaction(transaction, {
      companyId,
      actorId: session.uid,
      action: "company.brandingUpdated",
      targetType: "companySettings",
      targetId: "branding",
      before: { logoUrl: before?.logoUrl ?? null, primaryColor: before?.primaryColor ?? null },
      after: { logoUrl: branding.logoUrl ?? null, primaryColor: branding.primaryColor ?? null },
    });
  });
}
