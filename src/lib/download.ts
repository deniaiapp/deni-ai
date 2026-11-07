export function attachmentDisposition(name: string) {
  const safe = name.replace(/[\r\n\u0000]/g, "_").toWellFormed();
  const fallback = safe.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(safe).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
