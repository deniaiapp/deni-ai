import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { encryptSecretWith } from "../data/secrets";

/**
 * Test-only: a standalone Deni Run SQLite database (the D1 schema as deployed) with a
 * known data set, and a `wrangler d1 export`-style SQL dump of it. Never import this
 * from production code.
 */

const DDL = `
CREATE TABLE \`user\` ( \`id\` text PRIMARY KEY NOT NULL, \`name\` text NOT NULL, \`email\` text NOT NULL, \`email_verified\` integer DEFAULT false NOT NULL, \`image\` text, \`created_at\` integer NOT NULL, \`updated_at\` integer NOT NULL, \`two_factor_enabled\` integer DEFAULT false, \`two_factor_method\` text);
CREATE TABLE \`account\` ( \`id\` text PRIMARY KEY NOT NULL, \`issuer\` text, \`account_id\` text NOT NULL, \`provider_id\` text NOT NULL, \`user_id\` text NOT NULL, \`access_token\` text, \`refresh_token\` text, \`id_token\` text, \`access_token_expires_at\` integer, \`refresh_token_expires_at\` integer, \`scope\` text, \`password\` text, \`created_at\` integer NOT NULL, \`updated_at\` integer NOT NULL );
CREATE TABLE \`user_stores\` ( \`user_id\` text PRIMARY KEY NOT NULL, \`data\` text NOT NULL, \`created_at\` integer NOT NULL, \`updated_at\` integer NOT NULL, \`version\` integer DEFAULT 0 NOT NULL );
CREATE TABLE \`thread_messages\` ( \`user_id\` text NOT NULL, \`thread_id\` text NOT NULL, \`messages\` text NOT NULL, \`updated_at\` integer NOT NULL, PRIMARY KEY(\`user_id\`, \`thread_id\`) );
CREATE TABLE \`agent_jobs\` ( \`id\` text PRIMARY KEY NOT NULL, \`user_id\` text NOT NULL, \`thread_id\` text NOT NULL, \`bot_id\` text NOT NULL, \`kind\` text NOT NULL, \`status\` text NOT NULL, \`payload\` text NOT NULL, \`result\` text, \`checkpoint\` text, \`attempt\` integer DEFAULT 0 NOT NULL, \`max_attempts\` integer DEFAULT 3 NOT NULL, \`idempotency_key\` text NOT NULL, \`error\` text, \`locked_at\` integer, \`heartbeat_at\` integer, \`started_at\` integer, \`finished_at\` integer, \`created_at\` integer NOT NULL, \`updated_at\` integer NOT NULL );
CREATE TABLE \`job_events\` ( \`id\` text PRIMARY KEY NOT NULL, \`user_id\` text NOT NULL, \`job_id\` text NOT NULL, \`kind\` text NOT NULL, \`payload\` text NOT NULL, \`sequence\` integer NOT NULL, \`created_at\` integer NOT NULL );
CREATE TABLE \`job_artifacts\` ( \`id\` text PRIMARY KEY NOT NULL, \`user_id\` text NOT NULL, \`job_id\` text, \`thread_id\` text NOT NULL, \`bot_id\` text, \`path\` text NOT NULL, \`title\` text NOT NULL, \`mime_type\` text DEFAULT 'text/plain' NOT NULL, \`description\` text, \`created_at\` integer NOT NULL, \`updated_at\` integer NOT NULL );
CREATE TABLE \`browser_workspaces\` ( \`id\` text PRIMARY KEY NOT NULL, \`user_id\` text NOT NULL, \`job_id\` text NOT NULL, \`bot_id\` text, \`page_key\` text NOT NULL, \`status\` text DEFAULT 'idle' NOT NULL, \`url\` text, \`title\` text, \`takeover_job_id\` text, \`updated_at\` integer NOT NULL, \`created_at\` integer NOT NULL );
CREATE TABLE \`mcp_connections\` ( \`id\` text PRIMARY KEY NOT NULL, \`user_id\` text NOT NULL, \`name\` text NOT NULL, \`url\` text NOT NULL, \`transport\` text DEFAULT 'streamable-http' NOT NULL, \`auth_secret\` text, \`headers\` text NOT NULL, \`enabled\` integer DEFAULT true NOT NULL, \`last_test_at\` integer, \`last_error\` text, \`created_at\` integer NOT NULL, \`updated_at\` integer NOT NULL, \`oauth\` text, \`catalog_id\` text);
CREATE TABLE \`mcp_explanations\` ( \`user_id\` text NOT NULL, \`tool_call_id\` text NOT NULL, \`locale\` text NOT NULL, \`text\` text NOT NULL, \`created_at\` integer NOT NULL, PRIMARY KEY(\`user_id\`, \`tool_call_id\`, \`locale\`) );
CREATE TABLE \`app_notifications\` ( \`id\` text PRIMARY KEY NOT NULL, \`user_id\` text NOT NULL, \`job_id\` text, \`kind\` text NOT NULL, \`title\` text NOT NULL, \`body\` text NOT NULL, \`read_at\` integer, \`created_at\` integer NOT NULL );
CREATE TABLE \`discord_links\` ( \`user_id\` text PRIMARY KEY NOT NULL, \`discord_user_id\` text NOT NULL, \`discord_username\` text NOT NULL, \`bot_id\` text, \`locale\` text DEFAULT 'en' NOT NULL, \`created_at\` integer NOT NULL );
CREATE TABLE \`discord_link_codes\` ( \`code_hash\` text PRIMARY KEY NOT NULL, \`user_id\` text NOT NULL, \`locale\` text DEFAULT 'en' NOT NULL, \`expires_at\` integer NOT NULL );
CREATE TABLE \`rate_limits\` ( \`key\` text PRIMARY KEY NOT NULL, \`window_start\` integer NOT NULL, \`count\` integer NOT NULL );
`;

