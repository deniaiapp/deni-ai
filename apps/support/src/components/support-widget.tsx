import { useLocation, useRouter } from '@tanstack/react-router';
import { buttonVariants } from 'fumadocs-ui/components/ui/button';
import Link from 'fumadocs-core/link';
import { createMarkdownRenderer } from 'fumadocs-core/content/md';
import { remarkGfm } from 'fumadocs-core/mdx-plugins/remark-gfm';
import {
  ArrowLeft,
  ArrowUp,
  BookOpen,
  LifeBuoy,
  Loader2,
  Mail,
  MessageSquareText,
  Reply,
  RotateCcw,
  Search,
  UserRound,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';
import { feedbackTemplate, feedbackTemplateParams } from '@/lib/feedback-templates';
import type { Language } from '@/lib/i18n';
import { siteUrl } from '@/lib/shared';
import { postSupport, readSupportError, supportErrorMessage } from '@/lib/support-client';
import {
  isContactCategory,
  supportConversationHeader,
  supportLimits,
  supportSessionHeader,
  type ChatEvent,
  type ChatTurn,
  type ContactCategory,
  type ConversationBody,
  type ConversationMessage,
  type SentRequest,
  type SupportDraft,
  type SupportErrorCode,
  type SupportSentBody,
} from '@/lib/support-protocol';
import { useSupportConfig } from './support-config';
import { SupportDraftCard, type DraftState } from './support-draft-card';
import { ContactForm, FeedbackForm, type ChatContext } from './support-forms';
import { loadTurnstile, Turnstile, type TurnstileHandle } from './turnstile';

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
    verifying: 'Checking you’re human…',
    sources: 'Sources',
    contact: 'Contact support',
    feedback: 'Send feedback',
    needHelp: 'Need more help?',
    newReply: 'New reply from support',
    staffReply: 'Deni AI Support team',
    replyToStaff: 'Reply',
    sentToSupport: (subject: string) => `Sent to support: ${subject}`,
    sentFeedback: 'Sent as feedback',
    backToChat: 'Back to chat',
    contactSubtitle: 'Our team replies by email, usually within a few business days.',
    feedbackSubtitle: 'Ideas and requests for Deni AI, Flixa, or this help center.',
    chatUnavailable:
      'The AI assistant is not available right now. Use the buttons below to contact support or send feedback.',
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
    verifying: '確認中…',
    sources: '参照した記事',
    contact: 'サポートに問い合わせる',
    feedback: 'フィードバックを送る',
    needHelp: '相談したい場合',
    newReply: 'サポートから新しい返信があります',
    staffReply: 'Deni AI サポート担当',
    replyToStaff: '返信する',
    sentToSupport: (subject: string) => `サポートに送信：${subject}`,
    sentFeedback: 'フィードバックとして送信',
    backToChat: 'チャットに戻る',
    contactSubtitle: '担当者が通常、数営業日以内にメールで返信します。',
    feedbackSubtitle: 'Deni AI、Flixa、ヘルプセンターへのご意見・ご要望をお寄せください。',
    chatUnavailable:
      '現在 AI アシスタントはご利用いただけません。下のボタンからサポートへの問い合わせやフィードバックの送信ができます。',
  },
} satisfies Record<Language, unknown>;

type UiMessage = {
  id: number;
  /** `staff` is a reply from the support team, delivered through the saved conversation. */
  role: 'user' | 'assistant' | 'staff';
  content: string;
  /** Set on a user message that was sent to the team as contact or feedback. */
  request?: SentRequest;
  /** ISO timestamp, known for messages loaded from the saved conversation. */
  createdAt?: string;
  status?: { kind: 'thinking' | 'search' | 'read'; text: string };
  sources?: { title: string; url: string }[];
  error?: SupportErrorCode;
  pending?: boolean;
  /** Messages the assistant drafted for the user to send. */
  drafts?: UiDraft[];
};

