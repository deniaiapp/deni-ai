import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AccountScreen } from "../components/account-screen";

export default async function AccountPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  return <AccountScreen />;
}
