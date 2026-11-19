import type { Language } from './i18n';
import type { SupportErrorBody, SupportErrorCode, SupportSentBody } from './support-protocol';

const errorMessages = {
  en: {
    invalid: 'Some fields are missing or too long. Check the form and try again.',
    rate_limited: 'Too many requests. Wait a moment and try again.',
    verification_failed: 'We could not verify that you are human. Try again.',
    unavailable: 'This is not available right now. Email contact@deniai.app instead.',
    refused: 'The assistant can’t help with that request.',
    failed: 'Something went wrong. Try again, or email contact@deniai.app.',
  },
  ja: {
    invalid: '未入力の項目があるか、文字数が多すぎます。内容を確認してもう一度お試しください。',
    rate_limited: 'リクエストが多すぎます。少し待ってからもう一度お試しください。',
    verification_failed: '確認に失敗しました。もう一度お試しください。',
    unavailable: '現在ご利用いただけません。contact@deniai.app までメールでご連絡ください。',
    refused: 'このリクエストにはお答えできません。',
    failed:
      'エラーが発生しました。もう一度お試しいただくか、contact@deniai.app までご連絡ください。',
  },
} satisfies Record<Language, Record<SupportErrorCode, string>>;

export function supportErrorMessage(lang: Language, code: SupportErrorCode): string {
  return errorMessages[lang][code];
}

/** Reads the error code from a non-OK support response. */
export async function readSupportError(response: Response): Promise<SupportErrorCode> {
  try {
    const body = (await response.json()) as Partial<SupportErrorBody>;
    if (body.error && body.error in errorMessages.en) return body.error;
  } catch {
    // Not a support error body (e.g. a proxy error page).
  }
  return response.status === 429 ? 'rate_limited' : 'failed';
}

/** POSTs JSON to a support endpoint. */
export async function postSupport(
  url: string,
  body: unknown,
): Promise<{ ok: true; body: SupportSentBody } | { ok: false; error: SupportErrorCode }> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      const sent = (await response.json().catch(() => undefined)) as SupportSentBody | undefined;
      return { ok: true, body: sent ?? { ok: true } };
    }
    return { ok: false, error: await readSupportError(response) };
  } catch {
    return { ok: false, error: 'failed' };
  }
}
