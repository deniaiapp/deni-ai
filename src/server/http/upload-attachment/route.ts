import {
  decodeTextAttachment,
  MAX_TEXT_ATTACHMENT_BYTES,
  textMediaTypeForName,
} from "@/lib/attachment-types";
import { storageQuotaExceededMessage } from "@/lib/attachment-quota";
import { attachmentUrl } from "@/lib/attachment-url";
import {
  abandonAttachmentReservation,
  getStorageLimitForUser,
  markAttachmentReady,
  releaseAttachmentReservation,
  reserveAttachmentStorage,
  type StorageReservation,
} from "@/lib/attachments";
import { auth } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { attachmentStorageKey } from "@/lib/stored-files";
import { deleteStoredFiles, isStorageConfigured, uploadPrivateFile } from "@/lib/upload";
import { guardMutationRequest } from "@/lib/mutation-request";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
// Multipart boundaries and headers add a little on top of the file itself.
const MAX_REQUEST_BYTES = MAX_ATTACHMENT_BYTES + 64 * 1024;
const UPLOAD_WINDOW_MS = 10 * 60_000;

function asciiAt(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.subarray(start, end));
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The browser-supplied MIME type is only a claim; detect it from the file itself. */
function detectAttachmentType(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return "image/png";
  if (asciiAt(bytes, 0, 4) === "RIFF" && asciiAt(bytes, 8, 12) === "WEBP") return "image/webp";
  if (asciiAt(bytes, 0, 5) === "%PDF-") return "application/pdf";
  return null;
}

/**
 * Read the request body, stopping at the size cap. Content-Length can be absent
 * (chunked uploads) or wrong, so it cannot be the only guard before the body is buffered.
 */
async function readBodyWithinLimit(request: Request): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_REQUEST_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return body;
}

export async function POST(request: Request) {
  const rejected = guardMutationRequest(request, "multipart/form-data");
  if (rejected) return rejected;
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateCheck = await checkRateLimit({
    key: `upload-attachment:${session.session.userId}`,
    windowMs: UPLOAD_WINDOW_MS,
    maxRequests: session.user.isAnonymous ? 10 : 60,
  });
  if (!rateCheck.allowed) {
    return Response.json(
      { error: "Too many uploads. Please slow down." },
      { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter) } },
    );
  }

  // Reject oversized bodies before formData() buffers them in memory.
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return Response.json({ error: "Attachment is too large." }, { status: 413 });
  }

  const body = await readBodyWithinLimit(request);
  if (!body) {
    return Response.json({ error: "Attachment is too large." }, { status: 413 });
  }

  let formData: FormData;
  try {
    formData = await new Response(body, {
      headers: { "content-type": request.headers.get("content-type") ?? "" },
    }).formData();
  } catch {
    return Response.json({ error: "File is required." }, { status: 400 });
  }
  const submittedFile = formData.get("file");

  if (!(submittedFile instanceof File)) {
    return Response.json({ error: "File is required." }, { status: 400 });
  }

  if (submittedFile.size > MAX_ATTACHMENT_BYTES) {
    return Response.json({ error: "Attachment is too large." }, { status: 413 });
  }

  // The claimed type is not checked: browsers and OSes report it inconsistently
  // (empty, `image/jpg`, `application/octet-stream`), and the contents decide.
  const detectedType = detectAttachmentType(
    new Uint8Array(await submittedFile.slice(0, 16).arrayBuffer()),
  );

  let uploadedFile: File;
  if (detectedType) {
    // Store and serve the file under the type its contents prove, not the claimed one.
    uploadedFile =
      detectedType === submittedFile.type
        ? submittedFile
        : new File([submittedFile], submittedFile.name, { type: detectedType });
  } else {
    // No magic bytes: accept plain-text files by extension, provided they really decode as text.
    const textType = textMediaTypeForName(submittedFile.name);
    if (!textType) {
      console.warn(
        `[upload-attachment] unsupported content (claimed type: ${submittedFile.type || "none"}, size: ${submittedFile.size})`,
      );
      return Response.json({ error: "Unsupported attachment type." }, { status: 415 });
    }
    if (submittedFile.size > MAX_TEXT_ATTACHMENT_BYTES) {
      return Response.json({ error: "Text file is too large (max 2 MB)." }, { status: 413 });
    }
    const text = decodeTextAttachment(new Uint8Array(await submittedFile.arrayBuffer()));
    if (text === null) {
      console.warn(`[upload-attachment] binary content in text file (size: ${submittedFile.size})`);
      return Response.json({ error: "Unsupported attachment type." }, { status: 415 });
    }
    // Always stored as UTF-8, whatever encoding the file arrived in. Re-encoding can
    // grow it (Shift_JIS kana and kanji, UTF-16 CJK), and the chat reader caps the
    // stored file, so the limit applies to the UTF-8 bytes as well.
    const utf8 = new TextEncoder().encode(text);
    if (utf8.byteLength > MAX_TEXT_ATTACHMENT_BYTES) {
      return Response.json({ error: "Text file is too large (max 2 MB)." }, { status: 413 });
    }
    uploadedFile = new File([utf8], submittedFile.name, { type: textType });
  }

  if (!isStorageConfigured()) return inlineAttachment(uploadedFile);
  return storeAttachment(uploadedFile, session.session.userId, Boolean(session.user.isAnonymous));
}

