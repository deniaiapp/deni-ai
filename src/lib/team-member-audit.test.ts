import { beforeEach, expect, test, vi } from "vitest";
import {
  deletePersonalBillingRecords,
  takeDetachedTeamBillingContacts,
} from "@/lib/account-deletion-billing";
import { recordTeamAuditEvent, updateTeamSeatCount } from "@/lib/team-billing";
import {
  findTeamBillingContactOrganizations,
  redirectTeamBillingEmail,
  releaseTeamBillingContact,
} from "@/lib/team-billing-contact";
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
vi.mock("@/lib/account-deletion-billing", () => ({
  deletePersonalBillingRecords: vi.fn(),
  takeDetachedTeamBillingContacts: vi.fn(),
}));
vi.mock("@/lib/team-billing-contact", () => ({
  findTeamBillingContactOrganizations: vi.fn(),
  redirectTeamBillingEmail: vi.fn(),
  releaseTeamBillingContact: vi.fn(),
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
  vi.mocked(findTeamBillingContactOrganizations).mockResolvedValue([]);
  vi.mocked(takeDetachedTeamBillingContacts).mockReturnValue([]);
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
      organizationId: "team",
    }),
  ).rejects.toMatchObject({
    body: { code: "YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION" },
  });
});

test("repeated invitation resends to one inbox are throttled", async () => {
  handler.membership.mockResolvedValue([{ role: "admin" }]);
  const send = (inviter: string, organizationId = "resend-team") =>
    assertCanSendTeamInvitation({
      user: { id: inviter },
      email: " Flooded@Example.com ",
      organizationId,
    });
  for (let attempt = 0; attempt < 5; attempt++) {
    await expect(send("resend-inviter")).resolves.toBeUndefined();
  }
  await expect(send("resend-inviter")).rejects.toMatchObject({
    body: { code: "TOO_MANY_REQUESTS" },
  });
  // Another admin of the same team cannot reopen the same inbox.
  await expect(send("second-inviter")).rejects.toMatchObject({
    body: { code: "TOO_MANY_REQUESTS" },
  });
  // Other recipients and other teams keep their own budgets.
  await expect(
    assertCanSendTeamInvitation({
      user: { id: "second-inviter" },
      email: "other@example.com",
      organizationId: "resend-team",
    }),
  ).resolves.toBeUndefined();
  await expect(send("third-inviter", "other-team")).resolves.toBeUndefined();
});

test("requests the endpoint will refuse never spend a recipient's budget", async () => {
  handler.membership.mockResolvedValue([]);
  for (let attempt = 0; attempt < 10; attempt++) {
    await expect(
      assertCanSendTeamInvitation({
        user: { id: "stranger" },
        email: "protected@example.com",
        organizationId: "victim-team",
      }),
    ).resolves.toBeUndefined();
  }
  handler.membership.mockResolvedValue([{ role: "member" }]);
  await expect(
    assertCanSendTeamInvitation({
      user: { id: "plain-member" },
      email: "protected@example.com",
      organizationId: "victim-team",
    }),
  ).resolves.toBeUndefined();

  handler.membership.mockResolvedValue([{ role: "owner" }]);
  for (let attempt = 0; attempt < 5; attempt++) {
    await expect(
      assertCanSendTeamInvitation({
        user: { id: "real-owner" },
        email: "protected@example.com",
        organizationId: "victim-team",
      }),
    ).resolves.toBeUndefined();
  }
});

