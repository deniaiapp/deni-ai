import { asSchema } from "ai";
import { expect, test } from "vitest";
import { isQuestionnaireInput } from "@/components/chat/questionnaire-tool";
import { questionnaireToolInputSchema } from "./questionnaire";

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
