import { CHAT_SCOPE } from "@deniai/auth/oauth";
import {
  type BootstrapResponse,
  CLIENT_HEADER,
  type ChatDetail,
  type ChatListResponse,
  type ChatStatus,
  type ClientErrorCode,
  type ClientModel,
  type MessageWindow,
  type ModelsResponse,
  chatListQuerySchema,
  compareVersions,
  createChatBodySchema,
  olderMessagesQuerySchema,
  parseClientHeader,
  preferredModelBodySchema,
  updateChatBodySchema,
} from "@deniai/client-contract";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { env } from "@/env";
import { guardMutationRequest } from "@/lib/mutation-request";
import { checkRateLimit } from "@/lib/rate-limit";
import { getRequestSession, type RequestSession } from "@/lib/request-session.server";

/**
 * The native client API (`/api/client/v1/*`) used by Deni AI Desktop,
 * dispatched here from the catch-all route `src/routes/api/client/v1/$.ts`.
 * Request and response shapes are `@deniai/client-contract`; change them there
 * first. Chat operations go through the tRPC routers (`createCaller`) so the
 * rules live in one place; this layer only adapts them to plain JSON over REST.
 *
 * Credentials: an OAuth access token with the `chat` scope
 * (`Authorization: Bearer`), or the browser session. Sending and stopping
 * messages and attachments stay on `/api/chat`, `/api/chat/stop` and
 * `/api/upload-attachment`, which accept the same token.
 */

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

type ClientRequestContext = {
  request: Request;
  session: RequestSession;
  userId: string;
  url: URL;
};

type Handler = (context: ClientRequestContext, params: string[]) => Promise<Response>;

/** Per-user budget across every endpoint; the desktop client polls status once a second while generating. */
const RATE_LIMIT = { windowMs: 60_000, maxRequests: 300 };
const BODY_LIMIT_BYTES = 64 * 1024;

const NO_STORE = { "Cache-Control": "private, no-store" };

export function clientJson<T>(body: T, status = 200, headers: HeadersInit = {}) {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

export function clientError(
  status: number,
  code: ClientErrorCode,
  message: string,
  headers: HeadersInit = {},
) {
  return clientJson({ error: code, code, message }, status, headers);
}

class ClientRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ClientErrorCode,
    message: string,
  ) {
    super(message);
  }
}

async function readBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.output<S>> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > BODY_LIMIT_BYTES) {
    throw new ClientRequestError(413, "invalid_request", "Request body is too large");
  }
  let raw: unknown;
  try {
    const text = await request.text();
    if (text.length > BODY_LIMIT_BYTES) {
      throw new ClientRequestError(413, "invalid_request", "Request body is too large");
    }
    raw = JSON.parse(text);
  } catch (error) {
    if (error instanceof ClientRequestError) throw error;
    throw new ClientRequestError(400, "invalid_request", "Invalid JSON body");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ClientRequestError(400, "invalid_request", parsed.error.issues[0]?.message ?? "");
  }
  return parsed.data;
}

function readQuery<S extends z.ZodType>(url: URL, schema: S): z.output<S> {
  const parsed = schema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    throw new ClientRequestError(400, "invalid_request", parsed.error.issues[0]?.message ?? "");
  }
  return parsed.data;
}

const TRPC_STATUS: Partial<Record<TRPCError["code"], [number, ClientErrorCode]>> = {
  BAD_REQUEST: [400, "invalid_request"],
  UNAUTHORIZED: [401, "unauthorized"],
  FORBIDDEN: [403, "forbidden"],
  NOT_FOUND: [404, "not_found"],
  TOO_MANY_REQUESTS: [429, "rate_limited"],
};

/** tRPC puts a failed input's zod issues, serialized, in `message`; return the first issue's text. */
function trpcErrorMessage(error: TRPCError): string {
  const issues = (error.cause as { issues?: { message?: unknown }[] } | undefined)?.issues;
  const first = Array.isArray(issues) ? issues[0]?.message : undefined;
  return typeof first === "string" ? first : error.message;
}

