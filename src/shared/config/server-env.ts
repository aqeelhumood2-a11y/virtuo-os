import "server-only";

import { z } from "zod";

const serverEnvSchema = z.object({
  FIREBASE_PROJECT_ID: z.string().min(1),
  FIREBASE_CLIENT_EMAIL: z.string().min(1),
  FIREBASE_PRIVATE_KEY: z.string().min(1),
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
