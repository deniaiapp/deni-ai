import { viewPaths } from "@better-auth-ui/core";
import { magicLinkPlugin } from "@better-auth-ui/core/plugins/magic-link";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { Auth } from "@/components/auth/auth";
import { GuestSignInButton } from "@/components/guest-sign-in-button";
import { TWO_FACTOR_VIEW_PATH } from "@/lib/auth-paths";

const magicLinkPaths = Object.values(magicLinkPlugin().viewPaths?.auth ?? {});

const validAuthPaths = new Set<string>([
  ...Object.values(viewPaths.auth),
  ...magicLinkPaths,
  TWO_FACTOR_VIEW_PATH,
]);

export const Route = createFileRoute("/_auth/auth/$path")({
  beforeLoad: ({ params }) => {
    if (!validAuthPaths.has(params.path)) {
      throw notFound();
    }
  },
  component: AuthPage,
});

function AuthPage() {
  const { path } = Route.useParams();
  const showGuest = path === viewPaths.auth.signIn;

  return (
    <main
      className="flex min-h-screen w-full grow flex-col items-center justify-center gap-4 p-4 md:p-6"
      id="main-content"
    >
      <Auth path={path} />
      {showGuest ? <GuestSignInButton className="w-full max-w-sm" size="sm" /> : null}
    </main>
  );
}
