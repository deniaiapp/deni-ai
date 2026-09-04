import { redirect } from "next/navigation";
import { AccountScreen } from "../components/account-screen";
import { getAuthenticatedUserId } from "@/lib/auth";

export default async function AccountPage() {
  const userId = await getAuthenticatedUserId();
  if (!userId) redirect("/sign-in");
  return <AccountScreen />;
}
