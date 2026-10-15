"use client";

import { useExtracted } from "next-intl";

// Readable names for built-in plugin write actions, shown instead of ids like "createIssue".
export function usePluginActionLabels(): Record<string, string> {
  const t = useExtracted();
  return {
    send: t("Send an email"),
    create: t("Create a file"),
    update: t("Update a file"),
    createIssue: t("Create an issue"),
    createPR: t("Open a pull request"),
    comment: t("Add a comment"),
  };
}
