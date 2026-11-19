/**
 * Response types worth compressing. Streams the client reads incrementally
 * (chat's text/event-stream, AI SDK text streams) are left alone: gzip buffers
 * output and would hold tokens back.
 */
const COMPRESSIBLE_TYPES = new Set([
  "text/html",
  "text/css",
  "text/xml",
  "application/json",
  "application/javascript",
  "text/javascript",
  "application/xml",
  "application/rss+xml",
  "application/manifest+json",
  "image/svg+xml",
]);

/** Below this a gzip frame saves too little to be worth the CPU. */
const MIN_COMPRESS_BYTES = 1024;

function acceptsGzip(request: Request) {
  const entries = (request.headers.get("accept-encoding") ?? "").toLowerCase().split(",");
  return entries.some((entry) => {
    const [coding, ...params] = entry.split(";").map((part) => part.trim());
    if (coding !== "gzip" && coding !== "*") return false;
    const quality = params.find((param) => param.startsWith("q="));
    return quality === undefined || Number(quality.slice(2)) > 0;
  });
}

/**
 * Gzips dynamic responses (SSR HTML, API JSON) for clients that accept it.
 * Static assets are precompressed at build time (Nitro `compressPublicAssets`).
 */
export function compressResponse(request: Request, response: Response): Response {
  const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  const length = Number(response.headers.get("content-length") ?? Number.NaN);
  if (
    request.method === "HEAD" ||
    !response.body ||
    response.status < 200 ||
    response.status === 204 ||
    response.status === 206 ||
    response.headers.has("content-encoding") ||
    !COMPRESSIBLE_TYPES.has(type) ||
    length < MIN_COMPRESS_BYTES ||
    !acceptsGzip(request)
  ) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("content-encoding", "gzip");
  headers.delete("content-length");
  headers.append("vary", "Accept-Encoding");
  return new Response(response.body.pipeThrough(new CompressionStream("gzip")), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
