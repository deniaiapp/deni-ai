import "@tanstack/react-start/server-only";

import { createHash, randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "../data/secrets";

/**
 * OAuth for remote MCP servers, following the MCP authorization spec: protected resource
 * metadata (RFC 9728) points at the authorization server, whose metadata (RFC 8414) gives the
 * endpoints. The client is, in the spec's order: one the connector ships, our client ID metadata
 * document, or a dynamic registration (RFC 7591). Every authorization uses PKCE and names the
 * MCP server as the resource (RFC 8707).
 */

export type McpOAuthClient = { clientId: string; clientSecret?: string };

export type McpOAuth = {
  resource: string;
  issuer?: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  tokenAuthMethod: "none" | "client_secret_post" | "client_secret_basic";
  redirectUri: string;
  scope?: string;
  accessToken?: string;
  refreshToken?: string;
  /** Epoch milliseconds; absent when the server did not say. */
  expiresAt?: number;
  /** Authorization the user has not finished yet. */
  pending?: { state: string; verifier: string; expiresAt: number };
};

type ResourceMetadata = { resource?: string; authorization_servers?: string[]; scopes_supported?: string[] };
type ServerMetadata = {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
  code_challenge_methods_supported?: string[];
  client_id_metadata_document_supported?: boolean;
};

const timeout = () => AbortSignal.timeout(15_000);
const pendingLifetimeMs = 15 * 60_000;

export class McpAuthRequiredError extends Error {
  code = "mcp_auth_required" as const;
  constructor() {
    super("Sign in to this MCP server again");
    this.name = "McpAuthRequiredError";
  }
}

export function encodeOAuth(oauth: McpOAuth) {
  return encryptSecret(JSON.stringify(oauth));
}

export function decodeOAuth(value: string | null | undefined): McpOAuth | null {
  if (!value) return null;
  try {
    return JSON.parse(decryptSecret(value)) as McpOAuth;
  } catch {
    return null;
  }
}

async function getJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url, { headers: { Accept: "application/json", "MCP-Protocol-Version": "2025-11-25" }, signal: timeout() }).catch(() => null);
  if (!response?.ok) return null;
  return await response.json().catch(() => null) as T | null;
}

/** Well-known URLs for a resource or issuer: path-aware first, then the origin root. */
function wellKnown(base: string, suffix: string) {
  const url = new URL(base);
  const path = url.pathname.replace(/\/+$/, "");
  return [...new Set([`${url.origin}/.well-known/${suffix}${path}`, `${url.origin}/.well-known/${suffix}`])];
}

function headerParam(header: string | null, name: string) {
  return header?.match(new RegExp(`${name}="([^"]*)"`, "i"))?.[1] ?? header?.match(new RegExp(`${name}=([^\\s,]+)`, "i"))?.[1];
}

/** Ask the MCP server without credentials; a 401 names its resource metadata and scopes. */
async function probe(mcpUrl: string) {
  const response = await fetch(mcpUrl, {
    method: "POST",
    headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "Deni Run", version: "0.1.0" } } }),
    signal: timeout(),
  }).catch(() => null);
  if (!response) return { status: 0 };
  await response.body?.cancel().catch(() => undefined);
  const header = response.headers.get("www-authenticate");
  return { status: response.status, resourceMetadata: headerParam(header, "resource_metadata"), scope: headerParam(header, "scope") };
}

async function serverMetadata(issuer: string) {
  const url = new URL(issuer);
  const path = url.pathname.replace(/\/+$/, "");
  const candidates = [
    ...wellKnown(issuer, "oauth-authorization-server"),
    `${url.origin}/.well-known/openid-configuration${path}`,
    `${url.origin}${path}/.well-known/openid-configuration`,
  ];
  for (const candidate of [...new Set(candidates)]) {
    const metadata = await getJson<ServerMetadata>(candidate);
    if (metadata?.authorization_endpoint && metadata.token_endpoint) return metadata;
  }
  return null;
}

