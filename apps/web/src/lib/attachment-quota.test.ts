import { expect, test } from "vitest";
import {
  fitsStorageLimit,
  formatStorageBytes,
  getStorageLimitBytes,
  storageQuotaExceededMessage,
} from "./attachment-quota";
import { attachmentUrl, isAttachmentId, parseAttachmentUrl } from "./attachment-url";

const MiB = 1024 * 1024;

test("attachment storage quota follows the plan", () => {
  expect(getStorageLimitBytes("guest")).toBe(20 * MiB);
  expect(getStorageLimitBytes("free")).toBe(100 * MiB);
  expect(getStorageLimitBytes("go")).toBe(200 * MiB);
  expect(getStorageLimitBytes("plus")).toBe(500 * MiB);
  expect(getStorageLimitBytes("pro")).toBe(1024 * MiB);
});

test("a file fits only while the total stays within the quota", () => {
  expect(fitsStorageLimit(90 * MiB, 10 * MiB, 100 * MiB)).toBe(true);
  expect(fitsStorageLimit(90 * MiB, 10 * MiB + 1, 100 * MiB)).toBe(false);
  expect(fitsStorageLimit(0, 20 * MiB + 1, getStorageLimitBytes("guest"))).toBe(false);
});

test("storage sizes are shown in MB below 1 GB and in GB above", () => {
  expect(formatStorageBytes(0)).toBe("0 MB");
  expect(formatStorageBytes(512 * 1024)).toBe("0.5 MB");
  expect(formatStorageBytes(95.34 * MiB)).toBe("95.3 MB");
  expect(formatStorageBytes(100 * MiB)).toBe("100 MB");
  expect(formatStorageBytes(1024 * MiB)).toBe("1 GB");
  expect(formatStorageBytes(1.5 * 1024 * MiB)).toBe("1.5 GB");
});

test("the quota error carries usage and limit in the form the client localizes", () => {
  const message = storageQuotaExceededMessage(95.34 * MiB, 100 * MiB);
  expect(message).toBe(
    "Attachment storage is full (95.3 MB of 100 MB used). Delete chats with attachments or upgrade your plan.",
  );
  // Same pattern as useLocalizeError.
  expect(message).toMatch(
    /^Attachment storage is full \((.+) of (.+) used\)\. Delete chats with attachments or upgrade your plan\.$/,
  );
});

test("only the exact app attachment URL form is recognized", () => {
  const id = "a".repeat(32);
  expect(attachmentUrl(id)).toBe(`/api/attachments/${id}`);
  expect(parseAttachmentUrl(`/api/attachments/${id}`)).toBe(id);
  for (const url of [
    `https://deniai.app/api/attachments/${id}`,
    `/api/attachments/${id}?x=1`,
    `/api/attachments/${id}/..`,
    "/api/attachments/short",
    `/api/attachments/${"a".repeat(65)}`,
    "https://app.ufs.sh/f/key",
    "data:image/png;base64,AAAA",
  ]) {
    expect(parseAttachmentUrl(url)).toBeNull();
  }
  expect(isAttachmentId("abc/def")).toBe(false);
});
