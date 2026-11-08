const CHECKOUT_SETTINGS_PREFIXES = ["/settings/billing/checkout", "/settings/team/checkout"];

// Settings routes that render their own full layout instead of the shared
// Settings chrome (Plan/Usage sidebar + tab strip) in `settings-wrapper.tsx`.
const STANDALONE_SETTINGS_PREFIXES = [...CHECKOUT_SETTINGS_PREFIXES, "/settings/team"];

function matchesSettingsPrefixes(pathname: string | null, prefixes: string[]): boolean {
  if (!pathname) {
    return false;
  }

  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function isCheckoutSettingsRoute(pathname: string | null): boolean {
  return matchesSettingsPrefixes(pathname, CHECKOUT_SETTINGS_PREFIXES);
}

export function isStandaloneSettingsRoute(pathname: string | null): boolean {
  return matchesSettingsPrefixes(pathname, STANDALONE_SETTINGS_PREFIXES);
}
