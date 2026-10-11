import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { passkey } from "@better-auth/passkey";
import { betterAuth, type GenericEndpointContext } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";
import { generateRandomString } from "better-auth/crypto";
import {
  anonymous,
  captcha,
  haveIBeenPwned,
  lastLoginMethod,
  magicLink,
  organization,
} from "better-auth/plugins";
import { twoFactor } from "better-auth/plugins/two-factor";
import { createElement } from "react";
import { db } from "@/db/drizzle";
import * as schema from "@/db/schema";
import {
  ChangeEmailConfirmationEmail,
  changeEmailConfirmationEmailSubject,
} from "@/emails/change-email-confirmation-email";
import { MagicLinkEmail, magicLinkEmailSubject } from "@/emails/magic-link-email";
import {
  NewEmailVerificationEmail,
  newEmailVerificationEmailSubject,
} from "@/emails/new-email-verification-email";
import { OrgInvitationEmail } from "@/emails/org-invitation-email";
import { orgInvitationEmailSubject } from "@/emails/org-invitation-email-subject";
import { PasswordResetEmail, passwordResetEmailSubject } from "@/emails/password-reset-email";
import { VerificationEmail, verificationEmailSubject } from "@/emails/verification-email";
import { env } from "@/env";
import { TWO_FACTOR_PATH } from "@/lib/auth-paths";
import { toSafeRedirectPath } from "@/lib/auth-redirect";
import { resolveClientIp } from "@/lib/client-ip";
import { checkSignupLimits, recordSignupRisk } from "@/lib/signup-risk";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { readEmailChangeToken } from "@/lib/email-change-token";
import { deletePersonalStripeCustomers } from "@/lib/account-deletion-billing";
import { reassignTeamProjectsOnAccountDeletion } from "@/lib/project-access";
import {
  checkSignupEmail,
  signupEmailDenialCode,
  signupEmailDenialMessage,
  type SignupOAuthProvider,
} from "@/lib/email-domain-policy";
import {
  isAnonymousUser,
  recordSecurityActivity,
  securityActionForAuthResponse,
} from "@/lib/security-activity";
import {
  accountDeletionSeatHooks,
  assertCanSendTeamInvitation,
  teamInvitationHooks,
  teamMemberAuditHooks,
} from "@/lib/team-member-audit";
import {
  cancelPersonalSubscription,
  cancelTeamSubscriptionForDeletion,
  recordTeamAuditEvent,
  updateTeamSeatCount,
} from "@/lib/team-billing";

const emailEnabled = isEmailConfigured();
const googleClientId = env.GOOGLE_CLIENT_ID?.trim();
const googleClientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
const githubClientId = env.GITHUB_CLIENT_ID?.trim();
const githubClientSecret = env.GITHUB_CLIENT_SECRET?.trim();
const turnstileSecretKey = env.TURNSTILE_SECRET_KEY?.trim();
const turnstileSiteKey = env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();

const socialProviders = {
  ...(googleClientId && googleClientSecret
    ? {
        google: {
          enabled: true,
          clientId: googleClientId,
          clientSecret: googleClientSecret,
        },
      }
    : {}),
  ...(githubClientId && githubClientSecret
    ? {
        github: {
          enabled: true,
          clientId: githubClientId,
          clientSecret: githubClientSecret,
        },
      }
    : {}),
};

const captchaPlugin =
  turnstileSecretKey && turnstileSiteKey
    ? captcha({
        provider: "cloudflare-turnstile",
        secretKey: turnstileSecretKey,
        // Include defaults + magic-link request (not /magic-link/verify — email click).
        endpoints: [
          "/sign-up/email",
          "/sign-in/email",
          "/request-password-reset",
          "/sign-in/magic-link",
          // Guest accounts carry a free usage allowance; stop scripted minting.
          "/sign-in/anonymous",
        ],
      })
    : null;

type OrgUpdateAuditMarker = { name: boolean; logo: boolean };

const SIGNUP_RATE_LIMITED_MESSAGE =
  "Too many accounts were created from this network. Please try again later.";

type SignupContext = { request?: Request; headers?: Headers } | null | undefined;

function signupHeaders(ctx: SignupContext) {
  return ctx?.request?.headers ?? ctx?.headers;
}

function resolveSignupIp(ctx: SignupContext) {
  const headers = signupHeaders(ctx);
  return headers ? resolveClientIp(headers) : undefined;
}

function resolveSignupUserAgent(ctx: SignupContext) {
  return signupHeaders(ctx)?.get("user-agent");
}

