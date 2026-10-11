import { beforeEach, expect, test, vi } from "vitest";
import { recordTeamAuditEvent, updateTeamSeatCount } from "@/lib/team-billing";
import {
  accountDeletionSeatHooks,
  assertCanSendTeamInvitation,
  teamInvitationHooks,
  teamMemberAuditHooks,
  withTeamAuditActor,
} from "./team-member-audit";
import { POST } from "@/app/api/auth/[...all]/route";
import { organizationRouter } from "@/server/api/routers/organization";

const handler = vi.hoisted(() => ({
  post: vi.fn(),
  session: vi.fn(),
  membership: vi.fn(),
  where: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: handler.session } } }));
vi.mock("@/db/drizzle", () => ({
  db: { select: () => ({ from: () => ({ where: handler.where }) }) },
}));
vi.mock("@/lib/team-billing", () => ({
  recordTeamAuditEvent: vi.fn(),
  updateTeamSeatCount: vi.fn(),
}));
vi.mock("better-auth/next-js", () => ({
  toNextJsHandler: () => ({ POST: handler.post, GET: vi.fn() }),
}));

const change = { member: { userId: "target", role: "member" }, organization: { id: "team" } };

beforeEach(() => {
  vi.resetAllMocks();
  handler.session.mockResolvedValue({ session: { userId: "real-actor" } });
  handler.membership.mockResolvedValue([{ role: "member" }]);
  handler.where.mockReturnValue({ limit: handler.membership });
});

test("client-controlled audit mutations are not exposed", () => {
  const procedures = organizationRouter._def.procedures;
  expect(procedures).not.toHaveProperty("recordMemberRemoved");
  expect(procedures).not.toHaveProperty("recordMemberRoleChanged");
});

test("member changes fail closed without authenticated request context", async () => {
  await expect(teamMemberAuditHooks.beforeRemoveMember()).rejects.toThrow("audit context");
  await expect(teamMemberAuditHooks.beforeUpdateMemberRole({ newRole: "member" })).rejects.toThrow(
    "audit context",
  );
  expect(recordTeamAuditEvent).not.toHaveBeenCalled();
});

test("successful role changes use the authenticated actor and server-provided roles", async () => {
  await withTeamAuditActor("admin", async () => {
    await teamMemberAuditHooks.beforeUpdateMemberRole({ newRole: "member" });
    await teamMemberAuditHooks.afterUpdateMemberRole({ ...change, previousRole: "admin" });
  });
  expect(recordTeamAuditEvent).toHaveBeenCalledWith({
    organizationId: "team",
    actorUserId: "admin",
    targetUserId: "target",
    action: "member_role_updated",
    metadata: { previousRole: "admin", newRole: "member" },
  });
});

test("self-removal still records the original actor after membership disappears", async () => {
  await withTeamAuditActor("target", async () => {
    await teamMemberAuditHooks.beforeRemoveMember();
    await teamMemberAuditHooks.afterRemoveMember(change);
  });
  expect(recordTeamAuditEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      actorUserId: "target",
      targetUserId: "target",
      action: "member_removed",
    }),
  );
  expect(updateTeamSeatCount).toHaveBeenCalledWith("team");
});

test("parallel auth requests never share audit actors", async () => {
  await Promise.all(
    ["actor-a", "actor-b"].map((actor) =>
      withTeamAuditActor(actor, async () => {
        await new Promise((resolve) => setTimeout(resolve, actor === "actor-a" ? 5 : 0));
        await teamMemberAuditHooks.afterRemoveMember({ ...change, organization: { id: actor } });
      }),
    ),
  );
  for (const actor of ["actor-a", "actor-b"])
    expect(recordTeamAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: actor, actorUserId: actor }),
    );
});

test("auth route binds actor from the session, never the submitted body", async () => {
  handler.post.mockImplementation(async () => {
    await teamMemberAuditHooks.beforeUpdateMemberRole({ newRole: "member" });
    await teamMemberAuditHooks.afterUpdateMemberRole({ ...change, previousRole: "admin" });
    return new Response(null, { status: 200 });
  });
  await POST(
    new Request("http://localhost/api/auth/organization/update-member-role", {
      method: "POST",
      body: JSON.stringify({ actorUserId: "forged", previousRole: "owner" }),
    }),
  );
  expect(recordTeamAuditEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      actorUserId: "real-actor",
      metadata: { previousRole: "admin", newRole: "member" },
    }),
  );
});

test("self-service leave records the authenticated departure and reconciles seats", async () => {
  handler.post.mockResolvedValue(new Response(null, { status: 200 }));
  await POST(
    new Request("http://localhost/api/auth/organization/leave", {
      method: "POST",
      body: JSON.stringify({ organizationId: "team", actorUserId: "forged" }),
    }),
  );
  expect(recordTeamAuditEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      organizationId: "team",
      actorUserId: "real-actor",
      targetUserId: "real-actor",
      action: "member_removed",
      metadata: { role: "member", selfLeave: true },
    }),
  );
  expect(updateTeamSeatCount).toHaveBeenCalledWith("team");
});

