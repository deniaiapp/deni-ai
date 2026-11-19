import { normalizeMessageIds } from "../chat/messages";
import type { SourceUserData } from "./source";

const DEFAULT_TEAMMATE_IDS = new Set(["chief", "research", "ops"]);
const DEFAULT_SKILL_NAME = "Research report";

export type UserActivitySummary = {
  hasActivity: boolean;
  messages: number;
  jobs: number;
  artifacts: number;
  mcpConnections: number;
  customTeammates: number;
  memories: number;
  groupThreads: number;
  routines: number;
  customSkills: number;
  hasDiscordLink: boolean;
  hasByokKey: boolean;
};

/** Summarize whether an unlinked Run user has meaningful data beyond initial seeding. */
export function summarizeUserActivity(data: SourceUserData): UserActivitySummary {
  const store = data.store;
  const messages = data.threadMessages.reduce((sum, thread) => sum + thread.messages.length, 0);
  const jobs = data.jobs.length;
  const artifacts = data.artifacts.length;
  const mcpConnections = data.mcpConnections.length;
  const customTeammates = store
    ? store.bots.filter((bot) => !DEFAULT_TEAMMATE_IDS.has(bot.id)).length
    : 0;
  const memories = store ? store.bots.reduce((sum, bot) => sum + bot.memory.length, 0) : 0;
  const groupThreads = store ? store.threads.filter((thread) => thread.kind === "group").length : 0;
  const routines = store ? store.routines.length : 0;
  const customSkills = store
    ? store.skills.filter((skill) => skill.name !== DEFAULT_SKILL_NAME).length
    : 0;
  const hasDiscordLink = Boolean(data.discordLink);
  const hasByokKey = Boolean(store?.config?.apiKey?.trim());

  const hasActivity =
    messages > 0 ||
    jobs > 0 ||
    artifacts > 0 ||
    mcpConnections > 0 ||
    customTeammates > 0 ||
    memories > 0 ||
    groupThreads > 0 ||
    routines > 0 ||
    customSkills > 0 ||
    hasDiscordLink ||
    hasByokKey;

  return {
    hasActivity,
    messages,
    jobs,
    artifacts,
    mcpConnections,
    customTeammates,
    memories,
    groupThreads,
    routines,
    customSkills,
    hasDiscordLink,
    hasByokKey,
  };
}

/**
 * Build a portable JSON export for one Run user. API keys (`apiKey`) and MCP
 * credentials (`authSecret`, `oauth`, `headers`) are strictly omitted so nothing
 * sensitive leaves in email.
 */
