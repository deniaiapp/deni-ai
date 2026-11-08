import { type AvatarCharacter, characterIcon } from "./avatar";
import type { Store } from "../types";

/** The names, jobs, and DM preview the default teammates start with, in one language. */
export type TeammateCopy = {
  bots: Record<string, { name: string; job: string }>;
  preview: string;
};

export const DEFAULT_TEAMMATE_CHARACTERS: Record<string, AvatarCharacter> = { chief: "navi", research: "loupe", ops: "gear" };

/**
 * Default teammates and starter DMs keep the words they were created with until someone edits
 * them. Words still matching any language's starting copy switch to the viewer's language, and
 * default teammates that never had an icon get their character. Returns whether anything changed.
 */
export function applyTeammateCopy(store: Store, copies: TeammateCopy[], current: TeammateCopy): boolean {
  let changed = false;
  for (const bot of store.bots) {
    const wanted = current.bots[bot.id];
    if (!wanted) continue;
    const starting = copies.map((copy) => copy.bots[bot.id]).filter((copy) => copy !== undefined);
    if (bot.name !== wanted.name && starting.some((copy) => copy.name === bot.name)) {
      bot.name = wanted.name;
      changed = true;
    }
    if (bot.job !== wanted.job && starting.some((copy) => copy.job === bot.job)) {
      bot.job = wanted.job;
      changed = true;
    }
    const character = DEFAULT_TEAMMATE_CHARACTERS[bot.id];
    if (bot.icon === undefined && character) {
      bot.icon = characterIcon(character);
      changed = true;
    }
  }
  for (const thread of store.threads) {
    if (thread.kind !== "dm") continue;
    const bot = store.bots.find((item) => item.id === thread.botIds[0]);
    if (bot && current.bots[bot.id] && thread.title !== bot.name) {
      thread.title = bot.name;
      changed = true;
    }
    if (thread.lastPreview !== current.preview && copies.some((copy) => copy.preview === thread.lastPreview)) {
      thread.lastPreview = current.preview;
      changed = true;
    }
  }
  return changed;
}
