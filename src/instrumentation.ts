import { backgroundJobsDisabled } from "@/lib/deployment-flags";
import { getSentryOptions, loadSentry, sentryIntegrations } from "@/lib/sentry-options";

/** One-time server startup: error reporting, diagnostics, and in-process schedulers. */
export async function register() {
  const Sentry = await loadSentry();
  Sentry?.init({ ...getSentryOptions(), integrations: sentryIntegrations(Sentry) });
  const { installAbortDiagnostics } = await import("@/lib/abort-diagnostics");
  installAbortDiagnostics();
  const { installProcessWarningFilter } = await import("@/lib/process-warnings");
  installProcessWarningFilter();
  // `vite dev` would spend provider tokens on every restart and run billing and
  // storage jobs against the development database; use the cron routes there.
  // Staging copies (e.g. canary) opt out with DISABLE_BACKGROUND_JOBS.
  if (process.env.NODE_ENV === "production" && !backgroundJobsDisabled()) {
    const { startModelHealthScheduler } = await import("@/lib/model-health-scheduler");
    startModelHealthScheduler();
    // Vercel (which sets `VERCEL` at runtime) can suspend a function instance
    // mid-run, leaving a billing job's per-user row lock held until its
    // connection drops; deployments there schedule the cron routes instead.
    if (!process.env.VERCEL) {
      const { startBackgroundJobScheduler } = await import("@/lib/background-job-scheduler");
      startBackgroundJobScheduler();
    }
  }
}
