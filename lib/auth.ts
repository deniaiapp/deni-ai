import "server-only";

import { headers } from "next/headers";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { isLocalAuthBypass, LOCAL_USER_EMAIL, LOCAL_USER_ID } from "./local-auth";
import { OTP_PERIOD_MINUTES, sendTwoFactorEmail } from "./two-factor-delivery";
import {
  assertPasskeySignInAllowed,
  requireUserVerified,
  twoFactorAfter,
  twoFactorBefore,
} from "./two-factor-hooks";

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
    provider: "sqlite",
    schema: {
      user: authSchema.user,
      session: authSchema.session,
      account: authSchema.account,
      verification: authSchema.verification,
      twoFactor: authSchema.twoFactor,
      passkey: authSchema.passkey,
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
    additionalFields: {
      // Written only by the two-factor setup route and hooks, never by updateUser from the client.
      twoFactorMethod: { type: "string", required: false, input: false },
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    storage: "database",
    modelName: "authRateLimit",
    customRules: {
      // Each request sends an email; twoFactorBefore also limits per user.
      "/two-factor/send-otp": { window: 60, max: 3 },
    },
  },
  hooks: {
    before: twoFactorBefore,
    after: twoFactorAfter,
  },
  plugins: [
    twoFactor({
      issuer: "Deni Run",
      allowPasswordless: true,
      otpOptions: {
        period: OTP_PERIOD_MINUTES,
        storeOTP: "hashed",
        async sendOTP({ user, otp }) {
          await sendTwoFactorEmail(user.email, otp);
        },
      },
    }),
    passkey({
      rpName: "Deni Run",
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      registration: {
        async afterVerification({ verification }) {
          await requireUserVerified(verification.registrationInfo?.userVerified ?? false);
        },
      },
      authentication: {
        async afterVerification({ ctx, verification, clientData }) {
          await requireUserVerified(verification.authenticationInfo.userVerified);
          await assertPasskeySignInAllowed(ctx, clientData.id);
        },
      },
    }),
    nextCookies(),
  ],
});

export async function getAuthSession() {
  const requestHeaders = await headers();
  if (isLocalAuthBypass(requestHeaders.get("host"))) {
    // Workspace tables reference the auth user; create one stable tenant for local work.
    await db.insert(authSchema.user).values({
      id: LOCAL_USER_ID,
      name: "Local developer",
      email: LOCAL_USER_EMAIL,
      emailVerified: true,
      twoFactorEnabled: true,
    }).onConflictDoNothing();
    return { user: { id: LOCAL_USER_ID, name: "Local developer", email: LOCAL_USER_EMAIL, twoFactorEnabled: true } };
  }
  return auth.api.getSession({ headers: requestHeaders });
}

export async function getAuthenticatedUserId() {
  const session = await getAuthSession();
  return session?.user.id ?? null;
}

export async function getWorkspaceUserId() {
  const session = await getAuthSession();
  if (!session?.user.id || !session.user.twoFactorEnabled) return null;
  return session.user.id;
}
