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

/** `NOINDEX`: ask search engines not to index or follow anything on this deployment. */
export function indexingDisabled() {
  return isFlagSet(process.env.NOINDEX);
}
