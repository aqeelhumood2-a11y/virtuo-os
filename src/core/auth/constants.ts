export const SESSION_COOKIE_NAME = "session";
export const CSRF_COOKIE_NAME = "csrf_token";

// Firebase's createSessionCookie allows 5 minutes to 14 days; 14 days is the
// maximum and is used as the default session lifetime.
export const SESSION_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export const RATE_LIMITS = {
  signIn: { limit: 10, windowMs: 15 * 60 * 1000 },
  signUp: { limit: 5, windowMs: 15 * 60 * 1000 },
  passwordReset: { limit: 5, windowMs: 15 * 60 * 1000 },
  onboarding: { limit: 5, windowMs: 15 * 60 * 1000 },
} as const;
