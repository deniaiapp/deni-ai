export const appVersion = "8.0";
/**
 * Release codename. A placeholder until the 8.0 codename is chosen: change it
 * here only (the changelog entry and the version tooltip read this constant).
 */
export const appCodename = "Private Beta";
export const appDate = "2026-11-08";
/** Shows the "Beta" label next to the app name in the sidebar; turn off at general release. */
export const appIsBeta = true;

const appHashPayload = [appVersion, appDate].join(":");
export const appHash = globalThis.btoa(appHashPayload);

export const versions = {
  version: appVersion,
  codename: appCodename,
  date: appDate,
  hash: appHash,
};
