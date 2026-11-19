import { platformCapabilities } from "@/lib/platform-capabilities.server";

export const isBillingDisabled = !platformCapabilities.features.billing;
