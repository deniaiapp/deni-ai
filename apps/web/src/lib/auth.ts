import { createAuth } from "@deniai/auth/server";
import { db } from "@/db/drizzle";
import { env } from "@/env";
import { deletePersonalStripeCustomers } from "@/lib/account-deletion-billing";
import { isAdminEmailDomain } from "@/lib/admin-emails";
import { accountDeletionAttachmentHooks } from "@/lib/attachments";
import { toSafeRedirectPath } from "@/lib/auth-redirect";
import { resolveClientIp } from "@/lib/client-ip";
import { resolveUserName } from "@/lib/default-user-name";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { readEmailChangeToken } from "@/lib/email-change-token";
import {
  checkSignupEmail,
  signupEmailDenialCode,
  signupEmailDenialMessage,
} from "@/lib/email-domain-policy";
import { transferGuestData } from "@/lib/guest-data-transfer";
import { reassignTeamProjectsOnAccountDeletion } from "@/lib/project-access";
import {
  isAnonymousUser,
  recordSecurityActivity,
  securityActionForAuthResponse,
} from "@/lib/security-activity";
import { checkSignupLimits, recordSignupRisk } from "@/lib/signup-risk";
import {
  cancelPersonalSubscription,
  cancelTeamSubscriptionForDeletion,
  recordTeamAuditEvent,
  updateTeamSeatCount,
} from "@/lib/team-billing";
import {
  isActiveTeamEmailDomain,
  joinTeamByDomainOnSignIn,
  TEAM_MEMBERSHIP_LIMIT,
} from "@/lib/team-domains";
import {
  accountDeletionSeatHooks,
  assertCanSendTeamInvitation,
  teamInvitationHooks,
  teamMemberAuditHooks,
} from "@/lib/team-member-audit";

/**
 * The app's Better Auth server. The configuration lives in `@deniai/auth`
 * (packages/auth/src/server.ts); this module supplies env values, the database,
 * the email sender and the app callbacks. `pnpm run auth:generate` reads it.
 */

const googleClientId = env.GOOGLE_CLIENT_ID?.trim();
const googleClientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
const githubClientId = env.GITHUB_CLIENT_ID?.trim();
const githubClientSecret = env.GITHUB_CLIENT_SECRET?.trim();
const turnstileSecretKey = env.TURNSTILE_SECRET_KEY?.trim();
const turnstileSiteKey = env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
const deniRunOAuthClientId = env.DENI_RUN_OAUTH_CLIENT_ID?.trim();

export const auth = createAuth({
  db,
  publicURL: env.NEXT_PUBLIC_BETTER_AUTH_URL,
  sendEmail: isEmailConfigured() ? sendEmail : undefined,
  socialProviders: {
    ...(googleClientId && googleClientSecret
      ? { google: { clientId: googleClientId, clientSecret: googleClientSecret } }
      : {}),
    ...(githubClientId && githubClientSecret
      ? { github: { clientId: githubClientId, clientSecret: githubClientSecret } }
      : {}),
  },
  // The widget needs the site key; without both keys sign-up runs without CAPTCHA.
  turnstileSecretKey: turnstileSecretKey && turnstileSiteKey ? turnstileSecretKey : undefined,
  trustedOAuthClientIds: deniRunOAuthClientId ? [deniRunOAuthClientId] : [],
  clientIpHeader: env.CLIENT_IP_HEADER,
  hooks: {
    resolveClientIp,
    toSafeRedirectPath,
    resolveUserName,
    readEmailChangeToken,
    checkSignupEmail,
    signupEmailDenialMessage,
    signupEmailDenialCode,
    isAdminEmailDomain,
    isActiveTeamEmailDomain,
    checkSignupLimits,
    recordSignupRisk,
    securityActionForAuthResponse,
    recordSecurityActivity,
    isAnonymousUser,
    transferGuestData,
    teamMembershipLimit: TEAM_MEMBERSHIP_LIMIT,
    assertCanSendTeamInvitation,
    recordTeamAuditEvent,
    updateTeamSeatCount,
    cancelPersonalSubscription,
    cancelTeamSubscriptionForDeletion,
    joinTeamByDomainOnSignIn,
    teamMemberAuditHooks,
    teamInvitationHooks,
    deletePersonalStripeCustomers,
    reassignTeamProjectsOnAccountDeletion: (userId) =>
      reassignTeamProjectsOnAccountDeletion(db, userId),
    accountDeletionSeatHooks,
    accountDeletionAttachmentHooks,
  },
});
