import { z } from "zod";

const clientEnvSchema = z.object({
  NEXT_PUBLIC_FIREBASE_API_KEY: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_APP_ID: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: z.string().optional(),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;

export function parseClientEnv(source: NodeJS.ProcessEnv): ClientEnv {
  const result = clientEnvSchema.safeParse(source);
  if (!result.success) {
    const missingKeys = result.error.issues.map((issue) => issue.path.join("."));
    throw new Error(
      `Invalid or missing client environment variables: ${missingKeys.join(", ")}. Check .env.local against .env.example.`,
    );
  }
  return result.data;
}

export const clientEnv = parseClientEnv(process.env);
