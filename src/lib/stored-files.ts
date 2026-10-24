import { AwsClient } from "aws4fetch";

/**
 * Env-free access to the Cloudflare R2 bucket that holds private files, shared
 * by the app (`@/lib/upload`) and the maintenance tools, which do not load the
 * app's environment validation.
 */

export type StorageConfig = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

type StorageEnv = Partial<
  Record<"R2_ACCOUNT_ID" | "R2_ACCESS_KEY_ID" | "R2_SECRET_ACCESS_KEY" | "R2_BUCKET", string>
>;

/** The R2 settings of `source`, or `null` unless all of them are set and well-formed. */
export function storageConfigFrom(source: StorageEnv): StorageConfig | null {
  const {
    R2_ACCOUNT_ID: accountId,
    R2_ACCESS_KEY_ID: accessKeyId,
    R2_SECRET_ACCESS_KEY: secretAccessKey,
    R2_BUCKET: bucket,
  } = source;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  // Both end up in the storage URL: no host or path injection.
  if (!/^[a-z0-9]+$/i.test(accountId) || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(bucket)) return null;
  return { accountId: accountId.toLowerCase(), accessKeyId, secretAccessKey, bucket };
}

/**
 * Storage keys derive from row ids, so a file whose key never reached the
 * database (crash, lost response) can still be deleted with its row.
 */
export function attachmentStorageKey(id: string): string {
  return `attachments/${id}`;
}

export function exportStorageKey(id: string): string {
  return `exports/${id}`;
}

/** Deletes in flight at once (R2 deletes objects one request at a time here). */
const DELETE_CONCURRENCY = 10;
const REQUEST_TIMEOUT_MS = 30_000;

export type StoredObjectOptions = {
  contentType: string;
  /** Served with signed URLs; see `contentDispositionHeader`. */
  contentDisposition?: string;
};

/** `Content-Disposition` with an ASCII fallback name and the exact UTF-8 one. */
export function contentDispositionHeader(type: "inline" | "attachment", fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export type FileStorage = ReturnType<typeof createFileStorage>;

/** A client for the private R2 bucket of `config` (S3 API, SigV4-signed). */
export function createFileStorage(config: StorageConfig) {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: "auto",
    retries: 3,
  });
  const origin = `https://${config.accountId}.r2.cloudflarestorage.com`;
  const bucketPath = `/${config.bucket}/`;
  const objectUrl = (key: string) =>
    `${origin}${bucketPath}${key.split("/").map(encodeURIComponent).join("/")}`;

  return {
    /** Store a private object. Throws when R2 does not accept it. */
    async put(
      key: string,
      body: Blob | Uint8Array<ArrayBuffer>,
      { contentType, contentDisposition }: StoredObjectOptions,
    ): Promise<void> {
      const headers: Record<string, string> = { "content-type": contentType };
      if (contentDisposition) headers["content-disposition"] = contentDisposition;
      const data = body instanceof Blob ? new Uint8Array(await body.arrayBuffer()) : body;
      const response = await client.fetch(objectUrl(key), {
        method: "PUT",
        headers,
        body: data,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      await response.body?.cancel();
      if (!response.ok) throw new Error(`R2 rejected the upload (${response.status})`);
    },

    /** Whether an object exists. Throws when R2 cannot tell. */
    async exists(key: string): Promise<boolean> {
      const response = await client.fetch(objectUrl(key), {
        method: "HEAD",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 404) return false;
      if (!response.ok) throw new Error(`R2 could not check an object (${response.status})`);
      return true;
    },

    /** A presigned GET URL. Signing is local (no request to R2). */
    async sign(key: string, expiresInSeconds: number): Promise<string> {
      const url = new URL(objectUrl(key));
      url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
      const signed = await client.sign(new Request(url, { method: "GET" }), {
        aws: { signQuery: true },
      });
      return signed.url;
    },

    /**
     * Delete objects. Returns the keys that are gone (a key already missing
     * counts as deleted). Never throws: a failed delete is logged and left out.
     */
    async delete(keys: readonly string[]): Promise<string[]> {
      const unique = [...new Set(keys.filter(Boolean))];
      const deleted: string[] = [];
      let failed = 0;
      let next = 0;
      async function worker() {
        while (next < unique.length) {
          const key = unique[next++] as string;
          try {
            const response = await client.fetch(objectUrl(key), {
              method: "DELETE",
              signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
            await response.body?.cancel();
            if (!response.ok && response.status !== 404) {
              throw new Error(`R2 rejected the delete (${response.status})`);
            }
            deleted.push(key);
          } catch (error) {
            failed++;
            if (failed === 1) console.error("[storage] Failed to delete a stored file:", error);
          }
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(DELETE_CONCURRENCY, unique.length) }, worker),
      );
      if (failed > 0) console.error(`[storage] Failed to delete ${failed} stored file(s)`);
      return deleted;
    },

    /**
     * Whether a URL points into this bucket (a signed URL of one of its files).
     * Message parts come from the client, so any other URL must not be fetched
     * or treated as one of ours.
     */
    isFileUrl(url: URL): boolean {
      return (
        url.protocol === "https:" &&
        url.origin === origin &&
        url.pathname.startsWith(bucketPath) &&
        url.pathname.length > bucketPath.length
      );
    },
  };
}
