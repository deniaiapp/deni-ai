import { redirect } from "next/navigation";
import { TwoFactorSetupForm } from "../../components/auth-form";
import { getAuthSession } from "@/lib/auth";
import { emailOtpAvailable } from "@/lib/two-factor-delivery";

export default async function TwoFactorSetupPage() {
  const session = await getAuthSession();
  if (!session?.user.id) redirect("/sign-in");
  if (session.user.twoFactorEnabled) redirect("/");
  return <TwoFactorSetupForm email={session.user.email} emailAvailable={emailOtpAvailable()} />;
}
