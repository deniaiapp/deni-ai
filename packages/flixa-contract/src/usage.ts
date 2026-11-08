import { z } from "zod";

/** Plan of the account (team plans report the plan they map to). */
export const planTierSchema = z.enum(["free", "go", "plus", "pro"]);
export type PlanTier = z.infer<typeof planTierSchema>;

/** The only quota unit: pool usage units (1M units = $0.50). */
export const usageUnitSchema = z.literal("units");
export type UsageUnit = z.infer<typeof usageUnitSchema>;

/**
 * One entry of the legacy per-category `usage` list. Usage is no longer split
 * by model class: both `basic` and `premium` report the one shared pool and its
 * total use, so older Flixa extension and CLI versions keep working.
 */
export const deniUsageEntrySchema = z.object({
  category: z.enum(["basic", "premium"]),
  unit: usageUnitSchema,
  limit: z.number().nullable(),
  used: z.number(),
  remaining: z.number().nullable(),
  periodStart: z.iso.datetime(),
  periodEnd: z.iso.datetime().nullable(),
});
export type DeniUsageEntry = z.infer<typeof deniUsageEntrySchema>;

/**
 * The one monthly pool shared by Deni AI chat, Flixa, and Deni Run, in usage
 * units. It resets on the first day of the next month (UTC).
 */
export const deniUsagePoolSchema = z.object({
  limit: z.number(),
  used: z.number(),
  remaining: z.number(),
  periodEnd: z.iso.datetime(),
});
export type DeniUsagePool = z.infer<typeof deniUsagePoolSchema>;

/**
 * `GET /v1/deni/usage` (alias `GET /v1/deni/billing-status`) with
 * `Authorization: Bearer deni_...`: the account's plan, billing links and
 * usage (services/agent-api `utils/deni/usage.ts` `getDeniUsageInfo`).
 */
export const deniUsageInfoSchema = z.object({
  tier: planTierSchema,
  planId: z.string().nullable(),
  status: z.string().nullable(),
  hasVerifiedPaymentMethod: z.boolean(),
  cardVerifiedAt: z.iso.datetime().nullable(),
  verifyUrl: z.string(),
  upgradeUrl: z.string(),
  isTeam: z.boolean(),
  periodEnd: z.iso.datetime().nullable(),
  maxModeEnabled: z.boolean(),
  maxModeEligible: z.boolean(),
  usage: z.array(deniUsageEntrySchema),
  pool: deniUsagePoolSchema,
});
export type DeniUsageInfo = z.infer<typeof deniUsageInfoSchema>;

/**
 * What a client should accept from the usage route: a server started with
 * `FLIXA_AUTH_DISABLED` (local development only) answers a fixed Pro profile
 * without `pool`, and older servers predate it.
 */
export const deniUsageResponseSchema = deniUsageInfoSchema.extend({
  pool: deniUsagePoolSchema.optional(),
});
export type DeniUsageResponse = z.infer<typeof deniUsageResponseSchema>;
