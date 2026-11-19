/**
 * Dry-run or send sanitized Deni Run data exports (`deni-run-export.json`) by email
 * to unlinked Run accounts that still have meaningful activity.
 *
 *   pnpm --filter @deniai/run email:unlinked-exports -- --source <sqlite|export.sql> [options]
 *
 * Options:
 *   --source <path>              Run SQLite file or `wrangler d1 export` .sql dump (required)
 *   --target-url <url>           Postgres URL for verified-email matching (default: DATABASE_URL)
 *   --match-verified-email       Skip users who match a verified Deni AI account in Postgres
 *   --include-empty              Include unlinked users with only empty/seed data
 *   --out-dir <dir>              Write `<runUserId>-deni-run-export.json` files there
 *   --sent-log <file>            Sent log JSON preventing duplicate sends (default: unlinked-exports-sent.json)
 *   --from <address>             Sender address (default: EMAIL_FROM or "Deni AI <noreply@deniai.app>")
 *   --reply-to <address>         Optional Reply-To address
 *   --send                       Actually send via Cloudflare Email Sending (without it: dry run)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  buildSanitizedUserExport,
  buildUnlinkedExportEmail,
  openSource,
  readSource,
  resolveMigrationTargets,
  summarizeUserActivity,
} from "../src/migration";
import type { RunDatabase } from "../src/runtime";

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const PLACEHOLDER_EMAIL = /\.invalid$/i;

type SentLogEntry = { sentAt: string; messageId: string | null };
type SentLog = Record<string, SentLogEntry>;

function loadSentLog(path: string): SentLog {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as SentLog;
}

function saveSentLog(path: string, log: SentLog) {
  writeFileSync(path, `${JSON.stringify(log, null, 2)}\n`);
}

async function sendViaCloudflare({
  accountId,
  token,
  from,
  to,
  replyTo,
  subject,
  text,
  html,
  attachmentJson,
}: {
  accountId: string;
  token: string;
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
  attachmentJson: string;
}): Promise<{ messageId: string | null }> {
  const payloadBytes = Buffer.byteLength(attachmentJson, "utf8");
  if (payloadBytes > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Export attachment exceeds safe 20 MiB limit (${payloadBytes} bytes)`);
  }
  const body: Record<string, unknown> = {
    from,
    to: [to],
    subject,
    text,
    html,
    attachments: [
      {
        content: Buffer.from(attachmentJson, "utf8").toString("base64"),
        filename: "deni-run-export.json",
        type: "application/json",
        disposition: "attachment",
      },
    ],
  };
  if (replyTo) body.reply_to = replyTo;

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const json = (await response.json()) as {
    success?: boolean;
    errors?: { code: number; message: string }[];
    result?: { message_id?: string };
  };
  if (!response.ok || !json.success || !json.result) {
    const detail =
      json.errors?.map((err) => `${err.code}: ${err.message}`).join("; ") ||
      `${response.status} ${response.statusText}`;
    throw new Error(`Cloudflare Email Sending failed: ${detail}`);
  }
  return { messageId: json.result.message_id ?? null };
}

async function main() {
  const { values } = parseArgs({
    options: {
      source: { type: "string" },
      "target-url": { type: "string" },
      "match-verified-email": { type: "boolean", default: false },
      "include-empty": { type: "boolean", default: false },
      "out-dir": { type: "string" },
      "sent-log": { type: "string", default: "unlinked-exports-sent.json" },
      from: { type: "string" },
      "reply-to": { type: "string" },
      send: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (!values.source) throw new Error("--source is required");
  const sourceDb = openSource(values.source);
  const source = (() => {
    try {
      return readSource(sourceDb);
    } finally {
      sourceDb.close();
    }
  })();

  let matchedRunUserIds = new Set<string>();
  if (values["match-verified-email"]) {
    const targetUrl = values["target-url"] ?? process.env.DATABASE_URL;
    if (!targetUrl) {
      throw new Error("--target-url or DATABASE_URL is required with --match-verified-email");
    }
    const client = postgres(targetUrl, { max: 2, onnotice: () => undefined, prepare: false });
    try {
      const db = drizzle({ client }) as unknown as RunDatabase;
      const resolved = await resolveMigrationTargets({
        source,
        db,
        matchVerifiedEmail: true,
      });
      matchedRunUserIds = new Set(
        resolved.filter((item) => Boolean(item.deniUserId)).map((item) => item.data.user.id),
      );
    } finally {
      await client.end();
    }
  } else {
    matchedRunUserIds = new Set(
      source.users.filter((item) => Boolean(item.deniUserId)).map((item) => item.user.id),
    );
  }

  const sendMode = values.send;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (sendMode && (!accountId || !apiToken)) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required with --send");
  }
  const from =
    values.from?.trim() || process.env.EMAIL_FROM?.trim() || "Deni AI <noreply@deniai.app>";
  const replyTo = values["reply-to"]?.trim() || undefined;
  const sentLogPath = values["sent-log"];
  const sentLog = loadSentLog(sentLogPath);

  if (values["out-dir"]) mkdirSync(values["out-dir"], { recursive: true });

  console.info(
    sendMode
      ? `Sending unlinked Deni Run exports (${source.users.length} total Run users)`
      : `Dry run: preparing unlinked Deni Run exports (${source.users.length} total Run users; pass --send to email)`,
  );

  let plannedCount = 0;
  let sentCount = 0;
  let skippedEmpty = 0;
  let skippedLinked = 0;
  let skippedUnverified = 0;
  let skippedAlreadySent = 0;

  for (const data of source.users) {
    if (matchedRunUserIds.has(data.user.id)) {
      skippedLinked++;
      continue;
    }
    const activity = summarizeUserActivity(data);
    if (!activity.hasActivity && !values["include-empty"]) {
      skippedEmpty++;
      continue;
    }
    const email = data.user.email.trim();
    if (!data.user.emailVerified || !email || PLACEHOLDER_EMAIL.test(email)) {
      skippedUnverified++;
      console.info(`- ${data.user.id}: skipped (unverified or placeholder email)`);
      continue;
    }
    if (sentLog[data.user.id]) {
      skippedAlreadySent++;
      console.info(`- ${data.user.id}: skipped (already in ${sentLogPath})`);
      continue;
    }

    const exported = buildSanitizedUserExport(data);
    const json = `${JSON.stringify(exported, null, 2)}\n`;
    const kb = Math.ceil(Buffer.byteLength(json, "utf8") / 1024);

    if (values["out-dir"]) {
      writeFileSync(join(values["out-dir"], `${data.user.id}-deni-run-export.json`), json);
    }

    plannedCount++;
    if (!sendMode) {
      console.info(
        `- ${data.user.id}: planned (${kb} KB, msgs=${activity.messages}, jobs=${activity.jobs}, artifacts=${activity.artifacts}, customBots=${activity.customTeammates}, mcp=${activity.mcpConnections})`,
      );
      continue;
    }

    const mail = buildUnlinkedExportEmail({
      name: data.user.name,
      activity,
      hasArtifacts: activity.artifacts > 0,
    });
    const { messageId } = await sendViaCloudflare({
      accountId: accountId!,
      token: apiToken!,
      from,
      to: email,
      replyTo,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      attachmentJson: json,
    });
    sentLog[data.user.id] = { sentAt: new Date().toISOString(), messageId };
    saveSentLog(sentLogPath, sentLog);
    sentCount++;
    console.info(`- ${data.user.id}: sent (${kb} KB, messageId=${messageId ?? "ok"})`);
  }

  console.info(
    JSON.stringify({
      sendMode,
      matchedOrLinked: skippedLinked,
      skippedEmpty,
      skippedUnverified,
      skippedAlreadySent,
      planned: plannedCount,
      sent: sentCount,
    }),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
  if (error instanceof Error && error.cause) {
    console.error(
      "Cause:",
      error.cause instanceof Error ? `${error.cause.name}: ${error.cause.message}` : error.cause,
    );
  }
  process.exitCode = 1;
});
