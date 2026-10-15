import dotenv from "dotenv";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mockModules } from "./module-mocks";

dotenv.config({ path: ".env", quiet: true });
dotenv.config({ path: ".env.local", override: true, quiet: true });

mockModules((request) => {
  if (request === "@tanstack/react-start/server-only") return {};
  if (request === "@tanstack/react-start/server") return { getRequestHeaders: () => new Headers() };
  return undefined;
});

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

let tempDir = "";

// The GitHub plugin's list, review, merge, and close operations must call the right endpoints,
// trim list results, and stay out of the Google plugins.
async function main() {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "deni-github-"));
  delete process.env.D1_PROXY_URL;
  process.env.LOCAL_DB_PATH = path.join(tempDir, "test.sqlite");
  process.env.BETTER_AUTH_SECRET ||= "verify-plugin-secret-verify-plugin-secret";
  process.env.BETTER_AUTH_URL ||= "http://localhost:3000";
  process.env.DISABLED_PLUGINS = "";

  const { db } = await import("../db");
  const { user, account } = await import("../db/schema");
  const plugins = await import("../lib/builtin-plugins");
  const { isReadAction } = await import("../lib/plugin-actions");

  const userId = "github-user";
  await db.insert(user).values({ id: userId, name: "G", email: "g@example.com", emailVerified: true });
  await db.insert(account).values({ id: "a-github", accountId: "h1", providerId: "github", userId, scope: "user:email,repo", accessToken: "h-access" });

  const calls: { url: string; method: string; body: string }[] = [];
  const issue = { number: 7, title: "Bug", state: "open", html_url: "https://github.com/o/r/issues/7", user: { login: "a" }, labels: [{ name: "bug" }], assignees: [], comments: 2, body: "long body" };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", body: String(init?.body ?? "") });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (url.includes("/rerun-failed-jobs")) return new Response(null, { status: 201 });
    if (url.includes("/merge")) return json({ merged: true, sha: "abc" });
    if (url.includes("/reviews")) return json({ id: 1, state: "APPROVED", html_url: "https://github.com/o/r/pull/7#r1" });
    if (url.includes("/requested_reviewers")) return json({}, 201);
    if (url.includes("/actions/runs")) return json({ workflow_runs: [{ id: 99, name: "CI", head_branch: "main", status: "completed", conclusion: "failure", html_url: "u" }] });
    if (url.includes("/issues/7") && init?.method === "PATCH") return json({ ...issue, ...JSON.parse(String(init.body)) });
    if (url.includes("/issues?")) return json([issue, { ...issue, number: 8, pull_request: {} }]);
    return json({});
  }) as typeof fetch;
  const last = () => calls[calls.length - 1];

  const list = await plugins.runPlugin(userId, "github", "listIssues", { repo: "o/r", state: "all", labels: ["bug", "p1"], page: 2 }) as { number: number; pullRequest?: boolean; body?: string }[];
  const listUrl = new URL(last().url);
  assert(listUrl.pathname === "/repos/o/r/issues" && listUrl.searchParams.get("state") === "all" && listUrl.searchParams.get("labels") === "bug,p1" && listUrl.searchParams.get("page") === "2", `listIssues url: ${last().url}`);
  assert(list.length === 2 && list[1].pullRequest === true && list[0].body === undefined, `listIssues result: ${JSON.stringify(list)}`);

  const closed = await plugins.runPlugin(userId, "github", "updateIssue", { repo: "o/r", id: "7", state: "closed", stateReason: "not_planned", reviewers: ["b"] }) as { state: string; requestedReviewers?: string[] };
  const patch = calls.find((call) => call.method === "PATCH")!;
  assert(patch.url.endsWith("/repos/o/r/issues/7") && JSON.parse(patch.body).state === "closed" && JSON.parse(patch.body).state_reason === "not_planned", `close: ${JSON.stringify(patch)}`);
  assert(last().url.endsWith("/pulls/7/requested_reviewers") && closed.state === "closed" && closed.requestedReviewers?.join() === "b", `reviewers: ${JSON.stringify(last())}`);
  const before = calls.length;
  const nothing = await plugins.runPlugin(userId, "github", "updateIssue", { repo: "o/r", id: "7" }).then(() => false, () => true);
  assert(nothing && calls.length === before, "an empty update reached GitHub");

  await plugins.runPlugin(userId, "github", "mergePR", { repo: "o/r", id: "7", mergeMethod: "squash" });
  assert(last().method === "PUT" && last().url.endsWith("/pulls/7/merge") && JSON.parse(last().body).merge_method === "squash", `merge: ${JSON.stringify(last())}`);

  const review = await plugins.runPlugin(userId, "github", "review", { repo: "o/r", id: "7", event: "APPROVE" }) as { state: string };
  assert(last().method === "POST" && JSON.parse(last().body).event === "APPROVE" && review.state === "APPROVED", `review: ${JSON.stringify(last())}`);
  assert(await plugins.runPlugin(userId, "github", "review", { repo: "o/r", id: "7", event: "REQUEST_CHANGES" }).then(() => false, () => true), "requesting changes without a comment was sent");

  const runs = await plugins.runPlugin(userId, "github", "listWorkflowRuns", { repo: "o/r", ref: "main" }) as { id: number; conclusion: string }[];
  assert(new URL(last().url).searchParams.get("branch") === "main" && runs[0].id === 99 && runs[0].conclusion === "failure", `runs: ${JSON.stringify(runs)}`);
  const rerun = await plugins.runPlugin(userId, "github", "rerunWorkflow", { repo: "o/r", id: "99" }) as { rerun: boolean };
  assert(last().method === "POST" && last().url.endsWith("/actions/runs/99/rerun-failed-jobs") && rerun.rerun, `rerun: ${JSON.stringify(last())}`);

  const refused = async (run: () => Promise<unknown>) => run().then(() => false, () => true);
  assert(await refused(() => plugins.runPlugin(userId, "github", "updateIssue", { repo: "o/r", id: "../7", state: "closed" })), "a non-numeric issue id was accepted");
  assert(await refused(() => plugins.runPlugin(userId, "github", "listCommits", { repo: "o/r", ref: "main?x=1" })), "an unsafe ref was accepted");
  assert(await refused(() => plugins.runPlugin(userId, "gmail", "listIssues", {})), "a GitHub-only action ran for Gmail");
  assert(isReadAction("listPRs") && isReadAction("readPR") && !isReadAction("mergePR") && !isReadAction("updateIssue"), "read and write actions are mixed up");

  console.log("verified GitHub plugin: lists, close and reviewers, merge, review, workflow re-runs, input checks");
}

void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  });
