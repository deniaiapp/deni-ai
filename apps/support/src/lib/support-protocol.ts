// Request and response shapes shared by the support widget, the contact and
// feedback forms, and their server handlers.

import type { Language } from './i18n';

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

export type ChatRequest = {
  messages: ChatTurn[];
  lang: Language;
  /** Path of the page the widget was opened on, e.g. `/en/billing/payments`. */
  pagePath?: string;
  turnstileToken?: string;
  /** Pass from the previous response's {@link supportSessionHeader}. */
  session?: string;
};

/** Response header carrying a pass that lets the next messages skip Turnstile. */
export const supportSessionHeader = 'X-Support-Session';

/** One line of the chat response body (NDJSON). */
export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: 'search' | 'read'; detail: string }
  | { type: 'source'; title: string; url: string }
  | { type: 'error'; code: SupportErrorCode }
  | { type: 'done' };

export type SupportErrorCode =
  | 'invalid'
  | 'rate_limited'
  | 'verification_failed'
  | 'unavailable'
  | 'refused'
  | 'failed';

export const contactCategories = [
  'account',
  'billing',
  'education',
  'chat',
  'flixa',
  'teams',
  'bug',
  'privacy',
  'other',
] as const;

export type ContactCategory = (typeof contactCategories)[number];

export function isContactCategory(value: unknown): value is ContactCategory {
  return (contactCategories as readonly unknown[]).includes(value);
}

export type ContactRequest = {
  name?: string;
  email: string;
  category: ContactCategory;
  subject: string;
  message: string;
  lang: Language;
  pagePath?: string;
  turnstileToken?: string;
  /** Honeypot: left empty by people, filled by naive bots. */
  website?: string;
};

export type FeedbackRequest = {
  kind: 'page' | 'general';
  /** Required for `page` feedback. */
  helpful?: boolean;
  message?: string;
  email?: string;
  lang: Language;
  pagePath?: string;
  turnstileToken?: string;
  website?: string;
};

/** Error body of a non-streaming support response. */
export type SupportErrorBody = { error: SupportErrorCode; retryAfter?: number };

export const supportLimits = {
  chatMessages: 30,
  chatMessageLength: 4000,
  chatTotalLength: 24_000,
  nameLength: 100,
  emailLength: 254,
  subjectLength: 150,
  messageLength: 5000,
} as const;
