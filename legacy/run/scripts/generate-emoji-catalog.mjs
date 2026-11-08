import { readFileSync, writeFileSync } from "node:fs";

// Generate compact native-emoji data without shipping the picker implementation.
const root = "node_modules/emoji-picker-react/";
const english = JSON.parse(readFileSync(`${root}dist/data/emojis.json`, "utf8"));
const native = (unified) => String.fromCodePoint(...unified.split("-").map((part) => parseInt(part, 16)));
const catalog = Object.entries(english.emojis).flatMap(([category, emojis]) => emojis.map((item) => {
  return [native(item.u), item.n.at(-1), item.n.join(" ").toLowerCase(), category, (item.v ?? []).map(native)];
}));
writeFileSync("src/lib/ui/emoji-catalog.json", JSON.stringify(catalog));
writeFileSync("public/emoji-catalog.LICENSE.txt", readFileSync(`${root}LICENSE`));
