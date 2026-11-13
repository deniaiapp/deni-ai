import Anthropic from '@anthropic-ai/sdk';
import type { Language } from '@/lib/i18n';
import { searchServer } from '@/lib/search';
import { siteUrl } from '@/lib/shared';
import { docsLlms, source } from '@/lib/source';
import {
  contactCategories,
  isContactCategory,
  supportLimits,
  type ChatEvent,
  type ChatTurn,
  type SupportDraft,
} from '@/lib/support-protocol';
import { serverEnv } from './env';
import { isEmail } from './http/shared';

const model = 'claude-haiku-5-5';
/** Model turns per user message: searching, reading a few articles, then answering. */
const maxTurns = 6;

let client: Anthropic | undefined;

function getClient(): Anthropic {
  client ??= new Anthropic({ apiKey: serverEnv.anthropicApiKey });
  return client;
}

export function isSupportAgentEnabled(): boolean {
  return Boolean(serverEnv.anthropicApiKey);
}

const tools: Anthropic.Tool[] = [
  {
    name: 'search_help_center',
    description:
      'Full-text search over the Deni AI help center. Returns matching articles, headings, and passages with their URLs. Search with the words a help article would use; try a different wording if the first search finds nothing relevant.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search keywords' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_help_article',
    description:
      'Returns the full Markdown text of one help center article. Pass the article path from the article list or a search result, e.g. /en/billing/payments.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Article path, e.g. /en/billing/payments' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'draft_support_request',
    description:
      'Prepares a message to the Deni AI support team and shows it to the user as a card in this chat. Nothing is sent until the user reviews it and presses Send on the card (they can also edit it there). This conversation is attached automatically. Use it once the user wants a person to help. Write the subject and message in the user’s language, in the first person as the user, with the details support needs (what they tried, error messages, which product). Never include passwords, verification codes, card numbers, or API keys.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: [...contactCategories] },
        subject: { type: 'string', description: `At most ${supportLimits.subjectLength} characters` },
        message: { type: 'string', description: 'The message body' },
        email: {
          type: 'string',
          description:
            'Reply address the user gave in this conversation, or an empty string if they haven’t; never guess one',
        },
      },
      required: ['category', 'subject', 'message', 'email'],
      additionalProperties: false,
    },
  },
  {
    name: 'draft_feedback',
    description:
      'Prepares product feedback (feature requests, ideas, things to improve in Deni AI, Flixa, or this help center) and shows it to the user as a card in this chat. Nothing is sent until the user reviews it and presses Send. This conversation is attached automatically. Write the message in the user’s language, in the first person as the user.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The feedback' },
        email: {
          type: 'string',
          description:
            'Address the user gave for a follow-up, or an empty string; feedback does not need one',
        },
      },
      required: ['message', 'email'],
      additionalProperties: false,
    },
  },
];

const systemPrompts = new Map<Language, string>();

/** Button labels of the support widget, which follows the help center's language. */
const widgetLabels = {
  en: { send: 'Send', edit: 'Edit', contact: 'Contact support', feedback: 'Send feedback' },
  ja: {
    send: '送信',
    edit: '編集',
    contact: 'サポートに問い合わせる',
    feedback: 'フィードバックを送る',
  },
} satisfies Record<Language, Record<string, string>>;

