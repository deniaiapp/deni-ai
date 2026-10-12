import { expect, test } from "vitest";
import { findLegacyAttachments, rewriteLegacyAttachmentUrls } from "./legacy-attachment-migration";
import { storedFileKey, uploadThingFileHostname } from "./stored-files";

const HOST = "app123.ufs.sh";
const ID_A = "a".repeat(32);
const ID_B = "b".repeat(32);

const file = (url: string, mediaType = "image/png") => ({
  type: "file",
  mediaType,
  filename: "a.png",
  url,
});

const messages = [
  {
    id: "q1",
    role: "user",
    parts: [
      { type: "text", text: "look" },
      file(`https://${HOST}/f/keyA`),
      file(`https://${HOST}/f/keyB`, "application/pdf"),
    ],
  },
  { id: "a1", role: "assistant", parts: [{ type: "text", text: "ok" }] },
  {
    id: "q2",
    role: "user",
    parts: [
      // Same file sent again.
      file(`https://${HOST}/f/keyA`),
      // Not ours: another UploadThing app, another host, plain http, a data URL.
      file("https://other456.ufs.sh/f/keyC"),
      file("https://evil.example/f/keyD"),
      file(`http://${HOST}/f/keyE`),
      file("data:image/png;base64,AAAA"),
      // Already migrated.
      file(`/api/attachments/${ID_B}`),
      // Not a file part.
      { type: "text", text: `https://${HOST}/f/keyF` },
    ],
  },
];

test("only file parts with this app's public storage URLs are migrated", () => {
  expect(findLegacyAttachments(messages, HOST)).toEqual(
    new Map([
      ["keyA", "image/png"],
      ["keyB", "application/pdf"],
    ]),
  );
});

test("legacy URLs are rewritten to app URLs, everything else is untouched", () => {
  const { messages: rewritten, rewritten: count } = rewriteLegacyAttachmentUrls(
    messages,
    HOST,
    new Map([["keyA", ID_A]]),
  );
  expect(count).toBe(2);
  const [q1, a1, q2] = rewritten as typeof messages;
  expect(q1?.parts[1]).toEqual(file(`/api/attachments/${ID_A}`));
  // Keys without an id (for example a file left public on purpose) keep their URL.
  expect(q1?.parts[2]).toEqual(file(`https://${HOST}/f/keyB`, "application/pdf"));
  expect(a1).toBe(messages[1]);
  expect(q2?.parts[0]).toEqual(file(`/api/attachments/${ID_A}`));
  expect(q2?.parts.slice(1)).toEqual(messages[2]?.parts.slice(1));
  // The input is not modified.
  expect(messages[0]?.parts[1]).toEqual(file(`https://${HOST}/f/keyA`));
});

test("rewriting is idempotent", () => {
  const ids = new Map([
    ["keyA", ID_A],
    ["keyB", ID_B],
  ]);
  const first = rewriteLegacyAttachmentUrls(messages, HOST, ids);
  expect(first.rewritten).toBe(3);
  expect(findLegacyAttachments(first.messages, HOST).size).toBe(0);
  const second = rewriteLegacyAttachmentUrls(first.messages, HOST, ids);
  expect(second).toEqual({ messages: first.messages, rewritten: 0 });
});

test("malformed saved messages are left alone", () => {
  for (const value of [null, "text", 42, {}, [null, 1, { parts: "x" }, { parts: [null, 7] }]]) {
    expect(findLegacyAttachments(value, HOST).size).toBe(0);
    expect(rewriteLegacyAttachmentUrls(value, HOST, new Map([["keyA", ID_A]]))).toEqual({
      messages: value,
      rewritten: 0,
    });
  }
});

test("the storage host comes from the UploadThing token", () => {
  const token = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");
  expect(uploadThingFileHostname(token({ appId: "App123", apiKey: "sk" }))).toBe(HOST);
  expect(uploadThingFileHostname(undefined)).toBeNull();
  expect(uploadThingFileHostname("not base64 json")).toBeNull();
  expect(uploadThingFileHostname(token({ appId: "evil.example/x" }))).toBeNull();
});

test("storage keys are read from the path of this app's file URLs only", () => {
  expect(storedFileKey(new URL(`https://${HOST}/f/abc-123_x.png`), HOST)).toBe("abc-123_x.png");
  expect(storedFileKey(new URL(`https://${HOST}/f/key?x=1`), HOST)).toBe("key");
  expect(storedFileKey(new URL(`https://${HOST}/f/a/b`), HOST)).toBeNull();
  expect(storedFileKey(new URL(`https://${HOST}/f/`), HOST)).toBeNull();
  expect(storedFileKey(new URL(`https://${HOST}/a/app123/key`), HOST)).toBeNull();
  expect(storedFileKey(new URL(`https://${HOST}/f/key`), null)).toBeNull();
});