function assertAllowedSignupEmail(email: string, oauthProvider?: SignupOAuthProvider) {
  const result = checkSignupEmail(email, oauthProvider);
  if (result.ok) return;
  throw new APIError("BAD_REQUEST", {
    message: signupEmailDenialMessage(result.reason),
    code: signupEmailDenialCode(result.reason),
  });
}

/**
 * Better Auth answers a sign-up for an existing unverified email with a generic
 * success and keeps the first registrant's password, so verifying the mailbox
 * later would confirm a password its owner may never have set (account
 * pre-hijacking). Once a second sign-up brings a different password, neither is
 * proven: drop the stored one and its sessions. Whoever then verifies the
 * mailbox signs in without a password and can set one with a password reset.
 */
async function revokeContestedSignupPassword(
  ctx: GenericEndpointContext,
  email: string,
  password: unknown,
) {
  // Without required verification an unverified account is a normal account.
  if (!ctx.context.options.emailAndPassword?.requireEmailVerification) return;
  // Leave requests the endpoint rejects anyway untouched.
  const { minPasswordLength, maxPasswordLength } = ctx.context.password.config;
  if (
    typeof password !== "string" ||
    password.length < minPasswordLength ||
    password.length > maxPasswordLength
  ) {
    return;
  }

  const existing = await ctx.context.internalAdapter.findUserByEmail(email, {
    includeAccounts: true,
  });
  if (!existing || existing.user.emailVerified) return;
  const credential = existing.accounts.find((account) => account.providerId === "credential");
  if (!credential?.password) return;
  // The same password again (a repeated sign-up) changes nothing.
  if (await ctx.context.password.verify({ hash: credential.password, password })) return;

  await ctx.context.internalAdapter.deleteAccount(credential.id);
  await ctx.context.internalAdapter.deleteUserSessions(existing.user.id);
}

/** twoFactor()'s default `twoFactorCookieMaxAge`, in seconds. */
const TWO_FACTOR_CHALLENGE_MAX_AGE = 60 * 10;

/**
 * The two-factor plugin only challenges password sign-ins, while
 * /magic-link/verify issues a full session, so the mailbox alone would get past
 * an account's 2FA. Swap that session for the challenge the plugin issues after
 * a password (same cookie and verification rows, which /two-factor/verify-*
 * consume) and continue on the 2FA page.
 */
async function challengeSecondFactorAfterMagicLink(ctx: GenericEndpointContext) {
  const issued = ctx.context.newSession;
  if (!issued?.user.twoFactorEnabled) return;

  deleteSessionCookie(ctx, true);
  await ctx.context.internalAdapter.deleteSession(issued.session.token);
  ctx.context.setNewSession(null);

  const identifier = `2fa-${generateRandomString(20)}`;
  const expiresAt = new Date(Date.now() + TWO_FACTOR_CHALLENGE_MAX_AGE * 1000);
  await ctx.context.internalAdapter.createVerificationValue({
    value: issued.user.id,
    identifier,
    expiresAt,
  });
  await ctx.context.internalAdapter.createVerificationValue({
    value: "0",
    identifier: `2fa-attempts-${identifier}`,
    expiresAt,
  });
  const challengeCookie = ctx.context.createAuthCookie("two_factor", {
    maxAge: TWO_FACTOR_CHALLENGE_MAX_AGE,
  });
  await ctx.setSignedCookie(
    challengeCookie.name,
    identifier,
    ctx.context.secret,
    challengeCookie.attributes,
  );

  // Without a callback URL the endpoint answers with JSON (and a session token).
  const callbackURL: unknown = ctx.query?.callbackURL;
  if (typeof callbackURL !== "string") return ctx.json({ twoFactorRedirect: true });
  // Decoded the same way the endpoint did before it issued the session.
  const callback = new URL(decodeURIComponent(callbackURL), ctx.context.baseURL);
  const challengeURL = new URL(TWO_FACTOR_PATH, ctx.context.baseURL);
  challengeURL.searchParams.set(
    "redirectTo",
    toSafeRedirectPath(`${callback.pathname}${callback.search}${callback.hash}`),
  );
  throw ctx.redirect(challengeURL.toString());
}

