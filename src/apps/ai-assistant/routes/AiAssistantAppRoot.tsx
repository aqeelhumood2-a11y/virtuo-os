import { cookies } from "next/headers";

import { listBranches, requireCompanyMembership } from "@/core";
import { CSRF_COOKIE_NAME } from "@/core/auth/constants";

import { listRecentQuestions } from "../application/query-orchestrator.service";
import { AskForm } from "../components/AskForm";

const RECENT_QUESTIONS_LIMIT = 10;

// The single dispatch point the Next.js route layer's routeKey -> Component
// map (app-roots.ts) points "ai-assistant" at -- same mechanism as every
// other App's own AppRoot. Scoped to the first available branch, the same
// documented simplification Retail/Barcode/Kitchen Display all use.
export async function AiAssistantAppRoot({ companyId }: { companyId: string; slug?: string[] }) {
  await requireCompanyMembership(companyId);
  const cookieStore = await cookies();
  const csrfToken = cookieStore.get(CSRF_COOKIE_NAME)?.value ?? "";

  const branches = await listBranches(companyId);
  const branchId = branches[0]?.id ?? "";
  const recentQuestions = await listRecentQuestions(companyId, RECENT_QUESTIONS_LIMIT);

  return <AskForm companyId={companyId} branchId={branchId} csrfToken={csrfToken} recentQuestions={recentQuestions} />;
}
