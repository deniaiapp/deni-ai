import { defaultRemarkPlugins } from "streamdown";

type MarkdownNode = {
  children?: MarkdownNode[];
  lang?: string;
  type?: string;
  value?: string;
};

const HTML_BLOCK_PREFIX = /^(<!DOCTYPE|<!--|<\/?[a-z][\w:-]*[\s>])/i;

const shouldConvertHtmlToCodeBlock = (value: string) => {
  const trimmed = value.trim();
  return trimmed.includes("\n") && HTML_BLOCK_PREFIX.test(trimmed);
};

const transformHtmlNodes = (nodes?: MarkdownNode[]) => {
  if (!nodes) {
    return;
  }

  for (const node of nodes) {
    if (node.type === "html" && typeof node.value === "string") {
      if (shouldConvertHtmlToCodeBlock(node.value)) {
        node.type = "code";
        node.lang = "html";
        node.value = node.value.replace(/\n$/, "");
      }
      continue;
    }

    transformHtmlNodes(node.children);
  }
};

export const htmlCodeBlockRemarkPlugin = () => (tree: MarkdownNode) => {
  transformHtmlNodes(tree.children);
};

/**
 * Streamdown's `remarkPlugins` prop *replaces* its defaults instead of extending
 * them, so passing a custom plugin on its own silently disables GFM (tables,
 * strikethrough, task lists, autolinks) and the code-fence metastring parser.
 *
 * Always render with this list rather than a bare `[htmlCodeBlockRemarkPlugin]`.
 * The custom transform runs last so GFM has already produced its nodes.
 */
export const streamdownRemarkPlugins = [
  ...Object.values(defaultRemarkPlugins),
  htmlCodeBlockRemarkPlugin,
];
