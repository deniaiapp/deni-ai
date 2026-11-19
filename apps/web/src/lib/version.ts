export const appVersion = "8.0";
/**
 * Release codename (`pnpm run tools:codename generate`). Change it here only: the
 * changelog entry and the version tooltip read this constant.
 */
export const appCodename = "Crimson Blade";
/** The day v8 replaces v7 on deniai.app; keep the 8.0 changelog entry's date in step. */
export const appDate = "2026-11-19";

const appHashPayload = [appVersion, appDate].join(":");
export const appHash = globalThis.btoa(appHashPayload);

export const versions = {
  version: appVersion,
  codename: appCodename,
  date: appDate,
  hash: appHash,
};
