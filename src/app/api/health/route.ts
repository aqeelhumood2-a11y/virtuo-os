import { NextResponse } from "next/server";

// Phase 7: a liveness check for an external uptime monitor (UptimeRobot,
// Better Uptime, Pingdom, etc.) to poll -- deliberately just "is the
// process up and serving requests," not a dependency check against
// Firestore or any external API. A readiness/dependency check would add
// latency and a false-negative risk (a transient Firestore blip would
// report the whole app as down when it might still serve most routes
// fine); this route's only job is to answer fast and always, so a real
// process crash or deploy failure is what actually trips the monitor.
// Configuring an actual monitoring *service* against this endpoint is an
// operational step outside code -- see docs/phases/PHASE_7_PLAN.md.
export async function GET() {
  return NextResponse.json({ status: "ok", timestamp: new Date().toISOString() });
}
