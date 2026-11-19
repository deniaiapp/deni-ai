import { viewPaths } from "@better-auth-ui/core";
import { magicLinkPlugin } from "@better-auth-ui/core/plugins/magic-link";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { Auth } from "@/components/auth/auth";
import { AuthFrame } from "@/components/auth/auth-frame";
import { OAuthErrorAlert } from "@/components/auth/oauth-error-alert";
import { GuestSignInButton } from "@/components/guest-sign-in-button";
import { TWO_FACTOR_VIEW_PATH } from "@deniai/auth/paths";

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
    <AuthFrame>
      <OAuthErrorAlert />
      <Auth path={path} />
      {showGuest ? <GuestSignInButton className="w-full max-w-sm" size="sm" /> : null}
    </AuthFrame>
  );
}