async function caller(context: ClientRequestContext) {
  const [{ appRouter }, { db }, { requestCountry }] = await Promise.all([
    import("@/server/api/root"),
    import("@/db/drizzle"),
    import("@/lib/plan-currency"),
  ]);
  return appRouter.createCaller({
    db,
    session: context.session,
    country: requestCountry(context.request.headers),
  });
}

function isoDate(value: Date | string | null | undefined): string {
  return new Date(value ?? 0).toISOString();
}

function toChatDetail(page: {
  id: string;
  title: string | null;
  projectId: string | null;
  projectName: string | null;
  model: string | null;
  messages: unknown[];
  oldestIndex: number;
  hasMore: boolean;
}): ChatDetail {
  return {
    id: page.id,
    title: page.title,
    projectId: page.projectId,
    projectName: page.projectName,
    model: page.model,
    messages: page.messages as ChatDetail["messages"],
    oldestIndex: page.oldestIndex,
    hasMore: page.hasMore,
  };
}

/** Whether the requesting client is older than `DESKTOP_MIN_CLIENT_VERSION`. */
export function isClientUpdateRequired(
  headerValue: string | null,
  minVersion: string | null | undefined = env.DESKTOP_MIN_CLIENT_VERSION,
): boolean {
  if (!minVersion) return false;
  const identity = parseClientHeader(headerValue);
  // Browsers and tools without the header are not desktop clients to retire.
  if (!identity) return false;
  return compareVersions(identity.version, minVersion) < 0;
}

async function bootstrap({ session, userId, request }: ClientRequestContext) {
  const [{ getUsageSummary }, { getPlatformCapabilities }, api] = await Promise.all([
    import("@/lib/usage"),
    import("@/lib/platform-capabilities.server"),
    caller({ session, userId, request, url: new URL(request.url) }),
  ]);
  const [usage, preferences] = await Promise.all([
    getUsageSummary({ userId, isAnonymous: false }),
    api.preferences.get(),
  ]);
  const { features } = getPlatformCapabilities();
  const origin = new URL(env.NEXT_PUBLIC_BETTER_AUTH_URL).origin;
  const body: BootstrapResponse = {
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image ?? null,
    },
    plan: {
      tier: usage.tier,
      hasVerifiedPaymentMethod: usage.hasVerifiedPaymentMethod,
      pool: usage.pool
        ? {
            limit: usage.pool.limit,
            used: usage.pool.used,
            periodEnd: isoDate(usage.pool.periodEnd),
          }
        : null,
    },
    features: {
      webSearch: features.webSearch,
      memory: features.memory,
      billing: features.billing,
    },
    preferences: { preferredModel: preferences.preferredModel },
    client: {
      minVersion: env.DESKTOP_MIN_CLIENT_VERSION ?? null,
      updateRequired: isClientUpdateRequired(request.headers.get(CLIENT_HEADER)),
    },
    links: {
      web: `${origin}/chat`,
      settings: `${origin}/settings`,
      billing: `${origin}/settings/billing`,
    },
  };
  return clientJson(body);
}

async function listModels({ userId }: ClientRequestContext) {
  const [{ getUsageSummary }, { getPlatformCapabilities }, { isModelProviderAvailable }, ai] =
    await Promise.all([
      import("@/lib/usage"),
      import("@/lib/platform-capabilities.server"),
      import("@/lib/platform-capabilities"),
      import("@deniai/ai/models"),
    ]);
  const usage = await getUsageSummary({ userId, isAnonymous: false });
  const capabilities = getPlatformCapabilities();
  const proModeAllowed = ai.isProModeAllowedForAccount(usage.tier);
  const models: ClientModel[] = ai
    .getModelsForPlanTier(usage.tier, usage.hasVerifiedPaymentMethod)
    .filter((model) => isModelProviderAvailable(capabilities, model.provider ?? model.author))
    .map((model) => ({
      id: model.value,
      name: model.name,
      author: model.author,
      description: model.description ?? null,
      featured: Boolean(model.featured),
      efforts: model.efforts ? [...model.efforts] : [],
      contextWindow: model.contextWindow ?? null,
      usageTier: model.usageTier ?? 1,
      supportsProMode: Boolean(model.supportsProMode) && proModeAllowed,
      supportsFastMode: Boolean(model.supportsFastMode),
      retiresOn: model.deprecation?.date ?? null,
    }));
  const preferred = models.find((model) => model.id === ai.defaultModel.value) ?? models[0];
  const body: ModelsResponse = {
    defaultModel: preferred?.id ?? ai.defaultModel.value,
    models,
  };
  return clientJson(body);
}

