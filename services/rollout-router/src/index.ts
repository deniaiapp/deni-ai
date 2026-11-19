import { route, type RolloutEnv } from "./router";

/** Cloudflare Worker on `deniai.app/*`: see src/router.ts and README.md. */
export default {
  fetch(request: Request, env: RolloutEnv): Promise<Response> {
    return route(request, env);
  },
};