export function buildSanitizedUserExport(data: SourceUserData, exportedAt = new Date()) {
  const store = data.store;
  const messagesByThread = new Map(
    data.threadMessages.map((thread) => [thread.threadId, normalizeMessageIds(thread.messages)]),
  );
  const threadIds = new Set((store?.threads ?? []).map((thread) => thread.id));

  const threads = (store?.threads ?? []).map((thread) => ({
    id: thread.id,
    kind: thread.kind,
    title: thread.title,
    icon: thread.icon ?? null,
    pinned: Boolean(thread.pinned),
    archived: Boolean(thread.hidden),
    section: thread.section ?? null,
    reactions: thread.reactions ?? {},
    historySummary: store?.historySummaries?.[thread.id] ?? null,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    messages: messagesByThread.get(thread.id) ?? [],
  }));

  // Preserve messages whose thread metadata row was removed so history is never silently dropped.
  const orphanedThreads = data.threadMessages
    .filter((thread) => !threadIds.has(thread.threadId) && thread.messages.length > 0)
    .map((thread) => ({
      threadId: thread.threadId,
      messages: normalizeMessageIds(thread.messages),
    }));

  return {
    version: 1,
    source: "deni-run",
    exportedAt: exportedAt.toISOString(),
    account: {
      id: data.user.id,
      name: data.user.name,
      email: data.user.email,
    },
    settings: {
      timezone: store?.config?.timezone ?? "UTC",
      model: store?.config?.model ?? null,
      runMode: store?.config?.runMode ?? null,
    },
    teammates: (store?.bots ?? []).map((bot) => ({
      id: bot.id,
      name: bot.name,
      job: bot.job ?? "",
      instructions: bot.instructions ?? "",
      accent: bot.accent,
      icon: bot.icon ?? null,
      tools: Array.isArray(bot.tools) ? bot.tools : null,
      computerAccess: bot.computerAccess ?? true,
      memory: bot.memory ?? [],
      createdAt: bot.createdAt,
      updatedAt: bot.updatedAt,
    })),
    threads,
    ...(orphanedThreads.length ? { orphanedThreads } : {}),
    skills: (store?.skills ?? []).map((skill) => ({
      id: skill.id,
      name: skill.name,
      body: skill.body ?? "",
      createdAt: skill.createdAt,
      updatedAt: skill.updatedAt,
    })),
    routines: (store?.routines ?? []).map((routine) => ({
      id: routine.id,
      botId: routine.botId,
      threadId: routine.threadId,
      name: routine.name,
      instructions: routine.instructions,
      cron: routine.cron,
      timezone: routine.timezone,
      enabled: routine.enabled,
      locale: routine.locale ?? null,
      lastRunAt: routine.lastRunAt,
      nextRunAt: routine.nextRunAt,
      lastError: routine.lastError,
      createdAt: routine.createdAt,
    })),
    jobs: data.jobs.map((job) => ({
      id: job.id,
      threadId: job.threadId,
      botId: job.botId,
      kind: job.kind,
      status: job.status,
      result: job.result,
      error: job.error,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      finishedAt: job.finishedAt?.toISOString() ?? null,
    })),
    artifacts: data.artifacts.map((artifact) => ({
      id: artifact.id,
      jobId: artifact.jobId,
      threadId: artifact.threadId,
      botId: artifact.botId,
      path: artifact.path,
      title: artifact.title,
      mimeType: artifact.mimeType,
      description: artifact.description,
      createdAt: artifact.createdAt.toISOString(),
      updatedAt: artifact.updatedAt.toISOString(),
    })),
    mcpConnections: data.mcpConnections.map((connection) => ({
      id: connection.id,
      name: connection.name,
      url: connection.url,
      transport: connection.transport,
      catalogId: connection.catalogId,
      enabled: connection.enabled,
      createdAt: connection.createdAt.toISOString(),
      updatedAt: connection.updatedAt.toISOString(),
    })),
    notifications: data.notifications.map((notification) => ({
      id: notification.id,
      jobId: notification.jobId,
      kind: notification.kind,
      title: notification.title,
      body: notification.body,
      readAt: notification.readAt?.toISOString() ?? null,
      createdAt: notification.createdAt.toISOString(),
    })),
  };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Build the bilingual notice email carrying `deni-run-export.json` for unlinked users. */
export function buildUnlinkedExportEmail({
  name,
  activity,
  hasArtifacts,
}: {
  name: string;
  activity: UserActivitySummary;
  hasArtifacts: boolean;
}) {
  const displayName = name.trim() || "Deni Run User";
  const escapedName = escapeHtml(displayName);
  const subject = "[Deni Run] Your data export / Deni Run 統合に伴うデータ送付のお知らせ";

  const statsLineJa = `会話メッセージ: ${activity.messages}件 / タスク履歴: ${activity.jobs}件 / カスタムチームメイト: ${activity.customTeammates}人 / スキル: ${activity.customSkills}件 / ルーティン: ${activity.routines}件 / MCP接続: ${activity.mcpConnections}件`;
  const statsLineEn = `Messages: ${activity.messages} | Tasks: ${activity.jobs} | Custom teammates: ${activity.customTeammates} | Custom skills: ${activity.customSkills} | Routines: ${activity.routines} | MCP connections: ${activity.mcpConnections}`;

  const text = [
    `${displayName} 様`,
    "",
    "Deni Run（run.deniai.app）は Deni AI（https://deniai.app/run）に統合されました。",
    "ご利用中の Deni Run アカウントは Deni AI アカウントと未連携だったため、自動移行の対象外となりました。",
    "念のため、お使いいただいていた Deni Run のデータ（deni-run-export.json）を添付にてお送りします。",
    "",
    `・含まれるデータ概要: ${statsLineJa}`,
    "・セキュリティ保護のため、API キーおよび外部コネクタ（MCP）の認証情報・ヘッダーは除外しています。",
    ...(hasArtifacts
      ? [
          `・ワークスペース上の成果物ファイル（${activity.artifacts}件）の取得をご希望の場合は、https://support.deniai.app よりご連絡ください。`,
        ]
      : []),
    "",
    "今後は Deni AI（https://deniai.app/run）にサインインのうえ、サイドバーの「Run」からご利用いただけます。",
    "",
    "------------------------------------------------------------",
    "",
    `Hi ${displayName},`,
    "",
    "Deni Run (run.deniai.app) has unified into Deni AI (https://deniai.app/run).",
    "Because this Deni Run account was not linked to a Deni AI account before the cutover, it was not automatically migrated.",
    "We are sending you an export of your Deni Run data (deni-run-export.json) as an attachment.",
    "",
    `- Summary: ${statsLineEn}`,
    "- For your security, API keys and MCP connector credentials/headers are omitted from this export.",
    ...(hasArtifacts
      ? [
          `- If you need copies of your saved workspace files (${activity.artifacts} item(s)), please contact us at https://support.deniai.app.`,
        ]
      : []),
    "",
    "You can continue using Deni Run inside Deni AI by signing in at https://deniai.app/run.",
  ].join("\n");

  const html = `<!doctype html>
<html lang="ja">
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.65;color:#111827;max-width:640px;margin:0 auto;padding:24px;">
  <p>${escapedName} 様</p>
  <p>Deni Run（run.deniai.app）は <a href="https://deniai.app/run">Deni AI</a> に統合されました。<br>
  ご利用中の Deni Run アカウントは Deni AI アカウントと未連携だったため、自動移行の対象外となりました。念のため、Deni Run のエクスポートデータ（<code>deni-run-export.json</code>）を添付にてお送りします。</p>
  <ul>
    <li>概要: ${escapeHtml(statsLineJa)}</li>
    <li>セキュリティ保護のため、API キーおよび外部コネクタ（MCP）の認証情報・ヘッダーは除外しています。</li>
    ${hasArtifacts ? `<li>ワークスペース上の成果物ファイル（${activity.artifacts}件）の取得をご希望の場合は、<a href="https://support.deniai.app">サポート窓口</a>よりご連絡ください。</li>` : ""}
  </ul>
  <p>今後は <a href="https://deniai.app/run">https://deniai.app/run</a> より引き続きご利用いただけます。</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
  <p>Hi ${escapedName},</p>
  <p>Deni Run (run.deniai.app) has unified into <a href="https://deniai.app/run">Deni AI</a>.<br>
  Because this Deni Run account was not linked to a Deni AI account, it was not automatically migrated. We attached a JSON export of your Deni Run data (<code>deni-run-export.json</code>).</p>
  <ul>
    <li>Summary: ${escapeHtml(statsLineEn)}</li>
    <li>For your security, API keys and MCP connector credentials/headers are omitted.</li>
    ${hasArtifacts ? `<li>If you need copies of your saved workspace files (${activity.artifacts} item(s)), please contact us at <a href="https://support.deniai.app">support.deniai.app</a>.</li>` : ""}
  </ul>
  <p>You can continue using Deni Run by signing in at <a href="https://deniai.app/run">https://deniai.app/run</a>.</p>
</body>
</html>`;

  return { subject, text, html };
}
