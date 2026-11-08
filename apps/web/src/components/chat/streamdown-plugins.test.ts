import { expect, test } from "vitest";
import { hasMathSyntax } from "@/components/chat/streamdown-plugins";

test("math detection stays linear on lines with many backslash escapes", () => {
  const pathological = [
    `printf "$x:${"\\n".repeat(40)}"`,
    `$env:Path = "${Array.from({ length: 200 }, (_, i) => `C:\\Tools\\bin${i}`).join(";")}"`,
    `$${"\\".repeat(5000)}`,
  ];

  for (const content of pathological) {
    const startedAt = performance.now();
    expect(hasMathSyntax(content)).toBe(false);
    expect(performance.now() - startedAt).toBeLessThan(50);
  }
});

test("math detection still recognizes math and ignores prices", () => {
  for (const content of ["$x^2$", "Area: $\\frac{a}{b}$.", "$$a$$", "\\(x\\)", "\\[x\\]"]) {
    expect(hasMathSyntax(content)).toBe(true);
  }
  expect(hasMathSyntax("It costs $5 and $10 later")).toBe(false);
});
