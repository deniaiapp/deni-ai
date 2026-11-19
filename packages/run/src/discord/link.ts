import {
  CODE_LENGTH,
  generateLinkCode,
  hashLinkCode as hashCode,
  LINK_CODE_TTL_MS,
  formatLinkCode,
  normalizeLinkCode,
} from "./link-code";
import { and, eq, gt, lt, ne } from "drizzle-orm";
import { db } from "../runtime";
import {
  runDiscordLinkCodes as discordLinkCodes,
  runDiscordLinks as discordLinks,
  user,
} from "@deniai/db";
import { resolveServerLocale } from "../i18n/standalone";
import { mutateStore, readStore } from "../data/store";
import type { DiscordPrefs } from "../types";

export {
  LINK_CODE_TTL_MS,
  formatLinkCode,
  looksLikeLinkCode,
  normalizeLinkCode,
} from "./link-code";

export type DiscordLink = {
  userId: string;
  discordUserId: string;
  discordUsername: string;
  botId: string | null;
  locale: string;
  createdAt: string;
};

function mapLink(row: typeof discordLinks.$inferSelect): DiscordLink {
  return {
    userId: row.userId,
    discordUserId: row.discordUserId,
    discordUsername: row.discordUsername,
    botId: row.teammateId,
    locale: row.locale,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getDiscordLinkByUser(userId: string) {
  const [row] = await db
    .select()
    .from(discordLinks)
    .where(eq(discordLinks.userId, userId))
    .limit(1);
  return row ? mapLink(row) : null;
}

export async function getDiscordLinkByDiscordId(discordUserId: string) {
  const [row] = await db
    .select()
    .from(discordLinks)
    .where(eq(discordLinks.discordUserId, discordUserId))
    .limit(1);
  return row ? mapLink(row) : null;
}

/** Issue a fresh code for the signed-in user. Any earlier unused code stops working. */
export async function createDiscordLinkCode(userId: string, locale?: string) {
  const now = new Date();
  await db.delete(discordLinkCodes).where(lt(discordLinkCodes.expiresAt, now));
  await db.delete(discordLinkCodes).where(eq(discordLinkCodes.userId, userId));
  const code = generateLinkCode();
  const expiresAt = new Date(now.getTime() + LINK_CODE_TTL_MS);
  await db
    .insert(discordLinkCodes)
    .values({ codeHash: hashCode(code), userId, locale: resolveServerLocale(locale), expiresAt });
  return { code: formatLinkCode(code), expiresAt: expiresAt.toISOString() };
}

/**
 * Bind a Discord account to the user who issued the code. The delete is the guard: it matches
 * only an unexpired code and returns the row exactly once, so a code cannot be redeemed twice.
 */
export async function redeemDiscordLinkCode(
  rawCode: string,
  discord: { id: string; username: string },
) {
  const code = normalizeLinkCode(rawCode);
  if (code.length !== CODE_LENGTH) return null;
  const [redeemed] = await db
    .delete(discordLinkCodes)
    .where(
      and(
        eq(discordLinkCodes.codeHash, hashCode(code)),
        gt(discordLinkCodes.expiresAt, new Date()),
      ),
    )
    .returning();
  if (!redeemed) return null;
  // The Discord account may have belonged to another workspace user; one account maps to one user.
  await db
    .delete(discordLinks)
    .where(
      and(eq(discordLinks.discordUserId, discord.id), ne(discordLinks.userId, redeemed.userId)),
    );
  await db
    .insert(discordLinks)
    .values({
      userId: redeemed.userId,
      discordUserId: discord.id,
      discordUsername: discord.username,
      locale: redeemed.locale,
    })
    .onConflictDoUpdate({
      target: discordLinks.userId,
      set: {
        discordUserId: discord.id,
        discordUsername: discord.username,
        locale: redeemed.locale,
        teammateId: null,
      },
    });
  await setDiscordPrefs(redeemed.userId, { threadId: null });
  return redeemed.userId;
}

/** Name and masked email of the workspace account, shown to the Discord user who just linked it. */
export async function describeLinkedAccount(userId: string) {
  const [row] = await db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!row) return userId;
  const [local = "", domain = ""] = row.email.split("@");
  return `${row.name} (${local.slice(0, 1)}***@${domain})`;
}

export async function unlinkDiscord(userId: string) {
  await db.delete(discordLinkCodes).where(eq(discordLinkCodes.userId, userId));
  const removed = await db
    .delete(discordLinks)
    .where(eq(discordLinks.userId, userId))
    .returning({ userId: discordLinks.userId });
  return removed.length > 0;
}

export async function setDiscordLinkBot(userId: string, botId: string | null) {
  await db.update(discordLinks).set({ teammateId: botId }).where(eq(discordLinks.userId, userId));
}

export async function setDiscordLinkLocale(userId: string, locale: string) {
  await db
    .update(discordLinks)
    .set({ locale: resolveServerLocale(locale) })
    .where(eq(discordLinks.userId, userId));
}

export async function getDiscordPrefs(userId: string): Promise<Required<DiscordPrefs>> {
  const prefs = (await readStore(userId)).discord;
  return { threadId: prefs?.threadId ?? null, notify: prefs?.notify ?? true };
}

export async function setDiscordPrefs(userId: string, patch: DiscordPrefs) {
  await mutateStore(userId, (store) => {
    store.discord = { ...store.discord, ...patch };
  });
}

/** Plain DMs go to this teammate from now on, leaving any group conversation. */
export async function talkToTeammate(userId: string, botId: string | null) {
  await setDiscordLinkBot(userId, botId);
  await setDiscordPrefs(userId, { threadId: null });
}
