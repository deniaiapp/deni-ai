import { createHash, randomInt } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { runDiscordLinkCodes, runDiscordLinks } from "@deniai/db";
import { db } from "@/db/drizzle";

/**
 * The web half of Run's Discord link: the settings card issues a one-time code and
 * the worker's bot (`services/run-worker`, `discord/link.ts`) redeems it. The format
 * matches the worker's `discord/link-code.ts`: 8 characters without look-alikes, shown
 * as `ABCD-EFGH`, stored only as the SHA-256 of the normalized code, valid 10 minutes.
 */
const LINK_CODE_TTL_MS = 10 * 60_000;
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

export function hashLinkCode(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

export async function getDiscordLink(userId: string) {
  const [row] = await db
    .select()
    .from(runDiscordLinks)
    .where(eq(runDiscordLinks.userId, userId))
    .limit(1);
  return row
    ? { discordUsername: row.discordUsername, createdAt: row.createdAt.toISOString() }
    : null;
}

/** Issue a fresh code; any earlier unused code of the user stops working. */
export async function createDiscordLinkCode(userId: string, locale: "en" | "ja") {
  const now = new Date();
  await db.delete(runDiscordLinkCodes).where(lt(runDiscordLinkCodes.expiresAt, now));
  await db.delete(runDiscordLinkCodes).where(eq(runDiscordLinkCodes.userId, userId));
  const code = Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join(
    "",
  );
  const expiresAt = new Date(now.getTime() + LINK_CODE_TTL_MS);
  await db
    .insert(runDiscordLinkCodes)
    .values({ codeHash: hashLinkCode(code), userId, locale, expiresAt });
  return {
    code: `${code.slice(0, CODE_LENGTH / 2)}-${code.slice(CODE_LENGTH / 2)}`,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function unlinkDiscord(userId: string) {
  await db.delete(runDiscordLinks).where(and(eq(runDiscordLinks.userId, userId)));
  await db.delete(runDiscordLinkCodes).where(eq(runDiscordLinkCodes.userId, userId));
}