/** Whether the server wants OAuth, and if so where to authorize. Null means no sign-in needed. */
export async function discoverMcpOAuth(mcpUrl: string) {
  const challenge = await probe(mcpUrl);
  let resource: ResourceMetadata | null = null;
  for (const candidate of challenge.resourceMetadata ? [challenge.resourceMetadata] : wellKnown(mcpUrl, "oauth-protected-resource")) {
    resource = await getJson<ResourceMetadata>(candidate);
    if (resource) break;
  }
  if (challenge.status !== 401 && !resource) return null;
  // Servers from before protected resource metadata act as their own authorization server.
  const issuer = resource?.authorization_servers?.[0] ?? new URL(mcpUrl).origin;
  const metadata = await serverMetadata(issuer);
  if (!metadata?.authorization_endpoint || !metadata.token_endpoint) {
    throw new Error("This MCP server does not publish how to sign in");
  }
  // The spec requires refusing servers that do not advertise PKCE.
  if (!metadata.code_challenge_methods_supported?.includes("S256")) {
    throw new Error("This MCP server does not support secure sign-in (PKCE)");
  }
  return {
    resource: resource?.resource ?? mcpUrl,
    metadata,
    scope: challenge.scope ?? resource?.scopes_supported?.join(" "),
  };
}

async function registerClient(metadata: ServerMetadata, redirectUri: string): Promise<McpOAuthClient & { tokenAuthMethod: McpOAuth["tokenAuthMethod"] }> {
  if (!metadata.registration_endpoint) throw new Error("This MCP server needs an OAuth client that Deni Run does not have");
  const methods = metadata.token_endpoint_auth_methods_supported;
  const requested = !methods || methods.includes("none") ? "none" : methods.includes("client_secret_post") ? "client_secret_post" : "client_secret_basic";
  const response = await fetch(metadata.registration_endpoint, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Deni Run",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: requested,
    }),
    signal: timeout(),
  });
  const body = await response.json().catch(() => ({})) as { client_id?: string; client_secret?: string; token_endpoint_auth_method?: string };
  if (!response.ok || !body.client_id) throw new Error("Could not register Deni Run with this MCP server");
  const method = (body.token_endpoint_auth_method ?? (body.client_secret ? "client_secret_basic" : requested)) as McpOAuth["tokenAuthMethod"];
  return { clientId: body.client_id, clientSecret: body.client_secret, tokenAuthMethod: method };
}

const base64Url = (buffer: Buffer) => buffer.toString("base64url");

/** Where our client ID metadata document is served; servers fetch it, so it must be https. */
export function clientMetadataUrl(appUrl: string) {
  return appUrl.startsWith("https://") ? `${appUrl}/oauth/client-metadata.json` : null;
}

