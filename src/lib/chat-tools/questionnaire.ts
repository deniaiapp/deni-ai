import { tool } from "ai";
import { z } from "zod";

/** Text the client shows must not be blank. Refined rather than trimmed, so values stay as sent. */
function visibleText(max: number) {
  return z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim().length > 0, "Must not be blank");
}

const questionnaireChoiceSchema = z.object({
  value: z
    .string()
    .min(1)
    .max(120)
    .describe("Stable value returned for this choice, unique within the question"),
  label: visibleText(160).describe("Text shown to the user"),
  description: z.string().max(300).optional().describe("Optional supporting detail"),
});

const questionnaireItemSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z][A-Za-z0-9_-]*$/)
    .describe("Unique answer key using letters, numbers, underscores, or hyphens"),
  prompt: visibleText(240).describe("The question shown to the user"),
  description: z.string().max(400).optional().describe("Optional context for the question"),
  required: z.boolean().optional().describe("Whether the user must provide an answer"),
  multiple: z.boolean().optional().describe("Allow selecting multiple fixed choices"),
  choices: z.array(questionnaireChoiceSchema).max(8).optional(),
  input: z
    .object({
      label: visibleText(120).describe("Accessible label for a free-text answer"),
      placeholder: z.string().max(160).optional(),
    })
    .optional()
    .describe("Optional free-text answer in addition to or instead of choices"),
});

export const questionnaireToolInputSchema = z
  .object({
    title: visibleText(120).describe("Short heading for the questionnaire"),
    description: z.string().max(400).optional().describe("Optional introduction"),
    questions: z
      .array(questionnaireItemSchema)
      .min(1)
      .max(8)
      .describe("A short sequence of questions, shown one at a time"),
  })
  // The client cannot show a questionnaire with clashing keys (answers are keyed by
  // them), so reject it here, where the model gets the error and can retry.
  .superRefine((input, ctx) => {
    const names = new Set<string>();
    input.questions.forEach((question, questionIndex) => {
      if (names.has(question.name)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate question name "${question.name}"; names must be unique`,
          path: ["questions", questionIndex, "name"],
        });
      }
      names.add(question.name);

      const values = new Set<string>();
      question.choices?.forEach((choice, choiceIndex) => {
        if (values.has(choice.value)) {
          ctx.addIssue({
            code: "custom",
            message: `Duplicate choice value "${choice.value}"; values must be unique within a question`,
            path: ["questions", questionIndex, "choices", choiceIndex, "value"],
          });
        }
        values.add(choice.value);
      });
    });
  });

export type QuestionnaireToolInput = z.infer<typeof questionnaireToolInputSchema>;
export type QuestionnaireToolAnswer =
  | { name: string; status: "answered"; value: string | string[] }
  | { name: string; status: "skipped" };
export type QuestionnaireToolOutput =
  | {
      status: "submitted";
      title: string;
      answers: QuestionnaireToolAnswer[];
    }
  | {
      status: "unavailable";
      reason: string;
    };

// Multiple questionnaires may be answered in one assistant message. Only
// duplicate tool calls, not other completed questionnaires, should be hidden.
export function uniqueQuestionnaireParts<T extends { toolCallId: string }>(parts: T[]): T[] {
  return [...new Map(parts.map((part) => [part.toolCallId, part] as const)).values()];
}

export function createQuestionnaireTool() {
  return tool({
    description:
      "Ask the user a short, structured questionnaire when multiple clarifications or selectable options are more useful than a prose question. Use concise prompts, include only necessary questions, and mark questions optional when the user may intentionally skip them. Fixed choices can be single-select or multi-select, and you can add a free-text answer. The questionnaire pauses for the user's input; after it is submitted, continue using the returned answers and respect skipped answers as intentionally unanswered.",
    inputSchema: questionnaireToolInputSchema,
  });
}
