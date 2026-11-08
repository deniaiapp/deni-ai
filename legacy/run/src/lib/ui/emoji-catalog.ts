import catalog from "./emoji-catalog.json";

export type EmojiEntry = [emoji: string, label: string, keywords: string, category: string, variants: string[]];
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "🤔", "👎"];
// The compact catalog travels with the UI so opening the picker needs no request.
export const EMOJI_CATALOG = catalog as EmojiEntry[];
