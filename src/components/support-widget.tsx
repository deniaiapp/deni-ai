import { useLocation } from '@tanstack/react-router';
import { buttonVariants } from 'fumadocs-ui/components/ui/button';
import Link from 'fumadocs-core/link';
import { createMarkdownRenderer } from 'fumadocs-core/content/md';
import { remarkGfm } from 'fumadocs-core/mdx-plugins/remark-gfm';
import {
  ArrowUp,
  BookOpen,
  LifeBuoy,
  Loader2,
  Mail,
  MessageSquareText,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';
import type { Language } from '@/lib/i18n';
import { readSupportError, supportErrorMessage } from '@/lib/support-client';
import {
  supportLimits,
  type ChatEvent,
  type ChatTurn,
  type SupportErrorCode,
} from '@/lib/support-protocol';
import { useSupportConfig } from './support-config';
import { Turnstile, type TurnstileHandle } from './turnstile';

const labels = {
  en: {
    open: 'Get help',
    close: 'Close',
    title: 'Deni AI Support',
    subtitle: 'AI answers from the help center. They can be wrong.',
    newChat: 'New chat',
    intro: 'Hi! Ask a question about Deni AI or Flixa and I’ll look it up in the help center.',
    suggestions: [
      'How do I change my plan?',
      'I can’t sign in to my account',
      'How do I import my ChatGPT conversations?',
    ],
    placeholder: 'Ask a question…',
    send: 'Send',
    searching: (query: string) => `Searching “${query}”`,
    reading: (title: string) => `Reading “${title}”`,
    thinking: 'Thinking…',
    sources: 'Sources',
    contact: 'Contact support',
    feedback: 'Send feedback',
    needHuman: 'Need a person?',
    chatUnavailable:
      'The AI assistant is not available right now. Contact support or browse the help center.',
  },
  ja: {
    open: 'ヘルプ',
    close: '閉じる',
    title: 'Deni AI サポート',
    subtitle: 'ヘルプセンターをもとに AI が回答します。誤りを含む場合があります。',
    newChat: '新しいチャット',
    intro:
      'こんにちは。Deni AI や Flixa について質問してください。ヘルプセンターを調べてお答えします。',
    suggestions: [
      'プランを変更するには？',
      'アカウントにサインインできない',
      'ChatGPT の会話をインポートするには？',
    ],
    placeholder: '質問を入力…',
    send: '送信',
    searching: (query: string) => `「${query}」を検索中`,
    reading: (title: string) => `「${title}」を確認中`,
    thinking: '考え中…',
    sources: '参照した記事',
    contact: 'サポートに問い合わせる',
    feedback: 'フィードバックを送る',
    needHuman: '担当者に相談したい場合',
    chatUnavailable:
      '現在 AI アシスタントはご利用いただけません。お問い合わせフォームかヘルプセンターをご利用ください。',
  },
} satisfies Record<Language, unknown>;

type UiMessage = {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  status?: { kind: 'thinking' | 'search' | 'read'; text: string };
  sources?: { title: string; url: string }[];
  error?: SupportErrorCode;
  pending?: boolean;
};

const { Markdown } = createMarkdownRenderer({ remarkPlugins: [remarkGfm] });

/** Conversation history for the API: only exchanges that got an answer. */
function toTurns(messages: UiMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (let i = 0; i < messages.length - 1; i++) {
    const question = messages[i]!;
    const answer = messages[i + 1]!;
    if (
      question.role === 'user' &&
      answer.role === 'assistant' &&
      answer.content &&
      !answer.error
    ) {
      turns.push({ role: 'user', content: question.content });
      turns.push({
        role: 'assistant',
        content: answer.content.slice(0, supportLimits.chatMessageLength),
      });
      i++;
    }
  }
  // Keep the newest exchanges within the request limits.
  while (
    turns.length > supportLimits.chatMessages - 1 ||
    turns.reduce((n, t) => n + t.content.length, 0) >
      supportLimits.chatTotalLength - supportLimits.chatMessageLength
  ) {
    turns.splice(0, 2);
  }
  return turns;
}

export function SupportWidget({ lang }: { lang: Language }) {
  const t = labels[lang];
  const config = useSupportConfig();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string>();
  const turnstileRef = useRef<TurnstileHandle>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nextId = useRef(0);

  const verified = !config.turnstileSiteKey || Boolean(token);
  const canSend = config.chat && !busy && verified && input.trim().length > 0;

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  useEffect(() => () => abortRef.current?.abort(), []);

  function updateAnswer(id: number, update: (message: UiMessage) => UiMessage) {
    setMessages((current) => current.map((m) => (m.id === id ? update(m) : m)));
  }

  async function send(text: string) {
    const question = text.trim().slice(0, supportLimits.chatMessageLength);
    if (!question || busy || !config.chat) return;

    const history = toTurns(messages);
    const answerId = nextId.current + 1;
    nextId.current += 2;
    setMessages((current) => [
      ...current,
      { id: answerId - 1, role: 'user', content: question },
      {
        id: answerId,
        role: 'assistant',
        content: '',
        status: { kind: 'thinking', text: t.thinking },
        pending: true,
      },
    ]);
    setInput('');
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;
    const turnstileToken = token;
    turnstileRef.current?.reset();

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...history, { role: 'user', content: question }],
          lang,
          pagePath: pathname,
          turnstileToken,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const error = await readSupportError(response);
        updateAnswer(answerId, (m) => ({ ...m, pending: false, status: undefined, error }));
        return;
      }

      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      let finished = false;
      while (!finished) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as ChatEvent;
          switch (event.type) {
            case 'text':
              updateAnswer(answerId, (m) => ({
                ...m,
                content: m.content + event.text,
                status: undefined,
              }));
              break;
            case 'tool':
              updateAnswer(answerId, (m) => ({
                ...m,
                status:
                  event.name === 'search'
                    ? { kind: 'search', text: t.searching(event.detail) }
                    : { kind: 'read', text: t.reading(event.detail) },
              }));
              break;
            case 'source':
              updateAnswer(answerId, (m) => ({
                ...m,
                sources: [...(m.sources ?? []), { title: event.title, url: event.url }],
              }));
              break;
            case 'error':
              updateAnswer(answerId, (m) => ({ ...m, error: event.code }));
              finished = true;
              break;
            case 'done':
              finished = true;
              break;
          }
        }
      }
      updateAnswer(answerId, (m) => ({
        ...m,
        pending: false,
        status: undefined,
        error: m.error ?? (finished ? undefined : 'failed'),
      }));
    } catch {
      if (controller.signal.aborted) return;
      updateAnswer(answerId, (m) => ({ ...m, pending: false, status: undefined, error: 'failed' }));
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  }

  function reset() {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setMessages([]);
    setInput('');
    inputRef.current?.focus();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (canSend) void send(input);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (canSend) void send(input);
    }
  }

  // The panel covers the page on phones, so following a link closes it there.
  function closeOnPhone() {
    if (window.matchMedia('(max-width: 639px)').matches) setOpen(false);
  }

  const linkClass =
    'inline-flex items-center gap-1.5 text-fd-muted-foreground hover:text-fd-foreground [&_svg]:size-3.5';

  return (
    <>
      <button
        type="button"
        aria-label={t.open}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'fixed bottom-4 end-4 z-40 inline-flex items-center gap-2 rounded-full bg-fd-primary px-4 py-2.5 text-sm font-medium text-fd-primary-foreground shadow-lg transition-transform hover:scale-105',
          open && 'max-sm:hidden',
        )}
      >
        {open ? <X className="size-4" /> : <LifeBuoy className="size-4" />}
        <span className={cn(open && 'sr-only')}>{t.open}</span>
      </button>

      {open && (
        <section
          role="dialog"
          aria-label={t.title}
          className="fixed inset-0 z-50 flex flex-col bg-fd-background sm:inset-auto sm:bottom-18 sm:end-4 sm:h-[min(640px,calc(100dvh-6rem))] sm:w-[400px] sm:rounded-2xl sm:border sm:shadow-2xl"
        >
          <header className="flex items-start gap-2 border-b px-4 py-3">
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">{t.title}</h2>
              <p className="text-xs text-fd-muted-foreground">{t.subtitle}</p>
            </div>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={reset}
                aria-label={t.newChat}
                title={t.newChat}
                className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
              >
                <RotateCcw />
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t.close}
              title={t.close}
              className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
            >
              <X />
            </button>
          </header>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
            {messages.length === 0 ? (
              <div className="flex flex-col gap-4">
                <p className="text-sm">{config.chat ? t.intro : t.chatUnavailable}</p>
                {config.chat && (
                  <div className="flex flex-col items-start gap-2">
                    {t.suggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        disabled={!verified}
                        onClick={() => void send(suggestion)}
                        className="rounded-xl border bg-fd-card px-3 py-2 text-start text-sm transition-colors hover:bg-fd-accent disabled:opacity-50"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <ol className="flex flex-col gap-4">
                {messages.map((message) =>
                  message.role === 'user' ? (
                    <li
                      key={message.id}
                      className="ms-8 self-end whitespace-pre-wrap rounded-2xl rounded-ee-md bg-fd-primary px-3 py-2 text-sm text-fd-primary-foreground"
                    >
                      {message.content}
                    </li>
                  ) : (
                    <li key={message.id} className="flex flex-col gap-2">
                      {message.content && (
                        <div className="prose prose-sm max-w-none text-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                          <Markdown
                            components={{
                              a: ({ href, children }) => (
                                <Link
                                  href={href}
                                  className="text-fd-primary underline"
                                  onClick={closeOnPhone}
                                >
                                  {children}
                                </Link>
                              ),
                            }}
                          >
                            {message.content}
                          </Markdown>
                        </div>
                      )}
                      {message.status && (
                        <p className="inline-flex items-center gap-2 text-xs text-fd-muted-foreground">
                          {message.status.kind === 'thinking' ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : message.status.kind === 'read' ? (
                            <BookOpen className="size-3.5" />
                          ) : (
                            <Search className="size-3.5" />
                          )}
                          {message.status.text}
                        </p>
                      )}
                      {message.error && (
                        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs">
                          {supportErrorMessage(lang, message.error)}
                        </p>
                      )}
                      {!message.pending && message.sources && message.sources.length > 0 && (
                        <div className="flex flex-col gap-1">
                          <p className="text-xs font-medium text-fd-muted-foreground">
                            {t.sources}
                          </p>
                          <ul className="flex flex-wrap gap-1.5">
                            {message.sources.map((source) => (
                              <li key={source.url}>
                                <Link
                                  href={source.url}
                                  onClick={closeOnPhone}
                                  className="inline-flex items-center gap-1 rounded-md border bg-fd-card px-2 py-1 text-xs hover:bg-fd-accent"
                                >
                                  <BookOpen className="size-3" />
                                  {source.title}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </li>
                  ),
                )}
              </ol>
            )}
          </div>

          <footer className="flex flex-col gap-2 border-t px-4 py-3">
            {config.chat && (
              <form onSubmit={onSubmit} className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={t.placeholder}
                  aria-label={t.placeholder}
                  maxLength={supportLimits.chatMessageLength}
                  rows={1}
                  className="field-sizing-content max-h-32 min-h-10 flex-1 resize-none rounded-xl border bg-fd-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-fd-ring"
                />
                <button
                  type="submit"
                  disabled={!canSend}
                  aria-label={t.send}
                  title={t.send}
                  className={cn(
                    buttonVariants({ variant: 'primary', size: 'icon' }),
                    'size-10 rounded-xl disabled:opacity-50',
                  )}
                >
                  {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
                </button>
              </form>
            )}
            {config.chat && config.turnstileSiteKey && (
              <Turnstile
                ref={turnstileRef}
                siteKey={config.turnstileSiteKey}
                lang={lang}
                onToken={setToken}
              />
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span className="text-fd-muted-foreground">{t.needHuman}</span>
              <Link href={`/${lang}/contact`} className={linkClass} onClick={() => setOpen(false)}>
                <Mail />
                {t.contact}
              </Link>
              <Link href={`/${lang}/feedback`} className={linkClass} onClick={() => setOpen(false)}>
                <MessageSquareText />
                {t.feedback}
              </Link>
            </div>
          </footer>
        </section>
      )}
    </>
  );
}
