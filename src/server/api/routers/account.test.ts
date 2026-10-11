import { expect, test, vi } from "vitest";
import type { Context } from "../trpc";

const mocks = vi.hoisted(() => ({
  buildAccountExport: vi.fn(async () => ({ chats: [] })),
  recordSecurityActivity: vi.fn(async () => {}),
}));
vi.mock("@/db/drizzle", () => ({ db: {} }));
vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("@/lib/account-export", () => ({ buildAccountExport: mocks.buildAccountExport }));
vi.mock("@/lib/security-activity", () => ({
  recordSecurityActivity: mocks.recordSecurityActivity,
}));

const { accountRouter } = await import("./account");

// No export recorded yet: every concurrent call sees an empty activity log.
const noPreviousExport = {
  select: () => ({
    from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }),
  }),
};

test("concurrent exports, such as one batched request, build only one export", async () => {
  const caller = accountRouter.createCaller({
    db: noPreviousExport as unknown as Context["db"],
    session: { session: { userId: "exporter" } } as Context["session"],
  });

  const results = await Promise.allSettled(Array.from({ length: 5 }, () => caller.exportData()));

  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  for (const result of results.filter((result) => result.status === "rejected")) {
    expect(result.reason).toMatchObject({ code: "TOO_MANY_REQUESTS" });
  }
  expect(mocks.buildAccountExport).toHaveBeenCalledOnce();
});
