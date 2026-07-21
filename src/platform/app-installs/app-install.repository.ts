import "server-only";

import type { DocumentData } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";

import type { InstalledApp } from "./app-install.types";

function appInstallsCollection(companyId: string) {
  return adminDb.collection("companies").doc(companyId).collection("apps");
}

export function appInstallDoc(companyId: string, appId: string) {
  return appInstallsCollection(companyId).doc(appId);
}

function toInstalledApp(appId: string, data: DocumentData): InstalledApp {
  return {
    appId,
    enabled: data.enabled === true,
    installedAt: data.installedAt ?? undefined,
    config: data.config ?? undefined,
  };
}

export async function isAppInstalled(companyId: string, appId: string): Promise<boolean> {
  const snap = await appInstallDoc(companyId, appId).get();
  return snap.exists && snap.data()?.enabled === true;
}

// Only currently-enabled apps -- uninstalling is a soft toggle (the doc
// persists with enabled: false), same "no hard delete" convention as every
// other Core/Platform collection.
export async function listInstalledApps(companyId: string): Promise<InstalledApp[]> {
  const snap = await appInstallsCollection(companyId).where("enabled", "==", true).get();
  return snap.docs.map((doc) => toInstalledApp(doc.id, doc.data()));
}
