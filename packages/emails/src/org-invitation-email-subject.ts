const sanitizeSubjectValue = (value: string, fallback: string) => {
  const sanitized = value.replaceAll(/\r|\n/g, " ").replaceAll(/\s+/g, " ").trim().slice(0, 200);
  return sanitized || fallback;
};

export function orgInvitationEmailSubject(orgName: string) {
  return `You're invited to join ${sanitizeSubjectValue(orgName, "your organization")} on Deni AI`;
}

export { sanitizeSubjectValue };
