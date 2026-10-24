import dotenv from "dotenv";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mockModules } from "./module-mocks";

dotenv.config({ path: ".env", quiet: true });
dotenv.config({ path: ".env.local", override: true, quiet: true });

mockModules((request) => {
  if (request === "@tanstack/react-start/server-only") return {};
  return undefined;
});

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function rejects(promise: Promise<unknown>, pattern: RegExp, message: string) {
  try {
    await promise;
  } catch (error) {
    const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    assert(pattern.test(text), `${message} (threw ${text})`);
    return error;
  }
  throw new Error(`${message} (did not throw)`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (value: string) => createHash("sha256").update(value).digest("base64url");

/**
 * One server playing both sides: MCP resource servers under /mcp (OAuth), /open (no auth),
 * /nopkce and /cimd, plus the authorization servers they point at.
 */
function mockServer() {
  const state = {
    base: "",
    registrations: 0,
    tokenRequests: 0,
    refreshRequests: 0,
    refreshDelayMs: 0,
    refreshError: "" as string,
    clients: new Map<string, string>(),
    codes: new Map<string, { clientId: string; challenge: string; resource: string; redirectUri: string }>(),
    accessTokens: new Set<string>(),
    refreshTokens: new Set<string>(),
    bearers: [] as string[],
    issued: 0,
  };
  const tools = [
    { name: "read_page", description: "read", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } },
    { name: "write_page", description: "write", inputSchema: { type: "object" } },
  ];
  const json = (response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    response.writeHead(status, { "content-type": "application/json", ...headers });
    response.end(JSON.stringify(body));
  };
  const issue = () => {
    state.issued += 1;
    const access = `at-${state.issued}-${randomBytes(4).toString("hex")}`;
    const refresh = `rt-${state.issued}-${randomBytes(4).toString("hex")}`;
    state.accessTokens.add(access);
    state.refreshTokens.add(refresh);
    return { access_token: access, refresh_token: refresh, token_type: "Bearer", expires_in: 3600, scope: "read write" };
  };
  const asMetadata = (issuer: string, extra: Record<string, unknown>) => ({
    issuer,
    authorization_endpoint: `${state.base}/authorize`,
    token_endpoint: `${state.base}/token`,
    registration_endpoint: `${state.base}/register`,
    token_endpoint_auth_methods_supported: ["client_secret_basic"],
    code_challenge_methods_supported: ["S256"],
    ...extra,
  });

  const rpc = (response: ServerResponse, raw: string) => {
    const body = JSON.parse(raw || "{}") as { id?: unknown; method?: string; params?: { name?: string } };
    if (body.id === undefined) return void response.writeHead(202).end();
    const result = body.method === "initialize"
      ? { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "mock", version: "1" } }
      : body.method === "tools/list"
        ? { tools }
        : { content: [{ type: "text", text: `called ${body.params?.name}` }] };
    json(response, 200, { jsonrpc: "2.0", id: body.id, result });
  };

  const handle = async (request: IncomingMessage, response: ServerResponse, raw: string) => {
    const url = new URL(request.url ?? "/", state.base);
    const route = `${request.method} ${url.pathname}`;
    const challenge = (resource: string) => ({
      "www-authenticate": `Bearer resource_metadata="${state.base}/.well-known/oauth-protected-resource${resource}", scope="read write"`,
    });
    switch (route) {
      case "POST /mcp": {
        const auth = request.headers.authorization ?? "";
        const token = auth.replace(/^Bearer /, "");
        if (!state.accessTokens.has(token)) return json(response, 401, { error: "invalid_token" }, challenge("/mcp"));
        state.bearers.push(token);
        return rpc(response, raw);
      }
      case "POST /open":
        return rpc(response, raw);
      case "POST /nopkce":
        return json(response, 401, {}, challenge("/nopkce"));
      case "POST /cimd":
        return json(response, 401, {}, challenge("/cimd"));
      case "GET /.well-known/oauth-protected-resource/mcp":
        return json(response, 200, { resource: `${state.base}/mcp`, authorization_servers: [state.base], scopes_supported: ["read", "write"] });
      case "GET /.well-known/oauth-protected-resource/nopkce":
        return json(response, 200, { resource: `${state.base}/nopkce`, authorization_servers: [`${state.base}/nopkce-as`] });
      case "GET /.well-known/oauth-protected-resource/cimd":
        return json(response, 200, { resource: `${state.base}/cimd`, authorization_servers: [`${state.base}/cimd-as`] });
      case "GET /.well-known/oauth-authorization-server":
        return json(response, 200, asMetadata(state.base, {}));
      case "GET /.well-known/oauth-authorization-server/nopkce-as":
        return json(response, 200, asMetadata(`${state.base}/nopkce-as`, { code_challenge_methods_supported: ["plain"] }));
      case "GET /.well-known/oauth-authorization-server/cimd-as":
        return json(response, 200, asMetadata(`${state.base}/cimd-as`, { client_id_metadata_document_supported: true }));
      case "POST /register": {
        state.registrations += 1;
        const body = JSON.parse(raw) as { redirect_uris?: string[]; token_endpoint_auth_method?: string };
        assert(body.token_endpoint_auth_method === "client_secret_basic", "DCR asked for an auth method the server does not support");
        const clientId = `client-${state.registrations}`;
        const secret = `dcr-client-secret-${state.registrations}`;
        state.clients.set(clientId, secret);
        return json(response, 201, { client_id: clientId, client_secret: secret, token_endpoint_auth_method: "client_secret_basic", redirect_uris: body.redirect_uris });
      }
      case "POST /token": {
        state.tokenRequests += 1;
        const params = new URLSearchParams(raw);
        const basic = (request.headers.authorization ?? "").replace(/^Basic /, "");
        const [clientId, secret] = Buffer.from(basic, "base64").toString("utf8").split(":").map(decodeURIComponent);
        if (!clientId || state.clients.get(clientId) !== secret) return json(response, 401, { error: "invalid_client" });
        if (params.get("resource") !== `${state.base}/mcp`) return json(response, 400, { error: "invalid_target" });
        if (params.get("grant_type") === "authorization_code") {
          const code = state.codes.get(params.get("code") ?? "");
          state.codes.delete(params.get("code") ?? "");
          if (!code || code.clientId !== clientId) return json(response, 400, { error: "invalid_grant" });
          if (code.redirectUri !== params.get("redirect_uri")) return json(response, 400, { error: "invalid_grant" });
          if (code.resource !== params.get("resource")) return json(response, 400, { error: "invalid_target" });
          if (sha256(params.get("code_verifier") ?? "") !== code.challenge) return json(response, 400, { error: "invalid_grant", error_description: "PKCE" });
          return json(response, 200, issue());
        }
        if (params.get("grant_type") === "refresh_token") {
          state.refreshRequests += 1;
          if (state.refreshDelayMs) await sleep(state.refreshDelayMs);
          const token = params.get("refresh_token") ?? "";
          if (state.refreshError || !state.refreshTokens.has(token)) return json(response, 400, { error: state.refreshError || "invalid_grant" });
          // Rotation: the used refresh token stops working.
          state.refreshTokens.delete(token);
          return json(response, 200, issue());
        }
        return json(response, 400, { error: "unsupported_grant_type" });
      }
      default:
        return json(response, 404, { error: "not_found" });
    }
  };

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      handle(request, response, Buffer.concat(chunks).toString("utf8")).catch((error) => {
        console.error(error);
        if (!response.headersSent) json(response, 500, { error: String(error) });
      });
    });
  });
  return { server, state };
}

