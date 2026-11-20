import { render } from "react-email";
import { createElement } from "react";
import { expect, test } from "vitest";
import {
  SubscriptionEndingEmail,
  subscriptionEndingEmailSubject,
} from "./subscription-ending-email";

const billingUrl = "https://deniai.app/settings/billing";

test("tells an English reader when the plan ends and where to resume it", async () => {
  const props = {
    locale: "en" as const,
    name: "Rai",
    planName: "Pro",
    endDate: "November 23, 2026",
    billingUrl,
  };
  const text = await render(createElement(SubscriptionEndingEmail, props), { plainText: true });

  expect(text).toContain("Hi Rai,");
  expect(text).toContain("set to end on November 23, 2026");
  expect(text).toContain(billingUrl);
  expect(text).toContain("You will not be charged");
  expect(subscriptionEndingEmailSubject(props)).toBe(
    "Your Deni AI Pro plan ends on November 23, 2026",
  );
});

test("writes the Japanese version in Japanese", async () => {
  const props = {
    locale: "ja" as const,
    name: null,
    planName: "Plus",
    endDate: "2026年11月23日",
    billingUrl,
  };
  const text = await render(createElement(SubscriptionEndingEmail, props), { plainText: true });

  expect(text).toContain("2026年11月23日に終了する予定です");
  expect(text).toContain("プランを継続する");
  expect(text).not.toContain("Hi");
  expect(subscriptionEndingEmailSubject(props)).toBe(
    "Deni AI Plusプランは2026年11月23日に終了します",
  );
});

test("escapes user-controlled values", async () => {
  const html = await render(
    createElement(SubscriptionEndingEmail, {
      locale: "en",
      name: '<img src=x onerror="alert(1)">',
      planName: "Pro",
      endDate: "November 23, 2026",
      billingUrl,
    }),
  );

  expect(html).not.toContain("<img src=x");
});