/** Stable per language so the prompt prefix can be cached. */
function systemPrompt(lang: Language): string {
  const cached = systemPrompts.get(lang);
  if (cached) return cached;

  const articles = source
    .getPages(lang)
    .map(
      (page) =>
        `- [${page.data.title}](${page.url})${page.data.description ? `: ${page.data.description}` : ''}`,
    )
    .join('\n');

  const ui = widgetLabels[lang];
  const prompt = `You are Deni AI Support, the assistant on the Deni AI help center (${siteUrl}). Deni AI is an AI chat service at deniai.app; Flixa is its coding agent, available as a VS Code extension and a CLI.

How to answer:
- Before answering a product question, find the relevant help article with search_help_center or the article list below, and read it with read_help_article. Base answers on what the articles say. If they don't cover the question, say so plainly instead of guessing about features, plans, prices, or limits.
- Link the articles you used with Markdown links to their paths, e.g. [Payments and changing plans](/en/billing/payments).
- Keep answers short and concrete. Use numbered steps for procedures.
- Reply in the language the user writes in. This conversation started on the ${lang === 'ja' ? 'Japanese' : 'English'} help center, so prefer /${lang}/ article links.

What you can't do:
- You can't see or change anyone's account, subscription, payments, or chats. When the user needs a person (refunds, billing disputes, account recovery or deletion, privacy requests, a bug the articles don't resolve), offer to contact support for them. If they agree, ask for the email address support should reply to (for account matters, the one on their Deni AI account) unless they already gave it, then call draft_support_request. Ask for any details support will need first, but don't hold the draft back over optional ones.
- When the user shares a feature request, an idea, or something to improve, offer to pass it on and call draft_feedback once they agree.
- Drafts appear as cards with "${ui.send}" (send) and "${ui.edit}" (edit) buttons. After drafting, tell the user briefly to check the card and press "${ui.send}"; never say it was sent. If they ask for changes, draft again.
- Users can also open the forms themselves from the "${ui.contact}" and "${ui.feedback}" buttons at the bottom of this chat.
- Never ask for passwords, verification codes, full card numbers, or API keys.
- Help only with Deni AI and Flixa. Politely decline unrelated requests.

Help center articles (${lang}):
${articles}`;

  systemPrompts.set(lang, prompt);
  return prompt;
}

type ToolOutcome = { content: string; isError?: boolean; source?: { title: string; url: string } };

async function searchHelpCenter(lang: Language, query: string): Promise<ToolOutcome> {
  const results = await searchServer.search(query, { locale: lang, limit: 12 });
  if (results.length === 0) return { content: 'No results.' };

  return {
    content: results
      .map((result) => `- (${result.type}) ${result.content.replace(/\s+/g, ' ')} — ${result.url}`)
      .join('\n'),
  };
}

