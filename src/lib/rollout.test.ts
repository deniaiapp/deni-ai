import { expect, test } from "vitest";
import { rolloutSwitchUrl } from "@/lib/rollout";

test("links to the Worker's switch path with the page to come back to", () => {
  expect(rolloutSwitchUrl("v8", "/chat/abc")).toBe("/__rollout/v8?return=%2Fchat%2Fabc");
  expect(rolloutSwitchUrl("v7", "https://evil.example")).toBe("/__rollout/v7?return=%2F");
});
