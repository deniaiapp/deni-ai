import { expect, test } from "./fixtures";
import { continueAsGuest, newAccount, openAccountMenu, signIn, signUp } from "./helpers";

test.describe("authentication", () => {
  test("a signed-out visitor is sent from /chat to sign-in", async ({ page }) => {
    await page.goto("/chat");
    await expect(page).toHaveURL(/\/auth\/sign-in\?redirectTo=%2Fchat$/);
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
  });

  test("a guest can start chatting without an account", async ({ page }) => {
    await continueAsGuest(page);
    await openAccountMenu(page, "Guest");
    await expect(page.getByRole("menu").getByText("Guest", { exact: true })).toBeVisible();
  });

  test("sign up, log out and sign back in with email and password", async ({ page }) => {
    const account = newAccount();

    await signUp(page, account);
    await expect(page.getByRole("heading", { name: "What's on your mind, E2E?" })).toBeVisible();

    await openAccountMenu(page, account.name);
    await expect(page.getByRole("menu").getByText(account.email)).toBeVisible();
    await page.getByRole("menuitem", { name: "Logout" }).click();
    await expect(page).toHaveURL(/\/home$/);

    await signIn(page, account);
    await expect(page).toHaveURL(/\/chat$/);
    await expect(page.getByRole("button", { name: account.name })).toBeVisible();
  });

  test("a wrong password keeps the visitor on sign-in", async ({ page }) => {
    const account = newAccount();
    await signUp(page, account);
    await page.context().clearCookies();

    await signIn(page, { email: account.email, password: `${account.password}-wrong` });
    await expect(page.getByText(/invalid email or password/i)).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/sign-in/);
  });
});
