// Plugin kinds and operations, shared by the server and the Plugins dialog.

export const pluginKinds = ["gmail", "drive", "github"] as const;
export type PluginKind = (typeof pluginKinds)[number];

export const githubReadActions = [
  "listRepos",
  "listIssues",
  "listPRs",
  "readPR",
  "listComments",
  "listLabels",
  "listBranches",
  "listCommits",
  "listReleases",
  "listWorkflowRuns",
] as const;
export const readActions = ["search", "read", ...githubReadActions] as const;
export type ReadAction = (typeof readActions)[number];

export const writeActions = [
  "send",
  "create",
  "update",
  "createIssue",
  "createPR",
  "comment",
  "updateIssue",
  "mergePR",
  "review",
  "rerunWorkflow",
] as const;
export type WriteAction = (typeof writeActions)[number];

export type PluginOperation = ReadAction | WriteAction;

/** Read actions each plugin supports. They run without approval. */
export const pluginReadActions: Record<PluginKind, readonly ReadAction[]> = {
  gmail: ["search", "read"],
  drive: ["search", "read"],
  github: readActions,
};
/** Write actions each plugin supports; anything else is refused on save and at run time. */
export const pluginWriteActions: Record<PluginKind, WriteAction[]> = {
  gmail: ["send"],
  drive: ["create", "update"],
  github: [
    "createIssue",
    "createPR",
    "comment",
    "updateIssue",
    "review",
    "mergePR",
    "rerunWorkflow",
  ],
};

export const isReadAction = (action: string): action is ReadAction =>
  (readActions as readonly string[]).includes(action);
