export const appVersion = "7.11";
export const appCodename = "Thunder Dragon";
export const appDate = "2026-10-29";

const appHashPayload = [appVersion, appDate].join(":");
export const appHash = globalThis.btoa(appHashPayload);

export const versions = {
  version: appVersion,
  codename: appCodename,
  date: appDate,
  hash: appHash,
};
