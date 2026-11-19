import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RuntimeAppProviders } from "@/components/runtime-app-providers";

export const Route = createFileRoute("/_auth")({
  component: AuthLayout,
});

function AuthLayout() {
  // Browser auto-translate (Google Translate) rewraps text nodes in <font> and breaks
  // React's DOM updates on the auth forms (insertBefore NotFoundError).
  return (
    <div translate="no" className="contents">
      <RuntimeAppProviders>
        <Outlet />
      </RuntimeAppProviders>
    </div>
  );
}