async function readHelpArticle(url: string): Promise<ToolOutcome> {
  let path = url.trim();
  if (path.startsWith(siteUrl)) path = path.slice(siteUrl.length);
  path = path.replace(/[?#].*$/, '').replace(/\.md$/, '');

  const [lang, ...slugs] = path.split('/').filter((segment) => segment.length > 0);
  const page = lang ? source.getPage(slugs, lang) : undefined;
  if (!page) {
    return {
      content: `No article at ${url}. Use a path from the article list or search results.`,
      isError: true,
    };
  }

  return {
    content: await docsLlms.page(page),
    source: { title: page.data.title, url: page.url },
  };
}

/** Turns a draft tool call into a card for the widget, or an error for the model. */
function readDraft(name: string, input: unknown): SupportDraft | string {
  const message = parseInput(input, 'message')?.trim();
  if (!message || message.length > supportLimits.messageLength) {
    return `"message" must be 1 to ${supportLimits.messageLength} characters.`;
  }
  const email = parseInput(input, 'email')?.trim() || undefined;
  if (email && (email.length > supportLimits.emailLength || !isEmail(email))) {
    return `"${email}" is not a valid email address. Ask the user for it again, or pass an empty string.`;
  }

  if (name === 'draft_feedback') return { kind: 'feedback', message, email };

  const category = parseInput(input, 'category');
  const subject = parseInput(input, 'subject')?.trim();
  if (!isContactCategory(category)) return `"category" must be one of ${contactCategories.join(', ')}.`;
  if (!subject || subject.length > supportLimits.subjectLength) {
    return `"subject" must be 1 to ${supportLimits.subjectLength} characters.`;
  }
  return { kind: 'contact', category, subject, message, email };
}

function parseInput(input: unknown, key: string): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/**
 * Answers the latest user message, streaming events through `emit`. Resolves once
 * the answer is complete; API errors are thrown to the caller.
 */
export async function runSupportAgent(options: {
  lang: Language;
  turns: ChatTurn[];
  pagePath?: string;
  signal: AbortSignal;
  emit: (event: ChatEvent) => void;
}): Promise<void> {
  const { lang, emit, signal } = options;
  const messages: Anthropic.MessageParam[] = options.turns.map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: systemPrompt(lang), cache_control: { type: 'ephemeral' } },
  ];
  // Volatile context goes after the cached prefix.
  if (options.pagePath) {
    system.push({ type: 'text', text: `The user opened this chat on ${options.pagePath}.` });
  }

  const cited = new Set<string>();

  for (let turn = 0; turn < maxTurns; turn++) {
    // Tools are dropped on the last turn so the model has to answer.
    const isLastTurn = turn === maxTurns - 1;
    const stream = getClient().messages.stream(
      {
        model,
        max_tokens: 16000,
        output_config: { effort: 'low' },
        system,
        tools,
        tool_choice: isLastTurn ? { type: 'none' } : { type: 'auto' },
        messages,
      },
      { signal },
    );
    stream.on('text', (text) => emit({ type: 'text', text }));

    const message = await stream.finalMessage();

    if (message.stop_reason === 'refusal') {
      emit({ type: 'error', code: 'refused' });
      return;
    }

    const toolUses = message.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );
    if (toolUses.length === 0) return;
    // A tool input cut off at max_tokens can still parse; don't run it.
    if (message.stop_reason === 'max_tokens') {
      emit({ type: 'error', code: 'failed' });
      return;
    }

    // Keep the whole content, thinking blocks included, for the next request.
    messages.push({ role: 'assistant', content: message.content });

    const results = await Promise.all(
      toolUses.map(async (toolUse): Promise<Anthropic.ToolResultBlockParam> => {
        let outcome: ToolOutcome;
        if (toolUse.name === 'search_help_center') {
          const query = parseInput(toolUse.input, 'query');
          if (query) emit({ type: 'tool', name: 'search', detail: query });
          outcome = query
            ? await searchHelpCenter(lang, query)
            : { content: 'Missing "query".', isError: true };
        } else if (toolUse.name === 'read_help_article') {
          const url = parseInput(toolUse.input, 'url');
          outcome = url ? await readHelpArticle(url) : { content: 'Missing "url".', isError: true };
          if (outcome.source) {
            emit({ type: 'tool', name: 'read', detail: outcome.source.title });
            if (!cited.has(outcome.source.url)) {
              cited.add(outcome.source.url);
              emit({ type: 'source', ...outcome.source });
            }
          }
        } else if (toolUse.name === 'draft_support_request' || toolUse.name === 'draft_feedback') {
          const draft = readDraft(toolUse.name, toolUse.input);
          if (typeof draft === 'string') {
            outcome = { content: draft, isError: true };
          } else {
            emit({ type: 'draft', draft });
            const needsEmail = draft.kind === 'contact' && !draft.email;
            outcome = {
              content: [
                `Shown to the user as a card with "${widgetLabels[lang].send}" and "${widgetLabels[lang].edit}" buttons. It has not been sent; the user sends it from the card.`,
                'Tell them so briefly, in the language they write in.',
                ...(needsEmail
                  ? ['There is no reply address yet, so the user adds one with Edit before sending.']
                  : []),
              ].join(' '),
            };
          }
        } else {
          outcome = { content: `Unknown tool: ${toolUse.name}`, isError: true };
        }

        return {
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: outcome.content,
          ...(outcome.isError ? { is_error: true } : {}),
        };
      }),
    );

    // All results go back in one user message.
    messages.push({ role: 'user', content: results });
  }
}