export function clientMetadataDocument(appUrl: string) {
  return {
    client_id: `${appUrl}/oauth/client-metadata.json`,
    client_name: "Deni Run",
    client_uri: appUrl,
    logo_uri: `${appUrl}/icon.png`,
    redirect_uris: [mcpRedirectUri(appUrl)],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

export const mcpRedirectUri = (appUrl: string) => `${appUrl}/api/mcp/oauth/callback`;

/**
 * Start signing in: discover the endpoints, register a client when the connector has none,
 * and return the URL to send the browser to. The returned state keeps the PKCE verifier.
 */
export async function beginMcpOAuth(options: {
  mcpUrl: string;
  appUrl: string;
  stateKey: string;
  previous?: McpOAuth | null;
  client?: McpOAuthClient & { tokenAuthMethod?: McpOAuth["tokenAuthMethod"] };
  scope?: string;
}) {
  const discovered = await discoverMcpOAuth(options.mcpUrl);
  if (!discovered) return null;
  const { metadata } = discovered;
  const previous = options.previous;
  const redirectUri = mcpRedirectUri(options.appUrl);
  const metadataUrl = clientMetadataUrl(options.appUrl);
  // Keep a client registered earlier with the same server and redirect, so repeat sign-ins
  // do not pile up registrations.
  const client = options.client
    ? { tokenAuthMethod: options.client.clientSecret ? "client_secret_post" as const : "none" as const, ...options.client }
    : metadataUrl && metadata.client_id_metadata_document_supported
      ? { clientId: metadataUrl, tokenAuthMethod: "none" as const }
      : previous?.clientId && previous.tokenEndpoint === metadata.token_endpoint && previous.redirectUri === redirectUri
        ? { clientId: previous.clientId, clientSecret: previous.clientSecret, tokenAuthMethod: previous.tokenAuthMethod }
        : await registerClient(metadata, redirectUri);
  const verifier = base64Url(randomBytes(32));
  const state = `${options.stateKey}.${base64Url(randomBytes(24))}`;
  const scope = options.scope ?? discovered.scope;
  const url = new URL(metadata.authorization_endpoint!);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", client.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", base64Url(createHash("sha256").update(verifier).digest()));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", discovered.resource);
  if (scope) url.searchParams.set("scope", scope);
  const oauth: McpOAuth = {
    resource: discovered.resource,
    issuer: metadata.issuer,
    authorizationEndpoint: metadata.authorization_endpoint!,
    tokenEndpoint: metadata.token_endpoint!,
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    tokenAuthMethod: client.tokenAuthMethod,
    redirectUri,
    scope,
    // Tokens from an earlier sign-in keep working until the new one finishes.
    accessToken: previous?.accessToken,
    refreshToken: previous?.refreshToken,
    expiresAt: previous?.expiresAt,
    pending: { state, verifier, expiresAt: Date.now() + pendingLifetimeMs },
  };
  return { authorizeUrl: url.toString(), oauth };
}

async function tokenRequest(oauth: McpOAuth, params: Record<string, string>) {
  const body = new URLSearchParams({ ...params, resource: oauth.resource });
  const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" };
  if (oauth.tokenAuthMethod === "client_secret_basic" && oauth.clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(oauth.clientId)}:${encodeURIComponent(oauth.clientSecret)}`).toString("base64")}`;
  } else {
    body.set("client_id", oauth.clientId);
    if (oauth.clientSecret) body.set("client_secret", oauth.clientSecret);
  }
  const response = await fetch(oauth.tokenEndpoint, { method: "POST", headers, body, signal: timeout() });
  const data = await response.json().catch(() => ({})) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    // Slack-style responses carry the user token under authed_user.
    authed_user?: { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
  };
  const token = data.access_token ? data : data.authed_user?.access_token ? data.authed_user : null;
  // Slack answers errors with 200 and ok: false, so a missing token is the failure signal.
  if (!response.ok || !token?.access_token) return { error: data.error ?? `http_${response.status}` };
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: typeof token.expires_in === "number" ? Date.now() + token.expires_in * 1000 : undefined,
    scope: token.scope,
  };
}

/** Finish signing in with the code the authorization server sent back. */
export async function completeMcpOAuth(oauth: McpOAuth, params: { state: string; code: string; iss?: string | null }): Promise<McpOAuth> {
  const { state, code } = params;
  const pending = oauth.pending;
  if (!pending || pending.state !== state || pending.expiresAt < Date.now()) throw new Error("This sign-in link has expired. Start again.");
  // RFC 9207: a server that names itself must be the one we sent the user to.
  if (params.iss && oauth.issuer && params.iss !== oauth.issuer) throw new Error("The MCP server refused the sign-in. Start again.");
  const result = await tokenRequest(oauth, { grant_type: "authorization_code", code, redirect_uri: oauth.redirectUri, code_verifier: pending.verifier });
  if ("error" in result) throw new Error("The MCP server refused the sign-in. Start again.");
  return { ...oauth, pending: undefined, accessToken: result.accessToken, refreshToken: result.refreshToken, expiresAt: result.expiresAt, scope: result.scope ?? oauth.scope };
}

/**
 * New tokens from the refresh token. Null when there is none or the request failed for now;
 * a grant the server rejected comes back without tokens, so the user is asked to sign in.
 */
export async function refreshMcpOAuth(oauth: McpOAuth): Promise<McpOAuth | null> {
  if (!oauth.refreshToken) return null;
  const result = await tokenRequest(oauth, { grant_type: "refresh_token", refresh_token: oauth.refreshToken });
  if ("error" in result) {
    return result.error === "invalid_grant" ? { ...oauth, accessToken: undefined, refreshToken: undefined, expiresAt: undefined } : null;
  }
  // Servers that rotate refresh tokens send a new one; others expect the old one again.
  return { ...oauth, accessToken: result.accessToken, refreshToken: result.refreshToken ?? oauth.refreshToken, expiresAt: result.expiresAt, scope: result.scope ?? oauth.scope };
}

export const tokenExpiring = (oauth: McpOAuth) => Boolean(oauth.expiresAt && oauth.expiresAt - Date.now() < 60_000);
