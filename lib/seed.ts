import type { Bot, Store, Thread } from "./types";
import { createId, nowIso } from "./ids";
import { defaultTimezone } from "./paths";
import { DENI_MODEL_ID } from "./model";

function bot(id: string, name: string, job: string, instructions: string, accent: string): Bot {
  const at = nowIso();
  return {
    id,
    name,
    job,
    instructions,
    accent,
    createdAt: at,
    updatedAt: at,
    memory: [],
  };
}

export function seedBots(): Bot[] {
  return [
    bot(
      "chief",
      "Chief",
      "Team coordination",
      [
        "You are Deni Run's chief of staff.",
        "Organize the user's priorities, delegate research to Research, and execution to Operations.",
        "Handle anything you can investigate yourself, and ask for confirmation only when a decision is needed.",
        "Keep results concise and make the next step clear.",
      ].join("\n"),
      "#d4a574",
    ),
    bot(
      "research",
      "Research",
      "Research and reports",
      [
        "You are Deni Run's researcher.",
        "Open official pages in the browser and research with sources.",
        "Separate conclusions, evidence, and unverified points.",
        "Save deliverables in projects/ or outbox/ in the workspace.",
      ].join("\n"),
      "#8fad86",
    ),
    bot(
      "ops",
      "Operations",
      "Computer execution",
      [
        "You are Deni Run's operations teammate.",
        "Complete hands-on work with files, the terminal, and the browser.",
        "Wait for approval before destructive actions, sending, publishing, or purchases.",
        "Request takeover when login or 2FA is required.",
      ].join("\n"),
      "#7f9bb8",
    ),
  ];
}

export function seedThreads(bots: Bot[]): Thread[] {
  const at = nowIso();
  return bots.map((item) => ({
    id: `dm_${item.id}`,
    kind: "dm" as const,
    title: item.name,
    botIds: [item.id],
    createdAt: at,
    updatedAt: at,
    lastPreview: "Send me a task",
    pinned: false,
    unread: false,
    hidden: false,
    section: null,
  }));
}

export function emptyStore(): Store {
  const bots = seedBots();
  return {
    version: 1,
    config: {
      apiKey: "",
      timezone: defaultTimezone(),
      model: DENI_MODEL_ID,
      runMode: "default",
    },
    bots,
    threads: seedThreads(bots),
    skills: [
      {
        id: createId("skill"),
        name: "Research report",
        body: [
          "# Research report",
          "",
          "Use when: The user asks for comparison, market, or specification research.",
          "Steps:",
          "1. Break down the question",
          "2. Open official pages and primary sources in the browser",
          "3. Record and verify source URLs",
          "4. Write a Markdown file in outbox/ separated into conclusion / evidence / unverified",
          "5. Return a summary and file path in the conversation",
          "Approval: Do not post externally or send email.",
        ].join("\n"),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      },
    ],
    routines: [],
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
    billing: {
      plan: "free",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripeStatus: null,
      currentPeriodEnd: null,
    },
    usage: {
      month: `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}`,
      tokens: 0,
      browserMs: 0,
      computerMs: 0,
    },
  };
}

export const WORKSPACE_README = `# Deni Run Workspace

This folder is the shared computer workspace for all teammates.

- inbox/     Incoming materials
- projects/  Work in progress
- outbox/    Completed deliverables

Login sessions and browser cookies remain on this computer.
Never put passwords in chat; enter them through the "Take control" screen.
`;
