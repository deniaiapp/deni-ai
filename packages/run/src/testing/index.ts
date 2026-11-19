import { PGlite } from "@electric-sql/pglite";
import * as schema from "@deniai/db";
import { publicMigrationsFolder } from "@deniai/db/paths";
import { createUsageEngine } from "@deniai/billing/server";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import {
  configureRun,
  loadRunConfig,
  type RunConfig,
  type RunDatabase,
  type RunDeps,
} from "../runtime";
import { runUsageBinding } from "../usage-binding";

/**
 * Test-only helpers (`@deniai/run/testing`): an isolated PostgreSQL/WASM database with
 * the real `public` migrations plus the `run_*` tables, and a configured runtime. Never
 * import this from production code.
 */
export type RunTestDb = { pglite: PGlite; db: PgliteDatabase<typeof schema> };

/** The `run_*` tables are created from the TypeScript schema when no migration has them yet. */
async function createRunTables(pglite: PGlite) {
  const existing = await pglite.query<{ name: string | null }>(
    `SELECT to_regclass('public.run_settings')::text AS name`,
  );
  if (existing.rows[0]?.name) return;
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  const all = schema as unknown as Record<string, unknown>;
  const withoutRun = Object.fromEntries(
    Object.entries(all).filter(([name]) => !name.startsWith("run")),
  );
  const statements = await generateMigration(
    generateDrizzleJson(withoutRun),
    generateDrizzleJson(all),
  );
  for (const statement of statements) await pglite.exec(statement);
}

export async function createRunTestDb(): Promise<RunTestDb> {
  const pglite = new PGlite();
  await pglite.exec("SET TIME ZONE 'UTC'");
  const db = drizzle({ client: pglite, schema });
  await migrate(db, { migrationsFolder: publicMigrationsFolder });
  await createRunTables(pglite);
  return { pglite, db };
}

const RUN_TABLES = [
  "run_job_events",
  "run_jobs",
  "run_artifacts",
  "run_messages",
  "run_routines",
  "run_thread_participants",
  "run_threads",
  "run_teammate_memories",
  "run_teammates",
  "run_skills",
  "run_settings",
  "run_browser_workspaces",
  "run_mcp_connections",
  "run_mcp_explanations",
  "run_notifications",
  "run_discord_links",
  "run_discord_link_codes",
  "product_usage",
  "usage_quota",
  "usage_reservation",
  "billing",
  `"user"`,
];

export async function resetRunTables(pglite: PGlite) {
  await pglite.exec(`TRUNCATE ${RUN_TABLES.join(", ")} CASCADE`);
}

export async function seedTestUser(pglite: PGlite, id: string) {
  await pglite.query(
    `INSERT INTO "user" (id, name, email, email_verified) VALUES ($1, $1, $2, true)`,
    [id, `${id}@example.com`],
  );
}

/** A test configuration: no providers, a fixed key, a temporary local data dir. */
export function testRunConfig(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    ...loadRunConfig({ RUN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") }),
    localDataDir: ".deni-test",
    ...overrides,
  };
}

/** Configure the runtime against a test database with the real usage engine. */
export function configureRunForTest(
  testDb: RunTestDb,
  overrides: Partial<Omit<RunDeps, "db" | "config">> & { config?: Partial<RunConfig> } = {},
) {
  const engine = createUsageEngine({ db: testDb.db });
  const deps: RunDeps = {
    db: testDb.db as unknown as RunDatabase,
    usage: overrides.usage ?? runUsageBinding(engine),
    config: testRunConfig(overrides.config),
    logger: overrides.logger ?? {
      error: () => undefined,
      warn: () => undefined,
      info: () => undefined,
    },
    onNotification: overrides.onNotification,
    computer: overrides.computer,
    languageModel: overrides.languageModel,
  };
  configureRun(deps);
  return { deps, engine };
}

type StreamPart =
  Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer T>
    ? T
    : never;

type MockUsage = { inputTokens: number; outputTokens: number };

function v4Usage({ inputTokens, outputTokens }: MockUsage) {
  return {
    inputTokens: { total: inputTokens, noCache: inputTokens, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: outputTokens, text: outputTokens, reasoning: 0 },
  };
}

/**
 * A language model that answers every call with `text` and reports `costUsd` the way
 * OpenRouter does (`providerMetadata.openrouter.usage.cost`). `onCall` runs before each
 * answer (e.g. to cancel the job mid-run).
 */
export function mockTextModel(
  text: string,
  options: { costUsd?: number; onCall?: () => Promise<void> | void } = {},
) {
  const providerMetadata = { openrouter: { usage: { cost: options.costUsd ?? 0 } } };
  const usage = v4Usage({ inputTokens: 100, outputTokens: 20 });
  return new MockLanguageModelV4({
    doGenerate: async () => {
      await options.onCall?.();
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        providerMetadata,
        warnings: [],
      };
    },
    doStream: async () => {
      await options.onCall?.();
      return {
        stream: convertArrayToReadableStream<StreamPart>([
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: text },
          { type: "text-end", id: "t1" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage,
            providerMetadata,
          },
        ]),
      };
    },
  });
}
