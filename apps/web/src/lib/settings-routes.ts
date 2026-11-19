const CHECKOUT_SETTINGS_PREFIXES = ["/settings/billing/checkout", "/settings/team/checkout"];

// Settings routes that render their own full layout instead of the shared
// Settings chrome (section nav + plan summary) in `settings-wrapper.tsx`.
// Only checkout: every other settings page, team included, keeps the nav so
// moving between sections does not change the layout.
const STANDALONE_SETTINGS_PREFIXES = [...CHECKOUT_SETTINGS_PREFIXES];

function matchesSettingsPrefixes(pathname: string | null, prefixes: string[]): boolean {
  if (!pathname) {
    return false;
  }

  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function isCheckoutSettingsRoute(pathname: string | null): boolean {
  return matchesSettingsPrefixes(pathname, CHECKOUT_SETTINGS_PREFIXES);
}

/** Pages drawn in the settings frame: /settings/* and /account/*. */
export function isSettingsAreaRoute(pathname: string | null): boolean {
  return matchesSettingsPrefixes(pathname, ["/settings", "/account"]);
}

export function isStandaloneSettingsRoute(pathname: string | null): boolean {
  return matchesSettingsPrefixes(pathname, STANDALONE_SETTINGS_PREFIXES);
}
