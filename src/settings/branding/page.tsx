import { cookies } from "next/headers";

import { CSRF_COOKIE_NAME } from "@/core/auth/constants";
import { getCompanyBranding } from "@/core/companies/company-settings";

import { BrandingForm } from "./BrandingForm";

// Not a Next.js route file despite the name -- see
// apps-management/page.tsx's comment for why.
export async function BrandingSection({ companyId }: { companyId: string }) {
  const cookieStore = await cookies();
  const csrfToken = cookieStore.get(CSRF_COOKIE_NAME)?.value ?? "";

  const branding = await getCompanyBranding(companyId);

  return (
    <BrandingForm
      csrfToken={csrfToken}
      companyId={companyId}
      logoUrl={branding.logoUrl ?? null}
      primaryColor={branding.primaryColor ?? null}
    />
  );
}
