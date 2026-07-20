// Test-only stand-in for the real `server-only` package.
//
// The real package unconditionally throws unless resolved under Next.js's
// own webpack build (which special-cases it per compilation target).
// Vitest uses Vite/Rollup resolution instead, so importing the real
// package here would always throw, regardless of which file imports it.
// vitest.config.mts aliases the bare specifier `server-only` to this file
// for the test runner only — `next build`/`next dev` never see this file
// and the real package's client-vs-server enforcement is unchanged there.
export {};
