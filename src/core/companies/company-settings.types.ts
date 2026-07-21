// The first of several future settings categories (see
// docs/phases/PHASE_2_PLAN.md §3 of the original plan: localization, tax,
// numbering, receipts, currencies, printing, regional). Each category gets
// its own document under companies/{companyId}/settings/{settingId} --
// deliberately not one giant merged document -- so a future category never
// risks write contention with, or accidental coupling to, this one.
export type CompanyBranding = {
  logoUrl?: string;
  primaryColor?: string;
};

export type CompanySettingsFormState = {
  error?: string;
  success?: string;
};
