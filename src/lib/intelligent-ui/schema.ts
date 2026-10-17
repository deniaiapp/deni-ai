import { z } from "zod";
import { compileExpression } from "./expression";

/**
 * Intelligent UI blocks are fenced ```ui code blocks whose body is a JSON
 * component spec. The model writes them inline with its Markdown answer and the
 * client renders them as native, interactive components. Anything that fails
 * to validate falls back to an ordinary code block.
 */
export const INTELLIGENT_UI_LANGUAGE = "ui";

const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => value.trim().length > 0, "Must not be blank");
const optionalText = (max: number) => z.string().max(max).optional();
const identifier = z.string().regex(/^[A-Za-z_]\w{0,39}$/, "Use letters, digits, or underscores");
const finiteNumber = z.number().finite();
const cellValue = z.union([z.string().max(200), finiteNumber, z.boolean(), z.null()]);

const header = {
  title: optionalText(120),
  description: optionalText(400),
};

const chartSchema = z
  .object({
    type: z.literal("chart"),
    ...header,
    kind: z.enum(["bar", "line", "area", "pie", "donut"]).default("bar"),
    labels: z.array(text(60)).min(1).max(48),
    series: z
      .array(z.object({ name: text(60), values: z.array(finiteNumber).max(48) }))
      .min(1)
      .max(6),
    stacked: z.boolean().optional(),
    valuePrefix: optionalText(8),
    valueSuffix: optionalText(12),
  })
  .superRefine((chart, ctx) => {
    chart.series.forEach((series, index) => {
      if (series.values.length !== chart.labels.length) {
        ctx.addIssue({
          code: "custom",
          message: "Each series needs one value per label",
          path: ["series", index, "values"],
        });
      }
    });
    if (
      (chart.kind === "pie" || chart.kind === "donut") &&
      chart.series[0].values.some((value) => value < 0)
    ) {
      ctx.addIssue({ code: "custom", message: "Pie values must not be negative" });
    }
  });

const statsSchema = z.object({
  type: z.literal("stats"),
  ...header,
  items: z
    .array(
      z.object({
        label: text(60),
        value: z.union([text(40), finiteNumber]),
        change: optionalText(40),
        sentiment: z.enum(["positive", "negative", "neutral"]).optional(),
        detail: optionalText(120),
      }),
    )
    .min(1)
    .max(6),
});

const checklistSchema = z.object({
  type: z.literal("checklist"),
  ...header,
  items: z
    .array(
      z.object({ label: text(200), detail: optionalText(200), checked: z.boolean().optional() }),
    )
    .min(1)
    .max(40),
});

const actionSchema = z
  .object({
    label: text(60),
    prompt: optionalText(1000),
    copy: optionalText(4000),
    url: z
      .url({ protocol: /^https?$/ })
      .max(2000)
      .optional(),
  })
  .refine(
    (action) => [action.prompt, action.copy, action.url].filter(Boolean).length === 1,
    "Each action needs exactly one of prompt, copy, or url",
  );

const actionsSchema = z.object({
  type: z.literal("actions"),
  ...header,
  items: z.array(actionSchema).min(1).max(6),
});

const calculatorInputSchema = z.object({
  id: identifier,
  label: text(60),
  control: z.enum(["number", "slider", "stepper", "select"]).default("number"),
  value: finiteNumber,
  min: finiteNumber.optional(),
  max: finiteNumber.optional(),
  step: z.number().positive().finite().optional(),
  unit: optionalText(16),
  options: z
    .array(z.object({ label: text(60), value: finiteNumber }))
    .min(2)
    .max(12)
    .optional(),
});

const numberFormatFields = {
  format: z.enum(["number", "currency", "percent"]).default("number"),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  decimals: z.number().int().min(0).max(6).optional(),
  unit: optionalText(16),
};

const calculatorSchema = z
  .object({
    type: z.literal("calculator"),
    ...header,
    inputs: z.array(calculatorInputSchema).min(1).max(8),
    outputs: z
      .array(
        z.object({
          label: text(60),
          formula: text(500),
          highlight: z.boolean().optional(),
          ...numberFormatFields,
        }),
      )
      .min(1)
      .max(16),
  })
  .superRefine((calculator, ctx) => {
    const ids = new Set<string>();
    calculator.inputs.forEach((input, index) => {
      if (ids.has(input.id)) {
        ctx.addIssue({ code: "custom", message: "Duplicate input id", path: ["inputs", index] });
      }
      ids.add(input.id);
      if (input.control === "select" && !input.options) {
        ctx.addIssue({
          code: "custom",
          message: "Select inputs need options",
          path: ["inputs", index, "options"],
        });
      }
    });
    calculator.outputs.forEach((output, index) => {
      try {
        const { identifiers } = compileExpression(output.formula);
        for (const name of identifiers) {
          if (!ids.has(name)) {
            ctx.addIssue({
              code: "custom",
              message: `Unknown input "${name}"`,
              path: ["outputs", index, "formula"],
            });
          }
        }
      } catch (error) {
        ctx.addIssue({
          code: "custom",
          message: error instanceof Error ? error.message : "Invalid formula",
          path: ["outputs", index, "formula"],
        });
      }
    });
  });

const timelineSchema = z.object({
  type: z.literal("timeline"),
  ...header,
  items: z
    .array(
      z.object({
        title: text(120),
        time: optionalText(40),
        detail: optionalText(400),
        status: z.enum(["done", "current", "upcoming"]).optional(),
      }),
    )
    .min(1)
    .max(24),
});

