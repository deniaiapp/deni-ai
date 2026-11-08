import { Body, Container, Head, Heading, Html, Img, Preview, Section, Text } from "react-email";

// Styles are inline because most mail clients drop <style> blocks.

const ink = "#0e0c0a";
const tan = "#d4a574";
const muted = "#6b6560";
const fontFamily =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Noto Sans JP", Roboto, Helvetica, Arial, sans-serif';

export type SignInCodeEmailProps = {
  lang: string;
  code: string;
  preview: string;
  heading: string;
  intro: string;
  expiry: string;
  ignore: string;
  /** Absolute URL of the Deni Run app icon (public/icon.png). Without it the header shows the name only. */
  iconUrl?: string;
};

export function SignInCodeEmail({
  lang,
  code,
  preview,
  heading,
  intro,
  expiry,
  ignore,
  iconUrl,
}: SignInCodeEmailProps) {
  return (
    <Html lang={lang}>
      <Head />
      <Preview>{preview}</Preview>
      <Body
        lang={lang}
        style={{ backgroundColor: "#f5f3f0", fontFamily, margin: 0, padding: "32px 16px" }}
      >
        <Container
          style={{
            backgroundColor: "#ffffff",
            border: "1px solid #e7e2dc",
            borderRadius: 12,
            maxWidth: 480,
            padding: "32px",
          }}
        >
          <Text
            style={{
              color: ink,
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: "0.02em",
              margin: 0,
            }}
          >
            {iconUrl ? (
              <Img
                src={iconUrl}
                alt=""
                width={24}
                height={24}
                style={{ borderRadius: 6, display: "inline-block", marginRight: 8, verticalAlign: "middle" }}
              />
            ) : null}
            Deni Run
          </Text>
          <Heading
            as="h1"
            style={{ color: ink, fontSize: 22, fontWeight: 700, margin: "28px 0 8px" }}
          >
            {heading}
          </Heading>
          <Text style={{ color: ink, fontSize: 15, lineHeight: "24px", margin: 0 }}>{intro}</Text>
          <Section
            style={{
              backgroundColor: "#faf6f1",
              border: `1px solid ${tan}`,
              borderRadius: 10,
              margin: "24px 0",
              padding: "20px 0",
              textAlign: "center",
            }}
          >
            <Text
              style={{
                color: ink,
                fontFamily:
                  'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
                fontSize: 32,
                fontWeight: 700,
                letterSpacing: "0.3em",
                margin: 0,
                paddingLeft: "0.3em",
              }}
            >
              {code}
            </Text>
          </Section>
          <Text style={{ color: ink, fontSize: 14, lineHeight: "22px", margin: 0 }}>{expiry}</Text>
          <Text style={{ color: muted, fontSize: 13, lineHeight: "20px", margin: "16px 0 0" }}>
            {ignore}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
