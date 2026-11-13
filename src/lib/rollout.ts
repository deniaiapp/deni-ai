/**
 * Links to the rollout Worker in front of deniai.app (deni-ai-new:
 * services/rollout-router): `/__rollout/<variant>` stores the visitor's choice
 * of version and sends them back to `returnPath`. Only meaningful while
 * `ROLLOUT_SWITCH_ENABLED` is on.
 */
export function rolloutSwitchUrl(variant: "v7" | "v8", returnPath: string): string {
  const params = new URLSearchParams({ return: returnPath.startsWith("/") ? returnPath : "/" });
  return `/__rollout/${variant}?${params.toString()}`;
}
