import { expect, test } from "vitest";
import { getQueryClient, shouldRetryQuery } from "./query-client";

test("rate-limited queries are not retried inside the same window", () => {
  // The shape of a tRPC client error for a procedure's TOO_MANY_REQUESTS.
  const rateLimited = { data: { code: "TOO_MANY_REQUESTS", httpStatus: 429 } };
  expect(shouldRetryQuery(0, rateLimited)).toBe(false);
  // A 429 from outside tRPC's error shape is refused the same way.
  expect(shouldRetryQuery(0, { data: { httpStatus: 429 } })).toBe(false);
});

test("other failures keep React Query's three browser retries", () => {
  const serverError = { data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } };
  expect(shouldRetryQuery(0, serverError)).toBe(true);
  expect(shouldRetryQuery(2, serverError)).toBe(true);
  expect(shouldRetryQuery(3, serverError)).toBe(false);
  expect(shouldRetryQuery(0, new TypeError("Failed to fetch"))).toBe(true);
  expect(shouldRetryQuery(0, null)).toBe(true);
});

test("server-rendered queries are never retried", () => {
  expect(getQueryClient().getDefaultOptions().queries?.retry).toBe(false);
});
