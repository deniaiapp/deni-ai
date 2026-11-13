export const appVersion = "8.0";
/**
 * Release codename. A placeholder until the 8.0 codename is chosen: change it
 * here only (the changelog entry and the version tooltip read this constant).
 */
export const appCodename = "Private Beta";
export const appDate = "2026-11-08";

const appHashPayload = [appVersion, appDate].join(":");
export const appHash = globalThis.btoa(appHashPayload);

export const versions = {
  version: appVersion,
  codename: appCodename,
  date: appDate,
  hash: appHash,
};
