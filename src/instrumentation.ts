import * as Sentry from "@sentry/nextjs";
import { getSentryOptions } from "@/lib/sentry-options";

export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") {
    return;
  }
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }
  Sentry.init(getSentryOptions());
  const { installAbortDiagnostics } = await import("@/lib/abort-diagnostics");
  installAbortDiagnostics();
  const { installProcessWarningFilter } = await import("@/lib/process-warnings");
  installProcessWarningFilter();
  // `next dev` would spend provider tokens on every restart and run billing and
  // storage jobs against the development database; use the cron routes there.
  if (process.env.NODE_ENV === "production") {
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

export const onRequestError = Sentry.captureRequestError;
