import { describe, expect, it } from "vitest";
import {
  closesMobileSidebar,
  SIDEBAR_KEEP_OPEN_ATTRIBUTE,
  type SidebarClick,
} from "./mobile-sidebar";

type FakeNode = {
  tag: string;
  attributes?: Record<string, string>;
  parent?: FakeNode;
};

// Minimal Element stand-in: supports the selectors the helper uses.
function element(node: FakeNode) {
  const matches = (current: FakeNode, selector: string) => {
    const attributes = current.attributes ?? {};
    if (selector === "a[href]") return current.tag === "a" && "href" in attributes;
    const attribute = /^\[([\w-]+)\]$/.exec(selector)?.[1];
    return attribute !== undefined && attribute in attributes;
  };
  const wrap = (current: FakeNode): ReturnType<typeof element> => element(current);
  return {
    closest(selector: string) {
      for (let current: FakeNode | undefined = node; current; current = current.parent) {
        if (matches(current, selector)) return wrap(current);
      }
      return null;
    },
    getAttribute(name: string) {
      return node.attributes?.[name] ?? null;
    },
    hasAttribute(name: string) {
      return name in (node.attributes ?? {});
    },
  };
}

function click(target: unknown, overrides: Partial<SidebarClick> = {}): SidebarClick {
  return {
    target: target as EventTarget,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  };
}

const link: FakeNode = { tag: "a", attributes: { href: "/chat/abc" } };
const iconInLink: FakeNode = { tag: "svg", parent: link };

describe("closesMobileSidebar", () => {
  it("closes for a plain click on a link or on something inside one", () => {
    expect(closesMobileSidebar(click(element(link)))).toBe(true);
    expect(closesMobileSidebar(click(element(iconInLink)))).toBe(true);
  });

  it("stays open for clicks that are not on a link", () => {
    const button: FakeNode = { tag: "button" };
    expect(closesMobileSidebar(click(element(button)))).toBe(false);
    expect(closesMobileSidebar(click(element({ tag: "a" })))).toBe(false);
    expect(closesMobileSidebar(click(null))).toBe(false);
  });

  it("stays open for modified or non-primary clicks", () => {
    for (const overrides of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ]) {
      expect(closesMobileSidebar(click(element(link), overrides))).toBe(false);
    }
  });

  it("stays open for disabled links", () => {
    const ariaDisabled: FakeNode = {
      tag: "a",
      attributes: { href: "/settings/billing", "aria-disabled": "true" },
    };
    const dataDisabled: FakeNode = {
      tag: "a",
      attributes: { href: "/account/settings", "data-disabled": "" },
    };
    expect(closesMobileSidebar(click(element(ariaDisabled)))).toBe(false);
    expect(closesMobileSidebar(click(element(dataDisabled)))).toBe(false);
  });

  it("stays open for links inside an opted-out area", () => {
    const nav: FakeNode = { tag: "nav", attributes: { [SIDEBAR_KEEP_OPEN_ATTRIBUTE]: "" } };
    const modeLink: FakeNode = { tag: "a", attributes: { href: "/run" }, parent: nav };
    expect(closesMobileSidebar(click(element(modeLink)))).toBe(false);
  });
});
