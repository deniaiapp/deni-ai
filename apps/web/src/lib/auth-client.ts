import { createDeniAuthClient } from "@deniai/auth/client";

export { TWO_FACTOR_PATH, TWO_FACTOR_VIEW_PATH } from "@deniai/auth/paths";

const baseURL = import.meta.env.NEXT_PUBLIC_BETTER_AUTH_URL;
if (!baseURL) {
  throw new Error("NEXT_PUBLIC_BETTER_AUTH_URL is required");
}

/** Browser auth client; the plugin set lives in `@deniai/auth/client`. */
export const authClient = createDeniAuthClient({ baseURL });
