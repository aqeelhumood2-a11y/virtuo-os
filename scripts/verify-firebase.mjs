import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(rootDir, "..", ".env.local");

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    process.env[key] ??= rawValue.replace(/^"(.*)"$/, "$1");
  }
}

const { cert, initializeApp } = await import("firebase-admin/app");
const { getAuth } = await import("firebase-admin/auth");
const { getFirestore } = await import("firebase-admin/firestore");
const { getStorage } = await import("firebase-admin/storage");

const app = initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  }),
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
});

const results = {};

// --- Firestore ---
try {
  const db = getFirestore(app);
  const ref = db.collection("_infra_verification").doc("ping");
  await ref.set({ ok: true, at: new Date().toISOString() });
  const snap = await ref.get();
  await ref.delete();
  results.firestore = snap.exists ? "OK (write/read/delete succeeded)" : "FAILED (doc not found after write)";
} catch (err) {
  results.firestore = `FAILED: ${err.message}`;
}

// --- Auth ---
try {
  const auth = getAuth(app);
  const testEmail = `infra-verify-${Date.now()}@example.com`;
  const user = await auth.createUser({ email: testEmail, password: "TempPassw0rd!" });
  await auth.deleteUser(user.uid);
  results.auth = "OK (create/delete test user succeeded)";
} catch (err) {
  results.auth = `FAILED: ${err.message}`;
}

// --- Storage ---
try {
  const storage = getStorage(app);
  const bucket = storage.bucket();
  const [exists] = await bucket.exists();
  results.storage = exists ? "OK (bucket reachable)" : "FAILED (bucket does not exist)";
} catch (err) {
  results.storage = `FAILED: ${err.message}`;
}

console.log(JSON.stringify(results, null, 2));

const anyFailed = Object.values(results).some((v) => v.startsWith("FAILED"));
process.exit(anyFailed ? 1 : 0);
