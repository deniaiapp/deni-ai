import type { UIMessage } from "ai";
import type { ComparisonSettings } from "@/lib/comparison-settings";

// Gives the app-owned JSON columns of `@deniai/db` (model comparisons) their
// precise types; see packages/db/src/type-registry.ts.
declare module "@deniai/db/type-registry" {
  interface DbTypeRegistry {
    comparisonSettings: ComparisonSettings;
    uiMessage: UIMessage;
  }
}
