import type { DiagramPlugin } from "streamdown";

// Derived from the plugin contract: `mermaid` is only a transitive dependency and
// Streamdown does not re-export the instance type.
type MermaidInstance = ReturnType<DiagramPlugin["getMermaid"]>;
type MermaidConfig = Parameters<MermaidInstance["initialize"]>[0];

/**
 * `@streamdown/mermaid` imports the mermaid bundle at module scope, so importing
 * it directly ships roughly 900 kB of diagram code to every chat page even though
 * the overwhelming majority of messages contain no diagram at all.
 *
 * Dropping `plugins.mermaid` is not an option: Streamdown renders a hard
 * "Mermaid plugin not available" error whenever a mermaid fence is on screen and
 * the plugin is missing. The plugin object therefore has to exist from the first
 * render. Only `render` is awaited by Streamdown, which gives us a seam to defer
 * the real module — Streamdown keeps showing its normal diagram loading state
 * while the chunk is fetched.
 */
let pluginPromise: Promise<DiagramPlugin> | null = null;

function loadMermaidPlugin() {
  pluginPromise ??= import("@streamdown/mermaid").then((module) => module.mermaid);
  return pluginPromise;
}

export const lazyMermaid: DiagramPlugin = {
  name: "mermaid",
  type: "diagram",
  language: "mermaid",
  getMermaid(config?: MermaidConfig): MermaidInstance {
    // A diagram is on screen: start fetching before `render` is awaited.
    const loading = loadMermaidPlugin();
    let pendingConfig = config;

    return {
      // Streamdown may configure before rendering; the upstream plugin applies
      // config through `getMermaid`, so recording it here is enough.
      initialize(nextConfig: MermaidConfig) {
        pendingConfig = { ...pendingConfig, ...nextConfig };
      },
      async render(id: string, source: string) {
        const plugin = await loading;
        return plugin.getMermaid(pendingConfig).render(id, source);
      },
    };
  },
};
