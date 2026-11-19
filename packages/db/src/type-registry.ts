/**
 * JSON column types that belong to an app, not to the schema package.
 *
 * `@deniai/db` cannot import app code, so a few `jsonb` columns are typed
 * through this registry. An app that needs the precise types augments it:
 *
 * ```ts
 * declare module "@deniai/db/type-registry" {
 *   interface DbTypeRegistry {
 *     comparisonSettings: ComparisonSettings;
 *     uiMessage: UIMessage;
 *   }
 * }
 * ```
 *
 * Without an augmentation the columns fall back to loose JSON types.
 */
// oxlint-disable-next-line typescript/no-empty-interface, typescript/no-empty-object-type -- augmented by apps
export interface DbTypeRegistry {}

type Registered<Key extends string, Fallback> =
  DbTypeRegistry extends Record<Key, infer T> ? T : Fallback;

/** `model_comparisons.left_settings` / `right_settings` (apps/web `ComparisonSettings`). */
export type ComparisonSettingsJson = Registered<"comparisonSettings", Record<string, unknown>>;

/** One element of `model_comparisons.left_messages` / `right_messages` (AI SDK `UIMessage`). */
export type UIMessageJson = Registered<"uiMessage", Record<string, unknown>>;
