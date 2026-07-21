import { NextResponse } from "next/server";

import { handleWebhook } from "@/platform";

// Thin HTTP shell only -- all orchestration (looking up the connector's
// pure contract, calling its onWebhook(), any future persistence) lives in
// platform/connector-connections.handleWebhook(). Not company-scoped: this
// route mounts at /api/webhooks/[connectorId], matching
// FOLDER_STRUCTURE.md's original sketch. See docs/phases/PHASE_2_PLAN.md
// §2/§5 for why no Core mutation happens here in Phase 2.
export async function POST(request: Request, { params }: { params: Promise<{ connectorId: string }> }) {
  const { connectorId } = await params;

  let payload: unknown = null;
  try {
    payload = await request.json();
  } catch {
    payload = null;
  }

  try {
    const result = await handleWebhook(connectorId, payload);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Unknown connector." }, { status: 404 });
  }
}
