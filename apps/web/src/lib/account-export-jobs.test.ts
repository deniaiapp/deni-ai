import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  build: vi.fn(async (_userId: string): Promise<unknown> => ({ profile: { id: "user" } })),
  upload: vi.fn(
    async (
      _file: File,
      _key: string,
      _options?: { contentDisposition?: string },
    ): Promise<boolean> => true,
  ),
  // Reports every key as deleted unless a test says otherwise.
  deleteStoredFiles: vi.fn(async (keys: readonly string[]): Promise<string[]> => [...keys]),
}));

vi.mock("@/db/drizzle", () => ({ db: {} }));
vi.mock("@/lib/account-export", () => ({ buildAccountExport: mocks.build }));
vi.mock("@/lib/upload", () => ({
  deleteStoredFiles: mocks.deleteStoredFiles,
  uploadPrivateFile: mocks.upload,
}));

const {
  ACCOUNT_EXPORT_RETENTION_MS,
  ACCOUNT_EXPORT_STALE_MS,
  cleanUpAccountExports,
  collectAccountExportFiles,
  findDownloadableAccountExportKey,
  getLatestAccountExport,
  runAccountExportJob,
  startAccountExport,
} = await import("./account-export-jobs");

const dialect = new PgDialect();
const NOW = new Date("2026-10-11T12:00:00Z");
const MINUTE = 60_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const later = (ms: number) => new Date(NOW.getTime() + ms);

type Row = {
  id: string;
  userId: string;
  status: "pending" | "ready" | "failed";
  storageKey: string | null;
  sizeBytes: number | null;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
  expiresAt: Date | null;
};

const field = (name: string) => name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const time = (value: unknown) => (value === null ? null : new Date(value as string).getTime());

/** Evaluates the `=`, `<>`, `<`, `>` and `in` checks drizzle renders for these queries. */
function matches(row: Row, condition: SQL) {
  const values = row as unknown as Record<string, unknown>;
  const { sql: text, params } = dialect.sqlToQuery(condition);
  const param = (index: string) => params[Number(index) - 1];
  for (const [, column, index] of text.matchAll(/"([a-z_]+)" = \$(\d+)/g)) {
    if (values[field(column)] !== param(index)) return false;
  }
  for (const [, column, index] of text.matchAll(/"([a-z_]+)" <> \$(\d+)/g)) {
    if (values[field(column)] === param(index)) return false;
  }
  for (const [, column, list] of text.matchAll(/"([a-z_]+)" in \(([^)]*)\)/g)) {
    const allowed = [...list.matchAll(/\$(\d+)/g)].map(([, index]) => param(index));
    if (!allowed.includes(values[field(column)])) return false;
  }
  for (const [, column, operator, index] of text.matchAll(/"([a-z_]+)" ([<>]) \$(\d+)/g)) {
    const value = time(values[field(column)]);
    const bound = time(param(index))!;
    if (value === null || (operator === "<" ? !(value < bound) : !(value > bound))) return false;
  }
  return true;
}

function sorted(list: Row[], order: SQL) {
  const [, column, direction] = /"([a-z_]+)" (asc|desc)/.exec(dialect.sqlToQuery(order).sql)!;
  const key = (row: Row) => time(row[field(column) as keyof Row]) ?? 0;
  return list.toSorted((a, b) => (direction === "asc" ? 1 : -1) * (key(a) - key(b)));
}

const pick = (row: Row, fields: Record<string, unknown>) =>
  Object.fromEntries(Object.keys(fields).map((key) => [key, row[key as keyof Row]]));

/**
 * In-memory `account_export` table. Every query yields, so unlocked work would
 * interleave. `failUpdate` makes an update throw, `before` or `after` it applies
 * (a connection lost after the commit).
 */
