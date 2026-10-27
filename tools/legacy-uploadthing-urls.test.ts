import { expect, test } from "vitest";
import {
  findLegacyFiles,
  rewriteLegacyFileUrls,
  uploadThingUrlKey,
} from "./legacy-uploadthing-urls";

const APP = "app123";
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
      file(`https://${APP}.ufs.sh/f/keyA`),
      file("https://utfs.io/f/keyB", "application/pdf"),
      file(`https://utfs.io/a/${APP}/keyG`, ""),
    ],
  },
  { id: "a1", role: "assistant", parts: [{ type: "text", text: "ok" }] },
  {
    id: "q2",
    role: "user",
    parts: [
      // Same file sent again.
      file(`https://${APP}.ufs.sh/f/keyA`),
      // Not ours: another app, another host, plain http, a data URL.
      file("https://other456.ufs.sh/f/keyC"),
      file("https://utfs.io/a/other456/keyH"),
      file("https://evil.example/f/keyD"),
      file(`http://${APP}.ufs.sh/f/keyE`),
      file("data:image/png;base64,AAAA"),
      // Already migrated.
      file(`/api/attachments/${ID_B}`),
      // Not a file part.
      { type: "text", text: `https://${APP}.ufs.sh/f/keyF` },
    ],
  },
];

test("public URLs of this app are recognized in every form, nothing else is", () => {
  expect(uploadThingUrlKey(`https://${APP}.ufs.sh/f/key-1_x`, APP)).toBe("key-1_x");
  expect(uploadThingUrlKey("https://utfs.io/f/key", APP)).toBe("key");
  expect(uploadThingUrlKey(`https://utfs.io/a/${APP}/key`, APP)).toBe("key");
  expect(uploadThingUrlKey(`https://${APP}.ufs.sh/f/key/extra`, APP)).toBeNull();
  expect(uploadThingUrlKey(`https://${APP}.ufs.sh/f/`, APP)).toBeNull();
  expect(uploadThingUrlKey(`https://${APP}.ufs.sh/f/a%2Fb`, APP)).toBeNull();
  expect(uploadThingUrlKey(`https://user@${APP}.ufs.sh/f/key`, APP)).toBeNull();
  expect(uploadThingUrlKey("not a url", APP)).toBeNull();
});

test("only file parts with this app's public URLs are migrated", () => {
  expect(findLegacyFiles(messages, APP)).toEqual(
    new Map([
      ["keyA", "image/png"],
      ["keyB", "application/pdf"],
      ["keyG", "application/octet-stream"],
    ]),
  );
  expect(findLegacyFiles("not messages", APP)).toEqual(new Map());
});

test("legacy URLs are rewritten to app URLs, everything else is untouched", () => {
  const { messages: rewritten, rewritten: count } = rewriteLegacyFileUrls(
    messages,
    APP,
    new Map([["keyA", ID_A]]),
  );
  expect(count).toBe(2);
  const parts = (rewritten as typeof messages).flatMap((message) => message.parts);
  expect(
    parts.filter((part) => "url" in part && part.url === `/api/attachments/${ID_A}`),
  ).toHaveLength(2);
  expect(parts).toContainEqual(file("https://utfs.io/f/keyB", "application/pdf"));
  expect(parts).toContainEqual({ type: "text", text: `https://${APP}.ufs.sh/f/keyF` });
  // The input is not mutated, and a second pass finds nothing left.
  expect(findLegacyFiles(messages, APP).has("keyA")).toBe(true);
  expect(rewriteLegacyFileUrls(rewritten, APP, new Map([["keyA", ID_A]])).rewritten).toBe(0);
});

test("nothing to rewrite returns the same messages", () => {
  const result = rewriteLegacyFileUrls(messages, APP, new Map([["missing", ID_A]]));
  expect(result).toEqual({ messages, rewritten: 0 });
  expect(result.messages).toBe(messages);
});
