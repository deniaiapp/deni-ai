import { redirect } from "next/navigation";
import { SignInForm } from "../components/auth-form";
import { getAuthenticatedUserId } from "@/lib/auth";

export default async function SignInPage() {
  const userId = await getAuthenticatedUserId();
  if (userId) redirect("/");
  return <SignInForm />;
}
