import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { db as Db } from "@/db/drizzle";
import { member, organization, projects } from "@/db/schema";

export type AccessibleProject = typeof projects.$inferSelect & {
  organizationName: string | null;
  canManage: boolean;
  /** Whether the user may move the project to another team or make it personal. */
  canShare: boolean;
};

/** Evaluate membership against the current project row in the same database statement. */
export function currentProjectAccessWhere(userId: string) {
  return or(
    and(eq(projects.userId, userId), isNull(projects.organizationId)),
    sql`exists (select 1 from ${member} where ${member.organizationId} = ${projects.organizationId} and ${member.userId} = ${userId})`,
  );
}

export function currentProjectManagementWhere(userId: string) {
  return or(
    and(eq(projects.userId, userId), isNull(projects.organizationId)),
    sql`exists (select 1 from ${member}
      where ${member.organizationId} = ${projects.organizationId}
        and ${member.userId} = ${userId}
        and (${projects.userId} = ${userId} or ${member.role} in ('owner', 'admin')))`,
  );
}

/**
 * Only the creator may move a project out of its team or make it personal again,
 * so a team admin cannot hand a team project to someone else (including a
 * creator who has left the team). Pair with `currentProjectManagementWhere`.
 */
export function currentProjectSharingWhere(userId: string) {
  return and(currentProjectManagementWhere(userId), eq(projects.userId, userId));
}

/**
 * Hand a departing account's team projects to a current owner (or else admin) of
 * each team, so deleting the creator's account does not cascade them away from
 * the team. Personal projects, and a team project with no one to take it, are
 * still deleted with the account.
 */
export async function reassignTeamProjectsOnAccountDeletion(database: typeof Db, userId: string) {
  const successor = sql<string>`(select ${member.userId} from ${member}
    where ${member.organizationId} = ${projects.organizationId}
      and ${member.userId} <> ${userId}
      and ${member.role} in ('owner', 'admin')
    order by ${member.role} = 'owner' desc, ${member.createdAt} asc
    limit 1)`;
  await database
    .update(projects)
    .set({ userId: sql`coalesce(${successor}, ${projects.userId})` })
    .where(and(eq(projects.userId, userId), isNotNull(projects.organizationId)));
}

export async function listUserMemberships(database: typeof Db, userId: string) {
  return database
    .select({
      organizationId: member.organizationId,
      role: member.role,
      organizationName: organization.name,
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId));
}

function canManageWithRole(
  project: { userId: string; organizationId: string | null },
  userId: string,
  role: string | undefined,
) {
  if (!project.organizationId) {
    return project.userId === userId;
  }
  if (project.userId === userId) {
    return true;
  }
  return role === "owner" || role === "admin";
}

export function projectAccessWhere(
  userId: string,
  organizationIds: string[],
  includeArchived: boolean,
) {
  const personal = and(eq(projects.userId, userId), isNull(projects.organizationId));
  const team =
    organizationIds.length > 0 ? inArray(projects.organizationId, organizationIds) : undefined;
  return and(or(personal, team), includeArchived ? undefined : isNull(projects.archivedAt));
}

export async function getAccessibleProject(
  database: typeof Db,
  userId: string,
  projectId: string,
): Promise<AccessibleProject | null> {
  const [project] = await database
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) {
    return null;
  }

  if (!project.organizationId) {
    if (project.userId !== userId) {
      return null;
    }
    return { ...project, organizationName: null, canManage: true, canShare: true };
  }

  const [membership] = await database
    .select({
      role: member.role,
      organizationName: organization.name,
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(and(eq(member.organizationId, project.organizationId), eq(member.userId, userId)))
    .limit(1);

  if (!membership) {
    return null;
  }

  return {
    ...project,
    organizationName: membership.organizationName,
    canManage: canManageWithRole(project, userId, membership.role),
    canShare: project.userId === userId,
  };
}

export async function userIsOrgMember(database: typeof Db, userId: string, organizationId: string) {
  const [row] = await database
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1);
  return Boolean(row);
}

export function withProjectAccess(
  project: typeof projects.$inferSelect,
  userId: string,
  memberships: Array<{ organizationId: string; role: string; organizationName: string }>,
): AccessibleProject | null {
  if (!project.organizationId) {
    if (project.userId !== userId) {
      return null;
    }
    return { ...project, organizationName: null, canManage: true, canShare: true };
  }

  const membership = memberships.find((entry) => entry.organizationId === project.organizationId);
  if (!membership) {
    return null;
  }

  return {
    ...project,
    organizationName: membership.organizationName,
    canManage: canManageWithRole(project, userId, membership.role),
    canShare: project.userId === userId,
  };
}
