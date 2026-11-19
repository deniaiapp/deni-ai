import { createContext, use, type ReactNode } from 'react';
import type { SupportConfig } from '@/lib/support-config';

const SupportConfigContext = createContext<SupportConfig>({
  chat: false,
  email: false,
  turnstileSiteKey: null,
});

export function SupportConfigProvider({
  value,
  children,
}: {
  value: SupportConfig;
  children: ReactNode;
}) {
  return <SupportConfigContext value={value}>{children}</SupportConfigContext>;
}

export function useSupportConfig(): SupportConfig {
  return use(SupportConfigContext);
}
