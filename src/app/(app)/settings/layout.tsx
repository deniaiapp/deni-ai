import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import SettingsWrapper from "@/components/settings-wrapper";
import { Spinner } from "@/components/ui/spinner";
import { getSession } from "@/lib/get-session";
import { RETURN_TO_HEADER, signInPath } from "@/lib/sign-in-redirect";

function SettingsLayoutFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner className="size-5" />
    </div>
  );
}

async function AuthenticatedSettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  if (!session?.session) {
    // Keep team invite links (?invitationId=) through sign-in.
    redirect(signInPath((await headers()).get(RETURN_TO_HEADER)));
  }

  if (session.user?.isAnonymous) {
    redirect("/chat");
  }

  return <SettingsWrapper>{children}</SettingsWrapper>;
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<SettingsLayoutFallback />}>
      <AuthenticatedSettingsLayout>{children}</AuthenticatedSettingsLayout>
    </Suspense>
  );
}
