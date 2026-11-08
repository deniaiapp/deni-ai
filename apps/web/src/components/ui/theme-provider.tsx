import type * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({
  children,
  // Disable CSS transitions during theme change so light/dark flips instantly
  // instead of easing through intermediate colors across the whole tree.
  disableTransitionOnChange = true,
  scriptProps,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  // next-themes injects a FOUC-prevention <script>. React 19 warns (and does not
  // re-execute) scripts when a Client Component renders on the client. Keep the
  // script executable only in the SSR HTML; on the client mark it plain text.
  // @see https://nextjs.org/docs/app/guides/preventing-flash-before-hydration
  const safeScriptProps = {
    ...scriptProps,
    type: typeof window === "undefined" ? "text/javascript" : "text/plain",
  };

  return (
    <NextThemesProvider
      disableTransitionOnChange={disableTransitionOnChange}
      scriptProps={safeScriptProps}
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
