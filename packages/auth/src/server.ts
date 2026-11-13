import * as schema from "@deniai/db";
import { orgInvitationEmailSubject } from "@deniai/emails/org-invitation-email-subject";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { oauthProvider } from "@better-auth/oauth-provider";
import { passkey } from "@better-auth/passkey";
import { betterAuth, type GenericEndpointContext } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";
import { generateRandomString } from "better-auth/crypto";
import {
  type AnonymousOptions,
  anonymous,
  captcha,
  haveIBeenPwned,
  lastLoginMethod,
  magicLink,
  type OrganizationOptions,
  organization,
} from "better-auth/plugins";
import { twoFactor } from "better-auth/plugins/two-factor";
import { createElement, type ReactElement } from "react";
import { hashOAuthToken, OAUTH_SCOPES } from "./oauth";
import { OAUTH_CONSENT_PATH, OAUTH_LOGIN_PATH, TWO_FACTOR_PATH } from "./paths";

/** A rendered-on-send transactional email (`@deniai/emails` template element). */
export type AuthEmail = {
  to: string;
  subject: string;
  react: ReactElement;
};

export type SignupOAuthProvider = "google" | "github";

type OrganizationHooks = NonNullable<OrganizationOptions["organizationHooks"]>;

type AccountDeletionHooks = {
  before(user: { id: string; email?: string | null }): Promise<unknown>;
  after(user: { id: string; email?: string | null }): Promise<unknown>;
};

/**
 * App callbacks the auth server runs: sign-up policy, security logging, guest
 * data, team billing and audit. The web app passes its own implementations, so
 * this package never imports the app (database queries, Stripe, storage).
 *
 * Declared as methods so app functions with narrower parameter types (string
 * unions such as security activity actions) can be passed as they are.
 */
export interface AuthAppHooks {
  /** Client IP of a request, honoring the trusted edge header. */
  resolveClientIp(headers: Headers): string | undefined;
  /** Same-origin path for redirects built from untrusted input. */
  toSafeRedirectPath(path: string): string;
  /** Name stored for a new user (magic-link sign-ups carry none). */
  resolveUserName(name: string | null | undefined, email: string): string;
  /** Email-change fields of a Better Auth email verification token, or null. */
  readEmailChangeToken(
    token: string | null | undefined,
  ): { newEmail: string; requestType: string | null } | null;

  /** Domain allowlist and alias rules for new accounts and email changes. */
  checkSignupEmail(
    email: string,
    oauthProvider?: SignupOAuthProvider,
  ): { ok: true } | { ok: false; reason: string };
  signupEmailDenialMessage(reason: string): string;
  signupEmailDenialCode(reason: string): string;
  /** Operator domains may sign up although they are not on the allowlist. */
  isAdminEmailDomain(email: string): boolean;
  /** DNS-verified domains of paid teams may sign up as well. */
  isActiveTeamEmailDomain(email: string): Promise<boolean>;
  checkSignupLimits(input: {
    email: string;
    ip: string | undefined;
  }): Promise<{ allowed: boolean }>;
  recordSignupRisk(input: {
    userId: string;
    email: string;
    ip: string | undefined;
    userAgent: string | null | undefined;
  }): Promise<unknown>;

