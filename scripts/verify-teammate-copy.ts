import { applyTeammateCopy, type TeammateCopy } from "../lib/teammate-copy";
import { emptyStore } from "../lib/seed";
import { validAvatarIcon } from "../lib/avatar";

const en: TeammateCopy = {
  bots: { chief: { name: "Chief", job: "Team coordination" }, research: { name: "Research", job: "Research and reports" }, ops: { name: "Operations", job: "Computer execution" } },
  preview: "Send me a task",
};
const ja: TeammateCopy = {
  bots: { chief: { name: "チーフ", job: "チームのまとめ役" }, research: { name: "リサーチ", job: "調査とレポート" }, ops: { name: "オペレーション", job: "コンピューター操作" } },
  preview: "タスクを送ってください",
};

const store = emptyStore();
if (store.bots.some((bot) => !bot.icon?.startsWith("character:"))) throw new Error("default teammates did not start with a character");
if (!applyTeammateCopy(store, [en, ja], ja)) throw new Error("English defaults were not switched to Japanese");
if (store.bots.map((bot) => bot.name).join() !== "チーフ,リサーチ,オペレーション") throw new Error(`names: ${store.bots.map((bot) => bot.name).join()}`);
if (store.threads.find((thread) => thread.id === "dm_chief")?.title !== "チーフ") throw new Error("DM title did not follow the name");
if (store.threads.some((thread) => thread.lastPreview !== ja.preview)) throw new Error("starter preview was not translated");
if (applyTeammateCopy(store, [en, ja], ja)) throw new Error("a second pass changed the store again");

const research = store.bots.find((bot) => bot.id === "research")!;
research.name = "Scout";
research.icon = null;
store.threads.find((thread) => thread.id === "dm_ops")!.lastPreview = "Done with the report";
applyTeammateCopy(store, [en, ja], en);
if (research.name !== "Scout" || research.job !== "Research and reports") throw new Error("a renamed teammate lost its name or kept the old job language");
if (research.icon !== null) throw new Error("a removed icon came back");
if (store.bots.find((bot) => bot.id === "chief")?.name !== "Chief") throw new Error("defaults did not switch back to English");
if (store.threads.find((thread) => thread.id === "dm_ops")?.lastPreview !== "Done with the report") throw new Error("a real preview was replaced");

const legacy = emptyStore();
for (const bot of legacy.bots) delete bot.icon;
applyTeammateCopy(legacy, [en, ja], en);
if (legacy.bots.find((bot) => bot.id === "ops")?.icon !== "character:gear") throw new Error("existing default teammate did not get its character");

if (!validAvatarIcon("character:navi") || validAvatarIcon("character:dragon")) throw new Error("character icons are not validated");
console.info("verified default teammate names, previews, and characters");