let tempDir = "";

async function main() {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "deni-mcp-oauth-"));
  delete process.env.D1_PROXY_URL;
  process.env.LOCAL_DB_PATH = path.join(tempDir, "test.sqlite");
  process.env.APP_ENCRYPTION_KEY ||= randomBytes(32).toString("base64");

  const mcp = await import("../lib/mcp");
  const oauthLib = await import("../lib/mcp-oauth");
  const { db } = await import("../db");
  const { mcpConnections } = await import("../db/schema");
  const { and, eq } = await import("drizzle-orm");

  const { server, state } = mockServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("mock server did not start");
  state.base = `http://127.0.0.1:${address.port}`;
  const appUrl = "http://localhost:3000";
  const userId = "user-oauth";

  const readOAuth = async (id: string) => {
    const [row] = await db.select().from(mcpConnections).where(and(eq(mcpConnections.userId, userId), eq(mcpConnections.id, id)));
    return oauthLib.decodeOAuth(row?.oauth);
  };
  const writeOAuth = async (id: string, change: (oauth: import("../lib/mcp-oauth").McpOAuth) => void) => {
    const oauth = await readOAuth(id);
    assert(oauth, "no stored OAuth to change");
    change(oauth);
    await db.update(mcpConnections).set({ oauth: oauthLib.encodeOAuth(oauth) }).where(eq(mcpConnections.id, id));
  };
  const status = async (id: string) => (await mcp.listMcpConnections(userId)).find((item) => item.id === id)?.oauth;
  /** Plays the authorization server's consent page: the user approves and a code is issued. */
  const consent = (authorizeUrl: string) => {
    const url = new URL(authorizeUrl);
    const code = `code-${randomBytes(6).toString("hex")}`;
    state.codes.set(code, {
      clientId: url.searchParams.get("client_id") ?? "",
      challenge: url.searchParams.get("code_challenge") ?? "",
      resource: url.searchParams.get("resource") ?? "",
      redirectUri: url.searchParams.get("redirect_uri") ?? "",
    });
    return { code, state: url.searchParams.get("state") ?? "" };
  };

  // 1. Starting sign-in discovers the server from the 401 and registers once.
  const created = await mcp.saveMcpConnection({ userId, name: "oauth mock", url: `${state.base}/mcp` });
  assert(created, "connection was not saved");
  const id = created.id;
  const started = await mcp.startMcpSignIn(userId, { id }, appUrl);
  assert(started.authorizeUrl, "sign-in returned no authorize URL");
  const authorize = new URL(started.authorizeUrl);
  assert(authorize.origin + authorize.pathname === `${state.base}/authorize`, "authorize URL points elsewhere");
  assert(authorize.searchParams.get("response_type") === "code", "response_type is not code");
  assert(authorize.searchParams.get("code_challenge_method") === "S256", "PKCE method is not S256");
  assert(/^[A-Za-z0-9_-]{43}$/.test(authorize.searchParams.get("code_challenge") ?? ""), "PKCE challenge is not a SHA-256 hash");
  assert(authorize.searchParams.get("state")?.startsWith(`${id}.`), "state does not carry the connection");
  assert(authorize.searchParams.get("resource") === `${state.base}/mcp`, "resource parameter is missing");
  assert(authorize.searchParams.get("redirect_uri") === `${appUrl}/api/mcp/oauth/callback`, "redirect_uri is wrong");
  assert(authorize.searchParams.get("scope") === "read write", "scope from WWW-Authenticate was not used");
  assert(authorize.searchParams.get("client_id") === "client-1", "dynamic registration client was not used");
  assert(state.registrations === 1, "dynamic registration did not run exactly once");
  assert((await status(id)) === "signed-out", "a pending sign-in counted as signed in");
  const stored = await readOAuth(id);
  assert(stored?.pending && sha256(stored.pending.verifier) === authorize.searchParams.get("code_challenge"), "stored verifier does not match the challenge");

  // 3. Wrong state, unknown connection, and a mismatched issuer are refused before any token request.
  const grant = consent(started.authorizeUrl);
  await rejects(mcp.finishMcpSignIn(userId, { state: `${id}.wrong`, code: grant.code }), /expired/, "a wrong state was accepted");
  await rejects(mcp.finishMcpSignIn(userId, { state: `mcp_missing.${grant.state.split(".")[1]}`, code: grant.code }), /expired/, "a state for another connection was accepted");
  await rejects(mcp.finishMcpSignIn("someone-else", grant), /expired/, "another user finished this sign-in");
  await rejects(mcp.finishMcpSignIn(userId, { ...grant, iss: "https://evil.example" }), /refused/, "a mismatched iss was accepted");
  assert(!state.tokenRequests, "a refused callback still exchanged the code");

  // 2. Consent: the code exchange proves the verifier and names the resource; calls send the token.
  const signedIn = await mcp.finishMcpSignIn(userId, { ...grant, iss: state.base });
  assert(signedIn.oauth === "signed-in", "connection is not signed in after the callback");
  assert(state.tokenRequests === 1, "code was not exchanged exactly once");
  const firstTokens = await readOAuth(id);
  assert(firstTokens?.accessToken && firstTokens.refreshToken && !firstTokens.pending, "tokens were not stored");
  assert(firstTokens.expiresAt && firstTokens.expiresAt > Date.now() + 3_000_000, "expiry was not stored");
  state.bearers.length = 0;
  const call = await mcp.callMcpTool(userId, id, "read_page", {});
  assert(JSON.stringify(call).includes("called read_page"), "tool call did not return");
  assert(state.bearers.length > 0 && state.bearers.every((token) => token === firstTokens.accessToken), "tool call did not send the bearer token");
  await rejects(mcp.finishMcpSignIn(userId, grant), /expired/, "a used state was accepted twice");

  // 6. Signing in again reuses the registered client; an expired pending sign-in is refused.
  const again = await mcp.startMcpSignIn(userId, { id }, appUrl);
  assert(again.authorizeUrl && new URL(again.authorizeUrl).searchParams.get("client_id") === "client-1", "reconnect used another client");
  assert(state.registrations === 1, "reconnect registered a second client");
  assert((await status(id)) === "signed-in", "starting a new sign-in dropped working tokens");
  const late = consent(again.authorizeUrl);
  await writeOAuth(id, (oauth) => { oauth.pending!.expiresAt = Date.now() - 1; });
  await rejects(mcp.finishMcpSignIn(userId, late), /expired/, "an expired sign-in was accepted");
  const fresh = await mcp.startMcpSignIn(userId, { id }, appUrl);
  assert(fresh.authorizeUrl, "restart returned no URL");
  await mcp.finishMcpSignIn(userId, consent(fresh.authorizeUrl));
  assert(state.registrations === 1, "finishing a reconnect registered again");
  const reconnected = await readOAuth(id);
  assert(reconnected?.accessToken && reconnected.accessToken !== firstTokens.accessToken, "reconnect did not store new tokens");

  // 4. A token about to expire is refreshed before the call, once for concurrent calls, and rotated.
  await writeOAuth(id, (oauth) => { oauth.expiresAt = Date.now() + 10_000; });
  const beforeRefresh = await readOAuth(id);
  state.refreshRequests = 0;
  state.refreshDelayMs = 150;
  state.bearers.length = 0;
  const results = await Promise.all([1, 2, 3].map(() => mcp.callMcpTool(userId, id, "read_page", {})));
  state.refreshDelayMs = 0;
  assert(results.every((result) => JSON.stringify(result).includes("called read_page")), "concurrent calls failed");
  assert(state.refreshRequests === 1, `concurrent calls refreshed ${state.refreshRequests} times`);
  const refreshed = await readOAuth(id);
  assert(refreshed?.accessToken && refreshed.accessToken !== beforeRefresh?.accessToken, "refreshed access token was not stored");
  assert(refreshed.refreshToken && refreshed.refreshToken !== beforeRefresh?.refreshToken, "rotated refresh token was not stored");
  assert(refreshed.expiresAt! > Date.now() + 3_000_000, "refreshed expiry was not stored");
  assert(state.bearers.length > 0 && state.bearers.every((token) => token === refreshed.accessToken), "a call used the expiring token");

  // 5. A 401 refreshes and retries once; a rejected refresh asks the user to sign in again.
  state.accessTokens.clear();
  state.refreshRequests = 0;
  const retried = await mcp.callMcpTool(userId, id, "read_page", {});
  assert(JSON.stringify(retried).includes("called read_page"), "call after 401 did not succeed on retry");
  assert(state.refreshRequests === 1, "401 did not refresh exactly once");
  assert((await readOAuth(id))?.accessToken !== refreshed.accessToken, "token from the 401 refresh was not stored");
  state.accessTokens.clear();
  state.refreshError = "invalid_grant";
  await rejects(mcp.callMcpTool(userId, id, "read_page", {}), /McpAuthRequiredError: Sign in to this MCP server again/, "rejected refresh did not ask to sign in again");
  assert((await status(id)) === "signed-out", "connection still shows signed in after invalid_grant");
  const cleared = await readOAuth(id);
  assert(cleared && !cleared.accessToken && !cleared.refreshToken && cleared.clientId === "client-1", "invalid_grant did not clear only the tokens");
  const requestsBefore = state.refreshRequests;
  await rejects(mcp.callMcpTool(userId, id, "read_page", {}), /McpAuthRequiredError/, "signed-out connection still called the server");
  assert(state.refreshRequests === requestsBefore, "signed-out connection tried to refresh");
  state.refreshError = "";
  const back = await mcp.startMcpSignIn(userId, { id }, appUrl);
  assert(back.authorizeUrl && state.registrations === 1, "sign-in after invalid_grant registered again");
  assert((await mcp.finishMcpSignIn(userId, consent(back.authorizeUrl))).oauth === "signed-in", "sign-in after invalid_grant failed");

  // 7. With an https app URL and a server that accepts them, the client ID metadata document is the client.
  const httpsApp = "https://app.example";
  const cimd = await oauthLib.beginMcpOAuth({ mcpUrl: `${state.base}/cimd`, appUrl: httpsApp, stateKey: "cimd" });
  assert(cimd, "CIMD server needed no sign-in");
  const cimdUrl = new URL(cimd.authorizeUrl);
  assert(cimdUrl.searchParams.get("client_id") === `${httpsApp}/oauth/client-metadata.json`, "CIMD client_id is wrong");
  assert(cimdUrl.searchParams.get("redirect_uri") === `${httpsApp}/api/mcp/oauth/callback`, "CIMD redirect is wrong");
  assert(cimd.oauth.tokenAuthMethod === "none" && !cimd.oauth.clientSecret, "CIMD client has a secret");
  assert(cimd.oauth.issuer === `${state.base}/cimd-as`, "path-aware authorization server metadata was not used");
  assert(state.registrations === 1, "CIMD still registered a client");
  const document = oauthLib.clientMetadataDocument(httpsApp);
  assert(document.client_id === cimdUrl.searchParams.get("client_id") && document.redirect_uris.includes(cimdUrl.searchParams.get("redirect_uri")!), "metadata document does not match the client used");
  assert(oauthLib.clientMetadataUrl("http://localhost:3000") === null, "CIMD offered for an http app URL");

  // 8. Servers without PKCE are refused; servers without auth need no sign-in.
  await rejects(oauthLib.beginMcpOAuth({ mcpUrl: `${state.base}/nopkce`, appUrl, stateKey: "x" }), /PKCE/, "server without S256 was accepted");
  const open = await mcp.saveMcpConnection({ userId, name: "open custom", url: `${state.base}/open` });
  assert(open, "open connection was not saved");
  const openStart = await mcp.startMcpSignIn(userId, { id: open.id }, appUrl);
  assert(openStart.authorizeUrl === null && openStart.connection.oauth === null, "server without auth asked to sign in");
  assert(state.registrations === 1, "server without auth registered a client");

  // 9. Read-only hints count only for catalog connectors; Always allow works for any tool.
  const catalogId = "mcp_catalogtest";
  await db.insert(mcpConnections).values({ id: catalogId, userId, name: "Notion", url: `${state.base}/open`, transport: "streamable-http", headers: {}, catalogId: "notion", enabled: true });
  assert(await mcp.mcpCallPreapproved(userId, catalogId, "read_page"), "catalog read-only tool was not preapproved");
  assert(await mcp.mcpCallPreapproved(userId, catalogId, "read_page", { readOnly: true }), "catalog read-only tool was not preapproved for a handoff");
  assert(!(await mcp.mcpCallPreapproved(userId, catalogId, "write_page")), "catalog write tool was preapproved");
  assert(!(await mcp.mcpCallPreapproved(userId, open.id, "read_page")), "custom server's read-only hint was trusted");
  assert(!(await mcp.mcpCallPreapproved(userId, open.id, "write_page")), "custom tool was preapproved");
  await mcp.setMcpAlwaysAllow(userId, open.id, "write_page", true);
  assert(await mcp.mcpCallPreapproved(userId, open.id, "write_page"), "Always allow did not preapprove");
  assert(!(await mcp.mcpCallPreapproved(userId, open.id, "write_page", { readOnly: true })), "Always allow let a read-only handoff write");
  assert(!(await mcp.mcpCallPreapproved(userId, open.id, "read_page")), "Always allow leaked to another tool");
  assert((await mcp.mcpAlwaysAllowed(userId, open.id)).join(",") === "write_page", "Always allow list is wrong");
  assert((await mcp.mcpAlwaysAllowed(userId, catalogId)).length === 0, "Always allow leaked to another connection");
  await mcp.setMcpAlwaysAllow(userId, open.id, "write_page", false);
  assert(!(await mcp.mcpCallPreapproved(userId, open.id, "write_page")), "turning Always allow off did not ask again");
  await mcp.setMcpConnectionEnabled(userId, catalogId, false);
  assert(!(await mcp.mcpCallPreapproved(userId, catalogId, "read_page")), "disabled catalog connector was preapproved");

  // 10. The public listing and stored row never expose tokens or client secrets.
  const finalTokens = await readOAuth(id);
  assert(finalTokens?.accessToken && finalTokens.refreshToken && finalTokens.clientSecret, "final tokens missing");
  const listed = JSON.stringify(await mcp.listMcpConnections(userId));
  for (const secret of [finalTokens.accessToken, finalTokens.refreshToken, finalTokens.clientSecret, "dcr-client-secret", "at-", "rt-", "verifier"]) {
    assert(!listed.includes(secret), `public listing leaked ${secret}`);
  }
  const [raw] = await db.select().from(mcpConnections).where(eq(mcpConnections.id, id));
  assert(raw?.oauth?.startsWith("enc:v1:") && !raw.oauth.includes(finalTokens.accessToken), "stored OAuth is not encrypted");

  server.close();
  console.log("verified MCP OAuth discovery, DCR reuse, CIMD, PKCE, state/iss checks, refresh dedupe and rotation, 401 retry, sign-out on invalid_grant, approvals, and redaction");
}

async function run() {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
  process.exit(process.exitCode ?? 0);
}

void run();
