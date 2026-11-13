import { z } from "zod";

export const planTierSchema = z.enum(["free", "go", "plus", "pro"]);
export type PlanTier = z.infer<typeof planTierSchema>;

/**
 * `GET /api/client/v1/bootstrap`: everything the client needs after sign-in
 * and on every launch, in one request.
 */
export const bootstrapResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    image: z.string().nullable(),
  }),
  plan: z.object({
    tier: planTierSchema,
    hasVerifiedPaymentMethod: z.boolean(),
    /** The shared usage pool; null for accounts without one. */
    pool: z
      .object({
        limit: z.number(),
        used: z.object({ chat: z.number(), flixa: z.number(), run: z.number() }),
        /** ISO 8601. */
        periodEnd: z.string(),
      })
      .nullable(),
  }),
  /** Features this deployment has configured. */
  features: z.object({
    webSearch: z.boolean(),
    memory: z.boolean(),
    billing: z.boolean(),
  }),
  preferences: z.object({
    /** The account's default model for new chats; null until one is picked. */
    preferredModel: z.string().nullable(),
  }),
  client: z.object({
    /** Oldest client version the server accepts; null when any version is accepted. */
    minVersion: z.string().nullable(),
    /** True when the requesting client is older than `minVersion`. */
    updateRequired: z.boolean(),
  }),
  /** Web pages the client opens in the system browser instead of rendering itself. */
  links: z.object({
    web: z.string(),
    settings: z.string(),
    billing: z.string(),
  }),
});
export type BootstrapResponse = z.infer<typeof bootstrapResponseSchema>;
