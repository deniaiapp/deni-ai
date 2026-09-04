import "server-only";

import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "./auth";

export async function getApiUserId() {
  return getAuthenticatedUserId();
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
