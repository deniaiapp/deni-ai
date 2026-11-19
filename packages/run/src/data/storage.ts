import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { primeStorageKey, userStorageKey } from "./paths";
import { runConfig } from "../runtime";

type S3Config = {
  bucket: string;
  client: S3Client;
};

let cachedConfig: S3Config | null | undefined;

function normalizeS3Endpoint(endpoint: string, bucket: string) {
  try {
    const url = new URL(endpoint);
    const path = url.pathname.replace(/\/+$/, "");
    if (path === `/${bucket}`) url.pathname = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return endpoint.replace(/\/+$/, "");
  }
}

function isMissingObjectError(error: unknown) {
  const err = error as {
    name?: string;
    Code?: string;
    code?: string;
    message?: string;
    $metadata?: { httpStatusCode?: number };
  };
  const code = err.Code || err.code || err.name;
  const status = err.$metadata?.httpStatusCode;
  return (
    status === 404 ||
    code === "NoSuchKey" ||
    code === "NotFound" ||
    /NoSuchKey|specified key does not exist/i.test(err.message ?? "")
  );
}

function getS3Config(): S3Config | null {
  if (cachedConfig !== undefined) return cachedConfig;
  const config = runConfig().s3;
  if (!config) {
    cachedConfig = null;
    return null;
  }
  const endpoint = config.endpoint
    ? normalizeS3Endpoint(config.endpoint, config.bucket)
    : undefined;
  let r2 = false;
  try {
    r2 = endpoint ? /r2\.cloudflarestorage\.com$/i.test(new URL(endpoint).host) : false;
  } catch {
    r2 = false;
  }
  cachedConfig = {
    bucket: config.bucket,
    client: new S3Client({
      ...(endpoint ? { endpoint } : {}),
      region: config.region,
      forcePathStyle: config.forcePathStyle || r2,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    }),
  };
  return cachedConfig;
}

export function hasObjectStorage() {
  return getS3Config() !== null;
}

function objectKey(userId: string, suffix: string) {
  const normalized = suffix.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!normalized || normalized.includes("..") || normalized.includes("\0")) {
    throw new Error("Invalid object path");
  }
  return `users/${userStorageKey(userId)}/${normalized}`;
}

export async function putUserObject(
  userId: string,
  suffix: string,
  body: Uint8Array | Buffer | string,
  contentType = "application/octet-stream",
  options?: { ifMatch?: string; ifNoneMatch?: string },
) {
  await primeStorageKey(userId);
  const config = getS3Config();
  if (!config) return false;
  await config.client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: objectKey(userId, suffix),
      Body: body,
      ContentType: contentType,
      IfMatch: options?.ifMatch,
      IfNoneMatch: options?.ifNoneMatch,
    }),
  );
  return true;
}

export async function getUserObject(userId: string, suffix: string) {
  await primeStorageKey(userId);
  const config = getS3Config();
  if (!config) return null;
  try {
    const result = await config.client.send(
      new GetObjectCommand({ Bucket: config.bucket, Key: objectKey(userId, suffix) }),
    );
    if (!result.Body) return null;
    const body = result.Body as {
      transformToByteArray?: () => Promise<Uint8Array>;
    } & AsyncIterable<Uint8Array>;
    if (typeof body.transformToByteArray === "function") {
      return Buffer.from(await body.transformToByteArray());
    }
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch (error) {
    if (isMissingObjectError(error)) return null;
    throw error;
  }
}

export function objectSuffixFromKey(userId: string, key: string) {
  const prefix = `users/${userStorageKey(userId)}/`;
  if (!key.startsWith(prefix)) return null;
  return key.slice(prefix.length) || null;
}

export async function listUserObjects(userId: string, suffixPrefix: string) {
  await primeStorageKey(userId);
  const config = getS3Config();
  if (!config) return [];
  const prefix = suffixPrefix
    ? objectKey(userId, suffixPrefix)
    : `users/${userStorageKey(userId)}/`;
  const objects: { key: string; size: number; etag?: string }[] = [];
  let continuationToken: string | undefined;
  do {
    const result = await config.client.send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const item of result.Contents ?? []) {
      if (item.Key) objects.push({ key: item.Key, size: item.Size ?? 0, etag: item.ETag });
    }
    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (continuationToken);
  return objects;
}

export async function deleteUserObjects(userId: string, suffixes: string[]) {
  await primeStorageKey(userId);
  const config = getS3Config();
  if (!config || suffixes.length === 0) return;
  const keys = suffixes.map((suffix) => ({ Key: objectKey(userId, suffix) }));
  for (let offset = 0; offset < keys.length; offset += 1000) {
    await config.client.send(
      new DeleteObjectsCommand({
        Bucket: config.bucket,
        Delete: { Objects: keys.slice(offset, offset + 1000) },
      }),
    );
  }
}

export async function deleteAllUserStorage(userId: string) {
  await primeStorageKey(userId);
  const objects = await listUserObjects(userId, "");
  const suffixes = objects
    .map((item) => objectSuffixFromKey(userId, item.key))
    .filter((suffix): suffix is string => Boolean(suffix));
  await deleteUserObjects(userId, suffixes);
}

export async function deleteUserObject(userId: string, suffix: string) {
  await primeStorageKey(userId);
  const config = getS3Config();
  if (!config) return;
  await config.client.send(
    new DeleteObjectCommand({ Bucket: config.bucket, Key: objectKey(userId, suffix) }),
  );
}
