import { notFound } from "next/navigation";

import { requireCompanyMembership } from "@/core/companies/membership";
import { AppsManagementSection, BrandingSection, ConnectorsManagementSection } from "@/settings";

const SECTIONS = ["branding", "apps", "connectors"] as const;
type Section = (typeof SECTIONS)[number];

function isSection(value: string): value is Section {
  return (SECTIONS as readonly string[]).includes(value);
}

export default async function SettingsRoutePage({
  params,
}: {
  params: Promise<{ companyId: string; slug?: string[] }>;
}) {
  const { companyId, slug } = await params;
  await requireCompanyMembership(companyId);

  const section = slug?.[0] ?? "branding";
  if (!isSection(section)) {
    notFound();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 p-8">
      <h1 className="text-lg font-semibold text-neutral-900">Settings</h1>
      {section === "branding" ? <BrandingSection companyId={companyId} /> : null}
      {section === "apps" ? <AppsManagementSection companyId={companyId} /> : null}
      {section === "connectors" ? <ConnectorsManagementSection companyId={companyId} /> : null}
    </main>
  );
}
