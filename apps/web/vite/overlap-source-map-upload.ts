import type { Plugin } from "vite";

const SENTRY_PLUGIN = "sentry-vite-plugin";

/** Structural view of a Vite plugin; Sentry's types come from another Vite instance. */
type NamedPlugin = { name: string; writeBundle?: unknown };
type HookContext = { environment: { config: { consumer: string } } };

/**
 * Lets the Sentry upload of the client source maps run while the SSR
 * environment transforms its modules, instead of holding the SSR build until
 * the upload finishes (about 15 s on the deploy server).
 *
 * The upload ends by deleting every generated `*.map`, so the server
 * environments wait for it in `renderStart`, before they write their own maps:
 * an earlier deletion pass could otherwise remove SSR maps before they are
 * uploaded, and Nitro must not list client maps as public assets. Errors still
 * fail the build, from the first hook that awaits the upload.
 */
export function overlapClientSourceMapUpload<T extends NamedPlugin>(plugins: T[]): (T | Plugin)[] {
  let pendingUpload: Promise<unknown> | undefined;
  const awaitUpload = async () => {
    const upload = pendingUpload;
    pendingUpload = undefined;
    await upload;
  };

  const wrapped = plugins.map((plugin) => {
    const writeBundle = plugin.writeBundle;
    if (plugin.name !== SENTRY_PLUGIN || typeof writeBundle !== "function") return plugin;
    return {
      ...plugin,
      writeBundle(this: HookContext, ...args: unknown[]) {
        const result: unknown = writeBundle.apply(this, args);
        if (this.environment.config.consumer !== "client") return result;
        const upload = Promise.resolve(result);
        // Rejections surface when a later hook awaits the upload.
        upload.catch(() => undefined);
        pendingUpload = upload;
        return undefined;
      },
    };
  });

  return [
    ...wrapped,
    {
      name: "deni:await-client-source-map-upload",
      apply: "build",
      applyToEnvironment: (environment) => environment.config.consumer !== "client",
      renderStart: awaitUpload,
    },
    {
      name: "deni:await-client-source-map-upload-at-end",
      apply: "build",
      buildApp: { order: "post", handler: awaitUpload },
    },
  ];
}
