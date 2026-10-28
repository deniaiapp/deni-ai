import { auth } from "@/lib/auth";
import { withTeamAuditActor, withTeamLeaveAudit } from "@/lib/team-member-audit";

export function GET(request: Request) {
  return auth.handler(request);
}

export async function POST(request: Request) {
  const path = new URL(request.url).pathname.replace(/\/+$/, "");
  if (
    !path.endsWith("/organization/remove-member") &&
    !path.endsWith("/organization/update-member-role") &&
    !path.endsWith("/organization/leave")
  ) {
    return auth.handler(request);
  }
  const session = await auth.api.getSession({ headers: request.headers });
  const userId = session?.session.userId;
  return withTeamAuditActor(userId, () =>
    path.endsWith("/organization/leave")
      ? withTeamLeaveAudit(request, userId, () => auth.handler(request))
      : auth.handler(request),
  );
}
