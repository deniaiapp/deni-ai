import { redirect } from "next/navigation";
import { SocialAuth } from "../components/auth-form";
import { getAuthenticatedUserId } from "@/lib/auth";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const userId = await getAuthenticatedUserId();
  if (userId) redirect("/");
  const { error } = await searchParams;
  return <SocialAuth title="Sign in" error={error} />;
}
