import { expect, test } from "vitest";
import { createTitleStack } from "./document-title-stack";

/** A document whose title writes notify observers in a microtask, like the browser. */
function fakeDocument(initialTitle: string) {
  const observers = new Set<FakeObserver>();
  let title = initialTitle;
  let writes = 0;

  class FakeObserver {
    constructor(private readonly callback: () => void) {}
    observe() {
      observers.add(this);
    }
    disconnect() {
      observers.delete(this);
    }
    notify() {
      if (observers.has(this)) this.callback();
    }
  }

  const doc = {
    head: {} as Node,
    get title() {
      return title;
    },
    set title(value: string) {
      title = value;
      writes++;
      for (const observer of observers) queueMicrotask(() => observer.notify());
    },
  };

  return { doc, FakeObserver, writes: () => writes, observers };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("two mounted titles settle on the newest instead of rewriting each other", async () => {
  const { doc, FakeObserver, writes } = fakeDocument("Deni AI");
  const stack = createTitleStack(doc, FakeObserver);

  const settings = stack.push("Appearance | Deni AI");
  const chat = stack.push("New Chat | Deni AI");
  await settle();

  expect(doc.title).toBe("New Chat | Deni AI");
  expect(writes()).toBe(2);

  // The previous page unmounts once the next route has loaded.
  stack.remove(settings);
  await settle();
  expect(doc.title).toBe("New Chat | Deni AI");

  stack.remove(chat);
  expect(doc.title).toBe("Deni AI");
});

test("a route head rewriting <title> is overridden, and a title change keeps its place", async () => {
  const { doc, FakeObserver, observers } = fakeDocument("Deni AI");
  const stack = createTitleStack(doc, FakeObserver);

  const older = stack.push("Appearance | Deni AI");
  const newer = stack.push("New Chat | Deni AI");
  doc.title = "Deni AI (Deni Chat)";
  await settle();
  expect(doc.title).toBe("New Chat | Deni AI");

  // The older title changing does not make it win.
  stack.update(older, "Billing | Deni AI");
  await settle();
  expect(doc.title).toBe("New Chat | Deni AI");

  stack.update(newer, "Renamed | Deni AI");
  expect(doc.title).toBe("Renamed | Deni AI");

  stack.remove(newer);
  expect(doc.title).toBe("Billing | Deni AI");
  stack.remove(older);
  expect(observers.size).toBe(0);
});
