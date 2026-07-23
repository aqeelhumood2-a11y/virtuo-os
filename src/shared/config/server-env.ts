import "server-only";

import { z } from "zod";

const serverEnvSchema = z.object({
  FIREBASE_PROJECT_ID: z.string().min(1),
  FIREBASE_CLIENT_EMAIL: z.string().min(1),
  FIREBASE_PRIVATE_KEY: z.string().min(1),
  // Same variable Next.js also inlines into the client bundle (hence the
  // NEXT_PUBLIC_ prefix) -- validated here too, independently of
  // clientEnv's own schema, so lib/firebase/admin.ts's Storage
  // initialization depends only on the one value it actually needs, never
  // on the five other, purely client-facing Firebase fields (API key,
  // auth domain, messaging sender ID, app ID, measurement ID) that a
  // server-only path has no reason to require. See the hotfix note this
  // comment was added for: a missing client-only var must never be able
  // to break server-side-only routes (e.g. the webhook handler) that
  // never touch the browser at all.
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: z.string().min(1),
  // Optional (Phase 6, AI Assistant App): a single platform-wide LLM key,
  // not a per-company Secret-Manager-backed credential like a Connector's
  // -- one Virtuo-OS-operated subscription serves every company, since an
  // Assistant answering questions from a company's own already-authorized
  // reads has no per-company external account to connect, unlike Shopify/
  // Square/Odoo/WhatsApp. Optional so its absence never breaks any other
  // environment (tests, CI, a deployment that hasn't installed the App
  // yet) -- only asking the Assistant a question requires it, checked at
  // that call site, not at startup. See docs/phases/PHASE_6_PLAN.md §7.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(source: NodeJS.ProcessEnv): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    const missingKeys = result.error.issues.map((issue) => issue.path.join("."));
    throw new Error(
      `Invalid or missing server environment variables: ${missingKeys.join(", ")}. Check .env.local against .env.example.`,
    );
  }
  return result.data;
}

export const serverEnv = parseServerEnv(process.env);
