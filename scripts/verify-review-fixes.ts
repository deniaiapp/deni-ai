import assert from "node:assert/strict";
import Module from "node:module";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { attachmentDisposition } from "../lib/download";
import { userWorkspacePrefix } from "../lib/paths";
import * as workspacePaths from "../lib/paths";

async function main() {
  for (const name of ["資料.txt", "日本語.zip", 'a"b\\c.txt', "a\r\nb.txt", "😀.txt"]) {
    const value = attachmentDisposition(name);
    assert.doesNotThrow(() => new Response("", { headers: { "Content-Disposition": value } }));
    assert.match(value, /filename\*=UTF-8''/);
  }
  assert.ok(attachmentDisposition("資料.txt").endsWith(encodeURIComponent("資料.txt")));

  const root = await mkdtemp(path.join(tmpdir(), "deni-review-"));
  const store = {
    billing: {
      plan: "free",
      stripeCustomerId: null as string | null,
      stripeSubscriptionId: null as string | null,
    },
  };
  let lock: Promise<unknown> = Promise.resolve();
  const objects = new Map<string, Buffer>();
  const prefix = userWorkspacePrefix("test");
  let sessions: { id: string; status: string; url: string; mode: string }[] = [];
  let subscriptions: { id: string; status: string }[] = [];
  let created = 0;
  const checkoutKeys: string[] = [];
  let failCancel = false;
  const cancelled: string[] = [];
  const stripe = {
    customers: { create: async () => ({ id: "cus_test" }) },
    billingPortal: { sessions: { create: async () => ({ url: "https://test/portal" }) } },
    subscriptions: {
      list: async function* () {
        yield* subscriptions;
      },
      retrieve: async (id: string) => subscriptions.find((s) => s.id === id),
      cancel: async (id: string) => {
        if (failCancel) throw new Error("Stripe offline");
        cancelled.push(id);
        subscriptions.find((s) => s.id === id)!.status = "canceled";
      },
    },
    checkout: {
      sessions: {
        list: () =>
          Object.assign(Promise.resolve({ data: sessions }), {
            async *[Symbol.asyncIterator]() {
              yield* sessions.filter((s) => s.status === "open");
            },
          }),
        create: async (_params: unknown, options: { idempotencyKey: string }) => {
          assert.ok(options.idempotencyKey, "Checkout creation must be retry-safe");
          assert.ok(!checkoutKeys.includes(options.idempotencyKey), "New checkouts need fresh Stripe keys");
          checkoutKeys.push(options.idempotencyKey);
          created++;
          const session = {
            id: `cs_${created}`,
            status: "open",
            url: `https://test/${created}`,
            mode: "subscription",
          };
          sessions = [session];
          return session;
        },
        expire: async (id: string) => {
          sessions.find((s) => s.id === id)!.status = "expired";
        },
      },
    },
  };
  type Loader = (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
  const runtime = Module as unknown as { _load: Loader };
  const original = runtime._load;
  runtime._load = function (request, parent, isMain) {
    if (request === "server-only") return {};
    if (request === "./store")
      return {
        readStore: async () => store,
        mutateStore: (_id: string, fn: (value: typeof store) => unknown) => {
          const next = lock.then(() => fn(store));
          lock = next.catch(() => undefined);
          return next;
        },
      };
    if (request === "./stripe")
      return {
        getStripe: () => stripe,
        appUrl: () => "https://test",
        proPriceId: () => "price_test",
        stripeConfigured: () => true,
      };
    if (request === "./paths" && parent?.filename.endsWith("workspace.ts"))
      return {
        ...workspacePaths,
        userDataDir: () => root,
        userWorkspaceDir: () => path.join(root, "workspace"),
      };
    if (request === "./storage")
      return {
        hasObjectStorage: () => true,
        listUserObjects: async (_id: string, suffix: string) =>
          [...objects]
            .filter(([key]) => key.startsWith(suffix))
            .map(([key, body]) => ({
              key: prefix.replace(/workspace\/$/, "") + key,
              size: body.length,
              etag: body.toString("hex"),
            })),
        objectSuffixFromKey: (_id: string, key: string) =>
          key.slice(prefix.length - "workspace/".length),
        getUserObject: async (_id: string, key: string) => objects.get(key) ?? null,
        putUserObject: async (_id: string, key: string, body: Buffer) => {
          objects.set(key, Buffer.from(body));
        },
        deleteUserObject: async (_id: string, key: string) => {
          objects.delete(key);
        },
      };
    return original.call(this, request, parent, isMain);
  };
  try {
    const { checkoutUrl } = await import("../lib/checkout");
    const { cancelUserSubscription } = await import("../lib/billing");
    const req = new Request("https://test/api/billing/checkout");
    const urls = await Promise.all(
      Array.from({ length: 5 }, () => checkoutUrl("test", "test@example.com", req)),
    );
    assert.equal(new Set(urls).size, 1);
    assert.equal(created, 1, "Concurrent checkouts reuse the open session");
    sessions[0].status = "expired";
    await checkoutUrl("test", "test@example.com", req);
    assert.equal(created, 2, "Expired checkout can be replaced");
    sessions = []; // Stripe can omit the previous session from a later list response.
    await checkoutUrl("test", "test@example.com", req);
    assert.equal(created, 3, "A missing previous session must not reuse the initial Stripe key");
    assert.equal(new Set(checkoutKeys).size, 3);
    subscriptions = [
      { id: "sub_1", status: "active" },
      { id: "sub_2", status: "past_due" },
    ];
    assert.equal(await checkoutUrl("test", "test@example.com", req), "https://test/portal");
    assert.equal(created, 3);
    failCancel = true;
    await assert.rejects(cancelUserSubscription("test"), /Stripe offline/);
    failCancel = false;
    await cancelUserSubscription("test");
    assert.deepEqual(cancelled, ["sub_1", "sub_2"]);
    await cancelUserSubscription("test");
    assert.equal(cancelled.length, 2, "Retry skips already cancelled subscriptions");

    const { prepareCommandWorkspace, syncCommandWorkspace } =
      await import("../lib/workspace");
    objects.set("workspace/old.txt", Buffer.from("before"));
    objects.set("workspace/remove.txt", Buffer.from("remove"));
    objects.set("workspace/.config", Buffer.from("hidden"));
    const cwd = await prepareCommandWorkspace("test");
    await writeFile(path.join(cwd, "old.txt"), "after");
    await rm(path.join(cwd, "remove.txt"));
    await mkdir(path.join(cwd, "nested"));
    await writeFile(path.join(cwd, "nested", "new.txt"), "new");
    await syncCommandWorkspace("test", cwd);
    assert.equal(objects.get("workspace/old.txt")?.toString(), "after");
    assert.equal(objects.get("workspace/nested/new.txt")?.toString(), "new");
    assert.equal(objects.has("workspace/remove.txt"), false);
    assert.equal(objects.get("workspace/.config")?.toString(), "hidden");
    const conflictCwd = await prepareCommandWorkspace("test");
    await writeFile(path.join(conflictCwd, "old.txt"), "local change");
    objects.set("workspace/old.txt", Buffer.from("concurrent remote change"));
    await assert.rejects(syncCommandWorkspace("test", conflictCwd), /Workspace changed/);
    assert.equal(objects.get("workspace/old.txt")?.toString(), "concurrent remote change");
    console.log(
      "verified Unicode downloads, checkout reuse, cancellation failures, and workspace synchronization",
    );
  } finally {
    runtime._load = original;
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    await rm(root, { recursive: true, force: true });
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
