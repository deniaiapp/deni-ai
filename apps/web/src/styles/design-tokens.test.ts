import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * WCAG contrast of the colour roles (docs/design-system.md). Reads the
 * token blocks straight from globals.css so a palette edit that breaks AA fails.
 */
const css = readFileSync(join(import.meta.dirname, "globals.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  if (start < 0) throw new Error(`Missing block ${selector}`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("\n}", start));
  const tokens: Record<string, string> = {};
  for (const match of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    tokens[match[1]] = match[2].trim();
  }
  return tokens;
}

type Rgb = [number, number, number];

function oklchToLinearSrgb(l: number, c: number, h: number): Rgb {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  return [
    clamp(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    clamp(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    clamp(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  ];
}

function resolve(tokens: Record<string, string>, name: string): Rgb {
  let value = tokens[name];
  for (let depth = 0; value?.startsWith("var("); depth += 1) {
    if (depth > 5) throw new Error(`Circular ${name}`);
    value = tokens[value.slice(6, -1)];
  }
  const match = value?.match(/^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/);
  if (!match) throw new Error(`Token --${name} is not a plain oklch() value: ${value}`);
  return oklchToLinearSrgb(Number(match[1]), Number(match[2]), Number(match[3]));
}

function contrast(tokens: Record<string, string>, fg: string, bg: string) {
  const luminance = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const [high, low] = [luminance(resolve(tokens, fg)), luminance(resolve(tokens, bg))].sort(
    (x, y) => y - x,
  );
  return (high + 0.05) / (low + 0.05);
}

const light = block(":root");
const dark = { ...light, ...block(".dark") };

const TEXT = 4.5;

const pairs: [fg: string, bg: string, min: number][] = [
  ["foreground", "background", TEXT],
  ["foreground", "card", TEXT],
  ["muted-foreground", "background", TEXT],
  ["muted-foreground", "card", TEXT],
  ["popover-foreground", "popover", TEXT],
  ["primary", "background", TEXT],
  ["primary-foreground", "primary", TEXT],
  ["secondary-foreground", "secondary", TEXT],
  ["accent-foreground", "accent", TEXT],
  ["highlight-foreground", "highlight", TEXT],
  ["destructive", "background", TEXT],
  ["success", "background", TEXT],
  ["success-foreground", "success", TEXT],
  ["sidebar-foreground", "sidebar", TEXT],
  ["sidebar-accent-foreground", "sidebar-accent", TEXT],
  ["sidebar-primary-foreground", "sidebar-primary", TEXT],
];

describe.each([
  ["light", light],
  ["dark", dark],
])("%s mode", (_mode, tokens) => {
  test.each(pairs)("%s on %s", (fg, bg, min) => {
    expect(contrast(tokens, fg, bg)).toBeGreaterThanOrEqual(min);
  });
});