type UiDraft = { id: number; draft: SupportDraft; state: DraftState; error?: SupportErrorCode };

const { Markdown } = createMarkdownRenderer({ remarkPlugins: [remarkGfm] });

/** Conversation history for the API: only exchanges that got an answer. */
function toTurns(messages: UiMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (let i = 0; i < messages.length - 1; i++) {
    const question = messages[i]!;
    const answer = messages[i + 1]!;
    if (
      question.role === 'user' &&
      !question.request &&
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

/** The conversation to attach to a contact message, newest messages kept. */
function toTranscript(messages: UiMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const m of messages) {
    const content = m.content.trim().slice(0, supportLimits.chatMessageLength);
    // The team already has its own replies.
    if (content && m.role !== 'staff') turns.push({ role: m.role, content });
  }
  while (
    turns.length > supportLimits.chatMessages ||
    turns.reduce((n, t) => n + t.content.length, 0) > supportLimits.chatTotalLength
  ) {
    turns.shift();
  }
  return turns;
}

type FormKind = 'contact' | 'feedback';

/** What the panel shows instead of the chat: a form, maybe prefilled from a draft. */
type PanelForm = {
  kind: FormKind;
  /** Remounts the form each time it opens. */
  key: number;
  category?: ContactCategory;
  subject?: string;
  /** Starting text for the feedback form, from a `?from=` app link. */
  message?: string;
  draftId?: number;
};

const supportPathPattern = /^\/(?:en|ja)\/(contact|feedback)\/?(?:[?#]|$)/;

/**
 * Reads a link to the contact or feedback form, as articles and the assistant write
 * them (`/en/contact?category=billing`), so it can open in the widget instead.
 */
function readSupportLink(
  href: string | null | undefined,
): { kind: FormKind; category?: ContactCategory } | undefined {
  if (!href) return undefined;
  let path = href;
  for (const origin of [siteUrl, window.location.origin]) {
    if (path.startsWith(origin)) path = path.slice(origin.length);
  }
  const kind = supportPathPattern.exec(path)?.[1] as FormKind | undefined;
  if (!kind) return undefined;
  const category = new URLSearchParams(path.split('#')[0]!.split('?')[1]).get('category');
  return { kind, category: isContactCategory(category) ? category : undefined };
}

const passStorageKey = 'deni-support:chat-pass';

/** Whether a session pass is still valid for at least a minute. */
function isPassFresh(pass: string): boolean {
  return Number(pass.split('.')[0]) > Date.now() + 60_000;
}

/** A stored session pass that is still valid for at least a minute. */
function readStoredPass(): string | undefined {
  try {
    const pass = localStorage.getItem(passStorageKey);
    if (pass && isPassFresh(pass)) return pass;
  } catch {
    // Storage can be blocked; the chat then verifies with Turnstile.
  }
  return undefined;
}

function storePass(pass: string | undefined) {
  try {
    if (pass) localStorage.setItem(passStorageKey, pass);
    else localStorage.removeItem(passStorageKey);
  } catch {
    // Not persisted; the pass still works for this page.
  }
}

/** Credential of the saved conversation, which also receives the team's replies. */
const conversationStorageKey = 'deni-support:conversation';
/** Time of the newest team reply the visitor has seen, for the unread dot. */
const replySeenStorageKey = 'deni-support:reply-seen';
/** Reply emails link to `/{lang}#support-conversation=<credential>`. */
const conversationHashKey = 'support-conversation';

function readStorage(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeStorage(key: string, value: string | undefined) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Storage can be blocked; the conversation then lasts for this page only.
  }
}

/** Newest team reply time among the messages, as an ISO string. */
function latestReplyAt(messages: { role: string; createdAt?: string }[]): string | undefined {
  let latest: string | undefined;
  for (const m of messages) {
    if (m.role === 'staff' && m.createdAt && (!latest || m.createdAt > latest)) {
      latest = m.createdAt;
    }
  }
  return latest;
}

export function SupportWidget({ lang }: { lang: Language }) {
  const t = labels[lang];
  const config = useSupportConfig();
  const { pathname } = useLocation();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // The panel mounts before it first opens so Turnstile can run in the background.
  const [mounted, setMounted] = useState(false);
  // Only read once the panel mounts, which never happens during server rendering.
  const [needsTurnstile, setNeedsTurnstile] = useState(
    () => typeof window === 'undefined' || !readStoredPass(),
  );
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  /** Set while the panel shows the contact or feedback form instead of the chat. */
  const [form, setForm] = useState<PanelForm>();
  const turnstileRef = useRef<TurnstileHandle | null>(null);
  const turnstileWaitersRef = useRef<((turnstile: TurnstileHandle) => void)[]>([]);
  /** Pass from the last answer that lets the next message skip Turnstile. */
  const sessionRef = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nextId = useRef(0);
  const formKeyRef = useRef(0);
  /** Saved conversation credential; the server returns one with each chat answer. */
  const conversationRef = useRef<string | undefined>(undefined);
  /** A team reply the visitor hasn't seen yet. */
  const [unread, setUnread] = useState(false);
  const initialLoadRef = useRef<Promise<unknown> | undefined>(undefined);

  const canSend = config.chat && !busy && input.trim().length > 0;

  useEffect(() => {
    const pass = readStoredPass();
    if (pass) {
      sessionRef.current = pass;
      return;
    }
    if (!config.chat || !config.turnstileSiteKey) return;

    // Without a pass, start the challenge once the page is idle so a token is
    // ready by the time the visitor opens the chat.
    const mount = () => setMounted(true);
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(mount, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(mount, 1000);
    return () => window.clearTimeout(id);
  }, [config.chat, config.turnstileSiteKey]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && !form) el.scrollTop = el.scrollHeight;
  }, [messages, form]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  // The panel covers the page on phones; app.css locks the page scroll there.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    root.dataset.supportChatOpen = '';
    return () => {
      delete root.dataset.supportChatOpen;
    };
  }, [open]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Contact and feedback links anywhere on the site (articles, answers) open the
  // forms here instead of leaving the page.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!anchor || anchor.getAttribute('target') === '_blank') return;
      const link = readSupportLink(anchor.getAttribute('href'));
      if (!link) return;
      // Captured on the document, before the router's own link handling runs.
      event.preventDefault();
      event.stopPropagation();
      openForm(link);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  // Restore the saved conversation, or open the one a reply email links to.
  useEffect(() => {
    const linked = new URLSearchParams(window.location.hash.slice(1)).get(conversationHashKey);
    if (linked) {
      setConversation(linked);
      router.history.replace(`${window.location.pathname}${window.location.search}`);
      openPanel();
    } else {
      conversationRef.current = readStorage(conversationStorageKey);
    }
    initialLoadRef.current = loadConversation('replace');
  }, [router]);

  // Check for new team replies whenever the panel opens, and mark them seen.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      await initialLoadRef.current;
      const latest = await loadConversation('replies');
      if (cancelled || !latest) return;
      writeStorage(replySeenStorageKey, latest);
      setUnread(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // `/{lang}/contact` and `/{lang}/feedback` redirect to `?support=…`, opening a form.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const kind = params.get('support');
    if (kind !== 'contact' && kind !== 'feedback') return;
    const category = params.get('category');
    openForm({
      kind,
      category: isContactCategory(category) ? category : undefined,
      message: kind === 'feedback' ? feedbackTemplate(lang, params) : undefined,
    });

    params.delete('support');
    params.delete('category');
    for (const key of feedbackTemplateParams) params.delete(key);
    const search = params.toString();
    router.history.replace(
      `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`,
    );
  }, [router, lang]);

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
        status: { kind: 'thinking', text: needsToken() ? t.verifying : t.thinking },
        pending: true,
      },
    ]);
    setInput('');
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const post = async (): Promise<Response | SupportErrorCode> => {
      const verification = await verify();
      if (!verification) return 'verification_failed';
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      updateAnswer(answerId, (m) => ({ ...m, status: { kind: 'thinking', text: t.thinking } }));
      return fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...history, { role: 'user', content: question }],
          lang,
          pagePath: pathname,
          conversation: conversationRef.current,
          ...verification,
        }),
        signal: controller.signal,
      });
    };

    try {
      const usedSession = Boolean(sessionRef.current);
      let response = await post();
      // An expired pass: drop it and verify with Turnstile once.
      if (usedSession && response instanceof Response && response.status === 403) {
        setPass(undefined);
        updateAnswer(answerId, (m) => ({ ...m, status: { kind: 'thinking', text: t.verifying } }));
        response = await post();
      }

      if (!(response instanceof Response)) {
        const error = response;
        updateAnswer(answerId, (m) => ({ ...m, pending: false, status: undefined, error }));
        return;
      }

      const pass = response.headers.get(supportSessionHeader);
      if (pass) setPass(pass);
      const conversation = response.headers.get(supportConversationHeader);
      if (conversation) setConversation(conversation);

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
            case 'draft': {
              const id = nextId.current++;
              updateAnswer(answerId, (m) => ({
                ...m,
                drafts: [...(m.drafts ?? []), { id, draft: event.draft, state: 'ready' }],
              }));
              break;
            }
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

  function setPass(pass: string | undefined) {
    sessionRef.current = pass;
    storePass(pass);
    setNeedsTurnstile(!pass);
  }

  // Turnstile unmounts while a pass is held, so callers may wait for it to mount.
  function attachTurnstile(turnstile: TurnstileHandle | null) {
    turnstileRef.current = turnstile;
    if (turnstile) for (const resolve of turnstileWaitersRef.current.splice(0)) resolve(turnstile);
  }

  function getTurnstile(): Promise<TurnstileHandle> {
    const turnstile = turnstileRef.current;
    if (turnstile) return Promise.resolve(turnstile);
    return new Promise((resolve) => turnstileWaitersRef.current.push(resolve));
  }

  function needsToken() {
    return Boolean(config.turnstileSiteKey) && !sessionRef.current;
  }

  /** The session pass, or a fresh Turnstile token when there is none. */
  async function verify(): Promise<{ session?: string; turnstileToken?: string } | undefined> {
    if (!config.turnstileSiteKey) return {};
    // A pass about to expire (the chat may have sat open) falls back to Turnstile.
    if (sessionRef.current && !isPassFresh(sessionRef.current)) setPass(undefined);
    if (sessionRef.current) return { session: sessionRef.current };
    const turnstileToken = await (await getTurnstile()).take();
    return turnstileToken ? { turnstileToken } : undefined;
  }

  // Fetch the Turnstile script as soon as the visitor reaches for the button.
  function preload() {
    if (config.chat && config.turnstileSiteKey) loadTurnstile().catch(() => {});
  }

  function setConversation(credential: string | undefined) {
    conversationRef.current = credential;
    writeStorage(conversationStorageKey, credential);
  }

  function fromSaved(saved: ConversationMessage): UiMessage {
    return {
      id: nextId.current++,
      role: saved.role,
      content: saved.content,
      createdAt: saved.createdAt,
      request: saved.request,
      sources: saved.sources,
    };
  }

  /**
   * Fetches the saved conversation. `replace` restores it into an empty chat;
   * `replies` only appends team replies newer than the ones shown. Resolves with
   * the newest reply time.
   */
  async function loadConversation(mode: 'replace' | 'replies'): Promise<string | undefined> {
    const credential = conversationRef.current;
    if (!credential) return undefined;

    let body: ConversationBody;
    try {
      const response = await fetch('/api/conversation', {
        headers: { Authorization: `Bearer ${credential}` },
        cache: 'no-store',
      });
      // No longer valid (for example, the server secret changed): start afresh.
      if (response.status === 400) {
        if (conversationRef.current === credential) setConversation(undefined);
        return undefined;
      }
      if (!response.ok) return undefined;
      body = (await response.json()) as ConversationBody;
    } catch {
      return undefined;
    }
    if (conversationRef.current !== credential) return undefined;

    setMessages((current) => {
      if (mode === 'replace') return current.length === 0 ? body.messages.map(fromSaved) : current;
      const shown = latestReplyAt(current);
      const fresh = body.messages.filter(
        (m) => m.role === 'staff' && (!shown || m.createdAt > shown),
      );
      return fresh.length > 0 ? [...current, ...fresh.map(fromSaved)] : current;
    });

    const latest = latestReplyAt(body.messages);
    const seen = readStorage(replySeenStorageKey);
    setUnread(Boolean(latest && (!seen || latest > seen)));
    return latest;
  }

  /** Keeps the conversation a contact or feedback message was saved to, and shows it. */
  function addSentRequest(body: SupportSentBody) {
    if (body.conversation) setConversation(body.conversation);
    const saved = body.message;
    if (saved) setMessages((current) => [...current, fromSaved(saved)]);
  }

  function openPanel() {
    setMounted(true);
    setOpen(true);
  }

  function openForm(next: Omit<PanelForm, 'key'>) {
    openPanel();
    formKeyRef.current += 1;
    setForm({ ...next, key: formKeyRef.current });
  }

  function updateDraft(id: number, update: Partial<UiDraft>) {
    setMessages((current) =>
      current.map((m) =>
        m.drafts?.some((d) => d.id === id)
          ? { ...m, drafts: m.drafts.map((d) => (d.id === id ? { ...d, ...update } : d)) }
          : m,
      ),
    );
  }

  function findDraft(id: number | undefined): UiDraft | undefined {
    if (id === undefined) return undefined;
    for (const message of messages) {
      const draft = message.drafts?.find((d) => d.id === id);
      if (draft) return draft;
    }
    return undefined;
  }

  /** Sends an assistant draft as is, with the conversation attached. */
  async function sendDraft({ id, draft }: UiDraft) {
    updateDraft(id, { state: 'sending', error: undefined });
    const verification = await verify();
    if (!verification) {
      updateDraft(id, { state: 'ready', error: 'verification_failed' });
      return;
    }
    const transcript = toTranscript(messages);
    const shared = {
      lang,
      pagePath: pathname,
      transcript: transcript.length > 0 ? transcript : undefined,
      conversation: conversationRef.current,
      ...verification,
    };
    const result =
      draft.kind === 'contact'
        ? await postSupport('/api/contact', {
            ...shared,
            email: draft.email,
            category: draft.category,
            subject: draft.subject,
            message: draft.message,
          })
        : await postSupport('/api/feedback', {
            ...shared,
            kind: 'general',
            email: draft.email,
            message: draft.message,
          });
    if (!result.ok) {
      updateDraft(id, { state: 'ready', error: result.error });
      return;
    }
    updateDraft(id, { state: 'sent' });
    addSentRequest(result.body);
  }

  function reset() {
    setForm(undefined);
    // A new chat is a new saved conversation; reply emails still link to the old one.
    setConversation(undefined);
    setUnread(false);
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

  // An open form edits the draft it came from, if any, and marks it sent with it.
  const formDraftId = form?.draftId;
  const formDraft = findDraft(formDraftId)?.draft;
  const formChat: ChatContext = {
    transcript: toTranscript(messages),
    pagePath: pathname,
    verify,
    conversation: conversationRef.current,
    onSent: (body) => {
      if (formDraftId !== undefined) updateDraft(formDraftId, { state: 'sent', error: undefined });
      addSentRequest(body);
    },
  };

  /** Prefills a contact form that answers a team reply, on the topic last asked about. */
  function replyToStaff() {
    const lastContact = messages
      .map((m) => m.request)
      .filter((r) => r?.kind === 'contact')
      .at(-1);
    const subject = lastContact?.kind === 'contact' ? lastContact.subject : undefined;
    openForm({
      kind: 'contact',
      category: lastContact?.kind === 'contact' ? lastContact.category : undefined,
      subject: subject ? `Re: ${subject.replace(/^Re:\s*/i, '')}` : undefined,
    });
  }

  return (
    <>
      <button
        type="button"
        aria-label={t.open}
        aria-expanded={open}
        onClick={() => {
          setMounted(true);
          setOpen((value) => !value);
        }}
        onPointerEnter={preload}
        onFocus={preload}
        className={cn(
          'fixed bottom-4 end-4 z-40 inline-flex items-center gap-2 rounded-full bg-fd-primary px-4 py-2.5 text-sm font-medium text-fd-primary-foreground shadow-lg transition-transform hover:scale-105',
          open && 'max-sm:hidden',
        )}
      >
        {open ? <X className="size-4" /> : <LifeBuoy className="size-4" />}
        <span className={cn(open && 'sr-only')}>{t.open}</span>
        {unread && !open && (
          <span className="absolute -top-0.5 -end-0.5 size-3 rounded-full border-2 border-fd-background bg-red-500">
            <span className="sr-only">{t.newReply}</span>
          </span>
        )}
      </button>

      {mounted && (
        <section
          role="dialog"
          aria-label={t.title}
          aria-hidden={!open}
          inert={!open}
          // Hidden with visibility, not display, so Turnstile keeps running while closed.
          className={cn(
            'fixed inset-0 z-50 flex flex-col bg-fd-background sm:inset-auto sm:bottom-18 sm:end-4 sm:h-[min(640px,calc(100dvh-6rem))] sm:w-[400px] sm:rounded-2xl sm:border sm:shadow-2xl',
            !open && 'pointer-events-none invisible',
          )}
        >
          <header className="flex items-start gap-2 border-b px-4 py-3">
            {form && (
              <button
                type="button"
                onClick={() => setForm(undefined)}
                aria-label={t.backToChat}
                title={t.backToChat}
                className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), '-ms-2')}
              >
                <ArrowLeft />
              </button>
            )}
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">
                {form ? (form.kind === 'contact' ? t.contact : t.feedback) : t.title}
              </h2>
              <p className="text-xs text-fd-muted-foreground">
                {form
                  ? form.kind === 'contact'
                    ? t.contactSubtitle
                    : t.feedbackSubtitle
                  : t.subtitle}
              </p>
            </div>
            {!form && messages.length > 0 && (
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

          {form && (
            <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
              {form.kind === 'contact' ? (
                <ContactForm
                  key={form.key}
                  lang={lang}
                  chat={formChat}
                  defaultCategory={
                    formDraft?.kind === 'contact' ? formDraft.category : (form.category ?? 'other')
                  }
                  defaultSubject={
                    formDraft?.kind === 'contact'
                      ? formDraft.subject
                      : (form.subject ??
                        messages
                          .find((m) => m.role === 'user' && !m.request)
                          ?.content.replace(/\s+/g, ' ')
                          .slice(0, supportLimits.subjectLength))
                  }
                  defaultMessage={formDraft?.message}
                  defaultEmail={formDraft?.email}
                />
              ) : (
                <FeedbackForm
                  key={form.key}
                  lang={lang}
                  chat={formChat}
                  defaultMessage={formDraft?.message ?? form.message}
                  defaultEmail={formDraft?.email}
                />
              )}
            </div>
          )}

          {/* Hidden, not unmounted, so the conversation stays put behind the forms. */}
          <div
            ref={scrollRef}
            className={cn(
              'flex-1 overflow-y-auto overscroll-contain px-4 py-4',
              form && 'hidden',
            )}
            aria-live="polite"
          >
            {messages.length === 0 ? (
              <div className="flex flex-col gap-4">
                <p className="text-sm">{config.chat ? t.intro : t.chatUnavailable}</p>
                {config.chat && (
                  <div className="flex flex-col items-start gap-2">
                    {t.suggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
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
                      className="ms-8 flex min-w-0 flex-col gap-1 self-end whitespace-pre-wrap wrap-anywhere rounded-2xl rounded-ee-md bg-fd-primary px-3 py-2 text-sm text-fd-primary-foreground"
                    >
                      {message.request && (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium opacity-80 [&_svg]:size-3.5">
                          {message.request.kind === 'contact' ? <Mail /> : <MessageSquareText />}
                          {message.request.kind === 'contact'
                            ? t.sentToSupport(message.request.subject)
                            : t.sentFeedback}
                        </span>
                      )}
                      {message.content}
                    </li>
                  ) : message.role === 'staff' ? (
                    <li
                      key={message.id}
                      className="me-4 flex min-w-0 flex-col gap-2 rounded-2xl rounded-es-md border border-fd-primary/30 bg-fd-accent/50 px-3 py-2 text-sm"
                    >
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-fd-muted-foreground [&_svg]:size-3.5">
                        <UserRound />
                        {t.staffReply}
                      </span>
                      <div className="prose prose-sm max-w-none min-w-0 text-sm wrap-anywhere [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                        <Markdown>{message.content}</Markdown>
                      </div>
                      <button
                        type="button"
                        onClick={replyToStaff}
                        className={cn(
                          buttonVariants({ variant: 'outline', size: 'sm' }),
                          'gap-1.5 self-start',
                        )}
                      >
                        <Reply className="size-3.5" />
                        {t.replyToStaff}
                      </button>
                    </li>
                  ) : (
                    <li key={message.id} className="flex flex-col gap-2">
                      {message.content && (
                        // Long unbroken text (inline code, URLs) wraps; code blocks and tables scroll.
                        <div className="prose prose-sm max-w-none min-w-0 text-sm wrap-anywhere [&_pre]:overflow-x-auto [&_table]:block [&_table]:overflow-x-auto [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                          <Markdown
                            components={{
                              // Contact and feedback links are caught by the document listener.
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
                      {message.drafts?.map((draft) => (
                        <SupportDraftCard
                          key={draft.id}
                          lang={lang}
                          draft={draft.draft}
                          state={draft.state}
                          error={draft.error}
                          onSend={() => void sendDraft(draft)}
                          onEdit={() => openForm({ kind: draft.draft.kind, draftId: draft.id })}
                        />
                      ))}
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

          {/* The forms keep only Turnstile here, which is invisible unless challenged. */}
          <footer
            className={cn('flex flex-col gap-2 border-t px-4 py-3', form && 'border-t-0 py-0')}
          >
            {config.chat && !form && (
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
                  // 16px on phones: iOS zooms into inputs with smaller text on focus.
                  className="field-sizing-content max-h-32 min-h-10 flex-1 resize-none rounded-xl border bg-fd-card px-3 py-2 text-base outline-none sm:text-sm focus-visible:ring-2 focus-visible:ring-fd-ring"
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
            {(config.chat || form) && config.turnstileSiteKey && needsTurnstile && (
              <Turnstile ref={attachTurnstile} siteKey={config.turnstileSiteKey} lang={lang} />
            )}
            {!form && (
              <div className="flex flex-col gap-1 text-xs">
                <p className="text-fd-muted-foreground">{t.needHelp}</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <button
                    type="button"
                    className={linkClass}
                    onClick={() => openForm({ kind: 'contact' })}
                  >
                    <Mail />
                    {t.contact}
                  </button>
                  <button
                    type="button"
                    className={linkClass}
                    onClick={() => openForm({ kind: 'feedback' })}
                  >
                    <MessageSquareText />
                    {t.feedback}
                  </button>
                </div>
              </div>
            )}
          </footer>
        </section>
      )}
    </>
  );
}
