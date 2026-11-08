import "@tanstack/react-start/server-only";

import { z } from "zod";
import { createId, nowIso } from "../data/ids";
import { mutateStore } from "../data/store";
import type { Skill } from "../types";

export const SKILL_NAME_MAX = 120;
export const SKILL_BODY_MAX = 100_000;

/** A skill as the web form and Discord send it. A blank body would give a teammate nothing to follow. */
export const skillSchema = z.object({
  id: z.string().min(1).max(200).optional(),
  name: z.string().trim().min(1).max(SKILL_NAME_MAX),
  body: z.string().min(1).max(SKILL_BODY_MAX).refine((value) => Boolean(value.trim())),
});

export type SkillInput = z.input<typeof skillSchema>;
export type SaveSkillResult = { ok: true; skill: Skill } | { ok: false; reason: "invalid" | "duplicate" | "not_found" };

// Thrown inside mutateStore so a rejected save writes nothing.
class DuplicateSkillName extends Error {}

/**
 * Create a skill, or update the one with input.id. Teammates read skills by name, so names are
 * unique regardless of case; the duplicate check runs before the existence check.
 */
export async function saveSkill(userId: string, input: SkillInput): Promise<SaveSkillResult> {
  const parsed = skillSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const data = parsed.data;
  try {
    return await mutateStore(userId, (store): SaveSkillResult => {
      if (store.skills.some((item) => item.id !== data.id && item.name.toLowerCase() === data.name.toLowerCase())) throw new DuplicateSkillName();
      if (data.id) {
        const item = store.skills.find((entry) => entry.id === data.id);
        if (!item) return { ok: false, reason: "not_found" };
        item.name = data.name;
        item.body = data.body;
        item.updatedAt = nowIso();
        return { ok: true, skill: item };
      }
      const created: Skill = { id: createId("skill"), name: data.name, body: data.body, createdAt: nowIso(), updatedAt: nowIso() };
      store.skills.push(created);
      return { ok: true, skill: created };
    });
  } catch (error) {
    if (error instanceof DuplicateSkillName) return { ok: false, reason: "duplicate" };
    throw error;
  }
}

/** Remove one of the user's skills. Returns what was removed, or null when the id is not theirs. */
export async function deleteSkill(userId: string, id: string): Promise<Skill | null> {
  return mutateStore(userId, (store) => {
    const index = store.skills.findIndex((skill) => skill.id === id);
    if (index === -1) return null;
    return store.skills.splice(index, 1)[0] ?? null;
  });
}
