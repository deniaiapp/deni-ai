import { useLocation } from '@tanstack/react-router';
import { buttonVariants } from 'fumadocs-ui/components/ui/button';
import { CheckCircle2, Loader2, MessagesSquare, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { Language } from '@/lib/i18n';
import { postSupport, supportErrorMessage } from '@/lib/support-client';
import {
  contactCategories,
  supportLimits,
  type ChatTurn,
  type ContactCategory,
  type ContactRequest,
  type FeedbackRequest,
  type SupportErrorCode,
  type SupportSentBody,
} from '@/lib/support-protocol';
import { useSupportConfig } from './support-config';
import { Turnstile, type TurnstileHandle } from './turnstile';

const labels = {
  en: {
    optional: '(optional)',
    email: 'Email',
    emailHint:
      'We reply to this address. Use the email on your Deni AI account if it’s about your account.',
    category: 'Topic',
    categories: {
      account: 'Account and sign-in',
      billing: 'Plans and billing',
      education: 'Add a school email domain (students and educators)',
      chat: 'Chat',
      flixa: 'Flixa',
      teams: 'Teams',
      bug: 'Bug report',
      privacy: 'Privacy and data',
      other: 'Other',
    } satisfies Record<ContactCategory, string>,
    subject: 'Subject',
    message: 'Message',
    messageHint:
      'Describe what you expected, what happened, and any error message. Never include passwords or card numbers.',
    educationMessageHint:
      'Include your school’s name, its email domain (for example, example.ac.jp), and its official website. We add domains that only the school can issue addresses on.',
    transcriptNote:
      'Your conversation with the AI assistant is sent along with this message, so you don’t need to repeat it.',
    sendMessage: 'Send message',
    emailUs: 'You can also email',
    contactSent: 'Message sent',
    contactSentBody: 'Thanks. We’ll reply by email, usually within a few business days.',
    feedback: 'Your feedback',
    feedbackHint: 'Ideas, feature requests, or anything we could do better.',
    feedbackEmailHint: 'Add an email if you’d like us to follow up.',
    sendFeedback: 'Send feedback',
    feedbackSent: 'Thanks for your feedback!',
    feedbackSentBody: 'We read every message.',
    unavailable: 'Online forms are not available right now. Email contact@deniai.app instead.',
    wasHelpful: 'Was this page helpful?',
    yes: 'Yes',
    no: 'No',
    helpfulPrompt: 'Anything we could add? (optional)',
    unhelpfulPrompt: 'What were you looking for? (optional)',
    submit: 'Submit',
  },
  ja: {
    optional: '（任意）',
    email: 'メールアドレス',
    emailHint:
      'このアドレスに返信します。アカウントに関するお問い合わせは、Deni AI アカウントのメールアドレスをご入力ください。',
    category: '種類',
    categories: {
      account: 'アカウント・サインイン',
      billing: 'プラン・お支払い',
      education: '学校メールドメインの追加依頼（学生・教職員）',
      chat: 'チャット',
      flixa: 'Flixa',
      teams: 'チーム',
      bug: '不具合の報告',
      privacy: 'プライバシー・データ',
      other: 'その他',
    } satisfies Record<ContactCategory, string>,
    subject: '件名',
    message: '内容',
    messageHint:
      '期待した動作、実際に起きたこと、表示されたエラーを書いてください。パスワードやカード番号は書かないでください。',
    educationMessageHint:
      '学校名、メールアドレスのドメイン（例: example.ac.jp）、学校の公式サイトの URL を書いてください。学校だけがアドレスを発行できるドメインを追加します。',
    transcriptNote:
      'AI アシスタントとの会話も一緒に送信されます。同じ内容をもう一度書く必要はありません。',
    sendMessage: '送信する',
    emailUs: 'メールでのお問い合わせ：',
    contactSent: '送信しました',
    contactSentBody: 'お問い合わせありがとうございます。通常、数営業日以内にメールで返信します。',
    feedback: 'フィードバック',
    feedbackHint: 'アイデア、機能のリクエスト、改善してほしい点など、なんでもお寄せください。',
    feedbackEmailHint: '返信を希望する場合はメールアドレスを入力してください。',
    sendFeedback: 'フィードバックを送る',
    feedbackSent: 'フィードバックありがとうございます',
    feedbackSentBody: 'いただいた内容はすべて確認しています。',
    unavailable:
      '現在フォームはご利用いただけません。contact@deniai.app までメールでご連絡ください。',
    wasHelpful: 'このページは役に立ちましたか？',
    yes: 'はい',
    no: 'いいえ',
    helpfulPrompt: '追加してほしい情報があれば教えてください（任意）',
    unhelpfulPrompt: '探していた情報を教えてください（任意）',
    submit: '送信',
  },
} satisfies Record<Language, unknown>;

// 16px text on phones: iOS zooms into inputs with smaller text on focus.
export function contactCategoryLabel(lang: Language, category: ContactCategory): string {
  return labels[lang].categories[category];
}

const inputClass =
  'w-full rounded-lg border bg-fd-card px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-fd-ring sm:text-sm';

/**
 * Proves the sender is human, resolving `undefined` when that fails. The support
 * widget passes its own, which reuses the chat's session pass and Turnstile.
 */
export type SupportVerifier = () => Promise<
  { session?: string; turnstileToken?: string } | undefined
>;

/** Shared submit state: Turnstile token, pending flag, and the last error. */
function useSubmission(verify?: SupportVerifier, onSent?: (body: SupportSentBody) => void) {
  const { email, turnstileSiteKey } = useSupportConfig();
  const [token, setToken] = useState<string>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<SupportErrorCode>();
  const [sent, setSent] = useState(false);
  const turnstileRef = useRef<TurnstileHandle>(null);

  async function submit(url: string, body: ContactRequest | FeedbackRequest) {
    setPending(true);
    setError(undefined);
    const verification = verify ? await verify() : { turnstileToken: token };
    const result = verification
      ? await postSupport(url, { ...body, ...verification })
      : ({ ok: false, error: 'verification_failed' } as const);
    turnstileRef.current?.reset();
    setPending(false);
    if (result.ok) {
      setSent(true);
      onSent?.(result.body);
    } else {
      setError(result.error);
    }
  }

  return {
    enabled: email,
    ready: email && !pending && (Boolean(verify) || !turnstileSiteKey || Boolean(token)),
    pending,
    error,
    sent,
    submit,
    turnstile: (lang: Language) =>
      turnstileSiteKey && !verify ? (
        <Turnstile ref={turnstileRef} siteKey={turnstileSiteKey} lang={lang} onToken={setToken} />
      ) : null,
  };
}

function Field({
  label,
  hint,
  optional,
  children,
}: {
  label: string;
  hint?: string;
  optional?: string;
  children: (id: string, hintId: string | undefined) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {optional && <span className="ms-1 font-normal text-fd-muted-foreground">{optional}</span>}
      </label>
      {children(id, hintId)}
      {hint && (
        <p id={hintId} className="text-xs text-fd-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Off-screen field that people never fill; bots that do are silently dropped. */
function Honeypot() {
  return (
    <input
      type="text"
      name="website"
      tabIndex={-1}
      autoComplete="off"
      aria-hidden="true"
      className="absolute -start-[9999px] size-px opacity-0"
    />
  );
}

function FormError({ lang, error }: { lang: Language; error?: SupportErrorCode }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm">
      {supportErrorMessage(lang, error)}
    </p>
  );
}

function Sent({ title, body }: { title: string; body: string }) {
  return (
    <div role="status" className="flex items-start gap-3 rounded-xl border bg-fd-card p-4">
      <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-green-600 dark:text-green-400" />
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-sm text-fd-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function SubmitButton({
  ready,
  pending,
  children,
}: {
  ready: boolean;
  pending: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={!ready}
      className={cn(buttonVariants({ variant: 'primary' }), 'gap-2 self-start disabled:opacity-50')}
    >
      {pending && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

function readForm(form: HTMLFormElement) {
  const data = new FormData(form);
  return (name: string) => {
    const value = data.get(name);
    return typeof value === 'string' ? value.trim() : '';
  };
}

/** Context from the AI support chat, where the contact and feedback forms live. */
export type ChatContext = {
  /** The conversation so far, sent along with the message when it isn't empty. */
  transcript: ChatTurn[];
  /** Page the chat was opened on. */
  pagePath?: string;
  verify: SupportVerifier;
  /** Saved conversation the message joins, so the team's reply lands in the chat. */
  conversation?: string;
  /** Called once the message is sent, with the conversation it was saved to. */
  onSent?: (body: SupportSentBody) => void;
};

function TranscriptNote({ lang }: { lang: Language }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border bg-fd-card px-3 py-2 text-xs text-fd-muted-foreground">
      <MessagesSquare className="mt-px size-3.5 shrink-0" />
      {labels[lang].transcriptNote}
    </p>
  );
}

export function ContactForm({
  lang,
  chat,
  defaultCategory = 'account',
  defaultSubject,
  defaultMessage,
  defaultEmail,
}: {
  lang: Language;
  chat: ChatContext;
  /** Preselected topic, for example from a help article's `?category=` link. */
  defaultCategory?: ContactCategory;
  defaultSubject?: string;
  defaultMessage?: string;
  defaultEmail?: string;
}) {
  const t = labels[lang];
  const submission = useSubmission(chat.verify, chat.onSent);
  const [category, setCategory] = useState<ContactCategory>(defaultCategory);
  const hasTranscript = chat.transcript.length > 0;

  if (!submission.enabled) return <FormError lang={lang} error="unavailable" />;
  if (submission.sent) return <Sent title={t.contactSent} body={t.contactSentBody} />;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const get = readForm(event.currentTarget);
    void submission.submit('/api/contact', {
      email: get('email'),
      category: get('category') as ContactCategory,
      subject: get('subject'),
      message: get('message'),
      lang,
      pagePath: chat.pagePath,
      transcript: hasTranscript ? chat.transcript : undefined,
      conversation: chat.conversation,
      website: get('website') || undefined,
    });
  }

  return (
    <form onSubmit={onSubmit} className="not-prose relative flex flex-col gap-4">
      <Field label={t.category}>
        {(id) => (
          <select
            id={id}
            name="category"
            value={category}
            onChange={(event) => setCategory(event.currentTarget.value as ContactCategory)}
            className={inputClass}
          >
            {contactCategories.map((category) => (
              <option key={category} value={category}>
                {t.categories[category]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={t.email} hint={t.emailHint}>
        {(id, hintId) => (
          <input
            id={id}
            name="email"
            type="email"
            required
            autoComplete="email"
            defaultValue={defaultEmail}
            maxLength={supportLimits.emailLength}
            aria-describedby={hintId}
            className={inputClass}
          />
        )}
      </Field>
      <Field label={t.subject}>
        {(id) => (
          <input
            id={id}
            name="subject"
            required
            defaultValue={defaultSubject}
            maxLength={supportLimits.subjectLength}
            className={inputClass}
          />
        )}
      </Field>
      <Field
        label={t.message}
        hint={category === 'education' ? t.educationMessageHint : t.messageHint}
      >
        {(id, hintId) => (
          <textarea
            id={id}
            name="message"
            required
            rows={5}
            defaultValue={defaultMessage}
            maxLength={supportLimits.messageLength}
            aria-describedby={hintId}
            className={cn(inputClass, 'resize-y')}
          />
        )}
      </Field>
      {hasTranscript && <TranscriptNote lang={lang} />}
      <Honeypot />
      <FormError lang={lang} error={submission.error} />
      <SubmitButton ready={submission.ready} pending={submission.pending}>
        {t.sendMessage}
      </SubmitButton>
      <p className="text-xs text-fd-muted-foreground">
        {t.emailUs} <a href="mailto:contact@deniai.app">contact@deniai.app</a>
      </p>
    </form>
  );
}

export function FeedbackForm({
  lang,
  chat,
  defaultMessage,
  defaultEmail,
}: {
  lang: Language;
  chat: ChatContext;
  defaultMessage?: string;
  defaultEmail?: string;
}) {
  const t = labels[lang];
  const submission = useSubmission(chat.verify, chat.onSent);
  const hasTranscript = chat.transcript.length > 0;

  if (!submission.enabled) return <FormError lang={lang} error="unavailable" />;
  if (submission.sent) return <Sent title={t.feedbackSent} body={t.feedbackSentBody} />;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const get = readForm(event.currentTarget);
    void submission.submit('/api/feedback', {
      kind: 'general',
      message: get('message'),
      email: get('email') || undefined,
      lang,
      pagePath: chat.pagePath,
      transcript: hasTranscript ? chat.transcript : undefined,
      conversation: chat.conversation,
      website: get('website') || undefined,
    });
  }

  return (
    <form onSubmit={onSubmit} className="not-prose relative flex flex-col gap-4">
      <Field label={t.feedback} hint={t.feedbackHint}>
        {(id, hintId) => (
          <textarea
            id={id}
            name="message"
            required
            rows={6}
            defaultValue={defaultMessage}
            maxLength={supportLimits.messageLength}
            aria-describedby={hintId}
            className={cn(inputClass, 'resize-y')}
          />
        )}
      </Field>
      <Field label={t.email} optional={t.optional} hint={t.feedbackEmailHint}>
        {(id, hintId) => (
          <input
            id={id}
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={defaultEmail}
            maxLength={supportLimits.emailLength}
            aria-describedby={hintId}
            className={inputClass}
          />
        )}
      </Field>
      {hasTranscript && <TranscriptNote lang={lang} />}
      <Honeypot />
      <FormError lang={lang} error={submission.error} />
      <SubmitButton ready={submission.ready} pending={submission.pending}>
        {t.sendFeedback}
      </SubmitButton>
    </form>
  );
}

/** "Was this page helpful?" at the end of an article. */
export function PageFeedback({ lang }: { lang: Language }) {
  const t = labels[lang];
  const { pathname } = useLocation();
  const submission = useSubmission();
  const [helpful, setHelpful] = useState<boolean>();

  if (!submission.enabled) return null;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (helpful === undefined) return;
    const get = readForm(event.currentTarget);
    void submission.submit('/api/feedback', {
      kind: 'page',
      helpful,
      message: get('message') || undefined,
      lang,
      pagePath: pathname,
      website: get('website') || undefined,
    });
  }

  return (
    <div className="not-prose mt-10 border-t pt-6">
      {submission.sent ? (
        <Sent title={t.feedbackSent} body={t.feedbackSentBody} />
      ) : (
        <form onSubmit={onSubmit} className="relative flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-medium">{t.wasHelpful}</p>
            {([true, false] as const).map((value) => (
              <button
                key={String(value)}
                type="button"
                aria-pressed={helpful === value}
                onClick={() => setHelpful(value)}
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'sm' }),
                  'gap-1.5',
                  helpful === value && 'bg-fd-accent text-fd-accent-foreground',
                )}
              >
                {value ? <ThumbsUp className="size-3.5" /> : <ThumbsDown className="size-3.5" />}
                {value ? t.yes : t.no}
              </button>
            ))}
          </div>
          {helpful !== undefined && (
            <>
              <textarea
                name="message"
                rows={3}
                maxLength={supportLimits.messageLength}
                aria-label={helpful ? t.helpfulPrompt : t.unhelpfulPrompt}
                placeholder={helpful ? t.helpfulPrompt : t.unhelpfulPrompt}
                className={cn(inputClass, 'resize-y')}
              />
              <Honeypot />
              {submission.turnstile(lang)}
              <FormError lang={lang} error={submission.error} />
              <SubmitButton ready={submission.ready} pending={submission.pending}>
                {t.submit}
              </SubmitButton>
            </>
          )}
        </form>
      )}
    </div>
  );
}
