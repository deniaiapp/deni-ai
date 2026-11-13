import { buttonVariants } from 'fumadocs-ui/components/ui/button';
import { CheckCircle2, Loader2, Mail, MessageSquareText, Pencil, Send } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { Language } from '@/lib/i18n';
import { supportErrorMessage } from '@/lib/support-client';
import type { SupportDraft, SupportErrorCode } from '@/lib/support-protocol';
import { contactCategoryLabel } from './support-forms';

const labels = {
  en: {
    contact: 'Message to support',
    feedback: 'Feedback',
    notSent: 'Not sent yet. Check it, then press Send.',
    topic: 'Topic',
    replyTo: 'Reply to',
    noEmail: 'Not set. Add it with Edit.',
    subject: 'Subject',
    send: 'Send',
    edit: 'Edit',
    contactSent: 'Sent. Our team will reply by email.',
    feedbackSent: 'Sent. Thanks for your feedback!',
  },
  ja: {
    contact: 'サポートへの連絡',
    feedback: 'フィードバック',
    notSent: 'まだ送信されていません。内容を確認して「送信」を押してください。',
    topic: '種類',
    replyTo: '返信先',
    noEmail: '未入力です。「編集」から入力してください。',
    subject: '件名',
    send: '送信',
    edit: '編集',
    contactSent: '送信しました。担当者からメールで返信します。',
    feedbackSent: '送信しました。フィードバックありがとうございます。',
  },
} satisfies Record<Language, unknown>;

export type DraftState = 'ready' | 'sending' | 'sent';

/** A message the assistant prepared, shown under its answer for the user to send. */
export function SupportDraftCard({
  lang,
  draft,
  state,
  error,
  onSend,
  onEdit,
}: {
  lang: Language;
  draft: SupportDraft;
  state: DraftState;
  error?: SupportErrorCode;
  onSend: () => void;
  onEdit: () => void;
}) {
  const t = labels[lang];
  const isContact = draft.kind === 'contact';
  const canSend = state === 'ready' && (!isContact || Boolean(draft.email));

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border bg-fd-card p-3 text-sm">
      <p className="inline-flex items-center gap-1.5 text-xs font-medium text-fd-muted-foreground [&_svg]:size-3.5">
        {isContact ? <Mail /> : <MessageSquareText />}
        {isContact ? t.contact : t.feedback}
      </p>

      {isContact && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-fd-muted-foreground">{t.topic}</dt>
          <dd>{contactCategoryLabel(lang, draft.category)}</dd>
          <dt className="text-fd-muted-foreground">{t.replyTo}</dt>
          <dd className={cn('wrap-anywhere', !draft.email && 'text-red-600 dark:text-red-400')}>
            {draft.email ?? t.noEmail}
          </dd>
          <dt className="text-fd-muted-foreground">{t.subject}</dt>
          <dd className="wrap-anywhere font-medium">{draft.subject}</dd>
        </dl>
      )}
      {!isContact && draft.email && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-xs">
          <dt className="text-fd-muted-foreground">{t.replyTo}</dt>
          <dd className="wrap-anywhere">{draft.email}</dd>
        </dl>
      )}

      <p className="max-h-48 overflow-y-auto whitespace-pre-wrap wrap-anywhere rounded-lg bg-fd-muted px-3 py-2 text-xs">
        {draft.message}
      </p>

      {error && (
        <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs">
          {supportErrorMessage(lang, error)}
        </p>
      )}

      {state === 'sent' ? (
        <p role="status" className="inline-flex items-center gap-1.5 text-xs font-medium">
          <CheckCircle2 className="size-4 text-green-600 dark:text-green-400" />
          {isContact ? t.contactSent : t.feedbackSent}
        </p>
      ) : (
        <>
          <p className="text-xs text-fd-muted-foreground">{t.notSent}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onSend}
              disabled={!canSend}
              className={cn(
                buttonVariants({ variant: 'primary', size: 'sm' }),
                'gap-1.5 disabled:opacity-50',
              )}
            >
              {state === 'sending' ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" />
              )}
              {t.send}
            </button>
            <button
              type="button"
              onClick={onEdit}
              disabled={state === 'sending'}
              className={cn(
                buttonVariants({ variant: 'outline', size: 'sm' }),
                'gap-1.5 disabled:opacity-50',
              )}
            >
              <Pencil className="size-3.5" />
              {t.edit}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
