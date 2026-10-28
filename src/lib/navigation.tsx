import {
  Link as RouterLink,
  useLocation,
  useMatches,
  useRouter as useTanStackRouter,
} from "@tanstack/react-router";
import type { ComponentProps } from "react";

/**
 * href-based navigation helpers over TanStack Router.
 *
 * Much of the app builds links from data (`localizedPath()`, chat ids, query
 * strings), so these take a plain href and leave route matching to the router.
 * Search params are plain strings (see `parseSearch` in `src/router.tsx`).
 */

const EXTERNAL_HREF = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

export function isExternalHref(href: string) {
  return EXTERNAL_HREF.test(href);
}

type SplitHref = { to: string; search: Record<string, string>; hash: string | undefined };

export function splitHref(href: string): SplitHref {
  const url = new URL(href, "http://localhost");
  return {
    to: url.pathname,
    search: Object.fromEntries(url.searchParams),
    hash: url.hash ? url.hash.slice(1) : undefined,
  };
}

type LinkProps = Omit<ComponentProps<"a">, "href"> & {
  href: string;
  /** `false` disables intent preloading. */
  prefetch?: boolean | null;
  replace?: boolean;
  /** `false` keeps the scroll position. */
  scroll?: boolean;
};

export function Link({ href, prefetch, replace, scroll, ...props }: LinkProps) {
  if (isExternalHref(href) || href.startsWith("#")) {
    return <a href={href} {...props} />;
  }
  const { to, search, hash } = splitHref(href);
  return (
    <RouterLink
      {...props}
      to={to}
      search={search}
      hash={hash}
      preload={prefetch === false ? false : undefined}
      replace={replace}
      resetScroll={scroll}
    />
  );
}

type NavigateOptions = { scroll?: boolean };

export function useRouter() {
  const router = useTanStackRouter();
  return {
    push: (href: string, options?: NavigateOptions) =>
      void router.navigate({ href, resetScroll: options?.scroll }),
    replace: (href: string, options?: NavigateOptions) =>
      void router.navigate({ href, replace: true, resetScroll: options?.scroll }),
    back: () => router.history.back(),
    forward: () => router.history.forward(),
    /** Re-runs loaders for the current location. */
    refresh: () => void router.invalidate(),
    prefetch: (href: string) => void router.preloadRoute(splitHref(href)).catch(() => undefined),
  };
}

export function usePathname() {
  return useLocation({ select: (location) => location.pathname });
}

export function useSearchParams() {
  const searchStr = useLocation({ select: (location) => location.searchStr });
  return new URLSearchParams(searchStr);
}

export function useParams<T extends Record<string, string | undefined>>() {
  const matches = useMatches();
  return (matches.at(-1)?.params ?? {}) as T;
}
