import { createHmac } from "node:crypto";

/**
 * The parts of the UploadThing API the storage maintenance tools still use,
 * without the `uploadthing` package (removed with the move to R2).
 */

export type UploadThingCredentials = { apiKey: string; appId: string };

/** `apiKey` and `appId` of an UploadThing token (base64 JSON), or `null`. */
export function parseUploadThingToken(token: string | undefined): UploadThingCredentials | null {
  if (!token) return null;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(token, "base64").toString("utf8"));
    if (typeof decoded !== "object" || decoded === null) return null;
    const { apiKey, appId } = decoded as Record<string, unknown>;
    return typeof apiKey === "string" && typeof appId === "string" && /^[a-z0-9]+$/i.test(appId)
      ? { apiKey, appId: appId.toLowerCase() }
      : null;
  } catch {
    return null;
  }
}

const SIGNED_URL_TTL_SECONDS = 600;

/**
 * A signed URL of an UploadThing file, as `UTApi.generateSignedURL` builds it:
 * the URL with its expiry, HMAC-SHA256-signed with the API key. It serves
 * private and public files alike.
 */
export function uploadThingSignedUrl({ apiKey, appId }: UploadThingCredentials, key: string) {
  const url = new URL(`https://${appId}.ufs.sh/f/${encodeURIComponent(key)}`);
  url.searchParams.append("expires", String(Date.now() + SIGNED_URL_TTL_SECONDS * 1000));
  const signature = createHmac("sha256", apiKey).update(url.toString()).digest("hex");
  url.searchParams.append("signature", `hmac-sha256=${signature}`);
  return url.href;
}

export type UploadThingFile = {
  key: string;
  name: string;
  size: number;
  status: string;
  /** Milliseconds since the epoch; 0 when unknown. */
  uploadedAt: number;
};

const LIST_PAGE_SIZE = 500;
const REQUEST_TIMEOUT_MS = 60_000;

/** Every file of the app, as `UTApi.listFiles` pages through them. */
export async function listUploadThingFiles({
  apiKey,
}: UploadThingCredentials): Promise<UploadThingFile[]> {
  const files: UploadThingFile[] = [];
  for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
    const response = await fetch("https://api.uploadthing.com/v6/listFiles", {
      method: "POST",
      headers: { "content-type": "application/json", "x-uploadthing-api-key": apiKey },
      body: JSON.stringify({ limit: LIST_PAGE_SIZE, offset }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(
        `UploadThing listFiles answered ${response.status}: ${await response.text()}`,
      );
    }
    const page = (await response.json()) as { files?: unknown; hasMore?: unknown };
    if (!Array.isArray(page.files)) throw new Error("Unexpected listFiles response");
    for (const file of page.files as Record<string, unknown>[]) {
      if (typeof file.key !== "string") continue;
      const uploadedAt = typeof file.uploadedAt === "number" ? file.uploadedAt : 0;
      files.push({
        key: file.key,
        name: typeof file.name === "string" ? file.name : "",
        size: typeof file.size === "number" ? file.size : 0,
        status: typeof file.status === "string" ? file.status : "unknown",
        // Seconds or milliseconds, depending on the API version.
        uploadedAt: uploadedAt > 0 && uploadedAt < 1e12 ? uploadedAt * 1000 : uploadedAt,
      });
    }
    if (page.hasMore !== true || page.files.length === 0) return files;
  }
}

const DOWNLOAD_TIMEOUT_MS = 120_000;

/** Download one file with the type and name UploadThing serves it with. */
export async function downloadUploadThingFile(credentials: UploadThingCredentials, key: string) {
  const response = await fetch(uploadThingSignedUrl(credentials, key), {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`UploadThing answered ${response.status}`);
  }
  const body = new Uint8Array(await response.arrayBuffer());
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > 0 && length !== body.byteLength) {
    throw new Error(`Truncated download (${body.byteLength} of ${length} bytes)`);
  }
  return {
    body,
    contentType: response.headers.get("content-type"),
    contentDisposition: response.headers.get("content-disposition"),
  };
}
