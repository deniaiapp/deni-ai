export type ThemeName =
  | "light"
  | "dark"
  | "system"
  | "default"
  | "t3-chat"
  | "tangerine"
  | "mono"
  | "deep-dark"
  | "deep-dark-high-contrast";

type ThemePreset = {
  key: ThemeName;
  preview?: string[];
};

export const themePresets: ThemePreset[] = [
  {
    key: "default",
    preview: ["bg-[#171717]", "bg-[#737373]", "bg-[#f5f5f5]"],
  },
  {
    key: "t3-chat",
    preview: ["bg-[#ec4899]", "bg-[#a855f7]", "bg-[#fce7f3]"],
  },
  {
    key: "tangerine",
    preview: ["bg-[#fb923c]", "bg-[#f97316]", "bg-[#fef3e2]"],
  },
  {
    key: "mono",
    preview: ["bg-[#0b0b0f]", "bg-[#52525b]", "bg-[#a1a1aa]"],
  },
  {
    key: "deep-dark",
    preview: ["bg-[#000000]", "bg-[#0a0a0f]", "bg-[#1f2937]"],
  },
  {
    key: "deep-dark-high-contrast",
    preview: ["bg-[#000000]", "bg-[#525252]", "bg-[#ffffff]"],
  },
];
