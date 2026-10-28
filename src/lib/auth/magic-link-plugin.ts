import { createAuthPlugin } from "@better-auth-ui/core";
import {
  magicLinkPlugin as coreMagicLinkPlugin,
  type MagicLinkPluginOptions,
} from "@better-auth-ui/core/plugins/magic-link";

import { dynamic } from "@/lib/dynamic";

// Views load when an auth or settings screen renders them: plugins are
// registered app-wide, so static imports would ship them with every page.
const MagicLink = dynamic(() =>
  import("@/components/auth/magic-link").then((mod) => mod.MagicLink),
);
const MagicLinkButton = dynamic(() =>
  import("@/components/auth/magic-link-button").then((mod) => mod.MagicLinkButton),
);

export const magicLinkPlugin = createAuthPlugin(
  coreMagicLinkPlugin.id,
  (options: MagicLinkPluginOptions = {}) => ({
    ...coreMagicLinkPlugin(options),
    authButtons: [MagicLinkButton],
    views: {
      auth: { magicLink: MagicLink },
    },
    // Conditional, not an override: when `emailAndPassword.enabled === false`
    // the `<Auth>` router renders this at `/auth/sign-in` instead of the
    // disabled password form. With password auth on, the built-in `SignIn`
    // still wins.
    fallbackViews: {
      auth: { signIn: MagicLink },
    },
  }),
);
