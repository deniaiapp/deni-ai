import { redirect } from "next/navigation";
import { SocialAuth } from "../components/auth-form";
import { getAuthenticatedUserId } from "@/lib/auth";

export default async function SignUpPage() {
  const userId = await getAuthenticatedUserId();
  if (userId) redirect("/");
  return <SocialAuth title="Get started" />;
}
