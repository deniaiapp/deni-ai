import { z } from "zod";
import { bootstrapResponseSchema } from "./bootstrap.js";
import {
  chatDetailSchema,
  chatListResponseSchema,
  chatStatusSchema,
  createChatBodySchema,
  messageWindowSchema,
  preferredModelBodySchema,
  updateChatBodySchema,
} from "./chats.js";
import { clientErrorSchema } from "./errors.js";
import { modelsResponseSchema } from "./models.js";

/**
 * Request and response bodies by the name the Rust client generates a type
 * for (`typify`). Query parameters are not listed: they are plain strings.
 */
export const CLIENT_API_SCHEMAS = {
  BootstrapResponse: bootstrapResponseSchema,
  ModelsResponse: modelsResponseSchema,
  ChatListResponse: chatListResponseSchema,
  ChatDetail: chatDetailSchema,
  MessageWindow: messageWindowSchema,
  ChatStatus: chatStatusSchema,
  CreateChatBody: createChatBodySchema,
  UpdateChatBody: updateChatBodySchema,
  PreferredModelBody: preferredModelBodySchema,
  ClientError: clientErrorSchema,
} as const;

/**
 * zod closes every object (`additionalProperties: false`). Generated client
 * types would then reject any field the server adds later, so the published
 * schema leaves objects open: clients ignore fields they do not know.
 */
function openObjects(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(openObjects);
  if (!node || typeof node !== "object") return node;
  const entries = Object.entries(node).filter(
    ([key, value]) => !(key === "additionalProperties" && value === false),
  );
  return Object.fromEntries(entries.map(([key, value]) => [key, openObjects(value)]));
}

/** One JSON Schema document with every body under `$defs`. */
export function clientApiJsonSchema() {
  const registry = z.registry<{ id: string }>();
  for (const [name, schema] of Object.entries(CLIENT_API_SCHEMAS)) {
    registry.add(schema, { id: name });
  }
  const { schemas } = z.toJSONSchema(registry, { target: "draft-2020-12", io: "output" });
  const defs: Record<string, unknown> = {};
  for (const name of Object.keys(CLIENT_API_SCHEMAS)) {
    const { $schema: _schema, $id: _id, ...rest } = schemas[name] as Record<string, unknown>;
    defs[name] = openObjects(rest);
  }
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Deni AI client API v1",
    $defs: defs,
  };
}
