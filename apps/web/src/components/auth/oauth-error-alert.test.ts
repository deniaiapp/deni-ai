import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { OAuthErrorAlert } from "@/components/auth/oauth-error-alert";

const search = vi.hoisted(() => ({ params: new URLSearchParams() }));

vi.mock("@/lib/navigation", () => ({
  usePathname: () => "/auth/sign-in",
  useRouter: () => ({ replace: () => {} }),
  useSearchParams: () => search.params,
}));
vi.mock("use-intl", () => import("@/test/intl-mock"));

const render = (params: Record<string, string>) => {
  search.params = new URLSearchParams(params);
  return renderToStaticMarkup(createElement(OAuthErrorAlert));
};

test("nothing renders without an error in the URL", () => {
  expect(render({})).toBe("");
});

test("a sign-up policy rejection explains the rule, not the raw code", () => {
  const html = render({
    error: "EMAIL_USE_GOOGLE_OAUTH",
    error_description: "Gmail addresses must sign in with Google or GitHub.",
  });
  expect(html).toContain("We couldn&#x27;t sign you in");
  expect(html).toContain("Please use the Continue with Google or Continue with GitHub button.");
});

test("Better Auth callback codes get their own explanation", () => {
  expect(render({ error: "account_not_linked" })).toContain(
    "This email is already registered with another sign-in method.",
  );
  expect(render({ error: "invalid_code" })).toContain("Sign-in was cancelled or took too long.");
});

test("unknown and inherited codes fall back to the generic message", () => {
  for (const code of ["something_new", "__proto__", "constructor"]) {
    expect(render({ error: code })).toContain(
      `Something went wrong. Please try again. (Error: ${code})`,
    );
  }
});
