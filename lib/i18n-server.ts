import { defaultLocale, isLocale, type Locale } from "../i18n/config";
import { ja } from "./i18n-ja";

/**
 * Translator for server code that runs outside a request, such as the standalone worker and
 * the messages agents and background jobs persist. It does not read the request, so it
 * also runs under `tsx worker/index.ts`.
 */
export type Translate = (message: string, params?: Record<string, string | number>) => string;

const dictionaries: Record<Locale, Record<string, string>> = { en: {}, ja };

type Pattern = { regex: RegExp; names: string[]; template: string };
const patterns = new Map<Locale, Pattern[]>();

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Templates such as "Invalid MCP header: {name}" also match the English text lib code throws. */
function patternsFor(locale: Locale): Pattern[] {
  const cached = patterns.get(locale);
  if (cached) return cached;
  const built: Pattern[] = [];
  for (const [key, template] of Object.entries(dictionaries[locale])) {
    if (!key.includes("{")) continue;
    const names: string[] = [];
    const source = key
      .split(/(\{\w+\})/)
      .map((part) => {
        const placeholder = part.match(/^\{(\w+)\}$/);
        if (!placeholder) return escapeRegex(part);
        names.push(placeholder[1]);
        return "([\\s\\S]+?)";
      })
      .join("");
    built.push({ regex: new RegExp(`^${source}$`), names, template });
  }
  patterns.set(locale, built);
  return built;
}

export function fill(template: string, params?: Record<string, string | number>) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

export function resolveServerLocale(value: unknown): Locale {
  return typeof value === "string" && isLocale(value) ? value : defaultLocale;
}

export function translatorFor(locale?: unknown): Translate {
  const resolved = resolveServerLocale(locale);
  const dictionary = dictionaries[resolved];
  return (message, params) => fill(dictionary[message] ?? message, params);
}

/**
 * Translate a message that was already formatted in English, such as an Error thrown by lib code.
 * Unknown messages are returned unchanged.
 */
export function translateMessage(locale: unknown, message: string): string {
  const resolved = resolveServerLocale(locale);
  const exact = dictionaries[resolved][message];
  if (exact) return exact;
  for (const { regex, names, template } of patternsFor(resolved)) {
    const match = message.match(regex);
    if (!match) continue;
    const params: Record<string, string> = {};
    names.forEach((name, index) => {
      params[name] = match[index + 1];
    });
    return fill(template, params);
  }
  return message;
}

export function translateError(locale: unknown, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return translateMessage(locale, message);
}
