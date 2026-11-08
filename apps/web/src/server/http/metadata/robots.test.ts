import { afterEach, expect, test, vi } from "vitest";
import { renderRobots } from "./robots";

afterEach(() => {
  vi.unstubAllEnvs();
});

test("production robots.txt keeps app routes out and points at the sitemap", () => {
  vi.stubEnv("NOINDEX", undefined);
  const robots = renderRobots();
  expect(robots).toContain("Allow: /\n");
  expect(robots).toContain("Disallow: /chat\n");
  expect(robots).toContain("Sitemap: https://deniai.app/sitemap.xml\n");
});

test("NOINDEX deployments disallow everything and list no sitemap", () => {
  vi.stubEnv("NOINDEX", "1");
  expect(renderRobots()).toBe("User-Agent: *\nDisallow: /\n");
});
