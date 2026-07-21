import "server-only";

import { FieldValue, type Transaction } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import { writeAuditInTransaction } from "@/core/audit-logs";
import { listCompanyMembers } from "@/core/companies/membership";
import { createNotificationInTransaction } from "@/core/notifications";
import { requireSuperAdmin } from "@/core/roles-permissions";
import { getAppManifest } from "@/app-registry";

import { isAppEntitled } from "../licenses/license.repository";
import { requirePlatformCapability } from "../shared/require-platform-capability";

import { appInstallDoc } from "./app-install.repository";
import type { AppInstallAuditAction } from "./app-install.types";

// Business logic only -- no "use server", no FormData/prevState, no CSRF.
// Callable identically from a Server Action (settings/apps-management), a
// future REST route, a CLI tool, or a background job, since it never
// depends on anything HTTP/form-shaped itself (see docs/phases/PHASE_2_PLAN.md
// §2/§10 for the one honest caveat: authorization here still derives the
// actor from the current request's session cookie, so a true cookie-less
// caller would need its own future authentication bridge -- not solved here).
export class AppNotRegisteredError extends Error {
  constructor(appId: string) {
    super(`"${appId}" is not a registered app.`);
    this.name = "AppNotRegisteredError";
  }
}

export class AppNotEntitledError extends Error {
  constructor(appId: string) {
    super(`Your plan does not include "${appId}".`);
    this.name = "AppNotEntitledError";
  }
}

// Other Owners/Managers are notified of an install/uninstall (never the
// acting admin themselves, who already knows) -- the recipient list is
// fetched as a plain, non-transactional read before the transaction opens,
// same "plain read first, transaction re-reads only what the mutation
// itself needs" pattern order-engine's requireOrderAccess already uses.
async function otherAdminUids(companyId: string, actorId: string): Promise<string[]> {
  const members = await listCompanyMembers(companyId);
  return members
    .filter((member) => (member.role === "Owner" || member.role === "Manager") && member.uid !== actorId)
    .map((member) => member.uid);
}

async function setAppEnabled(
  companyId: string,
  appId: string,
  enabled: boolean,
  actorId: string,
  action: AppInstallAuditAction,
): Promise<void> {
  const recipients = await otherAdminUids(companyId, actorId);
  const ref = appInstallDoc(companyId, appId);

  await adminDb.runTransaction(async (transaction: Transaction) => {
    const snap = await transaction.get(ref);
    const wasEnabled = snap.exists && snap.data()?.enabled === true;
    const existingInstalledAt = snap.exists ? (snap.data()?.installedAt ?? null) : null;

    transaction.set(
      ref,
      {
        enabled,
        // installedAt is set once, the first time an app is enabled, and
        // never cleared on uninstall -- a re-install doesn't lose the
        // original install date, same "set once" convention as
        // onboardedAt/joinedAt elsewhere in Core.
        installedAt: enabled ? (existingInstalledAt ?? FieldValue.serverTimestamp()) : existingInstalledAt,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    writeAuditInTransaction<AppInstallAuditAction, "app">(transaction, {
      companyId,
      actorId,
      action,
      targetType: "app",
      targetId: appId,
      before: { enabled: wasEnabled },
      after: { enabled },
    });

    for (const uid of recipients) {
      createNotificationInTransaction(transaction, uid, {
        title: enabled ? "App installed" : "App uninstalled",
        body: `${appId} is now ${enabled ? "enabled" : "disabled"}.`,
        relatedEntity: { type: "app", id: appId },
      });
    }
  });
}

export async function installApp(companyId: string, appId: string): Promise<void> {
  const { session } = await requirePlatformCapability(companyId, "apps.install");

  if (!getAppManifest(appId)) throw new AppNotRegisteredError(appId);
  if (!(await isAppEntitled(companyId, appId))) throw new AppNotEntitledError(appId);

  await setAppEnabled(companyId, appId, true, session.uid, "app.installed");
}

export async function uninstallApp(companyId: string, appId: string): Promise<void> {
  const { session } = await requirePlatformCapability(companyId, "apps.install");
  await setAppEnabled(companyId, appId, false, session.uid, "app.uninstalled");
}

// The one Super Admin write path in the whole system -- bypasses both the
// apps.install capability check and the entitlement check entirely. See
// docs/phases/PHASE_2_PLAN.md §3/§10.
export async function forceToggleApp(companyId: string, appId: string, enabled: boolean): Promise<void> {
  const session = await requireSuperAdmin();
  await setAppEnabled(companyId, appId, enabled, session.uid, "app.forceToggled");
}
