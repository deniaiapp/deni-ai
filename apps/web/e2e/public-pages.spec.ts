import { expect, test } from "./fixtures";

test.describe("public pages", () => {
  test("home describes Deni AI and links to chat", async ({ page }) => {
    await page.goto("/home");
    await expect(
      page.getByRole("heading", { level: 1, name: "Chat with GPT, Claude, Gemini and more" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue as Guest" })).toBeVisible();
  });

  test("the Japanese home renders in Japanese", async ({ page }) => {
    await page.goto("/ja");
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(
      "Chat with GPT, Claude, Gemini and more",
    );
  });

  test("the changelog lists 8.0", async ({ page }) => {
    await page.goto("/changelog");
    await expect(page.getByText(/^8\.0\b/).first()).toBeVisible();
  });

  for (const [from, to] of [
    ["/about", "/home"],
    ["/ja/about", "/ja"],
    ["/guides/anything", "/home"],
    ["/use-cases", "/home"],
    ["/models", "/chat"],
    ["/migration", "/settings/import"],
  ] as const) {
    test(`retired page ${from} redirects permanently to ${to}`, async ({ request }) => {
      const response = await request.get(from, { maxRedirects: 0 });
      expect(response.status()).toBe(308);
      expect(new URL(response.headers().location ?? "", "http://x").pathname).toBe(to);
    });
  }

  test("robots.txt keeps app routes out and lists the sitemap", async ({ request }) => {
    const response = await request.get("/robots.txt");
    expect(response.ok()).toBe(true);
    const body = await response.text();
    expect(body).toContain("Disallow: /chat");
    expect(body).toContain("Sitemap: https://deniai.app/sitemap.xml");
  });

  test("the sitemap lists the public pages in both languages", async ({ request }) => {
    const response = await request.get("/sitemap.xml");
    expect(response.ok()).toBe(true);
    const body = await response.text();
    expect(body).toContain("https://deniai.app/home");
    expect(body).toContain("https://deniai.app/ja");
  });
});