async function listChats({ userId, url }: ClientRequestContext) {
  const { limit, cursor } = readQuery(url, chatListQuerySchema);
  const [{ db }, { chats }] = await Promise.all([import("@/db/drizzle"), import("@/db/schema")]);
  // The cursor is the id of the last chat of the previous page; comparing
  // against its stored (microsecond) timestamp in SQL keeps pages exact.
  const after = cursor
    ? sql`(${chats.updated_at}, ${chats.id}) < (select c.updated_at, c.id from chats c where c.id = ${cursor} and c.user_id = ${userId})`
    : undefined;
  const rows = await db
    .select({
      id: chats.id,
      title: chats.title,
      projectId: chats.projectId,
      pinned: chats.pinned,
      folder: chats.folder,
      tags: chats.tags,
      createdAt: chats.created_at,
      updatedAt: chats.updated_at,
    })
    .from(chats)
    .where(after ? and(eq(chats.uid, userId), after) : eq(chats.uid, userId))
    .orderBy(desc(chats.updated_at), desc(chats.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const body: ChatListResponse = {
    chats: page.map((row) => ({
      id: row.id,
      title: row.title,
      projectId: row.projectId,
      pinned: row.pinned,
      folder: row.folder,
      tags: Array.isArray(row.tags) ? row.tags.filter((tag) => typeof tag === "string") : [],
      createdAt: isoDate(row.createdAt),
      updatedAt: isoDate(row.updatedAt),
    })),
    nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
  };
  return clientJson(body);
}

async function createChat(context: ClientRequestContext) {
  const body = await readBody(context.request, createChatBodySchema);
  const api = await caller(context);
  const page = await api.chat.ensureChat({ id: body.id, projectId: body.projectId ?? null });
  return clientJson(toChatDetail(page));
}

async function getChat(context: ClientRequestContext, [id]: string[]) {
  const page = await (await caller(context)).chat.getChatPage({ id: id! });
  if (!page) return clientError(404, "not_found", "Chat not found");
  return clientJson(toChatDetail(page));
}

async function updateChat(context: ClientRequestContext, [id]: string[]) {
  const { model, ...fields } = await readBody(context.request, updateChatBodySchema);
  const api = await caller(context);
  if (Object.keys(fields).length > 0) await api.chat.updateChat({ id: id!, ...fields });
  if (model !== undefined) await api.chat.setChatModel({ id: id!, model });
  return getChat(context, [id!]);
}

async function deleteChat(context: ClientRequestContext, [id]: string[]) {
  await (await caller(context)).chat.deleteChat({ id: id! });
  return new Response(null, { status: 204, headers: NO_STORE });
}

async function olderMessages(context: ClientRequestContext, [id]: string[]) {
  const { before, limit } = readQuery(context.url, olderMessagesQuerySchema);
  const window = await (
    await caller(context)
  ).chat.getOlderMessages({
    id: id!,
    beforeIndex: before,
    limit,
  });
  const body: MessageWindow = {
    messages: window.messages as MessageWindow["messages"],
    oldestIndex: window.oldestIndex,
    hasMore: window.hasMore,
  };
  return clientJson(body);
}

async function chatStatus(context: ClientRequestContext, [id]: string[]) {
  const status = await (await caller(context)).chat.getChatStatus({ id: id! });
  if (!status) return clientError(404, "not_found", "Chat not found");
  const body: ChatStatus = {
    generating: status.activeGenerationId !== null,
    updatedAt: isoDate(status.updated_at),
  };
  return clientJson(body);
}

async function setPreferredModel(context: ClientRequestContext) {
  const { model } = await readBody(context.request, preferredModelBodySchema);
  const result = await (await caller(context)).preferences.setPreferredModel({ model });
  return clientJson(result);
}

/** Path patterns; `:id` matches one segment. Order matters only for readability. */
const ROUTES: { pattern: string[]; handlers: Partial<Record<Method, Handler>> }[] = [
  { pattern: ["bootstrap"], handlers: { GET: bootstrap } },
  { pattern: ["models"], handlers: { GET: listModels } },
  { pattern: ["chats"], handlers: { GET: listChats, POST: createChat } },
  { pattern: ["chats", ":id"], handlers: { GET: getChat, PATCH: updateChat, DELETE: deleteChat } },
  { pattern: ["chats", ":id", "messages"], handlers: { GET: olderMessages } },
  { pattern: ["chats", ":id", "status"], handlers: { GET: chatStatus } },
  { pattern: ["preferences", "model"], handlers: { PUT: setPreferredModel } },
];

export function matchClientRoute(segments: string[]) {
  for (const route of ROUTES) {
    if (route.pattern.length !== segments.length) continue;
    const params: string[] = [];
    const matches = route.pattern.every((part, index) => {
      const segment = segments[index]!;
      if (part.startsWith(":")) {
        params.push(decodeURIComponent(segment));
        return segment.length > 0 && segment.length <= 200;
      }
      return part === segment;
    });
    if (matches) return { handlers: route.handlers, params };
  }
  return null;
}

export async function handleClientApi(request: Request, splat: string): Promise<Response> {
  const url = new URL(request.url);
  const route = matchClientRoute(splat.split("/").filter(Boolean));
  if (!route) return clientError(404, "not_found", "Unknown endpoint");
  const method = request.method.toUpperCase() as Method;
  const handler = route.handlers[method];
  if (!handler) {
    return clientError(405, "method_not_allowed", "Method not allowed", {
      Allow: Object.keys(route.handlers).join(", "),
    });
  }

  const session = await getRequestSession(request, { bearerScope: CHAT_SCOPE });
  if (!session?.session) return clientError(401, "unauthorized", "Sign in again");
  if (session.user.isAnonymous) {
    return clientError(403, "forbidden", "Guest accounts cannot use the client API");
  }
  // A browser session needs the same-origin checks as every other mutation;
  // a bearer token is not sent by the browser on its own.
  if (method !== "GET" && session.credential === "cookie") {
    const rejected = guardMutationRequest(request);
    if (rejected) return rejected;
  }
  if (method !== "GET" && method !== "DELETE") {
    const type = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (type !== "application/json") {
      return clientError(415, "invalid_request", "Send application/json");
    }
  }
  const isBootstrap = splat.replace(/\/+$/, "") === "bootstrap";
  if (!isBootstrap && isClientUpdateRequired(request.headers.get(CLIENT_HEADER))) {
    return clientError(426, "client_update_required", "Update Deni AI Desktop to continue");
  }

  const userId = session.session.userId;
  const limit = await checkRateLimit({ key: `client-v1:${userId}`, ...RATE_LIMIT });
  if (!limit.allowed) {
    return clientError(429, "rate_limited", "Too many requests", {
      "Retry-After": String(limit.retryAfter),
    });
  }

  try {
    return await handler({ request, session, userId, url }, route.params);
  } catch (error) {
    if (error instanceof ClientRequestError) {
      return clientError(error.status, error.code, error.message);
    }
    if (error instanceof TRPCError) {
      const mapped = TRPC_STATUS[error.code];
      if (mapped) return clientError(mapped[0], mapped[1], trpcErrorMessage(error));
    }
    console.error("[client-v1]", method, splat, error);
    return clientError(500, "internal_error", "Something went wrong");
  }
}
