import type { ReactDoctorConfig } from "react-doctor/api";

export default {
  lint: true,
  deadCode: true,
  ignore: {
    files: [
      "public/**",
      "tools/**",
      "src/components/ai-elements/**",
      "src/components/ui/**",
      // Shared primitives/helpers — not React component entry files
      "src/lib/base-ui-compat.tsx",
      // Type-only module augmentation for better-auth-ui plugins
      "src/lib/auth/auth-plugin.ts",
    ],
  },
  // Brand icons package is intentional; Socket vulnerability axis is 100, supply-chain is 31.
  supplyChain: {
    minScore: 30,
    severity: "warning",
  },
} satisfies ReactDoctorConfig;