export const FIXTURE = {
  /** Linked to an existing Deni AI user. */
  linked: { runUserId: "run-user-1", deniUserId: "deni-1" },
  /** Linked to a Deni AI id that is missing from the target. */
  linkedMissing: { runUserId: "run-user-2", deniUserId: "deni-2" },
  unlinked: { runUserId: "run-user-3" },
  runningJobId: "job_running",
  mcpSecret: "mcp-bearer-secret",
  mcpHeader: "header-secret",
  byokKey: "sk-or-user-key",
};

const T0 = Date.UTC(2026, 9, 1, 9, 0, 0);

function bot(id: string, name: string, memory: { id: string; text: string }[] = []) {
  const at = new Date(T0).toISOString();
  return {
    id,
    name,
    job: `${name} job`,
    instructions: `You are ${name}.`,
    accent: "#7f9bb8",
    icon: null,
    createdAt: at,
    updatedAt: at,
    memory: memory.map((entry) => ({ ...entry, createdAt: at })),
  };
}

function thread(id: string, kind: "dm" | "group", botIds: string[]) {
  const at = new Date(T0).toISOString();
  return { id, kind, title: id, botIds, createdAt: at, updatedAt: at, lastPreview: "hi" };
}

function store(userId: string, apiKey: string) {
  const at = new Date(T0).toISOString();
  return {
    version: 1,
    config: {
      apiKey,
      timezone: "Asia/Tokyo",
      model: "anthropic/claude-sonnet-5.5",
      runMode: "default",
    },
    bots: [
      bot("chief", "Chief", [{ id: "m1", text: "Prefers short answers" }]),
      bot("research", "Research"),
    ],
    threads: [
      thread("dm_chief", "dm", ["chief"]),
      thread("dm_research", "dm", ["research"]),
      thread("group_1", "group", ["chief", "research", "ghost"]),
    ],
    skills: [{ id: "skill_1", name: "Report", body: "# Report", createdAt: at, updatedAt: at }],
    routines: [
      {
        id: "routine_ok",
        botId: "chief",
        threadId: "dm_chief",
        name: "Inbox",
        instructions: "Summarize",
        cron: "0 9 * * 1",
        timezone: "Asia/Tokyo",
        enabled: true,
        lastRunAt: null,
        nextRunAt: "2026-11-09T00:00:00.000Z",
        lastError: null,
        createdAt: at,
        revision: 2,
      },
      {
        id: "routine_orphan",
        botId: "chief",
        threadId: "dm_deleted",
        name: "Orphan",
        instructions: "x",
        cron: "0 9 * * *",
        timezone: "UTC",
        enabled: true,
        lastRunAt: null,
        nextRunAt: null,
        lastError: null,
        createdAt: at,
      },
    ],
    computer: {
      status: "working",
      workingBotId: "chief",
      activeJobId: "job_running",
      workingLabel: "Working",
      url: null,
      title: null,
      lastCommand: null,
      lastError: null,
      screenshotAt: null,
      e2bSandboxId: `sbx_${userId}`,
      steelSessionId: "steel_session",
      steelProfileId: "steel_profile",
      steelDebugUrl: "https://steel.example/debug",
      workspaces: {},
      activity: [],
    },
    shells: [],
    handoffs: [],
    billing: {
      plan: "free",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripeStatus: null,
      currentPeriodEnd: null,
    },
    usage: { month: "2026-10", tokens: 1, browserMs: 0, computerMs: 0 },
    mcpAlwaysAllow: { "mcp_1:search": true },
    historySummaries: {
      dm_chief: { throughMessageId: "m2", text: "Earlier: greetings", updatedAt: at },
    },
    discord: { threadId: "group_1", notify: false },
  };
}

