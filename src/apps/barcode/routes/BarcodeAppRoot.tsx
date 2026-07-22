import { cookies } from "next/headers";

import { listBranches, requireCompanyMembership } from "@/core";
import { CSRF_COOKIE_NAME } from "@/core/auth/constants";

import { BarcodeScanner } from "../components/BarcodeScanner";

// The single dispatch point the Next.js route layer's routeKey -> Component
// map (app-roots.ts) points "barcode" at -- same mechanism as every other
// App's own AppRoot. Barcode has only one screen this phase (no history/
// detail sub-routes), so there's no slug dispatch to do.
export async function BarcodeAppRoot({ companyId }: { companyId: string; slug?: string[] }) {
  await requireCompanyMembership(companyId);
  const cookieStore = await cookies();
  const csrfToken = cookieStore.get(CSRF_COOKIE_NAME)?.value ?? "";

  const branches = await listBranches(companyId);

  return <BarcodeScanner companyId={companyId} csrfToken={csrfToken} branches={branches} />;
}
