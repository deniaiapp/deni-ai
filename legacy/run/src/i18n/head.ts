import type { AnyRouteMatch } from "@tanstack/react-router";
import type { AbstractIntlMessages } from "use-intl";
import { sourceLocale } from "./config";
import { translatorFor, type ExtractedTranslator } from "./translator";

type RootData = { locale: string; messages: AbstractIntlMessages };
const untranslated: AbstractIntlMessages = {};

/** Translator for a route's `head`, from the locale and catalog the root route loaded. */
export function headTranslator(matches: AnyRouteMatch[]): ExtractedTranslator {
  const root = matches.find((match) => match.routeId === "__root__")?.loaderData as RootData | undefined;
  return root ? translatorFor(root.locale, root.messages) : translatorFor(sourceLocale, untranslated);
}
