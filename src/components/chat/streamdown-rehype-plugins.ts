"use client";

import { defaultRehypePlugins } from "streamdown";

type HastNode = {
  children?: HastNode[];
  properties?: Record<string, unknown>;
  type?: string;
};

/** The prefix remark-rehype already puts on footnote ids, so footnote links keep matching. */
const CLOBBER_PREFIX = "user-content-";
/** Element names and ids, plus the attributes that refer to ids. */
const CLOBBER_PROPERTIES = ["id", "name", "ariaDescribedBy", "ariaLabelledBy"];

const withClobberPrefix = (value: unknown): unknown => {
  if (typeof value === "string") {
    return value && !value.startsWith(CLOBBER_PREFIX) ? CLOBBER_PREFIX + value : value;
  }
  if (Array.isArray(value)) {
    return value.map(withClobberPrefix);
  }
  return value;
};

const prefixClobberingProperties = (nodes?: HastNode[]) => {
  if (!nodes) {
    return;
  }

  for (const node of nodes) {
    if (node.type === "element" && node.properties) {
      for (const key of CLOBBER_PROPERTIES) {
        if (key in node.properties) {
          node.properties[key] = withClobberPrefix(node.properties[key]);
        }
      }
    }

    prefixClobberingProperties(node.children);
  }
};

/**
 * Streamdown's sanitize schema sets `clobberPrefix: ""`, so `id` and `name`
 * from model HTML reach the DOM as written. `<img name="body">` then replaces
 * `document.body` (DOM clobbering), which breaks every portal and the PDF
 * export. Prefix them like hast-util-sanitize does by default, leaving values
 * that already carry the prefix (footnotes) alone.
 */
export const preventClobberingRehypePlugin = () => (tree: HastNode) => {
  prefixClobberingProperties(tree.children);
};

/**
 * Streamdown's `rehypePlugins` prop *replaces* its defaults (raw HTML, sanitize,
 * harden), so always render with this list. The guard runs last so it sees the
 * final sanitized tree.
 */
export const streamdownRehypePlugins = [
  ...Object.values(defaultRehypePlugins),
  preventClobberingRehypePlugin,
];
