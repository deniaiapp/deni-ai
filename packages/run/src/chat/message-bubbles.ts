/**
 * A line the model writes on its own to start a new chat bubble. It is an HTML comment so a
 * Markdown renderer that is not told about it still shows nothing.
 */
export const BUBBLE_BREAK = "<!-- split -->";

/** Assistant messages written after the model learned BUBBLE_BREAK carry this metadata. */
export const BUBBLE_BREAK_METADATA = { bubbles: "breaks" } as const;

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

export function usesBubbleBreaks(metadata: unknown): boolean {
  return (metadata as { bubbles?: unknown } | undefined)?.bubbles === BUBBLE_BREAK_METADATA.bubbles;
}

/** Split at BUBBLE_BREAK lines outside code fences, hiding one that is still streaming in. */
export function splitBubbleBreaks(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const tail = lines.at(-1)?.trim() ?? "";
  if (tail.length >= 2 && BUBBLE_BREAK.startsWith(tail)) lines.pop();
  const bubbles: string[] = [];
  let current: string[] = [];
  let fence: { marker: string; length: number } | null = null;
  const flush = () => {
    const content = current.join("\n").trim();
    if (content) bubbles.push(content);
    current = [];
  };
  for (const line of lines) {
    const delimiter = line.match(FENCE);
    if (delimiter) {
      if (!fence) fence = { marker: delimiter[1][0], length: delimiter[1].length };
      else if (
        delimiter[1][0] === fence.marker &&
        delimiter[1].length >= fence.length &&
        !delimiter[2].trim()
      )
        fence = null;
    } else if (!fence && line.trim() === BUBBLE_BREAK) {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return bubbles;
}

/** Plain text for places that show a message as one block, such as previews and Discord notices. */
export function withoutBubbleBreaks(text: string): string {
  return splitBubbleBreaks(text).join("\n\n");
}

/** Split long prose at paragraph boundaries without modifying the stored message. */
export function splitAssistantBubbles(text: string, breaks = false): string[] {
  if (breaks) return splitBubbleBreaks(text);
  if (text.length < 280 || /^ {0,3}\[[^\]]+\]:/m.test(text)) return [text];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const bubbles: string[] = [];
  let current: string[] = [];
  let fence: { marker: string; length: number } | null = null;
  const isList = (line: string) => /^ {0,3}(?:[-+*]|\d+[.)])\s/.test(line);
  const flush = () => {
    const content = current.join("\n").trim();
    if (content) bubbles.push(content);
    current = [];
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (delimiter) {
      if (!fence) fence = { marker: delimiter[1][0], length: delimiter[1].length };
      else if (
        delimiter[1][0] === fence.marker &&
        delimiter[1].length >= fence.length &&
        !delimiter[2].trim()
      )
        fence = null;
      current.push(line);
      continue;
    }
    if (!line.trim() && !fence) {
      const previous = current.findLast((item) => item.trim()) ?? "";
      let nextIndex = index + 1;
      while (nextIndex < lines.length && !lines[nextIndex].trim()) nextIndex++;
      const next = lines[nextIndex] ?? "";
      const headingNeedsBody =
        /^ {0,3}#{1,6}\s/.test(previous) || /^ {0,3}(?:={3,}|-{3,})\s*$/.test(previous);
      const listContinues = current.some(isList) && (isList(next) || /^\s{2,}\S/.test(next));
      const quoteContinues = /^\s*>/.test(previous) && /^\s*>/.test(next);
      const indentedCodeContinues = /^(?: {4}|\t)\S/.test(next);
      if (!headingNeedsBody && !listContinues && !quoteContinues && !indentedCodeContinues) {
        flush();
        continue;
      }
    }
    current.push(line);
  }
  flush();
  return bubbles.length ? bubbles : [text];
}
