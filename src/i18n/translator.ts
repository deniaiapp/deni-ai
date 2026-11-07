import { createTranslator, type AbstractIntlMessages, type _useExtracted } from "use-intl";
import { messageId } from "./message-id";

/**
 * Messages are written inline in English (`t("Save")`) and looked up in the catalog by
 * `messageId(message)`. A message that is not in the catalog yet, such as one added since the
 * last extraction, is formatted from the English source.
 */
export type ExtractedTranslator = ReturnType<typeof _useExtracted>;

type Translator = {
  (key: string, values?: never, formats?: never): string;
  rich(key: string, values?: never, formats?: never): unknown;
  markup(key: string, values?: never, formats?: never): string;
  has(key: string): boolean;
};

type Method = "plain" | "rich" | "markup";

export function createExtractedTranslator(translator: unknown, locale: string): ExtractedTranslator {
  const t = translator as Translator;
  const fallbacks = new Map<string, Translator>();

  function resolve(message: string): [Translator, string] {
    const id = messageId(message);
    if (t.has(id)) return [t, id];
    let fallback = fallbacks.get(id);
    if (!fallback) {
      fallback = createTranslator({ locale, messages: { [id]: message } }) as unknown as Translator;
      fallbacks.set(id, fallback);
    }
    return [fallback, id];
  }

  function call(method: Method, message: string, values?: never, formats?: never) {
    const [target, id] = resolve(message);
    if (method === "rich") return target.rich(id, values, formats);
    if (method === "markup") return target.markup(id, values, formats);
    return target(id, values, formats);
  }

  const translate = (message: string, values?: never, formats?: never) => call("plain", message, values, formats);
  translate.rich = (message: string, values?: never, formats?: never) => call("rich", message, values, formats);
  translate.markup = (message: string, values?: never, formats?: never) => call("markup", message, values, formats);
  translate.has = (message: string) => t.has(messageId(message));
  return translate as unknown as ExtractedTranslator;
}

const translators = new WeakMap<AbstractIntlMessages, ExtractedTranslator>();

/** Translator outside React, for server code and route `head` functions. */
export function translatorFor(locale: string, messages: AbstractIntlMessages): ExtractedTranslator {
  let translator = translators.get(messages);
  if (!translator) {
    translator = createExtractedTranslator(createTranslator({ locale, messages }), locale);
    translators.set(messages, translator);
  }
  return translator;
}
