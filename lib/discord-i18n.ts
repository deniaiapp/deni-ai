import { scrubServerPaths } from "./discord-text";
import { fill, resolveServerLocale, translateMessage, translatorFor, type Translate } from "./i18n-server";
import { ja as base } from "./i18n-ja";
import { ja as computer } from "./discord-features/computer.ja";
import { ja as core } from "./discord-features/core.ja";
import { ja as files } from "./discord-features/files.ja";
import { ja as groups } from "./discord-features/groups.ja";
import { ja as mcp } from "./discord-features/mcp.ja";
import { ja as notify } from "./discord-features/notify.ja";
import { ja as plugins } from "./discord-features/plugins.ja";
import { ja as routines } from "./discord-features/routines.ja";
import { ja as skills } from "./discord-features/skills.ja";
import { ja as tasks } from "./discord-features/tasks.ja";
import { ja as team } from "./discord-features/team.ja";

/**
 * The bot's strings live apart from lib/i18n-ja.ts on purpose: translateMessage turns every
 * dictionary key with a placeholder into a pattern for translating English errors, and short UI
 * labels such as "Retry {number}" would rewrite unrelated errors. They also stay out of the web
 * bundle, which imports the shared dictionary.
 */
const own: Record<"en" | "ja", Record<string, string>> = {
  en: {},
  ja: {
    ...core,
    ...team,
    ...groups,
    ...skills,
    ...routines,
    ...tasks,
    ...files,
    ...computer,
    ...plugins,
    ...mcp,
    ...notify,
  },
};

/** Everything the bot can say in Japanese: its own strings, then the shared server ones. */
export const discordJa: Record<string, string> = { ...base, ...own.ja };

/** Exact lookups in the bot's strings first, then the shared server dictionary. */
export function discordTranslator(locale?: unknown): Translate {
  const resolved = resolveServerLocale(locale);
  const strings = own[resolved];
  const shared = translatorFor(resolved);
  return (message, params) => (message in strings ? fill(strings[message], params) : shared(message, params));
}

/**
 * An error as the person should read it in Discord: the bot's own strings (schedule and option
 * errors thrown by the commands) first, then the shared error translations, with server paths
 * elided.
 */
export function discordErrorText(locale: unknown, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const strings = own[resolveServerLocale(locale)];
  return scrubServerPaths(message in strings ? strings[message] : translateMessage(locale, message));
}
