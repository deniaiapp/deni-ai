import { expect, test, vi } from "vitest";
import { ensureChatCreated, trackChatCreation } from "./chat-creation";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("a chat that was not started on this client needs no wait", async () => {
  expect(await ensureChatCreated("existing-chat")).toBe(true);
});

test("a send waits until the started chat's row exists", async () => {
  const row = deferred();
  const create = vi.fn(() => row.promise);
  void trackChatCreation("pending-chat", create, 0);

  let created: boolean | undefined;
  void ensureChatCreated("pending-chat").then((value) => {
    created = value;
  });
  await Promise.resolve();
  expect(created).toBeUndefined();

  row.resolve();
  await vi.waitFor(() => expect(created).toBe(true));
  expect(create).toHaveBeenCalledOnce();
  expect(await ensureChatCreated("pending-chat")).toBe(true);
  expect(create).toHaveBeenCalledOnce();
});

test("a transient creation failure is retried", async () => {
  const create = vi
    .fn<() => Promise<void>>()
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValueOnce();

  expect(await trackChatCreation("retried-chat", create, 0)).toBe(true);
  expect(create).toHaveBeenCalledTimes(2);
  expect(await ensureChatCreated("retried-chat")).toBe(true);
});

test("a failed creation is attempted again by the next send", async () => {
  const create = vi
    .fn<() => Promise<void>>()
    .mockRejectedValueOnce(new Error("down"))
    .mockRejectedValueOnce(new Error("still down"))
    .mockResolvedValueOnce();

  expect(await trackChatCreation("failed-chat", create, 0)).toBe(false);
  expect(create).toHaveBeenCalledTimes(2);

  expect(await ensureChatCreated("failed-chat")).toBe(true);
  expect(create).toHaveBeenCalledTimes(3);
});