const comparisonSchema = z
  .object({
    type: z.literal("comparison"),
    ...header,
    columns: z
      .array(
        z.object({
          name: text(60),
          badge: optionalText(30),
          summary: optionalText(200),
          highlight: z.boolean().optional(),
        }),
      )
      .min(2)
      .max(4),
    rows: z
      .array(z.object({ label: text(80), values: z.array(cellValue).max(4) }))
      .min(1)
      .max(24),
  })
  .superRefine((comparison, ctx) => {
    comparison.rows.forEach((row, index) => {
      if (row.values.length !== comparison.columns.length) {
        ctx.addIssue({
          code: "custom",
          message: "Each row needs one value per column",
          path: ["rows", index, "values"],
        });
      }
    });
  });

const tableSchema = z
  .object({
    type: z.literal("table"),
    ...header,
    columns: z.array(text(60)).min(1).max(8),
    rows: z.array(z.array(cellValue).max(8)).min(1).max(200),
  })
  .superRefine((table, ctx) => {
    table.rows.forEach((row, index) => {
      if (row.length !== table.columns.length) {
        ctx.addIssue({
          code: "custom",
          message: "Each row needs one value per column",
          path: ["rows", index],
        });
      }
    });
  });

const cardsSchema = z.object({
  type: z.literal("cards"),
  ...header,
  items: z
    .array(
      z.object({
        title: text(80),
        subtitle: optionalText(80),
        description: optionalText(300),
        badge: optionalText(30),
        prompt: optionalText(1000),
        url: z
          .url({ protocol: /^https?$/ })
          .max(2000)
          .optional(),
      }),
    )
    .min(1)
    .max(9),
});

const tabsSchema = z.object({
  type: z.literal("tabs"),
  ...header,
  tabs: z
    .array(z.object({ label: text(40), content: text(4000) }))
    .min(2)
    .max(8),
});

const formSchema = z
  .object({
    type: z.literal("form"),
    ...header,
    fields: z
      .array(
        z.object({
          id: identifier,
          label: text(80),
          input: z.enum(["text", "textarea", "number", "select"]).default("text"),
          options: z.array(text(80)).min(2).max(12).optional(),
          placeholder: optionalText(120),
          required: z.boolean().optional(),
        }),
      )
      .min(1)
      .max(8),
    submitLabel: optionalText(40),
    prompt: text(2000),
  })
  .superRefine((form, ctx) => {
    const ids = new Set<string>();
    form.fields.forEach((field, index) => {
      if (ids.has(field.id)) {
        ctx.addIssue({ code: "custom", message: "Duplicate field id", path: ["fields", index] });
      }
      ids.add(field.id);
      if (field.input === "select" && !field.options) {
        ctx.addIssue({
          code: "custom",
          message: "Select fields need options",
          path: ["fields", index, "options"],
        });
      }
    });
    for (const match of form.prompt.matchAll(/\{(\w+)\}/g)) {
      if (!ids.has(match[1])) {
        ctx.addIssue({
          code: "custom",
          message: `Unknown field "${match[1]}" in prompt`,
          path: ["prompt"],
        });
      }
    }
  });

const quizSchema = z.object({
  type: z.literal("quiz"),
  ...header,
  questions: z
    .array(
      z
        .object({
          question: text(300),
          choices: z.array(text(160)).min(2).max(6),
          answer: z.number().int().min(0),
          explanation: optionalText(400),
        })
        .refine((question) => question.answer < question.choices.length, {
          message: "answer must be a choice index",
          path: ["answer"],
        }),
    )
    .min(1)
    .max(10),
});

export const intelligentUiBlockSchema = z.discriminatedUnion("type", [
  chartSchema,
  statsSchema,
  checklistSchema,
  actionsSchema,
  calculatorSchema,
  timelineSchema,
  comparisonSchema,
  tableSchema,
  cardsSchema,
  tabsSchema,
  formSchema,
  quizSchema,
]);

export type IntelligentUiBlock = z.infer<typeof intelligentUiBlockSchema>;
export type IntelligentUiBlockOf<T extends IntelligentUiBlock["type"]> = Extract<
  IntelligentUiBlock,
  { type: T }
>;
export type IntelligentUiCellValue = z.infer<typeof cellValue>;

export type ParsedIntelligentUiBlock =
  | { ok: true; block: IntelligentUiBlock }
  | { ok: false; reason: "invalid-json" | "invalid-spec" };

const MAX_SPEC_LENGTH = 40_000;

export function parseIntelligentUiBlock(source: string): ParsedIntelligentUiBlock {
  if (source.length > MAX_SPEC_LENGTH) {
    return { ok: false, reason: "invalid-spec" };
  }
  let json: unknown;
  try {
    json = JSON.parse(source);
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
  const result = intelligentUiBlockSchema.safeParse(json);
  return result.success ? { ok: true, block: result.data } : { ok: false, reason: "invalid-spec" };
}

/** Removes ```ui blocks from Markdown, e.g. before reading an answer aloud. */
export function stripIntelligentUiBlocks(markdown: string): string {
  return markdown.replace(
    /^( {0,3})(`{3,}|~{3,})ui[ \t]*\r?\n[\s\S]*?(?:^\1\2[ \t]*$|(?![\s\S]))/gm,
    "",
  );
}
