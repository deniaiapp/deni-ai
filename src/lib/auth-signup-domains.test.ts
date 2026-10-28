import { beforeAll, expect, test, vi } from "vitest";

vi.mock("@/lib/email", () => ({ isEmailConfigured: () => true, sendEmail: vi.fn() }));

let auth: typeof import("./auth").auth;
beforeAll(async () => {
  ({ auth } = await import("./auth"));
}, 30_000);

function newUser(email: string) {
  return {
    id: "user",
    name: "Test",
    email,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const oauthContexts = [
  { path: "/callback/:id", params: { id: "google" } },
  { path: "/callback/:id", params: { id: "github" } },
  { path: "/sign-in/social", body: { provider: "google" } },
  { path: "/sign-in/social", body: { provider: "github" } },
];

test.each(oauthContexts)("OAuth domain allowlist applies to %j", async (ctx) => {
  const beforeCreate = auth.options.databaseHooks.user.create.before;
  for (const email of [
    "person@catpost.site",
    "person@company.example",
    "person@outlook.com.catpost.site",
    "person@school.edu.kg",
    "person@duck.com",
  ]) {
    await expect(beforeCreate(newUser(email), ctx as never)).rejects.toMatchObject({
      body: { code: "EMAIL_DOMAIN_NOT_ALLOWED" },
    });
  }
  for (const email of ["person@outlook.com", "person@u-tokyo.ac.jp"]) {
    await expect(beforeCreate(newUser(email), ctx as never)).resolves.toBeUndefined();
  }
});

test.each(["gmail.com", "googlemail.com"])(
  "%s registers through Google or GitHub on both OAuth entry points",
  async (domain) => {
    const beforeCreate = auth.options.databaseHooks.user.create.before;
    for (const ctx of oauthContexts) {
      await expect(
        beforeCreate(newUser(`first.last@${domain}`), ctx as never),
      ).resolves.toBeUndefined();
    }
    // Email sign-up still has to go through a provider.
    await expect(beforeCreate(newUser(`first.last@${domain}`), null)).rejects.toMatchObject({
      body: { code: "EMAIL_USE_GOOGLE_OAUTH" },
    });
  },
);

test("an alias-style Gmail address from GitHub is refused, Google's own address is not", async () => {
  const beforeCreate = auth.options.databaseHooks.user.create.before;
  const alias = newUser("first.last+deni@gmail.com");
  await expect(
    beforeCreate(alias, { path: "/callback/:id", params: { id: "github" } } as never),
  ).rejects.toMatchObject({ body: { code: "EMAIL_ALIAS_NOT_ALLOWED" } });
  await expect(
    beforeCreate(alias, { path: "/callback/:id", params: { id: "google" } } as never),
  ).resolves.toBeUndefined();
});

test("a claimed provider in an email signup cannot enable the Google exception", async () => {
  const beforeCreate = auth.options.databaseHooks.user.create.before;
  await expect(
    beforeCreate(newUser("person@gmail.com"), {
      path: "/sign-up/email",
      body: { provider: "google" },
    } as never),
  ).rejects.toMatchObject({ body: { code: "EMAIL_USE_GOOGLE_OAUTH" } });
});

test("alias restrictions remain specific to email registration", async () => {
  const beforeCreate = auth.options.databaseHooks.user.create.before;
  const user = newUser("person+tag@outlook.com");
  for (const ctx of oauthContexts) {
    await expect(beforeCreate(user, ctx as never)).resolves.toBeUndefined();
  }
  await expect(beforeCreate(user, null)).rejects.toMatchObject({
    body: { code: "EMAIL_ALIAS_NOT_ALLOWED" },
  });
});

test("duck.com is rejected for every new registration path", async () => {
  const beforeCreate = auth.options.databaseHooks.user.create.before;
  // `null`: email / magic-link sign-up; the rest: provider-verified identities.
  for (const ctx of [null, { path: "/sign-up/email" }, ...oauthContexts]) {
    await expect(beforeCreate(newUser("person@duck.com"), ctx as never)).rejects.toMatchObject({
      body: { code: "EMAIL_DOMAIN_NOT_ALLOWED" },
    });
  }
});

test("existing duck.com accounts keep updating, but nobody can switch to duck.com", async () => {
  const beforeUpdate = auth.options.databaseHooks.user.update.before;
  // What Better Auth writes for an existing user on sign-in / verification:
  // OAuth linking and magic links (emailVerified), 2FA, last login method.
  for (const data of [
    { emailVerified: true },
    { twoFactorEnabled: true },
    { lastLoginMethod: "github" },
    { name: "Renamed", image: null },
  ]) {
    await expect(beforeUpdate(data as never)).resolves.toBeUndefined();
  }
  // Moving off duck.com is allowed; moving onto it is not.
  await expect(
    beforeUpdate({ email: "person@outlook.com", emailVerified: true }),
  ).resolves.toBeUndefined();
  for (const email of ["person@duck.com", "Person@DUCK.com"]) {
    await expect(beforeUpdate({ email, emailVerified: true })).rejects.toMatchObject({
      body: { code: "EMAIL_DOMAIN_NOT_ALLOWED" },
    });
  }
});
