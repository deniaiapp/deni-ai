import { convertToModelMessages, type UIMessage } from "ai";
import { expect, test } from "vitest";
import type { ChatAttachmentCache } from "@/lib/chat-attachment-download";
import { reasoningEffortValues, resolveReasoningEffort } from "@/lib/constants";
import {
  capGuestReasoningEffort,
  estimateGuestPromptTokens,
  estimatePromptInputTokens,
  estimatePromptTextTokens,
  estimateTokenReservation,
  estimateUrlAttachmentTokens,
  fingerprintPromptPrefixes,
  GUEST_MAX_PROMPT_TOKENS,
  GUEST_MAX_REASONING_EFFORT,
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

test("the URL floor leaves data URL attachments to their encoded length", async () => {
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

const pdfUrl = "https://example.com/a.pdf";
const downloadedPdf = (bytes: number): ChatAttachmentCache =>
  new Map([[pdfUrl, { data: new Uint8Array(bytes), mediaType: "application/pdf" }]]);

test("guest prompts count each image per file and a short PDF at its floor, inline or by URL", async () => {
  const modelMessages = await convertToModelMessages([
    fileMessage([
      { type: "file", mediaType: "application/pdf", url: pdfUrl },
      {
        type: "file",
        mediaType: "image/png",
        url: `data:image/png;base64,${"A".repeat(400_000)}`,
      },
    ]),
  ]);
  const textTokens = estimatePromptTextTokens({ modelMessages, systemPrompt: "" });
  expect(textTokens).toBeLessThan(100);
  expect(
    estimateGuestPromptTokens({
      modelMessages,
      systemPrompt: "",
      attachmentCache: downloadedPdf(40_000),
    }),
  ).toBe(textTokens + URL_PDF_TOKEN_ESTIMATE + URL_IMAGE_TOKEN_ESTIMATE);
});

test("a large guest PDF counts by its size, inline or downloaded", async () => {
  const inline = await convertToModelMessages([
    fileMessage([
      {
        type: "file",
        mediaType: "application/pdf",
        // About 9 MB, decoded.
        url: `data:application/pdf;base64,${"A".repeat(12_000_000)}`,
      },
    ]),
  ]);
  expect(estimateGuestPromptTokens({ modelMessages: inline, systemPrompt: "" })).toBeGreaterThan(
    3_000_000,
  );

  const byUrl = await convertToModelMessages([
    fileMessage([{ type: "file", mediaType: "application/pdf", url: pdfUrl }]),
  ]);
  expect(
    estimateGuestPromptTokens({
      modelMessages: byUrl,
      systemPrompt: "",
      attachmentCache: downloadedPdf(1_000_000),
    }),
  ).toBeGreaterThan(GUEST_MAX_PROMPT_TOKENS);
  // A PDF that was not downloaded has no known size, so it counts as the largest one.
  expect(estimateGuestPromptTokens({ modelMessages: byUrl, systemPrompt: "" })).toBeGreaterThan(
    GUEST_MAX_PROMPT_TOKENS,
  );
});

test("guest reasoning effort is capped below the efforts that can exhaust the output cap", () => {
  const efforts = ["none", "low", "medium", "high", "xhigh", "max"] as const;
  expect(capGuestReasoningEffort(efforts, "max")).toBe("medium");
  expect(capGuestReasoningEffort(efforts, "xhigh")).toBe("medium");
  expect(capGuestReasoningEffort(efforts, "high")).toBe("medium");
  expect(capGuestReasoningEffort(efforts, "low")).toBe("low");
  expect(capGuestReasoningEffort(["low", "high"], "high")).toBe("low");
});

test("a guest effort the model does not support cannot resolve above the cap", () => {
  const efforts = ["none", "low", "medium", "high", "xhigh", "max"] as const;
  // Unsupported efforts resolve to the model's preferred one ("high") first.
  expect(capGuestReasoningEffort(efforts, "minimal")).toBe("medium");
  const limit = reasoningEffortValues.indexOf(GUEST_MAX_REASONING_EFFORT);
  for (const requested of reasoningEffortValues) {
    const resolved = capGuestReasoningEffort(
      efforts,
      resolveReasoningEffort(efforts, requested) ?? requested,
    );
    expect(efforts).toContain(resolved);
    expect(reasoningEffortValues.indexOf(resolved)).toBeLessThanOrEqual(limit);
    expect(resolveReasoningEffort(efforts, resolved)).toBe(resolved);
  }
});

test("prompt fingerprints match only while a prompt still starts with an earlier one", async () => {
  const question = fileMessage([]);
  const fingerprint = async (messages: UIMessage[], systemPrompt = "System") =>
    fingerprintPromptPrefixes({
      modelMessages: await convertToModelMessages(messages),
      systemPrompt,
      toolNames: ["search"],
    });
  const earlier = await fingerprint([question]);
  const followUp = await fingerprint([
    question,
    { id: "answer", role: "assistant", parts: [{ type: "text", text: "Answer" }] },
    { id: "next", role: "user", parts: [{ type: "text", text: "More" }] },
  ]);
  expect(followUp[1]).toBe(earlier[1]);

  const edited = await fingerprint([
    { ...question, parts: [{ type: "text", text: "Edited question" }] },
  ]);
  expect(edited[1]).not.toBe(earlier[1]);
  expect((await fingerprint([question], "Another system prompt"))[1]).not.toBe(earlier[1]);
});
