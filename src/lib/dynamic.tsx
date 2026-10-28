import { ClientOnly } from "@tanstack/react-router";
import { type ComponentType, lazy, type ReactNode, Suspense } from "react";

type DynamicOptions = {
  loading?: () => ReactNode;
  /** `false` renders only after hydration (browser-only modules). */
  ssr?: boolean;
};

type Loader<P> = () => Promise<ComponentType<P> | { default: ComponentType<P> }>;

/** Code-split component with a Suspense fallback, optionally client-only. */
export function dynamic<P extends object>(loader: Loader<P>, options: DynamicOptions = {}) {
  const LazyComponent = lazy(async () => {
    const loaded = await loader();
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
