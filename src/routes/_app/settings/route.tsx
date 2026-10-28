import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import SettingsWrapper from "@/components/settings-wrapper";
import { Spinner } from "@/components/ui/spinner";

function SettingsFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner className="size-5" />
    </div>
  );
}

export const Route = createFileRoute("/_app/settings")({
  beforeLoad: ({ context }) => {
    // Guest (anonymous) accounts have no settings; the app layout already
    // sent signed-out visitors to sign-in with their invite links intact.
    if (context.authState.isAnonymous) {
      throw redirect({ to: "/chat" });
    }
  },
  pendingComponent: SettingsFallback,
  component: SettingsLayout,
});

function SettingsLayout() {
  return (
    <SettingsWrapper>
      <Outlet />
    </SettingsWrapper>
  );
}
