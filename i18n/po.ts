// Reads and writes the gettext catalogs in messages/. Each entry is keyed by msgctxt (the message
// ID), holds the English source in msgid and the translation in msgstr, and lists the files that
// use it as `#:` references. The writer keeps the layout of the existing files so extraction
// produces small diffs.

export type PoEntry = {
  id: string;
  message: string;
  translation: string;
  references: string[];
};

export type PoCatalog = {
  headers: string[];
  entries: PoEntry[];
};

function unquote(line: string, keyword: string): string {
  const raw = line.slice(keyword.length).trim();
  return JSON.parse(raw) as string;
}

function quote(value: string): string {
  return JSON.stringify(value).replace(/\\u([0-9a-f]{4})/gi, (whole, hex: string) => {
    const code = Number.parseInt(hex, 16);
    // JSON.stringify escapes control characters; gettext only needs the common ones.
    return code < 0x20 ? whole : String.fromCharCode(code);
  });
}

export function parsePo(source: string): PoCatalog {
  const headers: string[] = [];
  const entries: PoEntry[] = [];
  const blocks = source.replace(/\r\n/g, "\n").split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n").filter(Boolean);
    if (lines.length === 0) continue;
    const references: string[] = [];
    let id: string | undefined;
    let message: string | undefined;
    let translation: string | undefined;
    let last: "msgid" | "msgstr" | "msgctxt" | undefined;
    for (const line of lines) {
      if (line.startsWith("#:")) references.push(...line.slice(2).trim().split(/\s+/).filter(Boolean));
      else if (line.startsWith("#")) continue;
      else if (line.startsWith("msgctxt ")) {
        id = unquote(line, "msgctxt");
        last = "msgctxt";
      } else if (line.startsWith("msgid ")) {
        message = unquote(line, "msgid");
        last = "msgid";
      } else if (line.startsWith("msgstr ")) {
        translation = unquote(line, "msgstr");
        last = "msgstr";
      } else if (line.startsWith('"')) {
        const continued = JSON.parse(line) as string;
        if (last === "msgid") message = (message ?? "") + continued;
        else if (last === "msgstr") translation = (translation ?? "") + continued;
        else if (last === "msgctxt") id = (id ?? "") + continued;
      }
    }
    if (message === "" && id === undefined) {
      headers.push(...(translation ?? "").split("\n").filter(Boolean));
      continue;
    }
    if (id === undefined || message === undefined) continue;
    entries.push({ id, message, translation: translation ?? "", references });
  }
  return { headers, entries };
}

export function serializePo(catalog: PoCatalog): string {
  const parts = [
    ['msgid ""', 'msgstr ""', ...catalog.headers.map((header) => quote(`${header}\n`))].join("\n"),
  ];
  for (const entry of catalog.entries) {
    parts.push(
      [
        ...entry.references.map((reference) => `#: ${reference}`),
        `msgctxt ${quote(entry.id)}`,
        `msgid ${quote(entry.message)}`,
        `msgstr ${quote(entry.translation)}`,
      ].join("\n"),
    );
  }
  return `${parts.join("\n\n")}\n`;
}

/** The runtime catalog: message ID to translated ICU message. Untranslated entries are left out. */
export function catalogMessages(catalog: PoCatalog): Record<string, string> {
  const messages: Record<string, string> = {};
  for (const entry of catalog.entries) {
    if (entry.translation) messages[entry.id] = entry.translation;
  }
  return messages;
}
