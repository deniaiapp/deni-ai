import "@tanstack/react-start/server-only";

import { getExtracted } from "@/i18n/server";
import { getWorkspaceUserId } from "./auth";

export async function getApiUserId() {
  return getWorkspaceUserId();
}

export async function unauthorizedResponse() {
  const t = await getExtracted();
  return Response.json({ error: t("Unauthorized") }, { status: 401 });
}
