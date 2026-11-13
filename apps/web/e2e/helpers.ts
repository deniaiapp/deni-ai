import { randomUUID } from "node:crypto";
import { expect, type Locator, type Page } from "@playwright/test";

export type TestAccount = { name: string; email: string; password: string };

/**
 * A fresh account per test. outlook.com is on the sign-up allowlist
 * (src/lib/email-domain-policy.ts); the local part has no `+` or dots, which
 * the alias rules refuse.
 */
export function newAccount(): TestAccount {
  const id = randomUUID().replaceAll("-", "").slice(0, 12);
  return { name: "E2E Tester", email: `e2e${id}@outlook.com`, password: `e2e-Pass-${id}` };
}

/**
 * Waits until React has hydrated the element (it carries React's props), so a
 * click or Enter reaches its handler instead of the browser's default, which
 * for a form is a native GET submit.
 */
export async function waitForHydration(locator: Locator) {
  await expect
    .poll(() =>
      locator.evaluate((element) =>
        Object.keys(element).some((key) => key.startsWith("__reactProps$")),
      ),
    )
    .toBe(true);
}

export async function signUp(page: Page, account: TestAccount) {
  await page.goto("/auth/sign-up");
  await waitForHydration(page.getByRole("button", { name: "Sign Up" }));
  await page.locator('input[name="name"]').fill(account.name);
  await page.locator('input[name="email"]').fill(account.email);
  await page.locator('input[name="password"]').fill(account.password);
  await page.getByRole("button", { name: "Sign Up" }).click();
  await expect(page).toHaveURL(/\/chat$/);
}

export async function signIn(page: Page, account: Pick<TestAccount, "email" | "password">) {
  await page.goto("/auth/sign-in");
  await waitForHydration(page.getByRole("button", { name: "Sign In" }));
  await page.locator('input[name="email"]').fill(account.email);
  await page.locator('input[name="password"]').fill(account.password);
  await page.getByRole("button", { name: "Sign In" }).click();
}

export async function continueAsGuest(page: Page) {
  await page.goto("/auth/sign-in");
  const guest = page.getByRole("button", { name: "Continue as Guest" });
  await waitForHydration(guest);
  await guest.click();
  await expect(page).toHaveURL(/\/chat$/);
}

/** The chat composer: "Ask me anything..." on the chat home, "What would you like to know?" in a chat. */
export function composer(page: Page) {
  return page.getByRole("textbox", {
    name: /^(Ask me anything\.\.\.|What would you like to know\?)$/,
  });
}

/** Sends a message from the composer; the mock answers `Mock reply: <text>`. */
export async function sendMessage(page: Page, text: string) {
  await waitForHydration(composer(page));
  await composer(page).fill(text);
  await composer(page).press("Enter");
}

export async function openAccountMenu(page: Page, name: string) {
  const button = page.getByRole("button", { name });
  await waitForHydration(button);
  await button.click();
  await expect(page.getByRole("menu")).toBeVisible();
}
