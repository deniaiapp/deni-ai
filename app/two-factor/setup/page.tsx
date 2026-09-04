import { redirect } from "next/navigation";
import { TwoFactorSetupForm } from "../../components/auth-form";
import { getAuthSession } from "@/lib/auth";

export default async function TwoFactorSetupPage() {
  const session = await getAuthSession();
  if (!session?.user.id) redirect("/sign-in");
  if (session.user.twoFactorEnabled) redirect("/");
  return <TwoFactorSetupForm />;
}
