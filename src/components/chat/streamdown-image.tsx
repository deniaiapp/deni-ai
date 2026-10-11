"use client";

import type { ComponentProps, MouseEvent } from "react";
import { useState, useSyncExternalStore } from "react";
import { ImageIcon } from "lucide-react";
import { useExtracted } from "next-intl";
import { defaultComponents, type ExtraProps } from "streamdown";
import { Button } from "@/components/ui/button";

export type StreamdownImageSource =
  /** `data:image/` and `blob:` URLs: no request leaves the browser. */
  | { kind: "inline" }
  /** Another site: loads only after the user asks, so no request is sent on render. */
  | { kind: "external"; host: string }
  /** Relative, same-origin or unsupported: never loaded. */
  | { kind: "blocked" };

/**
 * Model output (shaped by project instructions, browsed pages or memory) must
 * not make the browser fetch arbitrary URLs on render: an image URL can carry
 * chat contents to a third party, and a same-origin URL is an authenticated GET
 * against the app's own routes (e.g. `/new/...`).
 */
export function classifyStreamdownImageSource(
  src: unknown,
  appOrigin: string | null,
): StreamdownImageSource {
  if (typeof src !== "string") {
    return { kind: "blocked" };
  }
  const value = src.trim();
  if (/^data:image\//i.test(value) || /^blob:/i.test(value)) {
    return { kind: "inline" };
  }

  let url: URL;
  try {
    // Without a base, relative and protocol-relative URLs throw and stay blocked.
    url = new URL(value);
  } catch {
    return { kind: "blocked" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { kind: "blocked" };
  }
  if (url.origin === appOrigin) {
    return { kind: "blocked" };
  }
  return { kind: "external", host: url.host };
}

const DefaultImage = defaultComponents.img;

function subscribeNever() {
  return () => {};
}

function getAppOrigin() {
  return window.location.origin;
}

function getServerAppOrigin() {
  return null;
}

type StreamdownImageProps = ComponentProps<"img"> & ExtraProps;

export function StreamdownImage(props: StreamdownImageProps) {
  const t = useExtracted();
  const appOrigin = useSyncExternalStore(subscribeNever, getAppOrigin, getServerAppOrigin);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const source = classifyStreamdownImageSource(props.src, appOrigin);

  if (source.kind === "inline" || (source.kind === "external" && loadedSrc === props.src)) {
    return <DefaultImage {...props} />;
  }

  const alt = typeof props.alt === "string" ? props.alt.trim() : "";
  const handleLoad = (event: MouseEvent) => {
    // Images can sit inside links; loading one must not also follow the link.
    event.preventDefault();
    event.stopPropagation();
    if (typeof props.src === "string") {
      setLoadedSrc(props.src);
    }
  };

  return (
    <span
      className="my-1 inline-flex max-w-full items-center gap-2 rounded-lg border border-dashed px-3 py-2 align-middle text-sm text-muted-foreground"
      data-streamdown="image-placeholder"
    >
      <ImageIcon aria-hidden="true" className="size-4 shrink-0" />
      {source.kind === "external" ? (
        <>
          {alt ? <span className="min-w-0 truncate">{alt}</span> : null}
          <Button
            className="min-w-0 max-w-full"
            onClick={handleLoad}
            size="xs"
            title={typeof props.src === "string" ? props.src : undefined}
            type="button"
            variant="outline"
          >
            <span className="truncate">{t("Load image from {host}", { host: source.host })}</span>
          </Button>
        </>
      ) : (
        <span className="min-w-0 truncate">
          {alt ? t("Image blocked: {alt}", { alt }) : t("Image blocked")}
        </span>
      )}
    </span>
  );
}

/**
 * `<picture><source srcset>` lets the browser fetch a different URL than the
 * `<img>` it wraps, which would bypass the checks above. Markdown never
 * produces it, so drop it and let the `<img>` decide.
 */
export function StreamdownPictureSource() {
  return null;
}
