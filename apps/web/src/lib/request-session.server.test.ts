import { hashOAuthToken } from "@deniai/auth/oauth";
import { describe, expect, it, vi } from "vitest";

import {
  createRequestSessionResolver,
  isAccessTokenUsable,
  type RequestSessionDeps,
} from "./request-session.server";

const NOW = new Date("2026-11-12T00:00:00Z");
const TOKEN = "desktopAccessTokenValue";

const tokenRow = {
  id: "tok_1",
  clientId: "desktop",
  userId: "user_1",
  scopes: ["openid", "offline_access", "chat"],
  expiresAt: new Date(NOW.getTime() + 60_000),
  createdAt: new Date(NOW.getTime() - 60_000),
  revoked: null,
  clientDisabled: false,
  clientScopes: ["openid", "offline_access", "chat"],
};

const tokenUser = {
  id: "user_1",
  name: "Rai",
  email: "rai@example.com",
  emailVerified: true,
  image: null,
  createdAt: NOW,
  updatedAt: NOW,
  isAnonymous: false,
  twoFactorEnabled: false,
};

const cookieSession = {
  session: { id: "sess_1", userId: "user_2" },
  user: { id: "user_2", isAnonymous: false },
};

function makeResolver(overrides: Partial<RequestSessionDeps> = {}) {
  const deps = {
    getCookieSession: vi.fn(async () => cookieSession),
    findAccessToken: vi.fn(async (hashed: string) =>
      hashed === (await hashOAuthToken(TOKEN)) ? tokenRow : null,
    ),
    findUser: vi.fn(async (id: string) => (id === tokenUser.id ? tokenUser : null)),
    now: () => NOW,
    ...overrides,
  } as unknown as RequestSessionDeps;
  return { deps, resolve: createRequestSessionResolver(deps) };
}

const bearer = (token: string) => new Headers({ authorization: `Bearer ${token}` });

describe("createRequestSessionResolver", () => {
  it("resolves a chat-scoped access token to the token's user", async () => {
    const { resolve, deps } = makeResolver();
    const result = await resolve(bearer(TOKEN), { bearerScope: "chat" });
    expect(result?.credential).toBe("oauth");
    expect(result?.session.userId).toBe("user_1");
    expect(result?.session.id).toBe("oauth:tok_1");
    expect(result?.session.activeOrganizationId).toBeNull();
    expect(result?.oauth).toEqual({ clientId: "desktop", scopes: tokenRow.scopes });
    expect(deps.getCookieSession).not.toHaveBeenCalled();
  });

  it("ignores bearer tokens where the endpoint does not accept them", async () => {
    const { resolve } = makeResolver();
    const result = await resolve(bearer(TOKEN));
    expect(result?.credential).toBe("cookie");
    expect(result?.session.userId).toBe("user_2");
  });

  it("does not fall back to the cookie when the bearer token is wrong", async () => {
    const { resolve, deps } = makeResolver();
    expect(await resolve(bearer("unknown"), { bearerScope: "chat" })).toBeNull();
    expect(await resolve(new Headers({ authorization: "Bearer" }), { bearerScope: "chat" })).toBe(
      null,
    );
    expect(deps.getCookieSession).not.toHaveBeenCalled();
  });

  it("refuses tokens of guest users", async () => {
    const { resolve } = makeResolver({
      findUser: vi.fn(async () => ({ ...tokenUser, isAnonymous: true })),
    } as Partial<RequestSessionDeps>);
    expect(await resolve(bearer(TOKEN), { bearerScope: "chat" })).toBeNull();
  });

  it("uses the browser session when there is no bearer token", async () => {
    const { resolve } = makeResolver();
    const result = await resolve(new Headers({ cookie: "x=1" }), { bearerScope: "chat" });
    expect(result?.credential).toBe("cookie");
  });
});

describe("isAccessTokenUsable", () => {
  it("accepts a live chat token of a chat client", () => {
    expect(isAccessTokenUsable(tokenRow, "chat", NOW)).toBe(true);
  });

  it.each([
    ["expired", { expiresAt: NOW }],
    ["revoked", { revoked: NOW }],
    ["without the scope", { scopes: ["openid"] }],
    ["from a disabled client", { clientDisabled: true }],
    ["from a client registered without scopes", { clientScopes: null }],
    ["from a client not registered for chat", { clientScopes: ["openid", "chat2"] }],
    ["without a user", { userId: null }],
  ])("refuses a token %s", (_, patch) => {
    expect(isAccessTokenUsable({ ...tokenRow, ...patch }, "chat", NOW)).toBe(false);
  });
});
