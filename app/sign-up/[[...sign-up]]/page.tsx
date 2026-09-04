import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <main className="flex min-h-full items-center justify-center bg-[#050505] p-6">
      <SignUp />
    </main>
  );
}
