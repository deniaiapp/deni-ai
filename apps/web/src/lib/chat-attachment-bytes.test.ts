import { generateText, type ModelMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { expect, test } from "vitest";
import { createChatAttachmentDownload, type ChatAttachmentCache } from "./chat-attachment-download";

test("a provider that accepts file URLs still receives the downloaded bytes, never the URL", async () => {
  // A signed storage URL, as resolveAttachmentFileParts produces it.
  const signedUrl = "https://app.ufs.sh/f/key?expires=1&signature=secret";
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // Filled by fitBinaryAttachmentsToBudget before the model is called.
  const cache: ChatAttachmentCache = new Map([
    [signedUrl, { data: bytes, mediaType: "image/png" }],
  ]);
  let prompt: unknown;
  const model = new MockLanguageModelV4({
    // Claims to fetch any https URL itself.
    supportedUrls: { "*": [/^https:\/\/.*/] },
    doGenerate: async (options) => {
      prompt = options.prompt;
      throw new Error("stop after capturing the prompt");
    },
  });
  const messages: ModelMessage[] = [
    {
      role: "user",
      content: [
        { type: "text", text: "What is this?" },
        { type: "file", mediaType: "image/png", data: { type: "url", url: new URL(signedUrl) } },
      ],
    },
  ];

  await expect(
    generateText({
      model,
      messages,
      maxRetries: 0,
      experimental_download: createChatAttachmentDownload(new AbortController().signal, cache),
    }),
  ).rejects.toThrow("stop after capturing the prompt");

  expect(JSON.stringify(prompt)).not.toContain("ufs.sh");
  expect(JSON.stringify(prompt)).not.toContain("signature");
  expect(prompt).toMatchObject([
    {
      role: "user",
      content: [
        { type: "text", text: "What is this?" },
        { type: "file", mediaType: "image/png", data: { type: "data", data: bytes } },
      ],
    },
  ]);
});

test("without the chat download function, the SDK would pass such a URL through", async () => {
  let prompt: unknown;
  const model = new MockLanguageModelV4({
    supportedUrls: { "*": [/^https:\/\/.*/] },
    doGenerate: async (options) => {
      prompt = options.prompt;
      throw new Error("stop");
    },
  });
  await expect(
    generateText({
      model,
      maxRetries: 0,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "file",
              mediaType: "image/png",
              data: { type: "url", url: new URL("https://app.ufs.sh/f/key?signature=secret") },
            },
          ],
        },
      ],
    }),
  ).rejects.toThrow("stop");
  expect(JSON.stringify(prompt)).toContain("signature=secret");
});
