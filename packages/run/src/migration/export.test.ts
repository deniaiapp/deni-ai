import { describe, expect, it } from "vitest";
import { encryptSecretWith } from "../data/secrets";
import {
  buildSanitizedUserExport,
  buildUnlinkedExportEmail,
  summarizeUserActivity,
} from "./export";
import type { SourceUserData } from "./source";

const sourceKey = Buffer.alloc(32, 9);

function makeSourceUser(overrides: Partial<SourceUserData> = {}): SourceUserData {
  return {
    user: {
      id: "run_u1",
      name: "Ken <Alice>",
      email: "ken@example.com",
      emailVerified: true,
    },
    deniUserId: null,
    store: {
      version: 1,
      config: {
        apiKey: encryptSecretWith(sourceKey, "sk-secret-key"),
        timezone: "Asia/Tokyo",
        model: "anthropic/claude-sonnet-5.5",
        runMode: "default",
      },
      bots: [
        {
          id: "chief",
          name: "Chief",
          job: "Coordination",
          instructions: "Lead.",
          accent: "#d4a574",
          icon: null,
          createdAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-01T00:00:00.000Z",
          memory: [
            { id: "m1", text: "Keep replies concise", createdAt: "2026-10-01T00:00:00.000Z" },
          ],
        },
        {
          id: "custom_bot",
          name: "Planner",
          job: "Travel",
          instructions: "Plan trips.",
          accent: "#8fad86",
          icon: null,
          tools: ["web"],
          computerAccess: false,
          createdAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-01T00:00:00.000Z",
          memory: [],
        },
      ],
      threads: [
        {
          id: "dm_chief",
          kind: "dm",
          title: "Chief",
          botIds: ["chief"],
          createdAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-01T00:00:00.000Z",
          lastPreview: "Hi",
        },
      ],
      skills: [
        {
          id: "skill_default",
          name: "Research report",
          body: "# Research report",
          createdAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-01T00:00:00.000Z",
        },
      ],
      routines: [
        {
          id: "rtn_1",
          botId: "chief",
          threadId: "dm_chief",
          name: "Morning brief",
          instructions: "Summarize inbox",
          cron: "0 9 * * *",
          timezone: "Asia/Tokyo",
          enabled: true,
          lastRunAt: null,
          nextRunAt: null,
          lastError: null,
          createdAt: "2026-10-01T00:00:00.000Z",
        },
      ],
      computer: {
        status: "idle",
        workingBotId: null,
        activeJobId: null,
        workingLabel: "",
        url: null,
        title: null,
        lastCommand: null,
        lastError: null,
        screenshotAt: null,
        e2bSandboxId: null,
        steelSessionId: null,
        steelProfileId: null,
        steelDebugUrl: null,
        workspaces: {},
        activity: [],
      },
      shells: [],
      handoffs: [],
    },
    threadMessages: [
      {
        threadId: "dm_chief",
        messages: [
          {
            role: "user",
            parts: [{ type: "text", text: "Hello" }],
          } as never,
        ],
      },
    ],
    jobs: [
      {
        id: "job_1",
        userId: "run_u1",
        threadId: "dm_chief",
        botId: "chief",
        kind: "chat",
        status: "completed",
        payload: { locale: "en" },
        result: { text: "Done" },
        checkpoint: null,
        attempt: 1,
        maxAttempts: 3,
        idempotencyKey: "k1",
        error: null,
        lockedAt: null,
        heartbeatAt: null,
        startedAt: new Date("2026-10-01T00:00:00.000Z"),
        finishedAt: new Date("2026-10-01T00:01:00.000Z"),
        createdAt: new Date("2026-10-01T00:00:00.000Z"),
        updatedAt: new Date("2026-10-01T00:01:00.000Z"),
      },
    ],
    jobEvents: [],
    artifacts: [
      {
        id: "art_1",
        userId: "run_u1",
        jobId: "job_1",
        threadId: "dm_chief",
        botId: "chief",
        path: "outbox/report.md",
        title: "Report",
        mimeType: "text/markdown",
        description: null,
        createdAt: new Date("2026-10-01T00:01:00.000Z"),
        updatedAt: new Date("2026-10-01T00:01:00.000Z"),
      },
    ],
    browserWorkspaces: [],
    mcpConnections: [
      {
        id: "mcp_1",
        userId: "run_u1",
        name: "Private API",
        url: "https://mcp.example.com/mcp",
        transport: "streamable-http",
        authSecret: encryptSecretWith(sourceKey, "mcp-bearer-secret"),
        oauth: encryptSecretWith(sourceKey, JSON.stringify({ accessToken: "oauth-access-token" })),
        catalogId: null,
        headers: { "X-Api-Key": encryptSecretWith(sourceKey, "header-secret") },
        enabled: true,
        lastTestAt: null,
        lastError: null,
        createdAt: new Date("2026-10-01T00:00:00.000Z"),
        updatedAt: new Date("2026-10-01T00:00:00.000Z"),
      },
    ],
    mcpExplanations: [],
    notifications: [],
    discordLink: null,
    discordLinkCodes: [],
    ...overrides,
  };
}

