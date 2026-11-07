import type { Plugin } from "vite";

// The workspace is a lazy import, so the browser would ask for its chunk only after the main
// bundle has run. This hands the chunk's hashed file name to the server build, which preloads it
// on signed-in pages. The client is built before the server; in dev the name stays empty.

const id = "virtual:workspace-chunk";
const resolvedId = `\0${id}`;

export default function workspacePreload(): Plugin {
  let file = "";
  return {
    name: "deni:workspace-preload",
    resolveId(source) {
      return source === id ? resolvedId : undefined;
    },
    load(source) {
      if (source === resolvedId) return `export default ${JSON.stringify(file)};`;
    },
    generateBundle(_options, bundle) {
      if (this.environment.name !== "client") return;
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === "chunk" && chunk.facadeModuleId?.endsWith("/app/components/workspace.tsx")) file = `/${chunk.fileName}`;
      }
    },
  };
}
