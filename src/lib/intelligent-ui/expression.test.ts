import { expect, test } from "vitest";
import { compileExpression, evaluateExpression } from "./expression";

const run = (source: string, variables: Record<string, number> = {}) =>
  evaluateExpression(compileExpression(source).ast, variables);

test.each([
  ["1 + 2 * 3", 7],
  ["(1 + 2) * 3", 9],
  ["2 ^ 3 ^ 2", 512],
  ["2 ** 3", 8],
  ["-2 ^ 2", -4],
  ["10 % 4", 2],
  ["1 < 2 && 3 > 2", 1],
  ["!0 || 0", 1],
  ["5 > 3 ? 10 : 20", 10],
  ["round(2.345, 2)", 2.35],
  ["max(1, 7, 3) + min(4, 2)", 9],
  ["clamp(12, 0, 10)", 10],
  ["round(pi, 2)", 3.14],
  ["1e3 / .5", 2000],
])("evaluates %s", (source, expected) => {
  expect(run(source)).toBeCloseTo(expected);
});

test("reads input variables and reports the ones it uses", () => {
  const compiled = compileExpression("bill * (1 + tip) / people");
  expect([...compiled.identifiers].toSorted()).toEqual(["bill", "people", "tip"]);
  expect(evaluateExpression(compiled.ast, { bill: 100, tip: 0.2, people: 4 })).toBe(30);
});

test("does not treat built-in constants as inputs", () => {
  expect([...compileExpression("pi * r ^ 2").identifiers]).toEqual(["r"]);
});

test("yields non-finite results instead of throwing for bad math", () => {
  expect(run("1 / 0")).toBe(Infinity);
  expect(run("missing + 1")).toBeNaN();
});

test.each([
  "alert(1)",
  "constructor",
  "a.b",
  "x = 1",
  "1 +",
  "(1",
  "round()",
  "pow(1)",
  "`1`",
  "1 ; 2",
])("rejects %s", (source) => {
  // Unknown identifiers parse but evaluate to NaN; calls to unknown functions and syntax errors throw.
  let result: number | "threw";
  try {
    result = run(source);
  } catch {
    result = "threw";
  }
  expect(result === "threw" || Number.isNaN(result)).toBe(true);
});

test("rejects overly long or deeply nested input", () => {
  expect(() => compileExpression("1+".repeat(300) + "1")).toThrow();
  expect(() => compileExpression("(".repeat(200) + "1" + ")".repeat(200))).toThrow();
});
