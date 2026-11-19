import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

type MutationOptions = {
  onSuccess: (data: { id: string }, input: { id: string }) => Promise<void>;
  onError: (
    error: { message: string; data?: { code?: string } },
    input: { id: string },
  ) => Promise<void>;
};

const mocks = vi.hoisted(() => ({
  events: [] as string[],
  mutation: undefined as MutationOptions | undefined,
}));

vi.mock("use-intl", () => import("@/test/intl-mock"));
vi.mock("@/lib/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: unknown }) =>
    createElement("a", { href, ...props }, children as string),
}));
vi.mock("sonner", () => ({
  toast: {
    success: (message: string) => mocks.events.push(`toast success: ${message}`),
    error: (message: string) => mocks.events.push(`toast error: ${message}`),
  },
}));
vi.mock("@/hooks/use-localize-error", () => ({
  useLocalizeError: () => (error: { message?: string }, fallback?: string) =>
    error.message ?? fallback,
}));
vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    useUtils: () => ({
      chat: {
        getComparison: {
          invalidate: async (input: { id: string }, filters: { refetchType: string }) => {
            mocks.events.push(`stale comparison ${input.id} (refetch: ${filters.refetchType})`);
          },
        },
        getComparisons: {
          invalidate: async () => {
            mocks.events.push("refresh list");
          },
        },
      },
    }),
    chat: {
      deleteComparison: {
        useMutation: (options: MutationOptions) => {
          mocks.mutation = options;
          return { isPending: false, mutate: () => {} };
        },
      },
    },
  },
}));

import { DeleteComparisonDialog, SavedComparisonsList } from "./saved-comparisons-list";

const entries = [
  {
    id: "a",
    title: "First question",
    leftName: "Model A",
    rightName: "Model B",
    updatedAt: new Date(0),
  },
  {
    id: "b",
    title: "Second question",
    leftName: "Model C",
    rightName: "Model D",
    updatedAt: new Date(0),
  },
];

function renderList(locked: boolean) {
  return renderToStaticMarkup(
    createElement(SavedComparisonsList, {
      history: { isPending: false, isError: false, data: entries },
      activeId: "a",
      locked,
      onDeleted: () => {},
    }),
  );
}

/** Renders the dialog for comparison `cmp` and returns its delete mutation's callbacks. */
function renderDialog() {
  renderToStaticMarkup(
    createElement(DeleteComparisonDialog, {
      comparison: { id: "cmp", title: "Question" },
      open: true,
      onOpenChange: (open: boolean) => mocks.events.push(`dialog open: ${open}`),
      onDeleted: (id: string) => mocks.events.push(`left ${id}`),
    }),
  );
  if (!mocks.mutation) throw new Error("The dialog did not set up its delete mutation.");
  return mocks.mutation;
}

beforeEach(() => {
  mocks.events = [];
  mocks.mutation = undefined;
});

test("every saved comparison has its own delete button next to its link", () => {
  const html = renderList(false);

  expect(html).toContain('href="/compare/a"');
  expect(html).toContain('href="/compare/b"');
  expect(html).toContain('aria-label="Delete comparison: First question"');
  expect(html).toContain('aria-label="Delete comparison: Second question"');
  expect(html.match(/<button[^>]*aria-label="Delete comparison[^>]*>/g)).toHaveLength(2);
  expect(html).not.toMatch(/<button[^>]*aria-label="Delete comparison[^>]*disabled=""/);
});

test("comparisons cannot be deleted while a comparison is generating or saving", () => {
  const buttons = renderList(true).match(/<button[^>]*aria-label="Delete comparison[^>]*>/g);

  expect(buttons).toHaveLength(2);
  for (const button of buttons ?? []) expect(button).toContain('disabled=""');
});

test("a deleted comparison is left, dropped from the list and the dialog closes", async () => {
  await renderDialog().onSuccess({ id: "cmp" }, { id: "cmp" });

  expect(mocks.events).toEqual([
    "left cmp",
    // Not refetched while the page showing it navigates away.
    "stale comparison cmp (refetch: none)",
    "refresh list",
    "dialog open: false",
    "toast success: Comparison deleted.",
  ]);
});

test("a comparison already deleted elsewhere is forgotten too", async () => {
  await renderDialog().onError(
    { message: "Comparison not found.", data: { code: "NOT_FOUND" } },
    { id: "cmp" },
  );

  expect(mocks.events).toEqual([
    "toast error: Comparison not found.",
    "left cmp",
    "stale comparison cmp (refetch: none)",
    "refresh list",
    "dialog open: false",
  ]);
});

test("a failed delete keeps the comparison and the dialog open", async () => {
  await renderDialog().onError(
    { message: "INTERNAL_SERVER_ERROR", data: { code: "INTERNAL_SERVER_ERROR" } },
    { id: "cmp" },
  );

  expect(mocks.events).toEqual(["toast error: INTERNAL_SERVER_ERROR"]);
});
