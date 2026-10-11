/**
 * Most procedure calls one tRPC HTTP request may batch. The server runs every
 * call of a batch at once, so this bounds how far one request fans out; the
 * client splits larger batches to stay under it.
 */
export const TRPC_MAX_BATCH_SIZE = 20;
