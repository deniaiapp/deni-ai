import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const srcRoot = join(root, "src");
const lucideBarrel = join(root, "node_modules", "lucide-react", "dist", "esm", "lucide-react.mjs");

function walk(dir: string, out: string[] = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path);
  }
  return out;
}

const names = new Set<string>();
const importRe = /import\s+(type\s+)?(?:\{([^}]+)\}|\*\s+as\s+\w+)\s+from\s+["']lucide-react["']/g;

for (const file of walk(srcRoot)) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(importRe)) {
    if (match[1]) {
      for (const spec of (match[2] ?? "").split(",")) {
        const name = spec
          .replace(/\s+as\s+\w+/g, "")
          .replace(/type\s+/g, "")
          .trim();
        if (name) names.add(name);
      }
      continue;
    }
    for (const spec of (match[2] ?? "").split(",")) {
      const trimmed = spec.trim();
      if (!trimmed) continue;
      const name = trimmed
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (name) names.add(name);
    }
  }
}

const typeNames = new Set(["LucideIcon", "LucideProps", "LucidePropsWithoutChildren"]);
const componentNames = [...names].filter((name) => !typeNames.has(name)).sort();

const exportToFile = new Map<string, string>();
const barrelRe = /export\s*\{([^}]+)\}\s*from\s*['"]\.\/icons\/([^'"]+)['"]/g;
const barrel = readFileSync(lucideBarrel, "utf8");
for (const match of barrel.matchAll(barrelRe)) {
  const file = match[2];
  if (!file) continue;
  for (const spec of match[1].split(",")) {
    const asMatch = spec.trim().match(/^default\s+as\s+(\w+)$/);
    if (asMatch?.[1]) exportToFile.set(asMatch[1], file);
  }
}

const missing: string[] = [];
const lines = [
  "/**",
  " * Subset re-exports of lucide-react icons actually used in this repo.",
  " * Mapped over the `lucide-react` package name in tsconfig paths so tsc does",
  " * not parse the 2MB barrel typings file.",
  " */",
  'export type { LucideIcon, LucideProps } from "./lucide-react-types";',
  "",
];

for (const name of componentNames) {
  const file = exportToFile.get(name);
  if (!file) {
    missing.push(name);
    continue;
  }
  lines.push(`export { default as ${name} } from "lucide-react/dist/esm/icons/${file}";`);
}

if (missing.length) {
  console.error("Missing lucide icon files:", missing.join(", "));
  process.exit(1);
}

writeFileSync(join(srcRoot, "lib", "lucide-react.ts"), `${lines.join("\n")}\n`);
console.log(`Wrote ${componentNames.length} lucide icons`);
