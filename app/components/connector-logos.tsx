import type { ComponentProps, JSX } from "react";
import {
  siAirtable, siAtlassian, siClickup, siCloudflare, siDiscord, siDropbox, siGithub, siGmail, siGoogledrive, siHuggingface, siIntercom, siMiro, siNeon, siPaypal,
  siPosthog, siSentry, siSquare, siStripe, siSupabase, siWebflow, siWix, siZapier, type SimpleIcon,
} from "simple-icons";
import { mcpCatalogEntry } from "@/lib/mcp-catalog";

type LogoProps = Omit<ComponentProps<"svg">, "children">;

/** Brand marks for the one-click connectors, drawn inline or bundled so no logo loads from a CDN. */
function NotionLogo(props: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <rect x="3" y="2.5" width="18" height="19" rx="3" fill="#fff" stroke="#111" strokeWidth="1.6" />
      <path d="M8.5 17V7.5h.6L15.4 17h.1V7" fill="none" stroke="#111" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function LinearLogo(props: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <defs>
        <clipPath id="linear-logo-disc">
          <circle cx="12" cy="12" r="9.5" />
        </clipPath>
      </defs>
      <circle cx="12" cy="12" r="9.5" fill="#5E6AD2" />
      <g clipPath="url(#linear-logo-disc)" stroke="#fff" strokeWidth="1.6">
        <path d="M1 13.5 10.5 23" />
        <path d="M1 9.5 14.5 23" />
        <path d="M1.5 6 18 22.5" />
      </g>
    </svg>
  );
}

function SlackLogo(props: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <rect x="2" y="8.25" width="9.75" height="3.5" rx="1.75" fill="#36C5F0" />
      <rect x="8.25" y="2" width="3.5" height="3.5" rx="1.75" fill="#36C5F0" />
      <rect x="12.25" y="2" width="3.5" height="9.75" rx="1.75" fill="#2EB67D" />
      <rect x="18.5" y="8.25" width="3.5" height="3.5" rx="1.75" fill="#2EB67D" />
      <rect x="12.25" y="12.25" width="9.75" height="3.5" rx="1.75" fill="#ECB22E" />
      <rect x="12.25" y="18.5" width="3.5" height="3.5" rx="1.75" fill="#ECB22E" />
      <rect x="8.25" y="12.25" width="3.5" height="9.75" rx="1.75" fill="#E01E5A" />
      <rect x="2" y="12.25" width="3.5" height="3.5" rx="1.75" fill="#E01E5A" />
    </svg>
  );
}

const logos: Record<string, (props: LogoProps) => JSX.Element> = { notion: NotionLogo, linear: LinearLogo, slack: SlackLogo };

/** Marks from Simple Icons (CC0), bundled with the app. Colors that vanish on white are darkened. */
const simpleIcons: Record<string, { icon: SimpleIcon; color?: string }> = {
  // Built-in plugins and Discord sit in the same list as the connectors.
  github: { icon: siGithub },
  gmail: { icon: siGmail },
  drive: { icon: siGoogledrive },
  discord: { icon: siDiscord },
  atlassian: { icon: siAtlassian },
  clickup: { icon: siClickup },
  airtable: { icon: siAirtable },
  dropbox: { icon: siDropbox },
  zapier: { icon: siZapier },
  intercom: { icon: siIntercom, color: "#1F1F1F" },
  miro: { icon: siMiro },
  webflow: { icon: siWebflow },
  wix: { icon: siWix, color: "#000000" },
  stripe: { icon: siStripe },
  paypal: { icon: siPaypal },
  square: { icon: siSquare },
  sentry: { icon: siSentry },
  supabase: { icon: siSupabase },
  neon: { icon: siNeon },
  cloudflare: { icon: siCloudflare },
  posthog: { icon: siPosthog },
  huggingface: { icon: siHuggingface, color: "#E8A800" },
};

/** Brand colors for connectors without a mark, shown as a monogram. */
const monograms: Record<string, string> = {
  monday: "#FF3D57",
  granola: "#3F7D3A",
  canva: "#7D2AE8",
  attio: "#111111",
  close: "#1463FF",
  context7: "#059669",
  deepwiki: "#2563EB",
};

function Monogram({ id, color, ...props }: LogoProps & { id: string; color: string }) {
  const letter = (mcpCatalogEntry(id)?.name ?? id).charAt(0).toUpperCase();
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <rect x="1.5" y="1.5" width="21" height="21" rx="5" fill={color} />
      <text x="12" y="16.6" textAnchor="middle" fontFamily="Inter Variable, system-ui, sans-serif" fontSize="13" fontWeight="700" fill="#fff">
        {letter}
      </text>
    </svg>
  );
}

export function ConnectorLogo({ id, ...props }: LogoProps & { id: string }) {
  const Logo = logos[id];
  if (Logo) return <Logo {...props} />;
  const simple = simpleIcons[id];
  if (simple) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
        <path d={simple.icon.path} fill={simple.color ?? `#${simple.icon.hex}`} />
      </svg>
    );
  }
  const color = monograms[id];
  return color ? <Monogram id={id} color={color} {...props} /> : null;
}
