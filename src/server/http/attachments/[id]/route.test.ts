import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: { session: { userId: "owner" }, user: { isAnonymous: false } } as unknown,
  rows: [] as { id: string; userId: string; storageKey: string | null; status: string }[],
  sign: vi.fn(
    async (key: string, ttl: number) => `https://app.ufs.sh/f/${key}?expires=${ttl}&signature=s`,
  ),
}));

const dialect = new PgDialect();

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => mocks.session } } }));
vi.mock("@/lib/usage", () => ({ getSubscriptionTier: async () => "free" }));
vi.mock("@/lib/upload", () => ({
  ATTACHMENT_FETCH_URL_TTL_SECONDS: 300,
  ATTACHMENT_VIEW_URL_TTL_SECONDS: 600,
  isStorageConfigured: () => true,
  signAttachmentUrl: mocks.sign,
}));
// The real lookup runs against this table, so the owner check is the query's own.
vi.mock("@/db/drizzle", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (condition: SQL) => ({
          limit: async () => {
            const { sql, params } = dialect.sqlToQuery(condition);
            expect(sql).toMatch(/"id" = \$1 and .*"user_id" = \$2 and .*"status" = \$3/);
            return mocks.rows
              .filter(
                (row) =>
                  row.id === params[0] && row.userId === params[1] && row.status === params[2],
              )
              .map(({ storageKey }) => ({ storageKey }));
          },
        }),
      }),
    }),
  },
}));

const { GET, HEAD } = await import("./route");

const OWNED = "o".repeat(32);
const OTHERS = "x".repeat(32);
const PENDING = "p".repeat(32);

function request(id: string, method = "GET") {
  const handler = method === "HEAD" ? HEAD : GET;
  return handler(new Request(`https://app.example/api/attachments/${id}`, { method }), {
    params: { id },
  });
}

beforeEach(() => {
  mocks.session = { session: { userId: "owner" }, user: { isAnonymous: false } };
  mocks.rows = [
    { id: OWNED, userId: "owner", storageKey: "key-owned", status: "ready" },
    { id: OTHERS, userId: "someone-else", storageKey: "key-others", status: "ready" },
    { id: PENDING, userId: "owner", storageKey: null, status: "pending" },
  ];
  mocks.sign.mockClear();
});

function expectPrivate(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
}

test("the owner is redirected to a short-lived signed URL", async () => {
  for (const method of ["GET", "HEAD"]) {
    mocks.sign.mockClear();
    const response = await request(OWNED, method);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://app.ufs.sh/f/key-owned?expires=600&signature=s",
    );
    expectPrivate(response);
    expect(mocks.sign).toHaveBeenCalledWith("key-owned", 600);
  }
});

test("another user's attachment is indistinguishable from a missing one", async () => {
  const others = await request(OTHERS);
  const missing = await request("m".repeat(32));
  for (const response of [others, missing]) {
    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
    expectPrivate(response);
  }
  expect(mocks.sign).not.toHaveBeenCalled();
});

test("unfinished uploads and malformed ids are not served", async () => {
  expect((await request(PENDING)).status).toBe(404);
  expect((await request("key-owned")).status).toBe(404);
  expect((await request("..%2F..%2Fsecret")).status).toBe(404);
  expect(mocks.sign).not.toHaveBeenCalled();
});

test("requests without a session are rejected", async () => {
  mocks.session = null;
  const response = await request(OWNED);
  expect(response.status).toBe(401);
  expectPrivate(response);
  expect(mocks.sign).not.toHaveBeenCalled();
});