function createDatabase(
  initial: Partial<Row>[] = [],
  {
    failUpdate = () => undefined,
  }: { failUpdate?: (values: Partial<Row>) => "before" | "after" | undefined } = {},
) {
  const rows: Row[] = initial.map((row, index) => ({
    id: `export-${index}`,
    userId: "user",
    status: "ready",
    storageKey: null,
    sizeBytes: null,
    error: null,
    createdAt: NOW,
    completedAt: null,
    expiresAt: null,
    ...row,
  }));
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const operations = {
    select: (fields: Record<string, unknown>) => ({
      from: () => ({
        where: (condition: SQL) => {
          const read = async (order?: SQL, count = Infinity) => {
            await tick();
            const matched = rows.filter((row) => matches(row, condition));
            return (order ? sorted(matched, order) : matched)
              .slice(0, count)
              .map((row) => pick(row, fields));
          };
          return Object.assign(read(), {
            limit: (count: number) => read(undefined, count),
            orderBy: (order: SQL) => ({ limit: (count: number) => read(order, count) }),
          });
        },
      }),
    }),
    insert: () => ({
      values: (values: Partial<Row>) => ({
        returning: async (fields: Record<string, unknown>) => {
          await tick();
          const row = {
            storageKey: null,
            sizeBytes: null,
            error: null,
            completedAt: null,
            expiresAt: null,
            ...values,
          } as Row;
          rows.push(row);
          return [pick(row, fields)];
        },
      }),
    }),
    update: () => ({
      set: (values: Partial<Row>) => ({
        where: (condition: SQL) => {
          const result = (async () => {
            await tick();
            const failure = failUpdate(values);
            if (failure === "before") throw new Error("Connection refused");
            const matched = rows.filter((row) => matches(row, condition));
            for (const row of matched) Object.assign(row, values);
            if (failure === "after") throw new Error("Connection terminated unexpectedly");
            return matched;
          })();
          return Object.assign(result, {
            returning: async (fields: Record<string, unknown>) =>
              (await result).map((row) => pick(row, fields)),
          });
        },
      }),
    }),
    delete: () => ({
      where: async (condition: SQL) => {
        await tick();
        for (let index = rows.length - 1; index >= 0; index--) {
          if (matches(rows[index], condition)) rows.splice(index, 1);
        }
      },
    }),
  };
  let lock = Promise.resolve();
  const database = {
    ...operations,
    transaction: async <T>(run: (tx: unknown) => Promise<T>) => {
      let release = () => {};
      const tx = {
        ...operations,
        execute: async (statement: SQL) => {
          expect(dialect.sqlToQuery(statement).sql).toContain("pg_advisory_xact_lock");
          const previous = lock;
          lock = previous.then(
            () =>
              new Promise<void>((resolve) => {
                release = resolve;
              }),
          );
          await previous;
        },
      };
      try {
        return await run(tx);
      } finally {
        release();
      }
    },
  };
  return { rows, database: database as never };
}

