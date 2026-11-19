/**
 * Text that leaves the server for Discord. File system errors quote absolute paths such as
 * 'D:\app\.deni\users\…' or '/app/.deni/…'; the person never needs them, so they are elided.
 */
export function scrubServerPaths(text: string) {
  return text.replace(/(['"`])(?:[A-Za-z]:[\\/]|\/)[^'"`]*\1/g, "$1…$1");
}
