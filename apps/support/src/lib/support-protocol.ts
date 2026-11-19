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
  /** Saved conversation to append to, from {@link supportConversationHeader}. */
  conversation?: string;
};

/** Response header carrying a pass that lets the next messages skip Turnstile. */
export const supportSessionHeader = 'X-Support-Session';

/**
 * Response header carrying the saved conversation's credential (`id.token`). The
 * widget keeps it to restore the conversation and receive the team's replies.
 */
export const supportConversationHeader = 'X-Support-Conversation';

/** One line of the chat response body (NDJSON). */
export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: 'search' | 'read'; detail: string }
  | { type: 'source'; title: string; url: string }
  | { type: 'draft'; draft: SupportDraft }
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

/**
 * A message the assistant prepared for the user to review in the chat. Nothing is
 * sent until the user presses Send on its card.
 */
export type SupportDraft =
  | {
      kind: 'contact';
      category: ContactCategory;
      subject: string;
      message: string;
      /** Reply address the user gave in the chat, if any. */
      email?: string;
    }
  | { kind: 'feedback'; message: string; email?: string };

/** What a user message sent to the team carried besides its text. */
export type SentRequest =
  | { kind: 'contact'; category: ContactCategory; subject: string; email: string }
  | { kind: 'feedback'; email?: string };

/** A message of a saved conversation, including the team's replies (`staff`). */
export type ConversationMessage = {
  id: string;
  role: 'user' | 'assistant' | 'staff';
  content: string;
  /** ISO timestamp. */
  createdAt: string;
  /** Set on a user message that was sent to the team as contact or feedback. */
  request?: SentRequest;
  sources?: { title: string; url: string }[];
};

/** `GET /api/conversation` response. */
export type ConversationBody = { messages: ConversationMessage[] };

/** Body of a successful contact or feedback response from the widget. */
export type SupportSentBody = {
  ok: true;
  /** Credential of the conversation the message was saved to. */
  conversation?: string;
  /** The saved message, to show in the chat. */
  message?: ConversationMessage;
};

export type ContactRequest = {
  name?: string;
  email: string;
  category: ContactCategory;
  subject: string;
  message: string;
  lang: Language;
  pagePath?: string;
  turnstileToken?: string;
  /** Chat session pass; stands in for a Turnstile token when sent from the widget. */
  session?: string;
  /** The AI chat conversation, attached when the message is sent from the widget. */
  transcript?: ChatTurn[];
  /** Saved conversation to add the message to. */
  conversation?: string;
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
  /** Chat session pass; stands in for a Turnstile token when sent from the widget. */
  session?: string;
  /** The AI chat conversation, attached when the feedback is sent from the widget. */
  transcript?: ChatTurn[];
  /** Saved conversation to add the feedback to. */
  conversation?: string;
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
