export const appVersion = "7.10";
export const appCodename = "Silver Compass";
export const appDate = "2026-10-17";

const appHashPayload = [appVersion, appDate].join(":");
export const appHash = globalThis.btoa(appHashPayload);

export const versions = {
  version: appVersion,
  codename: appCodename,
  date: appDate,
  hash: appHash,
};
