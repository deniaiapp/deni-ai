import {
  CHAT_SCOPE,
  hasBearerAuthorization,
  hashOAuthToken,
  parseBearerToken,
} from "@deniai/auth/oauth";
import { and, eq, isNull } from "drizzle-orm";
import type { db as Db } from "@/db/drizzle";
import { oauthAccessToken, oauthClient, user } from "@/db/schema";
import type { auth as Auth } from "@/lib/auth";

type BetterAuthSession = NonNullable<Awaited<ReturnType<typeof Auth.api.getSession>>>;

/**
 * The signed-in user of a request, in Better Auth's `{ session, user }` shape so
 * handlers read it the same way whichever credential it came from.
 *
 * - `cookie`: the browser session (`better-auth.session_token`).
 * - `oauth`: an access token from the Deni AI OAuth provider, sent as
 *   `Authorization: Bearer` by a native client (Deni AI Desktop). `session` is
 *   synthesized from the token: its id is `oauth:<token row id>`, it carries no
 *   session token, and it has no active organization.
 */
export type RequestSession = BetterAuthSession & {
  credential: "cookie" | "oauth";
  /** The OAuth client and granted scopes; set when `credential` is `oauth`. */
  oauth?: { clientId: string; scopes: string[] };
};

export type RequestSessionOptions = {
  /**
   * Accept an OAuth access token that grants this scope. Without it the request
   * must carry a browser session; a bearer token is ignored.
   */
  bearerScope?: typeof CHAT_SCOPE;
};

type AccessTokenRow = {
  id: string;
  clientId: string;
  userId: string | null;
  scopes: string[];
  expiresAt: Date;
  createdAt: Date;
  revoked: Date | null;
  clientDisabled: boolean | null;
  clientScopes: string[] | null;
};

type UserRow = BetterAuthSession["user"];

export type RequestSessionDeps = {
  getCookieSession(headers: Headers): Promise<BetterAuthSession | null>;
  findAccessToken(hashedToken: string): Promise<AccessTokenRow | null>;
  findUser(userId: string): Promise<UserRow | null>;
  now(): Date;
};

/**
 * Whether an access token row authorizes `scope` right now. The client must
 * list the scope in its own registration as well: clients registered without
 * scopes (Deni Run) may request any scope, and must not reach the chat API.
 */
export function isAccessTokenUsable(row: AccessTokenRow, scope: string, now: Date) {
  return (
    row.revoked === null &&
    row.expiresAt > now &&
    row.userId !== null &&
    row.clientDisabled !== true &&
    row.scopes.includes(scope) &&
    (row.clientScopes?.includes(scope) ?? false)
  );
}

export function createRequestSessionResolver(deps: RequestSessionDeps) {
  return async function resolveRequestSession(
    headers: Headers,
    options: RequestSessionOptions = {},
  ): Promise<RequestSession | null> {
    // A request that names a bearer token is judged by that token alone: a
    // wrong token never falls back to cookies (native clients send none).
    if (options.bearerScope && hasBearerAuthorization(headers)) {
      const token = parseBearerToken(headers.get("authorization"));
      if (!token) return null;
      const row = await deps.findAccessToken(await hashOAuthToken(token));
      const now = deps.now();
      if (!row || !isAccessTokenUsable(row, options.bearerScope, now) || !row.userId) return null;
      const tokenUser = await deps.findUser(row.userId);
      if (!tokenUser || tokenUser.isAnonymous) return null;
      return {
        credential: "oauth",
        oauth: { clientId: row.clientId, scopes: row.scopes },
        user: tokenUser,
        session: {
          id: `oauth:${row.id}`,
          token: "",
          userId: tokenUser.id,
          expiresAt: row.expiresAt,
          createdAt: row.createdAt,
          updatedAt: row.createdAt,
          ipAddress: null,
          userAgent: headers.get("user-agent"),
          activeOrganizationId: null,
        },
      };
    }

    const cookieSession = await deps.getCookieSession(headers);
    if (!cookieSession?.session) return null;
    return { ...cookieSession, credential: "cookie" };
  };
}

function databaseDeps(database: typeof Db): Omit<RequestSessionDeps, "getCookieSession"> {
  return {
    async findAccessToken(hashedToken) {
      const [row] = await database
        .select({
          id: oauthAccessToken.id,
          clientId: oauthAccessToken.clientId,
          userId: oauthAccessToken.userId,
          scopes: oauthAccessToken.scopes,
          expiresAt: oauthAccessToken.expiresAt,
          createdAt: oauthAccessToken.createdAt,
          revoked: oauthAccessToken.revoked,
          clientDisabled: oauthClient.disabled,
          clientScopes: oauthClient.scopes,
        })
        .from(oauthAccessToken)
        .innerJoin(oauthClient, eq(oauthClient.clientId, oauthAccessToken.clientId))
        .where(and(eq(oauthAccessToken.token, hashedToken), isNull(oauthAccessToken.revoked)))
        .limit(1);
      return row ?? null;
    },
    async findUser(userId) {
      const [row] = await database.select().from(user).where(eq(user.id, userId)).limit(1);
      return row ?? null;
    },
    now: () => new Date(),
  };
}

/**
 * The signed-in user of a request: the browser session, or (with
 * `bearerScope`) an OAuth access token granting that scope. Use it instead of
 * `auth.api.getSession` in endpoints that native clients call.
 */
export async function getRequestSession(
  request: Request | Headers,
  options: RequestSessionOptions = {},
): Promise<RequestSession | null> {
  const [{ auth }, { db }] = await Promise.all([import("@/lib/auth"), import("@/db/drizzle")]);
  const headers = request instanceof Headers ? request : request.headers;
  return createRequestSessionResolver({
    getCookieSession: (cookieHeaders) => auth.api.getSession({ headers: cookieHeaders }),
    ...databaseDeps(db),
  })(headers, options);
}
