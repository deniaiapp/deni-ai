import { createAuthPlugin } from "@better-auth-ui/core";
import {
  passkeyPlugin as corePasskeyPlugin,
  type PasskeyPluginOptions,
} from "@better-auth-ui/core/plugins/passkey";

import { dynamic } from "@/lib/dynamic";

// Views load when an auth or settings screen renders them: plugins are
// registered app-wide, so static imports would ship them with every page.
const PasskeyButton = dynamic(() =>
  import("@/components/auth/passkey/passkey-button").then((mod) => mod.PasskeyButton),
);
const Passkeys = dynamic(() =>
  import("@/components/auth/passkey/passkeys").then((mod) => mod.Passkeys),
);

export const passkeyPlugin = createAuthPlugin(
  corePasskeyPlugin.id,
  (options: PasskeyPluginOptions = {}) => ({
    ...corePasskeyPlugin(options),
    authButtons: [PasskeyButton],
    securityCards: [Passkeys],
  }),
);
