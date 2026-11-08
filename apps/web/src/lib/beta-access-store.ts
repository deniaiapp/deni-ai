import { and, desc, eq, isNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db/drizzle";
import { betaAccess, user } from "@/db/schema";

export type BetaTester = {
  id: string;
  email: string;
  userId: string | null;
  /** The linked account's name and email (after its first signed-in check). */
  linkedName: string | null;
  linkedEmail: string | null;
  grantedById: string | null;
  grantedByEmail: string | null;
  note: string | null;
  createdAt: Date;
};

/** The `beta_access` reads and writes behind the gate and the admin page. */
export type BetaAccessStore = {
  /** Whether a grant is linked to this user. */
  hasUserGrant(userId: string): Promise<boolean>;
  /**
   * Links the grant for this (verified, lower-cased) email to the user, when it
   * is unlinked or already theirs. True when the user now holds it.
   */
  claimEmailGrant(email: string, userId: string): Promise<boolean>;
  list(): Promise<BetaTester[]>;
  /** Null when the email already has a grant. */
  add(input: {
    email: string;
    note: string | null;
    grantedBy: string;
  }): Promise<{ id: string; email: string } | null>;
  /** The removed grant, or null when there was none. */
  remove(id: string): Promise<{ id: string; email: string; userId: string | null } | null>;
};

const linkedUser = alias(user, "beta_linked_user");
const granter = alias(user, "beta_granted_by_user");

export const betaAccessStore: BetaAccessStore = {
  async hasUserGrant(userId) {
    const [row] = await db
      .select({ id: betaAccess.id })
      .from(betaAccess)
      .where(eq(betaAccess.userId, userId))
      .limit(1);
    return Boolean(row);
  },

  async claimEmailGrant(email, userId) {
    const rows = await db
      .update(betaAccess)
      .set({ userId })
      .where(
        and(
          eq(betaAccess.email, email),
          or(isNull(betaAccess.userId), eq(betaAccess.userId, userId)),
        ),
      )
      .returning({ id: betaAccess.id });
    return rows.length > 0;
  },

  async list() {
    return db
      .select({
        id: betaAccess.id,
        email: betaAccess.email,
        userId: betaAccess.userId,
        linkedName: linkedUser.name,
        linkedEmail: linkedUser.email,
        grantedById: betaAccess.grantedBy,
        grantedByEmail: granter.email,
        note: betaAccess.note,
        createdAt: betaAccess.createdAt,
      })
      .from(betaAccess)
      .leftJoin(linkedUser, eq(linkedUser.id, betaAccess.userId))
      .leftJoin(granter, eq(granter.id, betaAccess.grantedBy))
      .orderBy(desc(betaAccess.createdAt));
  },

  async add({ email, note, grantedBy }) {
    const [row] = await db
      .insert(betaAccess)
      .values({ email, note, grantedBy })
      .onConflictDoNothing({ target: betaAccess.email })
      .returning({ id: betaAccess.id, email: betaAccess.email });
    return row ?? null;
  },

  async remove(id) {
    const [row] = await db
      .delete(betaAccess)
      .where(eq(betaAccess.id, id))
      .returning({ id: betaAccess.id, email: betaAccess.email, userId: betaAccess.userId });
    return row ?? null;
  },
};