const UPLOAD_FAILED = "Attachment upload failed.";

/**
 * Store the file privately, counted against the user's storage quota. The quota
 * is reserved (a pending row with the file's size) before the upload, so
 * concurrent uploads cannot pass it, and given back if the upload fails.
 * A failed upload is an error: falling back to an inline data URL here would
 * bypass the quota.
 */
async function storeAttachment(file: File, userId: string, isAnonymous: boolean) {
  let reservation: StorageReservation;
  try {
    reservation = await reserveAttachmentStorage({
      userId,
      mediaType: file.type,
      sizeBytes: file.size,
      limitBytes: await getStorageLimitForUser(userId, isAnonymous),
    });
  } catch (error) {
    console.error("[upload-attachment] storage reservation failed", error);
    return Response.json({ error: UPLOAD_FAILED }, { status: 500 });
  }
  if (!reservation.ok) {
    return Response.json(
      {
        error: storageQuotaExceededMessage(reservation.usedBytes, reservation.limitBytes),
        reason: "storage_quota_exceeded",
        usedBytes: reservation.usedBytes,
        limitBytes: reservation.limitBytes,
      },
      { status: 413 },
    );
  }

  // Keyed by the reservation id: if the key is never recorded (crash, timeout),
  // dropping the abandoned reservation still deletes the file.
  const key = attachmentStorageKey(reservation.id);

  /**
   * Give the quota back. The reservation is dropped only once the file is
   * gone (`deleted`, what `deleteStoredFiles` reports, includes its key):
   * until then it is the file's only record, so it is marked for the
   * storage-cleanup cron to delete the file by its key instead. If even that
   * fails, the pending row expires and is cleaned up the same way.
   */
  const release = async (deleted: readonly string[]) => {
    try {
      if (deleted.includes(key)) await releaseAttachmentReservation(reservation.id);
      else await abandonAttachmentReservation(reservation.id);
    } catch (error) {
      console.error("[upload-attachment] failed to release a storage reservation", error);
    }
  };

  if (!(await uploadPrivateFile(file, key))) {
    // A request can fail after the file was stored (for example, a lost response).
    await release(await deleteStoredFiles([key]));
    return Response.json({ error: UPLOAD_FAILED }, { status: 502 });
  }

  let ready = false;
  try {
    ready = await markAttachmentReady(reservation.id, key);
  } catch (error) {
    console.error("[upload-attachment] failed to record a stored attachment", error);
  }
  if (!ready) {
    await release(await deleteStoredFiles([key]));
    return Response.json({ error: UPLOAD_FAILED }, { status: 500 });
  }

  return Response.json({ url: attachmentUrl(reservation.id), mediaType: file.type });
}

// Without R2 storage (local development), attachments travel inline as base64
// data URLs: nothing is stored, so there is no quota. Keep the fallback small so
// chat history and response payloads stay within limits.
const MAX_DATA_URL_BYTES = 512 * 1024;

async function inlineAttachment(file: File) {
  if (file.size > MAX_DATA_URL_BYTES) {
    console.error(
      `[upload-attachment] storage unavailable and file exceeds inline fallback (size: ${file.size})`,
    );
    return Response.json(
      {
        error:
          "Attachment upload failed. Inline fallback is limited to 512KB when storage is unavailable.",
      },
      { status: 500 },
    );
  }
  try {
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    return Response.json({ url: `data:${file.type};base64,${base64}`, mediaType: file.type });
  } catch (error) {
    console.error("Attachment base64 fallback failed", error);
    return Response.json({ error: UPLOAD_FAILED }, { status: 500 });
  }
}
