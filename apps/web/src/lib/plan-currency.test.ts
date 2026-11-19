import type Stripe from "stripe";
import { expect, test } from "vitest";

import { planDisplayCurrency, priceInCurrency, requestCountry } from "./plan-currency";

const price = {
  currency: "usd",
  unit_amount: 2000,
  currency_options: { usd: { unit_amount: 2000 }, jpy: { unit_amount: 3000 } },
} as unknown as Stripe.Price;

test("visitors from Japan see yen; everyone else, or an unknown country, sees dollars", () => {
  expect(planDisplayCurrency(requestCountry(new Headers({ "cf-ipcountry": "jp" })))).toBe("jpy");
  expect(planDisplayCurrency(requestCountry(new Headers({ "cf-ipcountry": "US" })))).toBe("usd");
  expect(planDisplayCurrency(requestCountry(new Headers({ "cf-ipcountry": "DE" })))).toBe("usd");
  expect(planDisplayCurrency(requestCountry(new Headers({ "cf-ipcountry": "XX" })))).toBe("usd");
  expect(planDisplayCurrency(requestCountry(new Headers()))).toBe("usd");
});

test("a price shows its currency option, else its default currency", () => {
  expect(priceInCurrency(price, "jpy")).toEqual({ amount: 3000, currency: "jpy" });
  expect(priceInCurrency(price, "usd")).toEqual({ amount: 2000, currency: "usd" });
  const usdOnly = { currency: "usd", unit_amount: 2000 } as unknown as Stripe.Price;
  expect(priceInCurrency(usdOnly, "jpy")).toEqual({ amount: 2000, currency: "usd" });
});