function messages(prefix: string) {
  return [
    { id: `${prefix}-m1`, role: "user", parts: [{ type: "text", text: "Hello" }] },
    {
      id: `${prefix}-m2`,
      role: "assistant",
      metadata: { author: { id: "chief", name: "Chief" } },
      parts: [
        { type: "text", text: "Hi! How can I help?" },
        {
          type: "tool-webSearch",
          toolCallId: "call_1",
          state: "output-available",
          input: { q: "x" },
          output: { ok: true },
        },
      ],
    },
    // Old rows sometimes have no id; the migration gives them the same id the app would.
    { role: "user", parts: [{ type: "text", text: "Thanks" }] },
  ];
}

type Insert = { table: string; values: Record<string, unknown> };

function fixtureRows(sourceKey: Buffer, now: number): Insert[] {
  const enc = (value: string) => encryptSecretWith(sourceKey, value);
  const rows: Insert[] = [];
  const add = (table: string, values: Record<string, unknown>) => rows.push({ table, values });
  const users = [
    FIXTURE.linked.runUserId,
    FIXTURE.linkedMissing.runUserId,
    FIXTURE.unlinked.runUserId,
  ];
  for (const [index, id] of users.entries()) {
    add("user", {
      id,
      name: `User ${index + 1}`,
      email: `${id}@example.com`,
      created_at: T0,
      updated_at: T0,
    });
    add("user_stores", {
      user_id: id,
      data: JSON.stringify(store(id, index === 0 ? enc(FIXTURE.byokKey) : "")),
      created_at: T0,
      updated_at: T0,
    });
    add("thread_messages", {
      user_id: id,
      thread_id: "dm_chief",
      messages: JSON.stringify(messages(id)),
      updated_at: T0,
    });
  }
  add("account", {
    id: "acc1",
    account_id: FIXTURE.linked.deniUserId,
    provider_id: "deni-ai",
    user_id: FIXTURE.linked.runUserId,
    created_at: T0,
    updated_at: T0,
  });
  add("account", {
    id: "acc2",
    account_id: FIXTURE.linkedMissing.deniUserId,
    provider_id: "deni-ai",
    user_id: FIXTURE.linkedMissing.runUserId,
    created_at: T0,
    updated_at: T0,
  });
  add("account", {
    id: "acc3",
    account_id: "google-123",
    provider_id: "google",
    user_id: FIXTURE.unlinked.runUserId,
    created_at: T0,
    updated_at: T0,
  });

  const user = FIXTURE.linked.runUserId;
  add("thread_messages", {
    user_id: user,
    thread_id: "dm_deleted",
    messages: JSON.stringify(messages("gone")),
    updated_at: T0,
  });
  const job = (id: string, status: string) =>
    add("agent_jobs", {
      id,
      user_id: user,
      thread_id: "dm_chief",
      bot_id: "chief",
      kind: "chat",
      status,
      payload: JSON.stringify({ locale: "en", messages: [] }),
      result: status === "completed" ? JSON.stringify({ text: "Done" }) : null,
      checkpoint: JSON.stringify({ step: 1 }),
      attempt: 1,
      max_attempts: 3,
      idempotency_key: `key-${id}`,
      error: status === "failed" ? "boom" : null,
      locked_at: status === "running" ? T0 : null,
      heartbeat_at: status === "running" ? T0 : null,
      started_at: T0,
      finished_at: status === "running" ? null : T0 + 1_000,
      created_at: T0,
      updated_at: T0 + 1_000,
    });
  job("job_done", "completed");
  job("job_failed", "failed");
  job(FIXTURE.runningJobId, "running");
  for (const [jobId, n] of [
    ["job_done", 3],
    [FIXTURE.runningJobId, 2],
  ] as const)
    for (let sequence = 1; sequence <= n; sequence++)
      add("job_events", {
        id: `evt_${jobId}_${sequence}`,
        user_id: user,
        job_id: jobId,
        kind: "checkpoint",
        payload: JSON.stringify({ step: sequence }),
        sequence,
        created_at: T0 + sequence,
      });
  add("job_artifacts", {
    id: "art_1",
    user_id: user,
    job_id: "job_done",
    thread_id: "dm_chief",
    bot_id: "chief",
    path: "outbox/report.md",
    title: "Report",
    mime_type: "text/markdown",
    description: null,
    created_at: T0,
    updated_at: T0,
  });
  add("job_artifacts", {
    id: "art_2",
    user_id: user,
    job_id: FIXTURE.runningJobId,
    thread_id: "dm_chief",
    bot_id: "chief",
    path: "notes/draft.md",
    title: "Draft",
    mime_type: "text/markdown",
    description: "wip",
    created_at: T0,
    updated_at: T0,
  });
  add("browser_workspaces", {
    id: "bw_done",
    user_id: user,
    job_id: "job_done",
    bot_id: "chief",
    page_key: "job_done",
    status: "idle",
    url: "https://example.com",
    title: "Example",
    takeover_job_id: null,
    created_at: T0,
    updated_at: T0,
  });
  add("browser_workspaces", {
    id: "bw_running",
    user_id: user,
    job_id: FIXTURE.runningJobId,
    bot_id: "chief",
    page_key: "job_running",
    status: "takeover",
    url: null,
    title: null,
    takeover_job_id: FIXTURE.runningJobId,
    created_at: T0,
    updated_at: T0,
  });
  add("mcp_connections", {
    id: "mcp_1",
    user_id: user,
    name: "Search",
    url: "https://mcp.example.com/mcp",
    transport: "streamable-http",
    auth_secret: enc(FIXTURE.mcpSecret),
    headers: JSON.stringify({ "X-Api-Key": enc(FIXTURE.mcpHeader) }),
    enabled: 1,
    last_test_at: T0,
    last_error: null,
    created_at: T0,
    updated_at: T0,
    oauth: enc(JSON.stringify({ accessToken: "oauth-token" })),
    catalog_id: null,
  });
  add("mcp_explanations", {
    user_id: user,
    tool_call_id: "call_1",
    locale: "ja",
    text: "検索します",
    created_at: T0,
  });
  add("app_notifications", {
    id: "ntf_1",
    user_id: user,
    job_id: "job_done",
    kind: "completed",
    title: "Chief finished a task",
    body: "Done",
    read_at: null,
    created_at: T0,
  });
  add("discord_links", {
    user_id: user,
    discord_user_id: "discord-1",
    discord_username: "rai",
    bot_id: "chief",
    locale: "ja",
    created_at: T0,
  });
  add("discord_link_codes", {
    code_hash: "hash-valid",
    user_id: user,
    locale: "en",
    expires_at: now + 600_000,
  });
  add("discord_link_codes", {
    code_hash: "hash-expired",
    user_id: user,
    locale: "en",
    expires_at: now - 600_000,
  });
  add("rate_limits", { key: "chat:run-user-1", window_start: T0, count: 3 });
  return rows;
}

function sqlLiteral(value: unknown) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Write the fixture as a SQLite file and as a D1 export (`.sql`) into `dir`.
 * `sourceKey` plays Deni Run's APP_ENCRYPTION_KEY.
 */
export function writeRunFixture(dir: string, sourceKey: Buffer, now = Date.now()) {
  const rows = fixtureRows(sourceKey, now);
  const statements = rows.map(
    ({ table, values }) =>
      `INSERT INTO "${table}" (${Object.keys(values)
        .map((name) => `"${name}"`)
        .join(",")}) VALUES(${Object.values(values).map(sqlLiteral).join(",")});`,
  );
  const sqlitePath = join(dir, "run.sqlite");
  const database = new DatabaseSync(sqlitePath);
  database.exec(DDL);
  database.exec(statements.join("\n"));
  database.close();
  const exportPath = join(dir, "run-export.sql");
  writeFileSync(exportPath, ["PRAGMA defer_foreign_keys=TRUE;", DDL, ...statements].join("\n"));
  return { sqlitePath, exportPath };
}