export const auth = betterAuth({
  appName: "Deni AI",
  database: drizzleAdapter(db, { provider: "pg", schema }),
  // Reject disallowed domains before verification / magic-link emails are sent,
  // and gate team invitation emails before they are created or resent.
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/organization/invite-member") {
        const session = await getSessionFromCtx(ctx);
        // Without a session the endpoint itself rejects the request.
        if (session) {
          const body = ctx.body as { email?: unknown } | undefined;
          await assertCanSendTeamInvitation({ user: session.user, email: body?.email });
        }
        return;
      }

      if (
        ctx.path !== "/sign-up/email" &&
        ctx.path !== "/sign-in/magic-link" &&
        ctx.path !== "/change-email"
      ) {
        return;
      }

      if (ctx.path === "/change-email") {
        // A guest keeps `isAnonymous` after a change, so a verified real address
        // would end up locked inside a guest account. Guests sign up instead.
        const session = await getSessionFromCtx(ctx);
        if (session?.user.isAnonymous) {
          throw new APIError("FORBIDDEN", {
            message: "Guest accounts cannot change their email. Sign up instead.",
            code: "GUEST_EMAIL_CHANGE_NOT_ALLOWED",
          });
        }
      }

      // Check the field the endpoint actually uses: /change-email ignores `email`.
      const body = ctx.body as
        | { email?: unknown; newEmail?: unknown; password?: unknown }
        | undefined;
      const email = ctx.path === "/change-email" ? body?.newEmail : body?.email;
      if (typeof email !== "string" || !email) return;

      // Magic-link sign-in for an *existing* account keeps working even if
      // the domain is no longer on the allowlist (grandfathered users).
      if (ctx.path === "/sign-in/magic-link") {
        const existing = await ctx.context.internalAdapter.findUserByEmail(email);
        if (existing) return;
      }

      assertAllowedSignupEmail(email);

      if (ctx.path === "/sign-up/email") {
        await revokeContestedSignupPassword(ctx, email, body?.password);
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/magic-link/verify") {
        return challengeSecondFactorAfterMagicLink(ctx);
      }

      const action = securityActionForAuthResponse({
        path: ctx.path,
        returned: ctx.context.returned,
        requestUser: ctx.context.session?.user,
        issuedUser: ctx.context.newSession?.user,
      });
      if (!action) return;

      const sessionUser = ctx.context.session?.user ?? ctx.context.newSession?.user ?? null;
      const userId = sessionUser?.id ?? ctx.context.session?.session?.userId;
      if (!userId || sessionUser?.isAnonymous) return;

      const session = ctx.context.session?.session ?? ctx.context.newSession?.session;
      void recordSecurityActivity({
        userId,
        action,
        ipAddress: session?.ipAddress ?? null,
        userAgent: session?.userAgent ?? null,
        metadata: { path: ctx.path },
      }).catch((error) => {
        console.error("Failed to record security activity", error);
      });
    }),
  },
  emailAndPassword: {
    enabled: true,
    // Includes advisory letters+digits addresses; the email policy permits them
    // through this verification and the signup CAPTCHA above.
    requireEmailVerification: emailEnabled,
    // A reset proves the mailbox; sessions opened with the old password end.
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: emailEnabled
      ? async ({ user, url }) => {
          await sendEmail({
            to: user.email,
            subject: passwordResetEmailSubject,
            react: createElement(PasswordResetEmail, {
              name: user.name,
              resetUrl: url,
            }),
          });
        }
      : undefined,
  },
  emailVerification: emailEnabled
    ? {
        sendVerificationEmail: async ({ user, url, token }) => {
          // During an email change Better Auth sends this to the requested address,
          // so the sign-up wording would be wrong there.
          const emailChange = readEmailChangeToken(token);
          await sendEmail(
            emailChange
              ? {
                  to: user.email,
                  subject: newEmailVerificationEmailSubject,
                  react: createElement(NewEmailVerificationEmail, {
                    name: user.name,
                    newEmail: emailChange.newEmail,
                    verificationUrl: url,
                  }),
                }
              : {
                  to: user.email,
                  subject: verificationEmailSubject,
                  react: createElement(VerificationEmail, {
                    name: user.name,
                    verificationUrl: url,
                  }),
                },
          );
        },
        // Called once Better Auth has verified a link. For an email change this is
        // when the address actually switches, so log it here rather than when the
        // change was requested.
        afterEmailVerification: async (user, request) => {
          const token = request ? new URL(request.url).searchParams.get("token") : null;
          const emailChange = readEmailChangeToken(token);
          if (!emailChange || emailChange.requestType === "change-email-confirmation") return;
          try {
            await recordSecurityActivity({
              userId: user.id,
              action: "email_changed",
              ipAddress: request ? (resolveClientIp(request.headers) ?? null) : null,
              userAgent: request?.headers.get("user-agent") ?? null,
              metadata: { path: "/verify-email" },
            });
          } catch (error) {
            console.error("Failed to record security activity", error);
          }
        },
        // Send on sign-up and when an unverified user tries to sign in
        // (better-auth only auto-sends on sign-in when this flag is set).
        sendOnSignUp: true,
        sendOnSignIn: true,
        autoSignInAfterVerification: true,
      }
    : undefined,
  plugins: [
    anonymous(),
    twoFactor(),
    passkey(),
    haveIBeenPwned(),
    lastLoginMethod(),
    organization({
      // Guests have placeholder emails and must not own teams (or their billing).
      allowUserToCreateOrganization: (user) => !user.isAnonymous,
      membershipLimit: 50,
      organizationHooks: {
        afterCreateOrganization: async ({ organization, user }) => {
          await recordTeamAuditEvent({
            organizationId: organization.id,
            actorUserId: user.id,
            action: "org_created",
            metadata: { name: organization.name },
          });
        },
        afterAcceptInvitation: async ({ organization, member, user }) => {
          await updateTeamSeatCount(organization.id);
          await cancelPersonalSubscription(member.userId, organization.id);
          await recordTeamAuditEvent({
            organizationId: organization.id,
            actorUserId: user.id,
            targetUserId: user.id,
            action: "member_joined",
            metadata: { role: member.role },
          });
        },
        ...teamMemberAuditHooks,
        ...teamInvitationHooks,
        afterCreateInvitation: async ({ invitation, inviter, organization }) => {
          await recordTeamAuditEvent({
            organizationId: organization.id,
            actorUserId: inviter.id,
            action: "member_invited",
            metadata: { email: invitation.email, role: invitation.role },
          });
        },
        afterCancelInvitation: async ({ invitation, cancelledBy, organization }) => {
          await recordTeamAuditEvent({
            organizationId: organization.id,
            actorUserId: cancelledBy.id,
            action: "invitation_canceled",
            metadata: { email: invitation.email },
          });
        },
        afterRejectInvitation: async ({ invitation, user, organization }) => {
          // The invitee themselves declines — actor and target are the same
          // person (self-action), same shape as afterAcceptInvitation above.
          await recordTeamAuditEvent({
            organizationId: organization.id,
            actorUserId: user.id,
            targetUserId: user.id,
            action: "invitation_declined",
            metadata: { email: invitation.email },
          });
        },
        beforeUpdateOrganization: async ({ organization, member }) => {
          // afterUpdateOrganization only receives the updated row, not which fields
          // the request actually touched — `organization.name` is always present on
          // the row, so we can't tell a name change from e.g. a logo-only change
          // from there alone. This hook *does* receive the update payload (only the
          // fields being changed), so stash a marker directly on `member` — the
          // same object instance is passed to afterUpdateOrganization for this same
          // request — and read it back there to build precise audit metadata.
          (member as unknown as Record<string, unknown>).__auditChangedFields = {
            name: "name" in organization,
            logo: "logo" in organization,
          } satisfies OrgUpdateAuditMarker;
        },
        afterUpdateOrganization: async ({ organization, user, member }) => {
          if (!organization) return;
          const changedFields = (member as unknown as Record<string, unknown>)
            .__auditChangedFields as OrgUpdateAuditMarker | undefined;
          const metadata: Record<string, unknown> = {};
          if (changedFields?.name) metadata.name = organization.name;
          if (changedFields?.logo) metadata.logoChanged = true;
          await recordTeamAuditEvent({
            organizationId: organization.id,
            actorUserId: user.id,
            action: "org_updated",
            metadata,
          });
        },
        beforeDeleteOrganization: async ({ organization }) => {
          // billing.organizationId has no DB-level FK/cascade, so this must run
          // before the organization row (and its cascading member/invitation rows)
          // is removed. If Stripe cancellation fails, this throws and blocks the
          // deletion rather than leaving an orphaned, unmanageable subscription.
          await cancelTeamSubscriptionForDeletion(organization.id);
        },
      },
      sendInvitationEmail: emailEnabled
        ? async (data) => {
            const url = `${env.NEXT_PUBLIC_BETTER_AUTH_URL}/settings/team?invitationId=${data.id}`;
            await sendEmail({
              to: data.email,
              subject: orgInvitationEmailSubject(data.organization.name),
              react: createElement(OrgInvitationEmail, {
                orgName: data.organization.name,
                inviterName: data.inviter.user.name,
                acceptUrl: url,
              }),
            });
          }
        : undefined,
    }),
    ...(captchaPlugin ? [captchaPlugin] : []),
    ...(emailEnabled
      ? [
          magicLink({
            sendMagicLink: async ({ email, url }) => {
              await sendEmail({
                to: email,
                subject: magicLinkEmailSubject,
                react: createElement(MagicLinkEmail, {
                  signInUrl: url,
                }),
              });
            },
          }),
        ]
      : []),
  ],
  socialProviders,
  rateLimit: {
    enabled: true,
    window: 60, // time window in seconds
    max: 100, // max requests in the window
    customRules: {
      "/sign-in/*": {
        window: 10,
        max: 3,
      },
      "/two-factor/*": async (_request) => {
        // custom function to return rate limit window and max
        return {
          window: 10,
          max: 3,
        };
      },
    },
  },
  user: {
    // Two-step change for verified accounts: the current address must approve
    // the request first (sendChangeEmailConfirmation), then Better Auth sends
    // the new address a verification link via emailVerification; the email is
    // only updated after that link is opened. Unverified accounts skip the
    // first step and verify the new address directly.
    changeEmail: {
      enabled: emailEnabled,
      sendChangeEmailConfirmation: emailEnabled
        ? async ({ user, newEmail, url }) => {
            await sendEmail({
              to: user.email,
              subject: changeEmailConfirmationEmailSubject,
              react: createElement(ChangeEmailConfirmationEmail, {
                name: user.name,
                currentEmail: user.email,
                newEmail,
                confirmUrl: url,
                securityUrl: `${env.NEXT_PUBLIC_BETTER_AUTH_URL}/account/security`,
              }),
            });
          }
        : undefined,
    },
    deleteUser: {
      enabled: true,
      beforeDelete: async (user) => {
        await deletePersonalStripeCustomers(user.id);
        // After the billing checks, so a blocked deletion leaves the projects as they were.
        await reassignTeamProjectsOnAccountDeletion(db, user.id);
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day (every 1 day the session expiration is updated)
  },
  advanced: {
    database: {
      joins: true,
    },
    // Trust only the edge's single-value client IP header when configured. Otherwise
    // Better Auth accepts X-Forwarded-For only when it has exactly one entry.
    ...(env.CLIENT_IP_HEADER ? { ipAddress: { ipAddressHeaders: [env.CLIENT_IP_HEADER] } } : {}),
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user, ctx) => {
          // Guest / anonymous accounts are not gated by email domain.
          if (user.isAnonymous) return;
          if (!user.email) return;

          // Every non-guest sign-up passes here (email, magic link, OAuth), so a batch
          // from one network is stopped at a single point.
          const limit = await checkSignupLimits({
            email: user.email,
            ip: resolveSignupIp(ctx),
          });
          if (!limit.allowed) {
            throw new APIError("TOO_MANY_REQUESTS", {
              message: SIGNUP_RATE_LIMITED_MESSAGE,
              code: "SIGNUP_RATE_LIMITED",
            });
          }

          // Better Auth verifies the provider before reaching this hook, for both
          // OAuth callbacks and direct ID-token sign-ins.
          const provider =
            ctx?.path === "/callback/:id"
              ? ctx.params?.id
              : ctx?.path === "/sign-in/social"
                ? ctx.body?.provider
                : undefined;
          assertAllowedSignupEmail(
            user.email,
            provider === "google" || provider === "github" ? provider : undefined,
          );
        },
        after: async (user, ctx) => {
          if (user.isAnonymous || !user.email) return;
          try {
            await recordSignupRisk({
              userId: user.id,
              email: user.email,
              ip: resolveSignupIp(ctx),
              userAgent: resolveSignupUserAgent(ctx),
            });
          } catch (error) {
            // The account is already created; a failed assessment must not undo the sign-up.
            console.error("Failed to record sign-up risk", error);
          }
        },
      },
      update: {
        before: async (data) => {
          // Block change-email flows that switch to a disallowed domain.
          const email = typeof data.email === "string" ? data.email : undefined;
          if (!email) return;
          assertAllowedSignupEmail(email);
        },
      },
      // Covers every deletion path, including guest cleanup after account linking.
      delete: accountDeletionSeatHooks,
    },
    session: {
      create: {
        after: async (session) => {
          if (!session.userId) return;
          try {
            if (await isAnonymousUser(session.userId)) return;
            await recordSecurityActivity({
              userId: session.userId,
              action: "signed_in",
              ipAddress: session.ipAddress,
              userAgent: session.userAgent,
            });
          } catch (error) {
            console.error("Failed to record sign-in activity", error);
          }
        },
      },
    },
  },
});
