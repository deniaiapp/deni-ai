import { createContext, type ReactNode, useContext } from "react";
import { useTeamSettings } from "./use-team-settings";

type TeamSettingsContextValue = ReturnType<typeof useTeamSettings>;

const TeamSettingsContext = createContext<TeamSettingsContextValue | null>(null);

export function TeamSettingsProvider({ children }: { children: ReactNode }) {
  const value = useTeamSettings();
  return <TeamSettingsContext.Provider value={value}>{children}</TeamSettingsContext.Provider>;
}

export function useTeamSettingsContext() {
  const context = useContext(TeamSettingsContext);
  if (!context) {
    throw new Error("useTeamSettingsContext must be used within a TeamSettingsProvider");
  }
  return context;
}
