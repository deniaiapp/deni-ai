import { z } from "zod";

export const reasoningEffortSchema = z.enum([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;

/** One model the account may use. */
export const clientModelSchema = z.object({
  /** Model id sent as `model` to `POST /api/chat`. */
  id: z.string(),
  name: z.string(),
  author: z.string(),
  description: z.string().nullable(),
  /** Shown first in the picker. */
  featured: z.boolean(),
  /** Reasoning efforts the model accepts; empty when it has no effort control. */
  efforts: z.array(reasoningEffortSchema),
  contextWindow: z.number().int().positive().nullable(),
  /** Each token counts this tier's multiplier toward the usage pool (1-10). */
  usageTier: z.number().int().min(1).max(10),
  /** Pro reasoning mode can be turned on (`proMode: true`) for this account. */
  supportsProMode: z.boolean(),
  supportsFastMode: z.boolean(),
  /** Upcoming retirement, as an ISO calendar date; null when none is announced. */
  retiresOn: z.string().nullable(),
});
export type ClientModel = z.infer<typeof clientModelSchema>;

/** `GET /api/client/v1/models`: the models this account's plan includes. */
export const modelsResponseSchema = z.object({
  /** The server default; use `preferences.preferredModel` first when it is set. */
  defaultModel: z.string(),
  models: z.array(clientModelSchema),
});
export type ModelsResponse = z.infer<typeof modelsResponseSchema>;
