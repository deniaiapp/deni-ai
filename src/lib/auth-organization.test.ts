import { afterEach, expect, test, vi } from "vitest";

const session = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("better-auth/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("better-auth/api")>()),
  getSessionFromCtx: session.get,
}));
vi.mock("@/lib/email", () => ({ isEmailConfigured: () => true, sendEmail: vi.fn() }));

// Each case re-imports the full auth module graph; the first cold import is slow.
const AUTH_IMPORT_TIMEOUT = { timeout: 30_000 };

type OrganizationOptions = {
  allowUserToCreateOrganization: (user: { isAnonymous?: boolean }) => boolean;
  organizationHooks: {
    beforeCreateInvitation: (data: { invitation: { role: string } }) => Promise<unknown>;
    beforeAcceptInvitation: (data: { invitation: { role: string } }) => Promise<unknown>;
  };
};

async function loadAuth() {
  vi.resetModules();
  const { auth } = await import("./auth");
  const plugins = (auth.options.plugins ?? []) as unknown as {
    id: string;
    options?: OrganizationOptions;
  }[];
  const organization = plugins.find((plugin) => plugin.id === "organization")?.options;
  if (!organization) throw new Error("organization plugin is not configured");
  return { auth, organization };
}

afterEach(() => {
  session.get.mockReset();
});

test("guests cannot create teams", AUTH_IMPORT_TIMEOUT, async () => {
  const { organization } = await loadAuth();

  expect(organization.allowUserToCreateOrganization({ isAnonymous: true })).toBe(false);
  expect(organization.allowUserToCreateOrganization({ isAnonymous: false })).toBe(true);
});

test(
  "the invitation endpoints reject roles that hide an owner grant",
  AUTH_IMPORT_TIMEOUT,
  async () => {
    const { organization } = await loadAuth();
    const { beforeCreateInvitation, beforeAcceptInvitation } = organization.organizationHooks;

    await expect(
      beforeCreateInvitation({ invitation: { role: "admin, owner" } }),
    ).rejects.toMatchObject({ body: { code: "ROLE_NOT_FOUND" } });
    await expect(
      beforeAcceptInvitation({ invitation: { role: "admin, owner" } }),
    ).rejects.toMatchObject({ body: { code: "ROLE_NOT_FOUND" } });
    await expect(beforeCreateInvitation({ invitation: { role: "admin" } })).resolves.toBe(
      undefined,
    );
  },
);

test("a guest session cannot send or resend invitation emails", AUTH_IMPORT_TIMEOUT, async () => {
  const { auth } = await loadAuth();
  session.get.mockResolvedValue({
    session: { id: "session", userId: "guest", activeOrganizationId: "team" },
    user: { id: "guest", isAnonymous: true },
  });

  // Rejected by the global before-hook, ahead of both the create and the
  // resend branch, so neither the database nor the mailer is reached.
  const response = await auth.handler(
    new Request("http://localhost:3000/api/auth/organization/invite-member", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "victim@example.com",
        role: "member",
        organizationId: "team",
        resend: true,
      }),
    }),
  );

  expect(session.get).toHaveBeenCalled();
  expect(response.status).toBe(403);
  await expect(response.json()).resolves.toMatchObject({
    code: "YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION",
  });
});

test(
  "account deletion reconciles team seats on every deletion path",
  AUTH_IMPORT_TIMEOUT,
  async () => {
    const { auth } = await loadAuth();
    const { accountDeletionSeatHooks } = await import("./team-member-audit");

    expect(auth.options.databaseHooks.user.delete).toBe(accountDeletionSeatHooks);
  },
);
