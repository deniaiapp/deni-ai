import { gunzipSync } from "node:zlib";
import { expect, test } from "vitest";
import { compressResponse } from "./compression";

const html = `<!doctype html><html><body>${"Deni AI ".repeat(500)}</body></html>`;

function request(acceptEncoding?: string, method = "GET") {
  return new Request("http://localhost/about", {
    method,
    headers: acceptEncoding ? { "accept-encoding": acceptEncoding } : {},
  });
}

function htmlResponse(body = html, headers: Record<string, string> = {}) {
  return new Response(body, {
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
  });
}

test("HTML is gzipped for clients that accept it, and decodes to the same body", async () => {
  const response = compressResponse(request("gzip, deflate, br"), htmlResponse());
  expect(response.headers.get("content-encoding")).toBe("gzip");
  expect(response.headers.get("vary")).toContain("Accept-Encoding");
  const body = Buffer.from(await response.arrayBuffer());
  expect(gunzipSync(body).toString()).toBe(html);
  expect(body.length).toBeLessThan(html.length);
});

test.each([
  ["no Accept-Encoding", request(), htmlResponse()],
  ["gzip refused with q=0", request("gzip;q=0, br"), htmlResponse()],
  ["HEAD requests", request("gzip", "HEAD"), htmlResponse()],
  [
    "event streams, which must reach the client chunk by chunk",
    request("gzip"),
    new Response(html, { headers: { "content-type": "text/event-stream" } }),
  ],
  ["already encoded bodies", request("gzip"), htmlResponse(html, { "content-encoding": "br" })],
  ["tiny bodies", request("gzip"), htmlResponse("ok", { "content-length": "2" })],
  ["empty responses", request("gzip"), new Response(null, { status: 204 })],
])("leaves %s untouched", (_label, req, res) => {
  expect(compressResponse(req, res)).toBe(res);
});
