import { ClientOnly } from "@tanstack/react-router";
import { type ComponentType, lazy, type ReactNode, Suspense } from "react";
import { isStaleDeploymentReloadStarted } from "@/lib/stale-deployment";

type DynamicOptions = {
  loading?: () => ReactNode;
  /** `false` renders only after hydration (browser-only modules). */
  ssr?: boolean;
};

type Loader<P> = () => Promise<ComponentType<P> | { default: ComponentType<P> } | null | undefined>;

/** Code-split component with a Suspense fallback, optionally client-only. */
export function dynamic<P extends object>(loader: Loader<P>, options: DynamicOptions = {}) {
  const LazyComponent = lazy(async () => {
    const loaded = await loader();
    if (loaded == null) {
      // Vite resolves the import with undefined once a vite:preloadError handler
      // calls preventDefault(), which the stale-deployment reload does.
      if (isStaleDeploymentReloadStarted()) {
        // Keep the fallback up until the page reloads.
        return new Promise<never>(() => {});
      }
      throw new Error(`dynamic(): import resolved to ${String(loaded)}`);
    }
    return "default" in loaded ? loaded : { default: loaded };
  });
  const fallback = options.loading?.() ?? null;

  function DynamicComponent(props: P) {
    const content = (
      <Suspense fallback={fallback}>
        <LazyComponent {...props} />
      </Suspense>
    );
    return options.ssr === false ? <ClientOnly fallback={fallback}>{content}</ClientOnly> : content;
  }

  return DynamicComponent;
}