beforeEach(() => {
  mocks.build.mockReset().mockResolvedValue({ profile: { id: "user" } });
  mocks.upload.mockReset().mockResolvedValue(true);
  mocks.deleteStoredFiles.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

test("only the owner's ready, unexpired export can be downloaded", async () => {
  const { database } = createDatabase([
    { id: "mine", storageKey: "key-mine", expiresAt: later(MINUTE) },
    { id: "expired", storageKey: "key-expired", expiresAt: ago(MINUTE) },
    { id: "building", status: "pending" },
    { id: "theirs", userId: "someone-else", storageKey: "key-theirs", expiresAt: later(MINUTE) },
  ]);
  const download = (id: string, userId = "user") =>
    findDownloadableAccountExportKey(id, userId, { now: NOW }, database);

  expect(await download("mine")).toBe("key-mine");
  // Someone else's export reads like a missing one.
  expect(await download("theirs")).toBeNull();
  expect(await download("expired")).toBeNull();
  expect(await download("building")).toBeNull();
  expect(await download("missing")).toBeNull();
  expect(await download("theirs", "someone-else")).toBe("key-theirs");
});

test("the status shows the latest export, never its storage key, and expiry", async () => {
  const { database } = createDatabase([
    { id: "older", storageKey: "key-older", createdAt: ago(60 * MINUTE), expiresAt: later(1) },
    {
      id: "latest",
      storageKey: "key-latest",
      sizeBytes: 2048,
      createdAt: ago(10 * MINUTE),
      completedAt: ago(9 * MINUTE),
      expiresAt: later(ACCOUNT_EXPORT_RETENTION_MS),
    },
    { id: "theirs", userId: "someone-else", createdAt: NOW },
  ]);
  expect(await getLatestAccountExport("user", { now: NOW }, database)).toEqual({
    id: "latest",
    status: "ready",
    createdAt: ago(10 * MINUTE),
    completedAt: ago(9 * MINUTE),
    expiresAt: later(ACCOUNT_EXPORT_RETENTION_MS),
    sizeBytes: 2048,
  });
  expect(
    await getLatestAccountExport("user", { now: later(ACCOUNT_EXPORT_RETENTION_MS + 1) }, database),
  ).toMatchObject({ id: "latest", status: "expired" });
  expect(await getLatestAccountExport("nobody", { now: NOW }, database)).toBeNull();
});

test("a request returns the export still being built instead of starting another", async () => {
  const { rows, database } = createDatabase([
    { id: "building", status: "pending", createdAt: ago(5 * MINUTE) },
  ]);
  const started = await startAccountExport("user", { now: NOW }, database);
  expect(started).toMatchObject({ created: false, export: { id: "building", status: "pending" } });
  expect(rows).toHaveLength(1);
});

test("concurrent requests start a single export", async () => {
  const { rows, database } = createDatabase();
  const results = await Promise.all(
    Array.from({ length: 3 }, () => startAccountExport("user", { now: NOW }, database)),
  );
  expect(results.filter(({ created }) => created)).toHaveLength(1);
  expect(new Set(results.map((result) => result.export.id)).size).toBe(1);
  expect(rows).toMatchObject([{ userId: "user", status: "pending", createdAt: NOW }]);
  expect(rows[0].id).toMatch(/^[\w-]{32}$/);
});

test("an export pending for over 30 minutes counts as failed and can be retried", async () => {
  const { rows, database } = createDatabase([
    { id: "lost", status: "pending", createdAt: ago(ACCOUNT_EXPORT_STALE_MS + 1) },
  ]);
  expect(await getLatestAccountExport("user", { now: NOW }, database)).toMatchObject({
    id: "lost",
    status: "failed",
  });

  const started = await startAccountExport("user", { now: NOW }, database);
  expect(started).toMatchObject({ created: true, export: { status: "pending" } });
  expect(started.export.id).not.toBe("lost");
  // Marked, so its job can never turn it ready if it finishes after all.
  expect(rows.find((row) => row.id === "lost")).toMatchObject({
    status: "failed",
    error: "interrupted",
  });
});

test("the job stores a private JSON download and replaces the owner's older exports", async () => {
  const createdAt = ago(MINUTE);
  const { rows, database } = createDatabase([
    { id: "job", status: "pending", createdAt },
    { id: "previous", storageKey: "key-previous", createdAt: ago(60 * MINUTE) },
    { id: "failed-before", status: "failed", createdAt: ago(30 * MINUTE) },
    { id: "theirs", userId: "someone-else", storageKey: "key-theirs", createdAt: ago(60 * MINUTE) },
  ]);
  mocks.build.mockResolvedValue({ profile: { id: "user", name: "Ada" } });

  await runAccountExportJob({ id: "job", userId: "user", createdAt }, database);

  expect(mocks.build).toHaveBeenCalledExactlyOnceWith("user");
  const [file, key, options] = mocks.upload.mock.calls[0]!;
  expect(file.name).toBe("deni-ai-export-2026-10-11.json");
  expect(file.type).toBe("application/json");
  expect(JSON.parse(await file.text())).toEqual({ profile: { id: "user", name: "Ada" } });
  // Keyed by its row id, so it can be deleted even if its key is never saved.
  expect(key).toBe("exports/job");
  expect(options).toEqual({ contentDisposition: "attachment" });

  const job = rows.find((row) => row.id === "job")!;
  expect(job).toMatchObject({
    status: "ready",
    storageKey: "exports/job",
    sizeBytes: file.size,
    error: null,
  });
  expect(job.expiresAt!.getTime() - job.completedAt!.getTime()).toBe(ACCOUNT_EXPORT_RETENTION_MS);
  expect(rows.map((row) => row.id)).toEqual(["job", "theirs"]);
  expect(mocks.deleteStoredFiles.mock.calls).toEqual([[["key-previous", "exports/failed-before"]]]);
});

test("a failed job marks its export failed and keeps no file", async () => {
  const { rows, database } = createDatabase([
    { id: "upload", status: "pending" },
    { id: "build", status: "pending" },
  ]);
  mocks.upload.mockResolvedValueOnce(false);
  await runAccountExportJob({ id: "upload", userId: "user", createdAt: NOW }, database);
  mocks.build.mockRejectedValueOnce(new Error("database unavailable"));
  await runAccountExportJob({ id: "build", userId: "user", createdAt: NOW }, database);

  expect(rows).toMatchObject([
    { id: "upload", status: "failed", error: "upload_failed", storageKey: null },
    { id: "build", status: "failed", error: "build_failed", storageKey: null },
  ]);
  expect(rows.every((row) => row.completedAt instanceof Date)).toBe(true);
  expect(mocks.deleteStoredFiles).not.toHaveBeenCalled();
});

test("a job whose export was given up meanwhile deletes the file it stored", async () => {
  const { rows, database } = createDatabase([
    { id: "lost", status: "failed", error: "interrupted", createdAt: ago(40 * MINUTE) },
  ]);
  await runAccountExportJob({ id: "lost", userId: "user", createdAt: ago(40 * MINUTE) }, database);
  expect(rows[0]).toMatchObject({ status: "failed", storageKey: null });
  expect(mocks.deleteStoredFiles).toHaveBeenCalledExactlyOnceWith(["exports/lost"]);

  // Deleted with its account: same.
  mocks.deleteStoredFiles.mockClear();
  await runAccountExportJob({ id: "gone", userId: "user", createdAt: NOW }, database);
  expect(mocks.deleteStoredFiles).toHaveBeenCalledExactlyOnceWith(["exports/gone"]);
});

test("a job that cannot save its export marks it failed and deletes the file", async () => {
  const { rows, database } = createDatabase([{ id: "job", status: "pending" }], {
    failUpdate: (values) => (values.status === "ready" ? "before" : undefined),
  });
  await runAccountExportJob({ id: "job", userId: "user", createdAt: NOW }, database);
  expect(rows[0]).toMatchObject({ status: "failed", error: "save_failed", storageKey: null });
  expect(mocks.deleteStoredFiles).toHaveBeenCalledExactlyOnceWith(["exports/job"]);
});

test("a job keeps its file when its export may have been saved ready", async () => {
  // Saved, but the connection dropped before the result arrived.
  const saved = createDatabase([{ id: "job", status: "pending" }], {
    failUpdate: (values) => (values.status === "ready" ? "after" : undefined),
  });
  await runAccountExportJob({ id: "job", userId: "user", createdAt: NOW }, saved.database);
  expect(saved.rows[0]).toMatchObject({ status: "ready", storageKey: "exports/job" });
  expect(mocks.deleteStoredFiles).not.toHaveBeenCalled();

  // The database is unreachable: the row stays pending without a key, and its
  // file is deleted by the key its id derives with it.
  const down = createDatabase([{ id: "job", status: "pending" }], { failUpdate: () => "before" });
  const unreadable = {
    ...(down.database as object),
    select: () => {
      throw new Error("Connection refused");
    },
  } as never;
  await runAccountExportJob({ id: "job", userId: "user", createdAt: NOW }, unreadable);
  expect(down.rows[0]).toMatchObject({ status: "pending", storageKey: null });
  expect(mocks.deleteStoredFiles).not.toHaveBeenCalled();
});

test("the storage cleanup deletes expired exports and old unfinished ones", async () => {
  const { rows, database } = createDatabase([
    { id: "expired", storageKey: "key-expired", expiresAt: ago(MINUTE) },
    { id: "valid", storageKey: "key-valid", expiresAt: later(MINUTE) },
    { id: "old-failed", status: "failed", createdAt: ago(ACCOUNT_EXPORT_RETENTION_MS + 1) },
    { id: "old-pending", status: "pending", createdAt: ago(ACCOUNT_EXPORT_RETENTION_MS + 1) },
    { id: "recent-failed", status: "failed", createdAt: ago(MINUTE) },
    { id: "stuck", storageKey: "key-stuck", expiresAt: ago(2 * MINUTE) },
  ]);
  // One file fails to delete: its row stays for the next run.
  mocks.deleteStoredFiles.mockImplementationOnce(async (keys) =>
    keys.filter((key) => key !== "key-expired"),
  );

  expect(await cleanUpAccountExports({ now: NOW }, database)).toEqual({ deleted: 3, failed: 1 });
  expect(rows.map((row) => row.id)).toEqual(["expired", "valid", "recent-failed"]);
  expect(mocks.deleteStoredFiles.mock.calls).toEqual([
    [["key-stuck", "key-expired", "exports/old-failed", "exports/old-pending"]],
  ]);
});

test("the storage cleanup is bounded per run", async () => {
  const { rows, database } = createDatabase(
    Array.from({ length: 3 }, (_, index) => ({
      storageKey: `key-${index}`,
      expiresAt: ago((3 - index) * MINUTE),
    })),
  );
  expect(await cleanUpAccountExports({ now: NOW, limit: 2 }, database)).toEqual({
    deleted: 2,
    failed: 0,
  });
  expect(rows.map((row) => row.id)).toEqual(["export-2"]);
});

test("account deletion collects the account's export files", async () => {
  const { database } = createDatabase([
    { id: "ready", storageKey: "key-ready" },
    { id: "building", status: "pending" },
    { id: "theirs", userId: "someone-else", storageKey: "key-theirs" },
  ]);
  expect(await collectAccountExportFiles("user", database)).toEqual([
    "key-ready",
    "exports/building",
  ]);
});
