export type Organization = {
  id: string;
  name: string;
  slug: string | null;
  logo: string | null;
  createdAt: Date;
};

export type Member = {
  id: string;
  userId: string;
  role: string;
  createdAt: Date;
  user: {
    id: string;
    name: string;
    email: string;
    image?: string | null;
  };
};

export type Invitation = {
  id: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: Date;
};

// An invitation addressed to the current user (any organization), as returned by
// `authClient.organization.listUserInvitations()` — distinct from `Invitation`
// above, which is an outgoing invite the active org sent to someone else.
export type ReceivedInvitation = {
  id: string;
  organizationId: string;
  organizationName: string;
  role: string | null;
  status: string;
  expiresAt: Date;
};

export function isMember(value: unknown): value is Member {
  if (!value || typeof value !== "object") {
    return false;
  }

  const member = value as Partial<Member>;
  return (
    typeof member.id === "string" &&
    typeof member.userId === "string" &&
    typeof member.role === "string" &&
    !!member.user &&
    typeof member.user === "object" &&
    typeof member.user.id === "string" &&
    typeof member.user.email === "string"
  );
}

export function isInvitation(value: unknown): value is Invitation {
  if (!value || typeof value !== "object") {
    return false;
  }

  const invitation = value as Partial<Invitation>;
  return (
    typeof invitation.id === "string" &&
    typeof invitation.email === "string" &&
    typeof invitation.status === "string"
  );
}
