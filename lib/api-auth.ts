import "server-only";

import { getExtracted } from "next-intl/server";
import { NextResponse } from "next/server";
import { getWorkspaceUserId } from "./auth";

export async function getApiUserId() {
  return getWorkspaceUserId();
}

export async function unauthorizedResponse() {
  const t = await getExtracted();
  return NextResponse.json({ error: t("Unauthorized") }, { status: 401 });
}
