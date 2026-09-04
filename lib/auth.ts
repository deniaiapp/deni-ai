import "server-only";

import { headers } from "next/headers";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";

const appUrl = process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL;

export const auth = betterAuth({
  appName: "Deni Run",
  baseURL: appUrl,
  trustedOrigins: [
    appUrl,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NODE_ENV !== "production" ? "http://localhost:3000" : "",
    process.env.NODE_ENV !== "production" ? "http://127.0.0.1:3000" : "",
  ].filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index),
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: authSchema.user,
      session: authSchema.session,
      account: authSchema.account,
      verification: authSchema.verification,
      authRateLimit: authSchema.authRateLimit,
    },
  }),
  emailAndPassword: {
    enabled: false,
  },
  socialProviders: {
    ...(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim()
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            prompt: "select_account" as const,
          },
        }
      : {}),
    ...(process.env.GITHUB_CLIENT_ID?.trim() && process.env.GITHUB_CLIENT_SECRET?.trim()
      ? {
          github: {
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
          },
        }
      : {}),
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["google", "github"],
    },
  },
  user: {
    deleteUser: {
      enabled: true,
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    storage: "database",
    modelName: "authRateLimit",
  },
  plugins: [nextCookies()],
});

export async function getAuthSession() {
  return auth.api.getSession({
    headers: await headers(),
  });
}

export async function getAuthenticatedUserId() {
  const session = await getAuthSession();
  return session?.user.id ?? null;
}
