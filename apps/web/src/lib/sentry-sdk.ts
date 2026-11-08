/**
 * The Sentry APIs the app uses. `loadSentry()` imports this module instead of
 * the package entry so the bundler can drop what is not listed here (session
 * replay, user feedback), which a dynamic import of the whole package keeps.
 */
export {
  captureException,
  consoleLoggingIntegration,
  init,
  tanstackRouterBrowserTracingIntegration,
} from "@sentry/tanstackstart-react";
