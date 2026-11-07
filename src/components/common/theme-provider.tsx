import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { isTheme, THEME_COOKIE, type ResolvedTheme, type Theme } from "@/lib/ui/theme";

type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const DARK_QUERY = "(prefers-color-scheme: dark)";
// next-themes kept the choice in localStorage under this key.
const LEGACY_STORAGE_KEY = "theme";

const MAX_AGE = 60 * 60 * 24 * 365;
const COOKIE_PATTERN = new RegExp(`(?:^|; )${THEME_COOKIE}=([^;]*)`);

/**
 * Runs before the first paint, so a theme the server cannot know does not flash: the system theme,
 * and a choice next-themes left in localStorage, which moves into the cookie here. A choice already
 * in the cookie is rendered on the server.
 */
export const themeScript = `(function(){var d=document,t=(d.cookie.match(${COOKIE_PATTERN})||[])[1];if(!t){try{t=localStorage.getItem(${JSON.stringify(LEGACY_STORAGE_KEY)});localStorage.removeItem(${JSON.stringify(LEGACY_STORAGE_KEY)})}catch(e){}if(t==="light"||t==="dark")d.cookie=${JSON.stringify(`${THEME_COOKIE}=`)}+t+"; path=/; max-age=${MAX_AGE}; samesite=lax"}if(t==="dark"||(t!=="light"&&matchMedia(${JSON.stringify(DARK_QUERY)}).matches))d.documentElement.classList.add("dark")})()`;

function cookieTheme(): Theme | null {
  const value = document.cookie.match(COOKIE_PATTERN)?.[1];
  return isTheme(value) ? value : null;
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

function saveTheme(theme: Theme) {
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${MAX_AGE}; samesite=lax`;
}

export function ThemeProvider({ initialTheme, children }: { initialTheme: Theme | null; children: ReactNode }) {
  // On the client the cookie can be newer than the loader data, after the script above migrated it.
  const [theme, setThemeState] = useState<Theme>(
    () => (typeof document === "undefined" ? null : cookieTheme()) ?? initialTheme ?? "system",
  );
  const [system, setSystem] = useState<ResolvedTheme>(() =>
    typeof document === "undefined"
      ? "light"
      : document.documentElement.classList.contains("dark")
        ? "dark"
        : "light",
  );
  const resolvedTheme = theme === "system" ? system : theme;

  useEffect(() => {
    if (theme !== "system") return;
    const query = window.matchMedia(DARK_QUERY);
    const update = () => setSystem(systemTheme());
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [theme]);

  // Switch colors at once instead of animating every element that has a transition.
  const previous = useRef(resolvedTheme);
  useLayoutEffect(() => {
    if (previous.current === resolvedTheme) return;
    previous.current = resolvedTheme;
    const style = document.createElement("style");
    style.textContent = "*,*::before,*::after{transition:none!important}";
    document.head.appendChild(style);
    void window.getComputedStyle(document.body).opacity;
    // A timeout, not requestAnimationFrame, which never fires in a background tab.
    setTimeout(() => style.remove(), 1);
  }, [resolvedTheme]);

  const setTheme = useCallback((next: Theme) => {
    saveTheme(next);
    setThemeState(next);
  }, []);

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within a ThemeProvider");
  return context;
}
