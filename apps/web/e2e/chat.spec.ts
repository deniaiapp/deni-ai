import { expect, test } from "./fixtures";
import { composer, continueAsGuest, newAccount, sendMessage, signUp } from "./helpers";

const chatUrl = /\/chat\/[0-9a-f-]{36}$/;

test.describe("chat", () => {
  test("a guest's message gets a streamed answer that survives a reload", async ({ page }) => {
    await continueAsGuest(page);

    await sendMessage(page, "hello from the guest test");
    await expect(page).toHaveURL(chatUrl);
    const log = page.getByRole("log");
    await expect(log.getByText("hello from the guest test", { exact: true })).toBeVisible();
    await expect(log.getByText("Mock reply: hello from the guest test")).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit" })).toBeVisible();

    await page.reload();
    await expect(log.getByText("hello from the guest test", { exact: true })).toBeVisible();
    await expect(log.getByText("Mock reply: hello from the guest test")).toBeVisible();
  });

  test("a signed-in user continues a conversation and finds it in the sidebar", async ({
    page,
  }) => {
    await signUp(page, newAccount());

    await sendMessage(page, "first question");
    await expect(page).toHaveURL(chatUrl);
    const chatPath = new URL(page.url()).pathname;
    const log = page.getByRole("log");
    await expect(log.getByText("Mock reply: first question")).toBeVisible();

    await sendMessage(page, "second question");
    await expect(log.getByText("Mock reply: second question")).toBeVisible();

    // The sidebar's action button ("New Chat" + shortcut) comes before chat items
    // still titled "New Chat".
    await page.getByRole("button", { name: "New Chat" }).first().click();
    await expect(page).toHaveURL(/\/chat$/);
    await expect(composer(page)).toBeEmpty();

    await page.locator(`[href="${chatPath}"]`).first().click();
    await expect(page).toHaveURL(chatUrl);
    await expect(log.getByText("Mock reply: first question")).toBeVisible();
    await expect(log.getByText("Mock reply: second question")).toBeVisible();
  });

  test("Stop ends a running answer and keeps what was streamed", async ({ page }) => {
    await continueAsGuest(page);

    // e2e/mock-deni-api.ts streams `[slow]` answers for about ten seconds.
    await sendMessage(page, "[slow] please take your time");
    const stop = page.getByRole("button", { name: "Stop" });
    await expect(stop).toBeVisible();
    const log = page.getByRole("log");
    // Wait until part of the answer has streamed (markers …0, …1, …).
    await expect(log.getByText(/^Mock reply: \[slow\] please take your time .*…1\b/)).toBeVisible();

    await stop.click();
    await expect(page.getByRole("button", { name: "Submit" })).toBeVisible();
    const answer = log.getByText(/^Mock reply: \[slow\] please take your time/);
    const stopped = await answer.textContent();
    // The mock would have sent 40 markers (…0 to …39) without the stop.
    expect(stopped).not.toContain("…39");

    await page.reload();
    await expect(log.getByText(/^Mock reply: \[slow\] please take your time/)).toBeVisible();
  });
});
