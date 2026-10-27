export type FolderGroup<TItem = unknown> = {
  folder: string;
  items: TItem[];
};

export function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const tags: string[] = [];

  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }

    const normalized = entry.trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }

    seen.add(key);
    tags.push(normalized);
  }

  return tags;
}

export function mergeFolderGroups<TItem>(
  groups: FolderGroup<TItem>[],
  customFolders: string[],
): FolderGroup<TItem>[] {
  const folderMap = new Map(groups.map((group) => [group.folder, group]));

  for (const folder of customFolders) {
    if (folderMap.has(folder)) {
      continue;
    }

    folderMap.set(folder, { folder, items: [] });
  }

  return Array.from(folderMap.values()).sort((left, right) =>
    left.folder.localeCompare(right.folder),
  );
}
