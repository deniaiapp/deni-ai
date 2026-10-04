import dynamic from "next/dynamic";
import { redirect } from "next/navigation";
import { PageLoading } from "@/components/page-loading";
import { getAuthSession } from "@/lib/auth";
import { syncBilling } from "@/lib/billing";
import { Landing } from "./components/landing";

const Workspace = dynamic(
  () => import("./components/workspace").then((mod) => ({ default: mod.Workspace })),
  {
    loading: () => <PageLoading />,
  },
);

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ billing?: string; session_id?: string }>;
}) {
  const session = await getAuthSession();
  if (!session?.user.id) return <Landing signedIn={false} />;
  if (!session.user.twoFactorEnabled) redirect("/two-factor/setup");
  const userId = session.user.id;
  const params = await searchParams;
  const sessionId = typeof params.session_id === "string" ? params.session_id : undefined;
  if (sessionId || params.billing === "success") {
    await syncBilling(userId, sessionId).catch(() => undefined);
  }
  return <Workspace />;
}
