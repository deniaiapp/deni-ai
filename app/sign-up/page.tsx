import { redirect } from "next/navigation";
import { SignUpForm } from "../components/auth-form";
import { getAuthenticatedUserId } from "@/lib/auth";

export default async function SignUpPage() {
  const userId = await getAuthenticatedUserId();
  if (userId) redirect("/");
  return <SignUpForm />;
}
