import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "react-email";

export type SubscriptionEndingEmailLocale = "en" | "ja";

export type SubscriptionEndingEmailProps = {
  locale: SubscriptionEndingEmailLocale;
  name?: string | null;
  /** Display name of the plan, e.g. "Pro". */
  planName: string;
  /** The day the plan ends, already formatted for `locale`. */
  endDate: string;
  /** Billing settings, where the subscription can be resumed. */
  billingUrl: string;
};

const copy = {
  en: {
    subject: (planName: string, endDate: string) =>
      `Your Deni AI ${planName} plan ends on ${endDate}`,
    heading: (planName: string) => `Your ${planName} plan is about to end`,
    greeting: (name?: string | null) => `Hi${name ? ` ${name}` : ""},`,
    body: (planName: string, endDate: string) =>
      `Your Deni AI ${planName} plan is set to end on ${endDate}. After that your account moves to the Free plan: your chats stay, and the ${planName} models and usage limits are no longer available.`,
    resume:
      "If you would like to keep it, you can resume the plan from your billing settings. Nothing changes and you are charged on the usual renewal date.",
    button: "Keep my plan",
    fallback: "If the button does not work, open this link directly:",
    ignore: "If you meant to cancel, you do not need to do anything. You will not be charged.",
    reply: "Is something missing or not working for you? Reply to this email and tell us.",
    signature: "Deni AI Team",
  },
  ja: {
    subject: (planName: string, endDate: string) =>
      `Deni AI ${planName}プランは${endDate}に終了します`,
    heading: (planName: string) => `${planName}プランがまもなく終了します`,
    greeting: (name?: string | null) => (name ? `${name} 様` : "こんにちは。"),
    body: (planName: string, endDate: string) =>
      `ご利用中の Deni AI ${planName}プランは、${endDate}に終了する予定です。終了後は Free プランに切り替わります。チャットの履歴は残りますが、${planName}プランのモデルと利用上限は使えなくなります。`,
    resume:
      "継続をご希望の場合は、請求設定からプランを再開できます。内容は変わらず、次回の更新日にこれまでどおり請求されます。",
    button: "プランを継続する",
    fallback: "ボタンが動作しない場合は、次のリンクを開いてください。",
    ignore: "解約のままでよい場合、手続きは不要です。これ以上の請求はありません。",
    reply: "足りない機能や使いにくい点があれば、このメールに返信してお知らせください。",
    signature: "Deni AI チーム",
  },
} as const;

export function subscriptionEndingEmailSubject({
  locale,
  planName,
  endDate,
}: Pick<SubscriptionEndingEmailProps, "locale" | "planName" | "endDate">) {
  return copy[locale].subject(planName, endDate);
}

export function SubscriptionEndingEmail({
  locale,
  name,
  planName,
  endDate,
  billingUrl,
}: SubscriptionEndingEmailProps) {
  const t = copy[locale];
  return (
    <Html lang={locale}>
      <Head />
      <Preview>{t.subject(planName, endDate)}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={heading}>{t.heading(planName)}</Heading>
          <Text style={text}>{t.greeting(name)}</Text>
          <Text style={text}>{t.body(planName, endDate)}</Text>
          <Text style={text}>{t.resume}</Text>
          <Section style={buttonSection}>
            <Button href={billingUrl} style={button}>
              {t.button}
            </Button>
          </Section>
          <Text style={text}>{t.fallback}</Text>
          <Link href={billingUrl} style={link}>
            {billingUrl}
          </Link>
          <Text style={footer}>{t.ignore}</Text>
          <Text style={footer}>{t.reply}</Text>
          <Text style={footer}>{t.signature}</Text>
        </Container>
      </Body>
    </Html>
  );
}

const main = {
  backgroundColor: "#f5f5f5",
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  margin: 0,
  padding: "32px 16px",
};

const container = {
  backgroundColor: "#ffffff",
  border: "1px solid #e5e5e5",
  borderRadius: "16px",
  margin: "0 auto",
  maxWidth: "560px",
  padding: "32px",
};

const heading = {
  color: "#111827",
  fontSize: "24px",
  fontWeight: "700",
  lineHeight: "32px",
  margin: "0 0 20px",
};

const text = {
  color: "#374151",
  fontSize: "16px",
  lineHeight: "26px",
  margin: "0 0 16px",
};

const buttonSection = {
  margin: "28px 0",
};

const button = {
  backgroundColor: "#111827",
  borderRadius: "10px",
  color: "#ffffff",
  display: "inline-block",
  fontSize: "16px",
  fontWeight: "600",
  padding: "14px 24px",
  textDecoration: "none",
};

const link = {
  color: "#2563eb",
  overflowWrap: "anywhere" as const,
};

const footer = {
  color: "#6b7280",
  fontSize: "14px",
  lineHeight: "22px",
  margin: "16px 0 0",
};
