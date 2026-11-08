export type SearchResult = {
  /** Citation id, unique within one response; the model cites it as `[cite:id]`. */
  id?: number;
  title: string;
  url: string;
  description: string;
};

export type ChatToolUsageContext = {
  userId: string;
  isAnonymous: boolean;
};

export type CreateChatToolsOptions = {
  webSearch?: boolean;
  interactive?: boolean;
  enabledTools?: readonly ("search" | "browse")[];
  usage?: ChatToolUsageContext;
};
