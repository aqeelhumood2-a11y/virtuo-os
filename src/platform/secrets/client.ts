import "server-only";

import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

import { serverEnv } from "@/shared/config/server-env";

// Reuses the exact same GCP service-account credentials already validated
// for Firebase Admin (a Firebase project's service account is a GCP
// service account) -- no new secret/env var is introduced, consistent
// with "Firebase Admin credentials are never exposed to client code" and
// with not inventing a second credential-management surface. See
// docs/phases/PHASE_5_PLAN.md §5 and docs/DATABASE.md §5.
function createSecretManagerClient(): SecretManagerServiceClient {
  return new SecretManagerServiceClient({
    projectId: serverEnv.FIREBASE_PROJECT_ID,
    credentials: {
      client_email: serverEnv.FIREBASE_CLIENT_EMAIL,
      private_key: serverEnv.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    },
  });
}

export const secretManagerClient = createSecretManagerClient();
export const gcpProjectId = serverEnv.FIREBASE_PROJECT_ID;
