/**
 * Packages this package imports that must resolve to the app's own copy.
 *
 * pnpm resolves Better Auth's optional peers (Vite, TanStack Start, Vitest…)
 * per importer, so `packages/auth` and the app can get different copies of the
 * same version. Two copies would break `instanceof APIError` for errors app
 * hooks throw and split plugin state, so apps list these in Vite's
 * `resolve.dedupe` (dev server, build and Vitest).
 */
export const authDedupe = [
  "better-auth",
  "@better-auth/drizzle-adapter",
  "@better-auth/oauth-provider",
  "@better-auth/passkey",
];
