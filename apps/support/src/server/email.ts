// Plain-text email through the Cloudflare Email Sending REST API, like deni-ai.
// https://developers.cloudflare.com/email-service/api/send-emails/rest-api/

import { serverEnv } from './env';

type EmailAddress = string | { address: string; name?: string };

type CloudflareApiResponse = {
  success: boolean;
  errors?: { code: number; message: string }[];
};

export function isEmailConfigured(): boolean {
  return Boolean(serverEnv.cloudflareAccountId && serverEnv.cloudflareApiToken);
}

/** Parses `Name <addr@domain>` or a bare address into the REST shape. */
function toAddress(value: string): EmailAddress {
  const match = value.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (!match) return value.trim();
  const name = match[1]?.trim();
  const address = match[2]!.trim();
  return name ? { name, address } : address;
}

export async function sendSupportEmail(options: {
  subject: string;
  text: string;
  replyTo?: string;
  /** Defaults to the support team (SUPPORT_EMAIL_TO). */
  to?: string;
}): Promise<void> {
  if (!isEmailConfigured()) {
    throw new Error(
      'Cloudflare Email Sending is not configured (set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN).',
    );
  }

  const body: Record<string, unknown> = {
    from: toAddress(serverEnv.supportEmailFrom),
    to: [options.to ?? serverEnv.supportEmailTo],
    // Headers can't carry line breaks.
    subject: options.subject.replace(/[\r\n]+/g, ' ').slice(0, 200),
    text: options.text,
  };
  if (options.replyTo) body.reply_to = options.replyTo;

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${serverEnv.cloudflareAccountId}/email/sending/send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serverEnv.cloudflareApiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );

  let data: CloudflareApiResponse | undefined;
  try {
    data = (await response.json()) as CloudflareApiResponse;
  } catch {
    // Reported below with the HTTP status.
  }

  if (!response.ok || !data?.success) {
    const detail =
      data?.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') ||
      `${response.status} ${response.statusText}`;
    throw new Error(`Cloudflare Email Sending failed: ${detail}`);
  }
}
