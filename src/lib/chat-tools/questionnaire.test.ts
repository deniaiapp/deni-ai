import { asSchema } from "ai";
import { expect, test } from "vitest";
import { isQuestionnaireInput } from "@/components/chat/questionnaire-tool";
import {
  createQuestionnaireTool,
  questionnaireToolInputSchema,
  uniqueQuestionnaireParts,
} from "./questionnaire";

const valid = {
  title: "Trip details",
  questions: [
    {
      name: "destination",
      prompt: "Where are you going?",
      choices: [
        { value: "tokyo", label: "Tokyo" },
        { value: "osaka", label: "Osaka" },
      ],
    },
    { name: "notes", prompt: "Anything else?", input: { label: "Notes" } },
  ],
};

test("accepts a questionnaire the client can display", () => {
  expect(questionnaireToolInputSchema.safeParse(valid).success).toBe(true);
  expect(isQuestionnaireInput(valid)).toBe(true);
});

test.each([
  [
    "duplicate question names",
    { ...valid, questions: [valid.questions[0], { ...valid.questions[1], name: "destination" }] },
  ],
  [
    "duplicate choice values",
    {
      ...valid,
      questions: [
        {
          ...valid.questions[0],
          choices: [
            { value: "other", label: "Other" },
            { value: "other", label: "Something else" },
          ],
        },
      ],
    },
  ],
  ["a blank title", { ...valid, title: "  " }],
  ["a blank prompt", { ...valid, questions: [{ ...valid.questions[1], prompt: " " }] }],
  [
    "a blank choice label",
    {
      ...valid,
      questions: [{ ...valid.questions[0], choices: [{ value: "tokyo", label: " " }] }],
    },
  ],
  [
    "a blank input label",
    { ...valid, questions: [{ ...valid.questions[1], input: { label: "\n" } }] },
  ],
])("rejects %s, as the client does", (_case, input) => {
  expect(isQuestionnaireInput(input)).toBe(false);
  expect(questionnaireToolInputSchema.safeParse(input).success).toBe(false);
});

test("points the model at the duplicated key", () => {
  const result = questionnaireToolInputSchema.safeParse({
    ...valid,
    questions: [valid.questions[0], { ...valid.questions[1], name: "destination" }],
  });
  expect(result.error?.issues).toEqual([
    expect.objectContaining({ path: ["questions", 1, "name"] }),
  ]);
});

test("the refinements leave the provider JSON schema intact", async () => {
  const jsonSchema = await asSchema(questionnaireToolInputSchema).jsonSchema;
  expect(jsonSchema).toMatchObject({
    type: "object",
    required: ["title", "questions"],
  });
});

test("accepts single choice, multiple choice, free text, and skippable questions", () => {
  const questionnaire = questionnaireToolInputSchema.parse({
    title: "Plan the prototype",
    questions: [
      {
        name: "direction",
        prompt: "What should we prototype?",
        required: true,
        choices: [{ value: "web", label: "Web app" }],
        input: { label: "Another direction" },
      },
      {
        name: "signals",
        prompt: "Which signals matter?",
        multiple: true,
        choices: [{ value: "speed", label: "Speed" }],
      },
      {
        name: "timing",
        prompt: "When should we revisit this?",
        required: false,
        input: { label: "Timing" },
      },
    ],
  });

  expect(questionnaire.questions).toHaveLength(3);
  expect(questionnaire.questions[1]?.multiple).toBe(true);
  expect(questionnaire.questions[2]?.required).toBe(false);
});

test("bounds questionnaire size and requires an answer key and prompt", () => {
  expect(() => questionnaireToolInputSchema.parse({ title: "Empty", questions: [] })).toThrow();
  expect(() =>
    questionnaireToolInputSchema.parse({
      title: "Missing prompt",
      questions: [{ name: "scope" }],
    }),
  ).toThrow();
  expect(() =>
    questionnaireToolInputSchema.parse({
      title: "Too many",
      questions: Array.from({ length: 9 }, (_, index) => ({
        name: `question-${index}`,
        prompt: "Question",
      })),
    }),
  ).toThrow();
});

test("pauses for client input rather than executing on the server", () => {
  expect(createQuestionnaireTool().execute).toBeUndefined();
});

test("keeps separate completed questionnaires in the same assistant message", () => {
  const first = { toolCallId: "first", state: "output-available", title: "First question" };
  const second = { toolCallId: "second", state: "output-available", title: "Second question" };
  const updatedFirst = { ...first, title: "Updated first" };
  expect(uniqueQuestionnaireParts([first, second, updatedFirst])).toEqual([updatedFirst, second]);
});
