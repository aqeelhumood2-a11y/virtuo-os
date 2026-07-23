import "server-only";

import { type App, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

import { serverEnv } from "@/shared/config/server-env";

// Deliberately reads the bucket name from serverEnv, not clientEnv --
// this module is imported by nearly every Core/Platform function (any
// caller of adminDb/adminAuth/adminStorage), including server-only paths
// like the webhook route handler that never touch the browser. Depending
// on clientEnv here would mean a single missing *client-only* variable
// (e.g. NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID) could break server-side-only
// functionality that has no relationship to it at all -- exactly the
// failure mode this fix removes. See docs/phases/PHASE_6_HOTFIX.md.
function createFirebaseAdminApp(): App {
  const existingApp = getApps()[0];
  if (existingApp) return existingApp;

  return initializeApp({
    credential: cert({
      projectId: serverEnv.FIREBASE_PROJECT_ID,
      clientEmail: serverEnv.FIREBASE_CLIENT_EMAIL,
      privateKey: serverEnv.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
    storageBucket: serverEnv.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  });
}

const adminApp = createFirebaseAdminApp();

export const adminAuth = getAuth(adminApp);
export const adminDb = getFirestore(adminApp);
export const adminStorage = getStorage(adminApp);
