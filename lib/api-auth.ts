import "server-only";

import { NextResponse } from "next/server";
import { getWorkspaceUserId } from "./auth";

export async function getApiUserId() {
  return getWorkspaceUserId();
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
