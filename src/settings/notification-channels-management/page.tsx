import { cookies } from "next/headers";

import { CSRF_COOKIE_NAME } from "@/core/auth/constants";
import { requireCompanyMembership } from "@/core/companies/membership";
import { getWhatsAppChannel, hasPlatformCapability } from "@/platform";

import { WhatsAppChannelSection } from "./WhatsAppChannelSection";

// Not a Next.js route file despite the name -- see
// apps-management/page.tsx's comment for why.
export async function NotificationChannelsManagementSection({ companyId }: { companyId: string }) {
  const { membership } = await requireCompanyMembership(companyId);

  const cookieStore = await cookies();
  const csrfToken = cookieStore.get(CSRF_COOKIE_NAME)?.value ?? "";

  const connection = await getWhatsAppChannel(companyId);

  return (
    <WhatsAppChannelSection
      csrfToken={csrfToken}
      companyId={companyId}
      connection={connection}
      canManage={hasPlatformCapability(membership.role, "notificationChannels.manage")}
    />
  );
}
