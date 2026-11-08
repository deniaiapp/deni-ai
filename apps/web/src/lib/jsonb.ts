function needsCleaning(text: string) {
  return text.includes("\u0000") || !text.isWellFormed();
}

/**
 * Text Postgres accepts. It rejects U+0000 (22P05), and jsonb also rejects the
 * `\ud83d` escape JSON.stringify writes for a lone UTF-16 surrogate (22P02).
 * Web search results and imported exports can contain NUL; tool output cut with
 * `.slice()` can end in half of an emoji. Lone surrogates become U+FFFD.
 */
export function toPostgresText(text: string) {
  return needsCleaning(text) ? text.replaceAll("\u0000", "").toWellFormed() : text;
}

/** JSON that Postgres accepts as jsonb: cleans string values and object keys. */
export function stringifyForJsonb(value: unknown) {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v === "string") return toPostgresText(v);
    if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).some(needsCleaning)) {
      return Object.fromEntries(
        Object.entries(v).map(([key, entry]) => [toPostgresText(key), entry]),
      );
    }
    return v;
  });
}

/** A JSON copy of `value` that Postgres accepts as jsonb. */
export function toJsonbSafe<T>(value: T): T {
  return JSON.parse(stringifyForJsonb(value)) as T;
}
