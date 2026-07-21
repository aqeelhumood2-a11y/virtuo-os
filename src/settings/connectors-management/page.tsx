import { cookies } from "next/headers";

import { CSRF_COOKIE_NAME } from "@/core/auth/constants";
import { requireCompanyMembership } from "@/core/companies/membership";
import { getRegisteredConnectors, hasPlatformCapability, listCompanyConnectors } from "@/platform";

import { ConnectorsList } from "./ConnectorsList";

// Not a Next.js route file despite the name -- see
// apps-management/page.tsx's comment for why.
export async function ConnectorsManagementSection({ companyId }: { companyId: string }) {
  const { membership } = await requireCompanyMembership(companyId);

  const cookieStore = await cookies();
  const csrfToken = cookieStore.get(CSRF_COOKIE_NAME)?.value ?? "";

  const connectors = getRegisteredConnectors();
  const connections = await listCompanyConnectors(companyId);

  return (
    <ConnectorsList
      csrfToken={csrfToken}
      companyId={companyId}
      connectors={connectors}
      connections={connections}
      canManage={hasPlatformCapability(membership.role, "connectors.manage")}
    />
  );
}
