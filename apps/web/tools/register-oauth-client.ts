/**
 * Register a first-party OAuth client (e.g. Deni Run) with the Deni AI OAuth
 * provider and print its client id and secret once.
 *
 *   pnpm run tools:register-oauth-client --name="Deni Run" \
 *     --redirect-uri=https://run.deniai.app/api/auth/callback/deni-ai
 *
 * `--redirect-uri` may be repeated (e.g. add the local dev callback). The client
 * skips the consent screen; pass `--consent` to show it. Set the printed client
 * id as DENI_RUN_OAUTH_CLIENT_ID here and both values in the client app.
 *
 * Uses a minimal Better Auth instance with the same secret and plugin options
 * as src/lib/auth.ts, so the stored (encrypted) secret matches the app's.
 */
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { drizzle } from "drizzle-orm/postgres-js";

import * as schema from "../src/db/schema";

const databaseUrl = process.env.DATABASE_URL;
const secret = process.env.BETTER_AUTH_SECRET;
const baseURL = process.env.NEXT_PUBLIC_BETTER_AUTH_URL;
if (!databaseUrl || !secret || !baseURL) {
  console.error("DATABASE_URL, BETTER_AUTH_SECRET and NEXT_PUBLIC_BETTER_AUTH_URL are required");
  process.exit(1);
}

const args = process.argv.slice(2);
const valuesOf = (name: string) =>
  args.filter((arg) => arg.startsWith(`--${name}=`)).map((arg) => arg.slice(name.length + 3));
const name = valuesOf("name")[0];
const redirectUris = valuesOf("redirect-uri");
if (!name || redirectUris.length === 0) {
  console.error(
    'Usage: --name="Deni Run" --redirect-uri=<callback url> [--redirect-uri=...] [--consent]',
  );
  process.exit(1);
}

const db = drizzle({ connection: { url: databaseUrl, max: 1, prepare: false }, schema });
const auth = betterAuth({
  baseURL,
  secret,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  plugins: [
    oauthProvider({
      loginPage: "/oauth/authorize",
      consentPage: "/oauth/consent",
      disableJwtPlugin: true,
      allowDynamicClientRegistration: false,
      // Own the client by a reference, not by the synthetic operator below.
      clientReference: () => OPERATOR_REFERENCE,
    }),
  ],
});

// The plugin creates clients only for a signed-in user, even from the server API.
// This script has no user session, so it acts through a synthetic operator session
// on its own (throwaway) auth context.
const OPERATOR_REFERENCE = "deni-ai-operator";
const context = await auth.$context;
const now = new Date();
Object.assign(context, {
  session: {
    session: {
      id: OPERATOR_REFERENCE,
      userId: OPERATOR_REFERENCE,
      token: OPERATOR_REFERENCE,
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
    },
    user: {
      id: OPERATOR_REFERENCE,
      name: "Deni AI operator",
      email: "operator@deniai.invalid",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
  },
});

const client = await auth.api.adminCreateOAuthClient({
  headers: new Headers(),
  body: {
    client_name: name,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: "client_secret_post",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    skip_consent: !args.includes("--consent"),
  },
});

console.info(`Registered OAuth client "${name}"`);
console.info(`client_id:     ${client.client_id}`);
console.info(`client_secret: ${client.client_secret ?? "(none)"}`);
console.info("Store the secret now: it cannot be shown again.");
process.exit(0);
