import { auth } from "@clerk/nextjs/server";
import { syncBilling } from "@/lib/billing";
import { Landing } from "./components/landing";
import { Workspace } from "./components/workspace";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ billing?: string; session_id?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) return <Landing />;
  const params = await searchParams;
  const sessionId = typeof params.session_id === "string" ? params.session_id : undefined;
  if (sessionId || params.billing === "success") {
    await syncBilling(userId, sessionId).catch(() => undefined);
  }
  return <Workspace />;
}
