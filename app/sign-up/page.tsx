import { getExtracted } from "next-intl/server";
import { redirect } from "next/navigation";
import { SocialAuth } from "../components/auth-form";
import { getAuthSession } from "@/lib/auth";

export default async function SignUpPage() {
  const session = await getAuthSession();
  if (session?.user.twoFactorEnabled) redirect("/");
  if (session?.user.id) redirect("/two-factor/setup");
  const t = await getExtracted();
  return <SocialAuth title={t("Create an account")} mode="sign-up" />;
}
