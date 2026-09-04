import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="flex min-h-full items-center justify-center bg-[#050505] p-6">
      <SignIn />
    </main>
  );
}
