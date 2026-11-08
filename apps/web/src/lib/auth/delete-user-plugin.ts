import { createAuthPlugin } from "@better-auth-ui/core";
import {
  deleteUserPlugin as coreDeleteUserPlugin,
  type DeleteUserPluginOptions,
} from "@better-auth-ui/core/plugins/delete-user";

import { dynamic } from "@/lib/dynamic";

// Views load when an auth or settings screen renders them: plugins are
// registered app-wide, so static imports would ship them with every page.
const DangerZone = dynamic(() =>
  import("@/components/auth/delete-user/danger-zone").then((mod) => mod.DangerZone),
);

export const deleteUserPlugin = createAuthPlugin(
  coreDeleteUserPlugin.id,
  (options: DeleteUserPluginOptions = {}) => ({
    ...coreDeleteUserPlugin(options),
    securityCards: [DangerZone],
  }),
);
