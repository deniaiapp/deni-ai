import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { AuthLinkError } from "@/components/auth/settings/auth-link-error";

const search = vi.hoisted(() => ({ params: new URLSearchParams() }));

vi.mock("@/lib/navigation", () => ({
  usePathname: () => "/account/settings",
  useRouter: () => ({ replace: () => {} }),
  useSearchParams: () => search.params,
}));
vi.mock("use-intl", () => import("@/test/intl-mock"));

const render = (error: string) => {
  search.params = new URLSearchParams({ error });
  return renderToStaticMarkup(createElement(AuthLinkError));
};

test("inherited object keys fall back to the generic message instead of crashing", () => {
  for (const code of ["__proto__", "constructor", "toString"]) {
    expect(render(code)).toContain(`Something went wrong. Please try again. (Error: ${code})`);
  }
});

test("known codes keep their specific description", () => {
  expect(render("TOKEN_EXPIRED")).toContain("This link has expired.");
});
