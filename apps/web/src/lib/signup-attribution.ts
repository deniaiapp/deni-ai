/**
 * Where a visitor first came from, kept in a first-party cookie until they sign
 * up and then stored with the new account (`signup_attribution`).
 *
 * The cookie is written in the browser, not by the server: public pages are
 * served from a shared cache, so a `Set-Cookie` header would either be replayed to
 * every visitor or never be sent.
 */
export const SIGNUP_ATTRIBUTION_COOKIE = "deni_attr";

const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const MAX_FIELD_LENGTH = 100;

/** Returning from a sign-in page is not a referral. */
const IGNORED_REFERRER_HOSTS = ["accounts.google.com"];

/**
 * Runs before hydration on every page. First touch wins: an existing cookie is
 * kept. Nothing is written for a visit with no UTM parameters and no external
 * referrer, so direct visits leave no cookie.
 */
export const SIGNUP_ATTRIBUTION_BOOT_SCRIPT = `(function(){try{var n=${JSON.stringify(SIGNUP_ATTRIBUTION_COOKIE)};if(document.cookie.split("; ").some(function(c){return c.indexOf(n+"=")===0}))return;var q=new URLSearchParams(location.search),r="";try{var h=new URL(document.referrer).hostname;if(h&&h!==location.hostname&&${JSON.stringify(IGNORED_REFERRER_HOSTS)}.indexOf(h)===-1)r=h}catch(e){}var c=function(v){return v?String(v).slice(0,${MAX_FIELD_LENGTH}):""};var s=c(q.get("utm_source")),m=c(q.get("utm_medium")),k=c(q.get("utm_campaign"));if(!s&&!m&&!k&&!r)return;document.cookie=n+"="+encodeURIComponent(JSON.stringify({s:s,m:m,c:k,r:c(r),p:c(location.pathname)}))+";path=/;max-age=${COOKIE_MAX_AGE_SECONDS};samesite=lax"+(location.protocol==="https:"?";secure":"")}catch(e){}})();`;

export type SignupAttribution = {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  referrerHost: string | null;
  landingPath: string | null;
};

function field(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // Control characters never belong in these values; the cookie is visitor-controlled.
  const cleaned = Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("")
    .trim()
    .slice(0, MAX_FIELD_LENGTH);
  return cleaned || null;
}

/**
 * The attribution carried by a request's `Cookie` header, or null when there is
 * none or it is malformed. The cookie is written by the visitor's browser, so
 * every field is treated as untrusted text: bounded, and stored only as text.
 */
export function parseSignupAttribution(
  cookieHeader: string | null | undefined,
): SignupAttribution | null {
  const prefix = `${SIGNUP_ATTRIBUTION_COOKIE}=`;
  const raw = cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const value = parsed as Record<string, unknown>;
  const landingPath = field(value.p);
  const attribution: SignupAttribution = {
    utmSource: field(value.s),
    utmMedium: field(value.m),
    utmCampaign: field(value.c),
    referrerHost: field(value.r)?.toLowerCase() ?? null,
    landingPath: landingPath?.startsWith("/") ? landingPath : null,
  };
  const hasSource =
    attribution.utmSource ||
    attribution.utmMedium ||
    attribution.utmCampaign ||
    attribution.referrerHost;
  return hasSource ? attribution : null;
}