test("one inviter can fill a team but not mail without bound", async () => {
  handler.membership.mockResolvedValue([{ role: "owner" }]);
  for (let invitee = 0; invitee < 50; invitee++) {
    await expect(
      assertCanSendTeamInvitation({
        user: { id: "bulk-inviter" },
        email: `invitee${invitee}@example.com`,
        organizationId: "bulk-team",
      }),
    ).resolves.toBeUndefined();
  }
  await expect(
    assertCanSendTeamInvitation({
      user: { id: "bulk-inviter" },
      email: "one-more@example.com",
      organizationId: "bulk-team",
    }),
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

test("leaving or being removed from a team clears the member as its billing contact", async () => {
  handler.post.mockResolvedValue(new Response(null, { status: 200 }));
  await POST(
    new Request("http://localhost/api/auth/organization/leave", {
      method: "POST",
      body: JSON.stringify({ organizationId: "team" }),
    }),
  );
  expect(releaseTeamBillingContact).toHaveBeenCalledWith("team", "real-actor");

  await withTeamAuditActor("owner", async () => {
    await teamMemberAuditHooks.beforeRemoveMember();
    await teamMemberAuditHooks.afterRemoveMember(change);
  });
  expect(releaseTeamBillingContact).toHaveBeenCalledWith("team", "target");
});

test("a failed audit write never keeps a departed member as the billing contact", async () => {
  vi.mocked(recordTeamAuditEvent).mockRejectedValue(new Error("audit insert failed"));
  handler.post.mockResolvedValue(new Response(null, { status: 200 }));
  await expect(
    POST(
      new Request("http://localhost/api/auth/organization/leave", {
        method: "POST",
        body: JSON.stringify({ organizationId: "team" }),
      }),
    ),
  ).rejects.toThrow("audit insert failed");
  expect(releaseTeamBillingContact).toHaveBeenCalledWith("team", "real-actor");

  await expect(
    withTeamAuditActor("owner", () => teamMemberAuditHooks.afterRemoveMember(change)),
  ).rejects.toThrow("audit insert failed");
  expect(releaseTeamBillingContact).toHaveBeenCalledWith("team", "target");
});

test("a rejected leave keeps the team's billing contact", async () => {
  handler.post.mockResolvedValue(new Response(null, { status: 403 }));
  await POST(
    new Request("http://localhost/api/auth/organization/leave", {
      method: "POST",
      body: JSON.stringify({ organizationId: "team" }),
    }),
  );
  expect(releaseTeamBillingContact).not.toHaveBeenCalled();
});

test("account deletion removes personal billing and moves team invoices to an owner", async () => {
  handler.where.mockResolvedValue([{ organizationId: "team-a" }]);
  vi.mocked(findTeamBillingContactOrganizations).mockResolvedValue(["team-a"]);
  const departing = { id: "former-owner", email: "former@example.com" };

  await accountDeletionSeatHooks.before(departing);
  // Personal rows must go before the user row; team rows stay for the FK's SET NULL.
  expect(deletePersonalBillingRecords).toHaveBeenCalledWith("former-owner");
  expect(findTeamBillingContactOrganizations).toHaveBeenCalledWith("former-owner");
  expect(redirectTeamBillingEmail).not.toHaveBeenCalled();
  await accountDeletionSeatHooks.after(departing);

  expect(redirectTeamBillingEmail).toHaveBeenCalledTimes(1);
  expect(redirectTeamBillingEmail).toHaveBeenCalledWith("team-a", "former@example.com");
  expect(updateTeamSeatCount).toHaveBeenCalledWith("team-a");
});

test("account deletion checks the invoices of every team the user belonged to or billed", async () => {
  // A member's address can be on the customer without them being the row's contact,
  // and a self-service deletion has already cleared the contact it found.
  handler.where.mockResolvedValue([{ organizationId: "member-team" }]);
  vi.mocked(takeDetachedTeamBillingContacts).mockReturnValue(["detached-team"]);
  vi.mocked(findTeamBillingContactOrganizations).mockResolvedValue(["member-team"]);
  const departing = { id: "former-admin", email: "former@example.com" };

  await accountDeletionSeatHooks.before(departing);
  expect(takeDetachedTeamBillingContacts).toHaveBeenCalledWith("former-admin");
  await accountDeletionSeatHooks.after(departing);

  expect(redirectTeamBillingEmail).toHaveBeenCalledTimes(2);
  expect(redirectTeamBillingEmail).toHaveBeenCalledWith("member-team", "former@example.com");
  expect(redirectTeamBillingEmail).toHaveBeenCalledWith("detached-team", "former@example.com");
  // Seats only change for teams the user was still a member of.
  expect(updateTeamSeatCount).toHaveBeenCalledTimes(1);
  expect(updateTeamSeatCount).toHaveBeenCalledWith("member-team");
});

test("a personal billing row that cannot be removed never blocks the account deletion", async () => {
  // Sessions and accounts are already gone; the FK's SET NULL orphans the row instead.
  vi.mocked(deletePersonalBillingRecords).mockRejectedValue(new Error("database unavailable"));
  handler.where.mockResolvedValue([{ organizationId: "team-a" }]);
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const departing = { id: "personal-delete-fails", email: "former@example.com" };

  await expect(accountDeletionSeatHooks.before(departing)).resolves.toBeUndefined();
  expect(consoleError).toHaveBeenCalled();
  await accountDeletionSeatHooks.after(departing);
  expect(updateTeamSeatCount).toHaveBeenCalledWith("team-a");
  expect(redirectTeamBillingEmail).toHaveBeenCalledWith("team-a", "former@example.com");
  consoleError.mockRestore();
});
