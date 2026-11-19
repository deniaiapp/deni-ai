import { defaultRehypePlugins } from "streamdown";
import { CITATION_MARKER_PATTERN } from "@/lib/chat-citations";

type HastNode = {
  children?: HastNode[];
  properties?: Record<string, unknown>;
  tagName?: string;
  type?: string;
  value?: string;
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

/** Elements whose text is shown literally or is already a link. */
const CITATION_SKIPPED_TAGS = new Set(["a", "code", "pre", "kbd", "samp", "script", "style"]);

const splitCitationText = (value: string): HastNode[] | null => {
  const nodes: HastNode[] = [];
  let cursor = 0;
  for (const match of value.matchAll(CITATION_MARKER_PATTERN)) {
    const before = value.slice(cursor, match.index).replace(/[ \t]+$/, "");
    if (before) nodes.push({ type: "text", value: before });
    nodes.push({
      type: "element",
      tagName: "sup",
      properties: { dataCitation: match[1].replace(/\s+/g, "") },
      children: [{ type: "text", value: match[0] }],
    });
    cursor = match.index + match[0].length;
  }
  if (nodes.length === 0) return null;
  const rest = value.slice(cursor);
  if (rest) nodes.push({ type: "text", value: rest });
  return nodes;
};

const transformCitations = (node: HastNode) => {
  if (!node.children) return;
  if (node.type === "element" && node.tagName && CITATION_SKIPPED_TAGS.has(node.tagName)) return;
  node.children = node.children.flatMap((child) => {
    if (child.type === "text" && typeof child.value === "string") {
      return splitCitationText(child.value) ?? [child];
    }
    transformCitations(child);
    return [child];
  });
};

/**
 * Turns `[cite:3,5]` markers into `<sup data-citation="3,5">`, which the `sup`
 * override renders as a source button. The button only ever links to search
 * results of the same message, whatever ids the attribute names.
 */
export const citationRehypePlugin = () => (tree: HastNode) => {
  transformCitations(tree);
};

/**
 * Streamdown's `rehypePlugins` prop *replaces* its defaults (raw HTML, sanitize,
 * harden), so always render with this list. The guard runs last so it sees the
 * final sanitized tree.
 */
export const streamdownRehypePlugins = [
  ...Object.values(defaultRehypePlugins),
  preventClobberingRehypePlugin,
  citationRehypePlugin,
];
