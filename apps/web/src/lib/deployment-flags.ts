/**
 * Runtime switches for non-production copies of the app (e.g. a canary
 * deployment). `1` or `true` turns a flag on; read per call so a container
 * restart with new env applies without a rebuild.
 */
function isFlagSet(value: string | undefined) {
  return ["1", "true"].includes(value?.trim().toLowerCase() ?? "");
}

/** `DISABLE_BACKGROUND_JOBS`: no billing/storage jobs and no model probes that spend provider tokens. */
export function backgroundJobsDisabled() {
  return isFlagSet(process.env.DISABLE_BACKGROUND_JOBS);
}

/** zod's `stringbool()` false values, which `src/env.ts` validates `CRON_ENABLED` with. */
const FALSE_VALUES = ["0", "false", "no", "off", "n", "disabled"];

/**
 * `CRON_ENABLED` (default true): `false` makes `/api/cron/*` no-ops and keeps
 * the in-process jobs that write the shared database from starting, on a
 * deployment that shares its database with one that runs them (the v8 beta).
 */
export function cronEnabled() {
  return !FALSE_VALUES.includes(process.env.CRON_ENABLED?.trim().toLowerCase() ?? "");
}

/** The answer of every `/api/cron/*` route while `CRON_ENABLED=false`: success, nothing done. */
export function cronDisabledResponse() {
  return Response.json(
    { skipped: true, reason: "cron_disabled" },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** `NOINDEX`: ask search engines not to index or follow anything on this deployment. */
export function indexingDisabled() {
  return isFlagSet(process.env.NOINDEX);
}
