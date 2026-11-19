import type { Language } from './i18n';

/**
 * Starting text for the feedback form when an app links to `/{lang}/feedback?from=…`.
 * Deni AI v8 links with `from=v8` and its `version` (during the private beta and
 * while deniai.app is split between v7 and v8), so v8 feedback arrives in a shape
 * that is easy to tell apart from v7's and triage.
 */
const templates = {
  v8: {
    en: (version: string) =>
      [
        `[Deni AI v8${version ? ` · ${version}` : ''}]`,
        '',
        'What happened or what you tried:',
        '',
        '',
        'What you expected or would like instead:',
        '',
        '',
      ].join('\n'),
    ja: (version: string) =>
      [
        `[Deni AI v8${version ? `・${version}` : ''}]`,
        '',
        '起きたこと・試したこと：',
        '',
        '',
        '期待していたこと・こうしてほしいこと：',
        '',
        '',
      ].join('\n'),
  },
} satisfies Record<string, Record<Language, (version: string) => string>>;

type FeedbackSource = keyof typeof templates;

function isFeedbackSource(value: string | null): value is FeedbackSource {
  return value !== null && Object.hasOwn(templates, value);
}

/** Query parameters a feedback link may carry; the form consumes them once. */
export const feedbackTemplateParams = ['from', 'version'] as const;

/** The prefilled feedback text for a link's `from` and `version`, if `from` is known. */
export function feedbackTemplate(
  lang: Language,
  params: URLSearchParams,
): string | undefined {
  const from = params.get('from');
  if (!isFeedbackSource(from)) return undefined;
  // Shown in a text box the user edits; keep only short, plain version labels.
  const version = (params.get('version') ?? '')
    .replace(/[^\p{L}\p{N} ().+_-]/gu, '')
    .trim()
    .slice(0, 40);
  return templates[from][lang](version);
}
