export type DesktopReleaseAsset = {
  name: string;
  browser_download_url: string;
};

export type DesktopRelease = {
  version: string | null;
  releaseUrl: string;
  assets: DesktopReleaseAsset[];
};

export type DesktopDownloads = {
  latestRelease: DesktopRelease;
  prerelease: DesktopRelease | null;
  releasesUrl: string;
};