  /** Security activity entry for a finished auth request, or null for none. */
  securityActionForAuthResponse(input: {
    path: string;
    returned: unknown;
    requestUser?: unknown;
    issuedUser?: unknown;
  }): string | null;
  recordSecurityActivity(input: {
    userId: string;
    action: string;
    ipAddress?: string | null;
    userAgent?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<unknown>;
  isAnonymousUser(userId: string): Promise<boolean>;

  /** Moves a guest's data to the account the guest signed up or signed in to. */
  transferGuestData(guestId: string, userId: string): Promise<unknown>;

  teamMembershipLimit: number;
  assertCanSendTeamInvitation(input: {
    user: { id: string; isAnonymous?: boolean | null };
    email: unknown;
    organizationId: unknown;
  }): Promise<unknown>;
  recordTeamAuditEvent(input: {
    organizationId: string;
    actorUserId: string | null;
    targetUserId?: string | null;
    action: string;
    metadata?: Record<string, unknown>;
  }): Promise<unknown>;
  updateTeamSeatCount(organizationId: string): Promise<unknown>;
  cancelPersonalSubscription(userId: string, organizationId: string): Promise<unknown>;
  cancelTeamSubscriptionForDeletion(organizationId: string): Promise<unknown>;
  joinTeamByDomainOnSignIn(userId: string): Promise<unknown>;
  /** Organization hooks spread into the organization plugin (role checks, audit). */
  teamMemberAuditHooks: OrganizationHooks;
  teamInvitationHooks: OrganizationHooks;

  deletePersonalStripeCustomers(userId: string): Promise<unknown>;
  reassignTeamProjectsOnAccountDeletion(userId: string): Promise<unknown>;
  accountDeletionSeatHooks: AccountDeletionHooks;
  accountDeletionAttachmentHooks: AccountDeletionHooks;
}

export type CreateAuthDeps = {
  /** Drizzle database (pooled Postgres) for the Better Auth tables. */
  db: Parameters<typeof drizzleAdapter>[0];
  /** Public origin of the web app, for links in emails (NEXT_PUBLIC_BETTER_AUTH_URL). */
  publicURL: string;
  /**
   * Sends a transactional email. Omit when email is not configured: email
   * verification, password reset emails, magic links, invitations and email
   * changes are then disabled.
   */
  sendEmail?: (email: AuthEmail) => Promise<unknown>;
  socialProviders?: {
    google?: { clientId: string; clientSecret: string };
    github?: { clientId: string; clientSecret: string };
  };
  /** Cloudflare Turnstile secret; set only when the site key is configured too. */
  turnstileSecretKey?: string;
  /** First-party OAuth clients (Deni Run) cached as trusted. */
  trustedOAuthClientIds?: readonly string[];
  /** Single-value client IP header set by the trusted edge (CLIENT_IP_HEADER). */
  clientIpHeader?: string;
  /**
   * WebAuthn relying party ID (PASSKEY_RP_ID). Omit for the auth URL's host. A
   * subdomain (beta.deniai.app) may use its parent (deniai.app) so passkeys
   * registered there keep working; the origin is still checked per request.
   */
  passkeyRpID?: string;
  hooks: AuthAppHooks;
};

type OrgUpdateAuditMarker = { name: boolean; logo: boolean };

const SIGNUP_RATE_LIMITED_MESSAGE =
  "Too many accounts were created from this network. Please try again later.";

type SignupContext = { request?: Request; headers?: Headers } | null | undefined;

function signupHeaders(ctx: SignupContext) {
  return ctx?.request?.headers ?? ctx?.headers;
}

function resolveSignupUserAgent(ctx: SignupContext) {
  return signupHeaders(ctx)?.get("user-agent");
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

  // Only a pending sign-up is contested. An account with another sign-in method,
  // or one someone has signed in to, is in use, and this form proves nothing
  // against it (a squatter cannot sign in while verification is required).
  if (existing.accounts.some((account) => account.providerId !== "credential")) return;
  if ((await ctx.context.internalAdapter.listSessions(existing.user.id)).length) return;

  await ctx.context.internalAdapter.deleteAccount(credential.id);
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
async function challengeSecondFactorAfterMagicLink(
  ctx: GenericEndpointContext,
  toSafeRedirectPath: (path: string) => string,
) {
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

/**
 * A sign-in method added to a guest leaves the account a guest (placeholder
 * email, no plan) that the method then signs in to for good. Guests sign up or
 * sign in instead, which moves their data (`linkGuestAccount`).
 */
const GUEST_SIGN_IN_METHOD_PATHS = new Set([
  "/link-social",
  "/passkey/generate-register-options",
  "/passkey/verify-registration",
  "/two-factor/enable",
]);

/**
 * The Deni AI Better Auth server: email and password, magic links, social
 * sign-in, guests (anonymous), 2FA, passkeys, organizations (teams), and the
 * OAuth provider for first-party clients. The app supplies its database, env
 * values, email sender and the callbacks in `deps.hooks`.
 */
export function createAuth(deps: CreateAuthDeps) {
  const { hooks, sendEmail } = deps;
  const emailEnabled = Boolean(sendEmail);

  const socialProviders = {
    ...(deps.socialProviders?.google
      ? { google: { enabled: true, ...deps.socialProviders.google } }
      : {}),
    ...(deps.socialProviders?.github
      ? { github: { enabled: true, ...deps.socialProviders.github } }
      : {}),
  };

  const captchaPlugin = deps.turnstileSecretKey
    ? captcha({
        provider: "cloudflare-turnstile",
        secretKey: deps.turnstileSecretKey,
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

  function resolveSignupIp(ctx: SignupContext) {
    const headers = signupHeaders(ctx);
    return headers ? hooks.resolveClientIp(headers) : undefined;
  }

  async function assertAllowedSignupEmail(email: string, oauthProvider?: SignupOAuthProvider) {
    const result = hooks.checkSignupEmail(email, oauthProvider);
    if (result.ok) return;
    // Operator domains and DNS-verified domains of paid teams are allowed even
    // though they are not on the allowlist; alias rules still apply to them.
    if (
      result.reason === "not_allowed" &&
      (hooks.isAdminEmailDomain(email) || (await hooks.isActiveTeamEmailDomain(email)))
    ) {
      return;
    }
    throw new APIError("BAD_REQUEST", {
      message: hooks.signupEmailDenialMessage(result.reason),
      code: hooks.signupEmailDenialCode(result.reason),
    });
  }

  /**
   * Runs when a browser with a guest session signs up or signs in to an account
   * (the anonymous plugin's `onLinkAccount`): moves the guest's data to that
   * account, then deletes the guest. A guest whose data could not be moved is
   * kept; the guest cleanup job deletes it once its session has ended.
   */
  async function linkGuestAccount({
    anonymousUser,
    newUser,
    ctx,
  }: Parameters<NonNullable<AnonymousOptions["onLinkAccount"]>>[0]) {
    const guestId = anonymousUser.user.id;
    if (newUser.user.id === guestId || newUser.user.isAnonymous) return;

    // A password sign-in to a 2FA account gets this session only until the
    // two-factor plugin swaps it for the second-factor challenge, so the password
    // alone must not write into the account. The guest's data is dropped.
    const awaitsSecondFactor =
      ctx.path === "/sign-in/email" && Boolean(newUser.user.twoFactorEnabled);
    if (!awaitsSecondFactor) {
      try {
        await hooks.transferGuestData(guestId, newUser.user.id);
      } catch (error) {
        console.error("Failed to move guest data to the signed-in account", error);
        return;
      }
    }

    try {
      await ctx.context.internalAdapter.deleteUser(guestId);
    } catch (error) {
      console.error("Failed to delete a guest after it signed in to an account", error);
    }
  }

  return betterAuth({
    appName: "Deni AI",
    database: drizzleAdapter(deps.db, { provider: "pg", schema }),
    // Reject disallowed domains before verification / magic-link emails are sent,
    // and gate team invitation emails before they are created or resent.
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/oauth2/authorize" || ctx.path === "/oauth2/consent") {
          // Guest accounts have placeholder identities and no plan: they must not
          // sign in to Deni Run or other clients. The login page asks them to sign in.
          const session = await getSessionFromCtx(ctx);
          if (session?.user.isAnonymous) {
            const query = new URLSearchParams(
              Object.entries((ctx.query ?? {}) as Record<string, unknown>).flatMap(([key, value]) =>
                typeof value === "string" ? [[key, value]] : [],
              ),
            );
            throw ctx.redirect(`${OAUTH_LOGIN_PATH}?${query.toString()}`);
          }
          return;
        }

        if (GUEST_SIGN_IN_METHOD_PATHS.has(ctx.path)) {
          const session = await getSessionFromCtx(ctx);
          if (session?.user.isAnonymous) {
            throw new APIError("FORBIDDEN", {
              message: "Guest accounts cannot add sign-in methods. Sign up instead.",
              code: "GUEST_SIGN_IN_METHOD_NOT_ALLOWED",
            });
          }
          return;
        }

        if (ctx.path === "/organization/invite-member") {
          const session = await getSessionFromCtx(ctx);
          // Without a session the endpoint itself rejects the request.
          if (session) {
            const body = ctx.body as { email?: unknown; organizationId?: unknown } | undefined;
            await hooks.assertCanSendTeamInvitation({
              user: session.user,
              email: body?.email,
              organizationId: body?.organizationId ?? session.session.activeOrganizationId,
            });
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

        await assertAllowedSignupEmail(email);

        if (ctx.path === "/sign-up/email") {
          await revokeContestedSignupPassword(ctx, email, body?.password);
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/magic-link/verify") {
          return challengeSecondFactorAfterMagicLink(ctx, hooks.toSafeRedirectPath);
        }

        const action = hooks.securityActionForAuthResponse({
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
        void hooks
          .recordSecurityActivity({
            userId,
            action,
            ipAddress: session?.ipAddress ?? null,
            userAgent: session?.userAgent ?? null,
            metadata: { path: ctx.path },
          })
          .catch((error) => {
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
      sendResetPassword: sendEmail
        ? async ({ user, url }) => {
            const { PasswordResetEmail, passwordResetEmailSubject } =
              await import("@deniai/emails/password-reset-email");
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
    emailVerification: sendEmail
      ? {
          sendVerificationEmail: async ({ user, url, token }) => {
            // During an email change Better Auth sends this to the requested address,
            // so the sign-up wording would be wrong there.
            const emailChange = hooks.readEmailChangeToken(token);
            const [
              { NewEmailVerificationEmail, newEmailVerificationEmailSubject },
              { VerificationEmail, verificationEmailSubject },
            ] = await Promise.all([
              import("@deniai/emails/new-email-verification-email"),
              import("@deniai/emails/verification-email"),
            ]);
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
            const emailChange = hooks.readEmailChangeToken(token);
            if (!emailChange || emailChange.requestType === "change-email-confirmation") return;
            try {
              await hooks.recordSecurityActivity({
                userId: user.id,
                action: "email_changed",
                ipAddress: request ? (hooks.resolveClientIp(request.headers) ?? null) : null,
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
      anonymous({
        // linkGuestAccount deletes the guest itself, once its data has moved.
        disableDeleteAnonymousUser: true,
        onLinkAccount: linkGuestAccount,
      }),
      twoFactor(),
      passkey(deps.passkeyRpID ? { rpID: deps.passkeyRpID } : undefined),
      haveIBeenPwned(),
      lastLoginMethod(),
      // Deni AI is the identity provider for Deni Run (and other first-party apps).
      // Clients are registered with `pnpm run tools:register-oauth-client`.
      oauthProvider({
        loginPage: OAUTH_LOGIN_PATH,
        consentPage: OAUTH_CONSENT_PATH,
        // Opaque access tokens and HS256 id tokens: no JWKS table or key rotation to run.
        disableJwtPlugin: true,
        // Clients are created by operators only; no dynamic registration.
        allowDynamicClientRegistration: false,
        cachedTrustedClients: new Set(deps.trustedOAuthClientIds ?? []),
        // The defaults plus `chat`, which Deni AI Desktop asks for (src/oauth.ts).
        scopes: [...OAUTH_SCOPES],
        // The plugin default, spelled out so the web app can look up access tokens.
        storeTokens: { hash: hashOAuthToken },
      }),
      organization({
        // Guests have placeholder emails and must not own teams (or their billing).
        allowUserToCreateOrganization: (user) => !user.isAnonymous,
        membershipLimit: hooks.teamMembershipLimit,
        organizationHooks: {
          afterCreateOrganization: async ({ organization, user }) => {
            await hooks.recordTeamAuditEvent({
              organizationId: organization.id,
              actorUserId: user.id,
              action: "org_created",
              metadata: { name: organization.name },
            });
          },
          afterAcceptInvitation: async ({ organization, member, user }) => {
            await hooks.updateTeamSeatCount(organization.id);
            await hooks.cancelPersonalSubscription(member.userId, organization.id);
            await hooks.recordTeamAuditEvent({
              organizationId: organization.id,
              actorUserId: user.id,
              targetUserId: user.id,
              action: "member_joined",
              metadata: { role: member.role },
            });
          },
          ...hooks.teamMemberAuditHooks,
          ...hooks.teamInvitationHooks,
          afterCreateInvitation: async ({ invitation, inviter, organization }) => {
            await hooks.recordTeamAuditEvent({
              organizationId: organization.id,
              actorUserId: inviter.id,
              action: "member_invited",
              metadata: { email: invitation.email, role: invitation.role },
            });
          },
          afterCancelInvitation: async ({ invitation, cancelledBy, organization }) => {
            await hooks.recordTeamAuditEvent({
              organizationId: organization.id,
              actorUserId: cancelledBy.id,
              action: "invitation_canceled",
              metadata: { email: invitation.email },
            });
          },
          afterRejectInvitation: async ({ invitation, user, organization }) => {
            // The invitee themselves declines — actor and target are the same
            // person (self-action), same shape as afterAcceptInvitation above.
            await hooks.recordTeamAuditEvent({
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
            await hooks.recordTeamAuditEvent({
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
            await hooks.cancelTeamSubscriptionForDeletion(organization.id);
          },
        },
        sendInvitationEmail: sendEmail
          ? async (data) => {
              const invitationUrl = new URL("/settings/team", deps.publicURL);
              invitationUrl.searchParams.set("invitationId", data.id);
              const url = invitationUrl.toString();
              const { OrgInvitationEmail } = await import("@deniai/emails/org-invitation-email");
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
      ...(sendEmail
        ? [
            magicLink({
              sendMagicLink: async ({ email, url }) => {
                const { MagicLinkEmail, magicLinkEmailSubject } =
                  await import("@deniai/emails/magic-link-email");
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
    logger: {
      log(level, message, ...args) {
        // Sign-in and password-reset attempts for unregistered emails are routine
        // traffic, not actionable warnings.
        if (level === "warn" && message.endsWith("User not found")) {
          return;
        }
        const line = `${new Date().toISOString()} ${level.toUpperCase()} [Better Auth]: ${message}`;
        if (level === "error") console.error(line, ...args);
        else if (level === "warn") console.warn(line, ...args);
        else console.log(line, ...args);
      },
    },
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
        sendChangeEmailConfirmation: sendEmail
          ? async ({ user, newEmail, url }) => {
              const { ChangeEmailConfirmationEmail, changeEmailConfirmationEmailSubject } =
                await import("@deniai/emails/change-email-confirmation-email");
              await sendEmail({
                to: user.email,
                subject: changeEmailConfirmationEmailSubject,
                react: createElement(ChangeEmailConfirmationEmail, {
                  name: user.name,
                  currentEmail: user.email,
                  newEmail,
                  confirmUrl: url,
                  securityUrl: new URL("/account/security", deps.publicURL).toString(),
                }),
              });
            }
          : undefined,
      },
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => {
          await hooks.deletePersonalStripeCustomers(user.id);
          // After the billing checks, so a blocked deletion leaves the projects as they were.
          await hooks.reassignTeamProjectsOnAccountDeletion(user.id);
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
      ...(deps.clientIpHeader ? { ipAddress: { ipAddressHeaders: [deps.clientIpHeader] } } : {}),
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
            const limit = await hooks.checkSignupLimits({
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
            await assertAllowedSignupEmail(
              user.email,
              provider === "google" || provider === "github" ? provider : undefined,
            );

            // Magic-link sign-ups carry no name, and Better Auth stores "" for them.
            const name = hooks.resolveUserName(user.name, user.email);
            if (name !== user.name) return { data: { ...user, name } };
          },
          after: async (user, ctx) => {
            if (user.isAnonymous || !user.email) return;
            try {
              await hooks.recordSignupRisk({
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
            await assertAllowedSignupEmail(email);
          },
        },
        // Covers every deletion path, including guest cleanup after account linking.
        delete: {
          before: async (user) => {
            await hooks.accountDeletionSeatHooks.before(user);
            // After the billing step, which can still block the deletion.
            await hooks.accountDeletionAttachmentHooks.before(user);
          },
          after: async (user) => {
            // Never throws, so it runs whatever the seat updates do.
            await hooks.accountDeletionAttachmentHooks.after(user);
            await hooks.accountDeletionSeatHooks.after(user);
          },
        },
      },
      session: {
        create: {
          after: async (session) => {
            if (!session.userId) return;
            try {
              if (await hooks.isAnonymousUser(session.userId)) return;
              await hooks.recordSecurityActivity({
                userId: session.userId,
                action: "signed_in",
                ipAddress: session.ipAddress,
                userAgent: session.userAgent,
              });
            } catch (error) {
              console.error("Failed to record sign-in activity", error);
            }
            try {
              await hooks.joinTeamByDomainOnSignIn(session.userId);
            } catch (error) {
              // Signing in must not fail because the automatic team join did.
              console.error("Failed to join a team by email domain", error);
            }
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
