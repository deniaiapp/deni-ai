export function supportEmail() {
  return process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || "";
}

export function supportMailto() {
  const email = supportEmail();
  return email ? `mailto:${email}` : null;
}
