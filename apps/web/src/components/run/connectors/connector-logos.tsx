import type { ComponentProps, ComponentType } from "react";
import SiAirtable from "@icons-pack/react-simple-icons/icons/SiAirtable";
import SiAtlassian from "@icons-pack/react-simple-icons/icons/SiAtlassian";
import SiClickup from "@icons-pack/react-simple-icons/icons/SiClickup";
import SiCloudflare from "@icons-pack/react-simple-icons/icons/SiCloudflare";
import SiDropbox from "@icons-pack/react-simple-icons/icons/SiDropbox";
import SiHuggingface from "@icons-pack/react-simple-icons/icons/SiHuggingface";
import SiIntercom from "@icons-pack/react-simple-icons/icons/SiIntercom";
import SiMiro from "@icons-pack/react-simple-icons/icons/SiMiro";
import SiNeon from "@icons-pack/react-simple-icons/icons/SiNeon";
import SiPaypal from "@icons-pack/react-simple-icons/icons/SiPaypal";
import SiPosthog from "@icons-pack/react-simple-icons/icons/SiPosthog";
import SiSentry from "@icons-pack/react-simple-icons/icons/SiSentry";
import SiSquare from "@icons-pack/react-simple-icons/icons/SiSquare";
import SiStripe from "@icons-pack/react-simple-icons/icons/SiStripe";
import SiSupabase from "@icons-pack/react-simple-icons/icons/SiSupabase";
import SiWebflow from "@icons-pack/react-simple-icons/icons/SiWebflow";
import SiWix from "@icons-pack/react-simple-icons/icons/SiWix";
import SiZapier from "@icons-pack/react-simple-icons/icons/SiZapier";
import { mcpCatalogEntry } from "@deniai/run/mcp/catalog";

type LogoProps = Omit<ComponentProps<"svg">, "children" | "ref">;

/** Brand marks for the one-click connectors, bundled so no logo loads from a CDN. */
function NotionLogo(props: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <rect
        x="3"
        y="2.5"
        width="18"
        height="19"
        rx="3"
        fill="#fff"
        stroke="#111"
        strokeWidth="1.6"
      />
      <path
        d="M8.5 17V7.5h.6L15.4 17h.1V7"
        fill="none"
        stroke="#111"
        strokeWidth="2"
        strokeLinejoin="round"
      />
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

const drawn: Record<string, ComponentType<LogoProps>> = {
  notion: NotionLogo,
  linear: LinearLogo,
  slack: SlackLogo,
};

type SimpleIcon = ComponentType<{ className?: string; color?: string; "aria-hidden"?: boolean }>;

/** Marks from Simple Icons (CC0). Colors that vanish on white are darkened. */
const simpleIcons: Record<string, { Icon: SimpleIcon; color?: string }> = {
  atlassian: { Icon: SiAtlassian },
  clickup: { Icon: SiClickup },
  airtable: { Icon: SiAirtable },
  dropbox: { Icon: SiDropbox },
  zapier: { Icon: SiZapier },
  intercom: { Icon: SiIntercom, color: "#1F1F1F" },
  miro: { Icon: SiMiro },
  webflow: { Icon: SiWebflow },
  wix: { Icon: SiWix, color: "#000000" },
  stripe: { Icon: SiStripe },
  paypal: { Icon: SiPaypal },
  square: { Icon: SiSquare },
  sentry: { Icon: SiSentry },
  supabase: { Icon: SiSupabase },
  neon: { Icon: SiNeon },
  cloudflare: { Icon: SiCloudflare },
  posthog: { Icon: SiPosthog },
  huggingface: { Icon: SiHuggingface, color: "#E8A800" },
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
      <text
        x="12"
        y="16.6"
        textAnchor="middle"
        fontFamily="system-ui, sans-serif"
        fontSize="13"
        fontWeight="700"
        fill="#fff"
      >
        {letter}
      </text>
    </svg>
  );
}

/** The connector's brand mark; a monogram when there is none, nothing for an unknown id. */
export function ConnectorLogo({ id, className }: { id: string; className?: string }) {
  const Drawn = drawn[id];
  if (Drawn) return <Drawn className={className} />;
  const simple = simpleIcons[id];
  if (simple) {
    return <simple.Icon className={className} color={simple.color ?? "default"} aria-hidden />;
  }
  const color = monograms[id];
  return color ? <Monogram id={id} color={color} className={className} /> : null;
}

/** The logo on a white tile, so marks keep their colors in the dark theme. */
export function ConnectorLogoTile({ id, size = "md" }: { id: string; size?: "md" | "lg" }) {
  return (
    <span
      className={
        size === "lg"
          ? "flex size-16 shrink-0 items-center justify-center rounded-2xl bg-white ring-1 ring-foreground/10"
          : "flex size-10 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-foreground/10"
      }
    >
      <ConnectorLogo id={id} className={size === "lg" ? "size-10" : "size-6"} />
    </span>
  );
}
