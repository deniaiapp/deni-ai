import type { ComponentProps, JSX } from "react";

type LogoProps = Omit<ComponentProps<"svg">, "children">;

/** Brand marks for the one-click connectors, drawn inline so no logo loads from a CDN. */
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

export function ConnectorLogo({ id, ...props }: LogoProps & { id: string }) {
  const Logo = logos[id];
  return Logo ? <Logo {...props} /> : null;
}