test("rejected self-service leave does not log or reconcile seats", async () => {
  handler.post.mockResolvedValue(new Response(null, { status: 403 }));
  const response = await POST(
    new Request("http://localhost/api/auth/organization/leave", {
      method: "POST",
      body: JSON.stringify({ organizationId: "team" }),
    }),
  );
  expect(response.status).toBe(403);
  expect(recordTeamAuditEvent).not.toHaveBeenCalled();
  expect(updateTeamSeatCount).not.toHaveBeenCalled();
});

test("a denied auth mutation does not produce an audit event", async () => {
  handler.post.mockResolvedValue(new Response(null, { status: 403 }));
  const response = await POST(
    new Request("http://localhost/api/auth/organization/remove-member", { method: "POST" }),
  );
  expect(response.status).toBe(403);
  expect(recordTeamAuditEvent).not.toHaveBeenCalled();
});

test("role updates accept only a single exact role", async () => {
  await withTeamAuditActor("owner", async () => {
    for (const newRole of ["member", "admin", "owner"]) {
      await expect(teamMemberAuditHooks.beforeUpdateMemberRole({ newRole })).resolves.toBe(
        undefined,
      );
    }
    for (const newRole of ["admin,owner", "admin, owner", " owner", "Owner", "superuser"]) {
      await expect(teamMemberAuditHooks.beforeUpdateMemberRole({ newRole })).rejects.toMatchObject({
        body: { code: "ROLE_NOT_FOUND" },
      });
    }
  });
});

test("invitations cannot carry a padded or multi-role that later reads as owner", async () => {
  for (const role of ["member", "admin"]) {
    await expect(
      teamInvitationHooks.beforeCreateInvitation({ invitation: { role } }),
    ).resolves.toBeUndefined();
  }
  // Owner invitations are not offered; ownership moves through a role update.
  for (const role of ["admin, owner", "admin,owner", "member, owner", "owner", " admin", ""]) {
    await expect(
      teamInvitationHooks.beforeCreateInvitation({ invitation: { role } }),
    ).rejects.toMatchObject({ body: { code: "ROLE_NOT_FOUND" } });
    // Invitations stored before the check existed cannot be redeemed either.
    await expect(
      teamInvitationHooks.beforeAcceptInvitation({ invitation: { role } }),
    ).rejects.toMatchObject({ body: { code: "ROLE_NOT_FOUND" } });
  }
});

test("guests cannot send team invitations", async () => {
  await expect(
    assertCanSendTeamInvitation({
      user: { id: "guest", isAnonymous: true },
      email: "victim@example.com",
    }),
  ).rejects.toMatchObject({
    body: { code: "YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION" },
  });
});

test("repeated invitation resends to one inbox are throttled", async () => {
  const send = (inviter: string) =>
    assertCanSendTeamInvitation({ user: { id: inviter }, email: " Flooded@Example.com " });
  for (let attempt = 0; attempt < 5; attempt++) {
    await expect(send("resend-inviter")).resolves.toBeUndefined();
  }
  await expect(send("resend-inviter")).rejects.toMatchObject({
    body: { code: "TOO_MANY_REQUESTS" },
  });
  // Another account (or team) cannot reopen the same inbox.
  await expect(send("second-inviter")).rejects.toMatchObject({
    body: { code: "TOO_MANY_REQUESTS" },
  });
  // Other recipients are unaffected.
  await expect(
    assertCanSendTeamInvitation({ user: { id: "second-inviter" }, email: "other@example.com" }),
  ).resolves.toBeUndefined();
});

test("one inviter can fill a team but not mail without bound", async () => {
  for (let invitee = 0; invitee < 50; invitee++) {
    await expect(
      assertCanSendTeamInvitation({
        user: { id: "bulk-inviter" },
        email: `invitee${invitee}@example.com`,
      }),
    ).resolves.toBeUndefined();
  }
  await expect(
    assertCanSendTeamInvitation({ user: { id: "bulk-inviter" }, email: "one-more@example.com" }),
  ).rejects.toMatchObject({ body: { code: "TOO_MANY_REQUESTS" } });
});

test("deleting a member's account reconciles every team's seats afterwards", async () => {
  handler.where.mockResolvedValue([{ organizationId: "team-a" }, { organizationId: "team-b" }]);
  const departing = { id: "departing-member" };

  await accountDeletionSeatHooks.before(departing);
  // Seats are counted only once the cascade has removed the memberships.
  expect(updateTeamSeatCount).not.toHaveBeenCalled();
  await accountDeletionSeatHooks.after(departing);

  expect(updateTeamSeatCount).toHaveBeenCalledTimes(2);
  expect(updateTeamSeatCount).toHaveBeenCalledWith("team-a");
  expect(updateTeamSeatCount).toHaveBeenCalledWith("team-b");
});

test("a failed membership lookup never aborts an account deletion", async () => {
  handler.where.mockRejectedValue(new Error("database unavailable"));
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const departing = { id: "lookup-fails" };

  await expect(accountDeletionSeatHooks.before(departing)).resolves.toBeUndefined();
  await accountDeletionSeatHooks.after(departing);

  expect(updateTeamSeatCount).not.toHaveBeenCalled();
  consoleError.mockRestore();
});
