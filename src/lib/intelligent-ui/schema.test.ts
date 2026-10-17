import { expect, test } from "vitest";
import { niceTicks, formatIntelligentUiNumber } from "./format";
import { buildIntelligentUiInstruction } from "./prompt";
import { parseIntelligentUiBlock, stripIntelligentUiBlocks } from "./schema";

const parse = (value: unknown) => parseIntelligentUiBlock(JSON.stringify(value));

test("accepts each documented component", () => {
  const blocks = [
    {
      type: "chart",
      kind: "line",
      labels: ["Jan", "Feb"],
      series: [{ name: "Visitors", values: [1, 2] }],
    },
    {
      type: "stats",
      items: [{ label: "Revenue", value: "$1.2M", change: "+4%", sentiment: "positive" }],
    },
    { type: "checklist", items: [{ label: "Eggs" }, { label: "Milk", checked: true }] },
    {
      type: "actions",
      items: [
        { label: "More detail", prompt: "Explain step 2" },
        { label: "Copy", copy: "eggs, milk" },
        { label: "Docs", url: "https://example.com" },
      ],
    },
    {
      type: "calculator",
      inputs: [
        { id: "bill", label: "Bill", value: 100 },
        {
          id: "tip",
          label: "Tip",
          control: "select",
          value: 0.15,
          options: [
            { label: "15%", value: 0.15 },
            { label: "20%", value: 0.2 },
          ],
        },
        { id: "people", label: "People", control: "stepper", value: 2, min: 1 },
      ],
      outputs: [
        {
          label: "Each",
          formula: "bill * (1 + tip) / people",
          format: "currency",
          currency: "USD",
        },
      ],
    },
    { type: "timeline", items: [{ title: "Prep", time: "10 min", status: "done" }] },
    {
      type: "comparison",
      columns: [{ name: "A" }, { name: "B", highlight: true }],
      rows: [{ label: "Waterproof", values: [true, false] }],
    },
    {
      type: "table",
      columns: ["City", "Pop."],
      rows: [
        ["Tokyo", 14],
        ["Osaka", null],
      ],
    },
    { type: "cards", items: [{ title: "Kyoto", prompt: "Plan Kyoto" }] },
    {
      type: "tabs",
      tabs: [
        { label: "Frame", content: "**Steel**" },
        { label: "Wheels", content: "700c" },
      ],
    },
    {
      type: "form",
      fields: [{ id: "city", label: "City" }],
      prompt: "Plan a trip to {city}",
    },
    { type: "quiz", questions: [{ question: "2+2?", choices: ["3", "4"], answer: 1 }] },
  ];
  for (const block of blocks) {
    expect(parse(block), block.type).toMatchObject({ ok: true });
  }
});

test.each([
  ["unknown type", { type: "map", points: [] }],
  [
    "series length mismatch",
    { type: "chart", labels: ["a", "b"], series: [{ name: "x", values: [1] }] },
  ],
  [
    "negative pie values",
    { type: "chart", kind: "pie", labels: ["a", "b"], series: [{ name: "x", values: [1, -1] }] },
  ],
  ["action without a target", { type: "actions", items: [{ label: "Go" }] }],
  [
    "action with two targets",
    { type: "actions", items: [{ label: "Go", prompt: "x", copy: "y" }] },
  ],
  ["javascript url", { type: "actions", items: [{ label: "Go", url: "javascript:alert(1)" }] }],
  [
    "formula with an unknown input",
    {
      type: "calculator",
      inputs: [{ id: "a", label: "A", value: 1 }],
      outputs: [{ label: "B", formula: "a + b" }],
    },
  ],
  [
    "formula that does not parse",
    {
      type: "calculator",
      inputs: [{ id: "a", label: "A", value: 1 }],
      outputs: [{ label: "B", formula: "a +" }],
    },
  ],
  [
    "select without options",
    {
      type: "calculator",
      inputs: [{ id: "a", label: "A", control: "select", value: 1 }],
      outputs: [{ label: "B", formula: "a" }],
    },
  ],
  [
    "form placeholder without a field",
    { type: "form", fields: [{ id: "a", label: "A" }], prompt: "{b}" },
  ],
  [
    "quiz answer out of range",
    { type: "quiz", questions: [{ question: "?", choices: ["a", "b"], answer: 2 }] },
  ],
  [
    "comparison row mismatch",
    {
      type: "comparison",
      columns: [{ name: "A" }, { name: "B" }],
      rows: [{ label: "x", values: [1] }],
    },
  ],
  ["blank label", { type: "checklist", items: [{ label: "  " }] }],
])("rejects %s", (_, block) => {
  expect(parse(block)).toEqual({ ok: false, reason: "invalid-spec" });
});

test("reports incomplete JSON, as seen while an answer streams", () => {
  expect(parseIntelligentUiBlock('{"type":"chart","labels":["a"')).toEqual({
    ok: false,
    reason: "invalid-json",
  });
});

test("strips ui blocks, including an unterminated one, and keeps other code", () => {
  const markdown = [
    "Intro",
    "```ui",
    '{"type":"stats","items":[]}',
    "```",
    "Middle",
    "```ts",
    "const ui = 1;",
    "```",
    "```ui",
    '{"type":"chart"',
  ].join("\n");
  const stripped = stripIntelligentUiBlocks(markdown);
  expect(stripped).toContain("Intro");
  expect(stripped).toContain("Middle");
  expect(stripped).toContain("const ui = 1;");
  expect(stripped).not.toContain('"type"');
});

test("formats calculator values", () => {
  expect(formatIntelligentUiNumber(0.155, "en", { format: "percent" })).toBe("15.5%");
  expect(formatIntelligentUiNumber(12.5, "en", { format: "currency", currency: "USD" })).toBe(
    "$12.50",
  );
  expect(formatIntelligentUiNumber(3, "en", { unit: "kg" })).toBe("3 kg");
  expect(formatIntelligentUiNumber(Infinity, "en")).toBe("—");
});

test("builds nice axis ticks", () => {
  expect(niceTicks(0, 97)).toEqual([0, 25, 50, 75, 100]);
  expect(niceTicks(-3, 8, 4)).toEqual([-5, 0, 5, 10]);
  expect(niceTicks(5, 5).length).toBeGreaterThan(1);
});

test("simple layout limits components to explicit requests", () => {
  expect(buildIntelligentUiInstruction("rich")).toContain("Choose the format");
  expect(buildIntelligentUiInstruction("simple")).toContain("only when the user explicitly asks");
});