describe("unlinked user export helpers", () => {
  it("distinguishes default-seeded/empty accounts from accounts with activity", () => {
    const empty = makeSourceUser({
      store: {
        ...makeSourceUser().store!,
        config: { apiKey: "", timezone: "UTC", model: "run", runMode: "default" },
        bots: [
          {
            id: "chief",
            name: "Chief",
            job: "",
            instructions: "",
            accent: "#d4a574",
            icon: null,
            createdAt: "2026-10-01T00:00:00.000Z",
            updatedAt: "2026-10-01T00:00:00.000Z",
            memory: [],
          },
        ],
        routines: [],
      },
      threadMessages: [],
      jobs: [],
      artifacts: [],
      mcpConnections: [],
    });

    expect(summarizeUserActivity(empty).hasActivity).toBe(false);

    const active = makeSourceUser();
    expect(summarizeUserActivity(active)).toMatchObject({
      hasActivity: true,
      messages: 1,
      jobs: 1,
      artifacts: 1,
      mcpConnections: 1,
      customTeammates: 1,
      memories: 1,
      routines: 1,
      hasByokKey: true,
    });
  });

  it("builds a portable export strictly free of plaintext or encrypted secrets", () => {
    const source = makeSourceUser();
    const exported = buildSanitizedUserExport(source, new Date("2026-11-19T00:00:00.000Z"));
    const serialized = JSON.stringify(exported);

    expect(exported.settings).toEqual({
      timezone: "Asia/Tokyo",
      model: "anthropic/claude-sonnet-5.5",
      runMode: "default",
    });
    expect(exported.teammates).toHaveLength(2);
    expect(exported.threads[0]?.messages).toHaveLength(1);
    expect(exported.threads[0]?.messages[0]?.id).toMatch(/^legacy-message:0:/);
    expect(exported.mcpConnections).toEqual([
      expect.objectContaining({
        id: "mcp_1",
        name: "Private API",
        url: "https://mcp.example.com/mcp",
      }),
    ]);

    expect(serialized).not.toContain("enc:v1:");
    expect(serialized).not.toContain("sk-secret-key");
    expect(serialized).not.toContain("mcp-bearer-secret");
    expect(serialized).not.toContain("oauth-access-token");
    expect(serialized).not.toContain("header-secret");
    expect(serialized).not.toContain("apiKey");
    expect(serialized).not.toContain("authSecret");
  });

  it("escapes HTML in the email template and includes the workspace files note only when artifacts exist", () => {
    const withFiles = buildUnlinkedExportEmail({
      name: 'Ken <Alice> & "Bob"',
      activity: summarizeUserActivity(makeSourceUser()),
      hasArtifacts: true,
    });
    expect(withFiles.html).toContain("Ken &lt;Alice&gt; &amp; &quot;Bob&quot;");
    expect(withFiles.text).toContain("https://support.deniai.app");

    const withoutFiles = buildUnlinkedExportEmail({
      name: "Bob",
      activity: { ...summarizeUserActivity(makeSourceUser()), artifacts: 0 },
      hasArtifacts: false,
    });
    expect(withoutFiles.text).not.toContain("workspace files");
    expect(withoutFiles.html).not.toContain("support.deniai.app");
  });
});
