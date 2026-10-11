import { convertToModelMessages, type UIMessage } from "ai";
import { expect, test } from "vitest";
import {
  estimatePromptInputTokens,
  estimateTokenReservation,
  estimateUrlAttachmentTokens,
  URL_IMAGE_TOKEN_ESTIMATE,
  URL_PDF_TOKEN_ESTIMATE,
} from "./usage-estimate";

const fileMessage = (parts: UIMessage["parts"]): UIMessage => ({
  id: "message",
  role: "user",
  parts: [{ type: "text", text: "Summarize these" }, ...parts],
});

test("URL images and PDFs count toward the prompt estimate", async () => {
  const modelMessages = await convertToModelMessages([
    fileMessage([
      { type: "file", mediaType: "application/pdf", url: "https://example.com/a.pdf" },
      { type: "file", mediaType: "image/png", url: "https://example.com/a.png" },
    ]),
  ]);
  expect(estimateUrlAttachmentTokens(modelMessages)).toBe(
    URL_PDF_TOKEN_ESTIMATE + URL_IMAGE_TOKEN_ESTIMATE,
  );
});

test("data URL attachments are already counted by their encoded length", async () => {
  const modelMessages = await convertToModelMessages([
    fileMessage([{ type: "file", mediaType: "image/png", url: "data:image/png;base64,AAAA" }]),
  ]);
  expect(estimateUrlAttachmentTokens(modelMessages)).toBe(0);
});

test("twenty URL PDFs reserve their per-file floor instead of their URL length", async () => {
  const modelMessages = await convertToModelMessages([
    fileMessage(
      Array.from({ length: 20 }, (_, index) => ({
        type: "file" as const,
        mediaType: "application/pdf",
        url: `https://example.com/${index}.pdf`,
      })),
    ),
  ]);
  const estimatedPromptTokens =
    estimatePromptInputTokens({ modelMessages, systemPrompt: "" }) +
    estimateUrlAttachmentTokens(modelMessages);
  expect(
    estimateTokenReservation({ estimatedPromptTokens, modelId: "gpt-6-luna" }),
  ).toBeGreaterThan(20 * URL_PDF_TOKEN_ESTIMATE);
});
