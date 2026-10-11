"use client";

import type { ReactNode } from "react";
import { createContext, use, useEffect, useSyncExternalStore } from "react";
import type { ThemeName } from "@/lib/theme-presets";

const STORAGE_KEY = "deni-theme-preset";
const PRESET_EVENT = "deni:theme-preset";
const CUSTOM_CLASSES: ThemeName[] = [
  "t3-chat",
  "tangerine",
  "mono",
  "deep-dark",
  "deep-dark-high-contrast",
];
const STANDARD_THEMES: ThemeName[] = ["light", "dark", "system"];

type ThemePresetContextValue = {
  preset: ThemeName;
  setPreset: (value: ThemeName) => void;
};

const ThemePresetContext = createContext<ThemePresetContextValue | null>(null);

function isThemeName(value: string): value is ThemeName {
  return (
    value === "light" ||
    value === "dark" ||
    value === "system" ||
    value === "default" ||
    value === "t3-chat" ||
    value === "tangerine" ||
    value === "mono" ||
    value === "deep-dark" ||
    value === "deep-dark-high-contrast"
  );
}

function normalizePreset(value: ThemeName) {
  return STANDARD_THEMES.includes(value) ? "default" : value;
}

function applyPresetClass(value: ThemeName) {
  if (typeof document === "undefined") return;
  const body = document.body;
  for (const cls of CUSTOM_CLASSES) {
    body.classList.remove(cls);
  }
  if (CUSTOM_CLASSES.includes(value)) {
    body.classList.add(value);
  }
}

function subscribeThemePreset(onStoreChange: () => void) {
  const handleChange = () => onStoreChange();
  window.addEventListener("storage", handleChange);
  window.addEventListener(PRESET_EVENT, handleChange);
  return () => {
    window.removeEventListener("storage", handleChange);
    window.removeEventListener(PRESET_EVENT, handleChange);
  };
}

/**
 * Blocked site data makes `localStorage` access throw, and the snapshot is read
 * during render on every page. Fall back to an in-memory choice instead, so a
 * preset picked while storage is unavailable still lasts for this page.
 */
let unpersistedPreset: ThemeName = "default";

function getThemePresetSnapshot(): ThemeName {
  let stored: string | null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return unpersistedPreset;
  }
  if (stored && isThemeName(stored)) {
    return normalizePreset(stored);
  }
  if (stored) {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore; the invalid value is not used either way.
    }
  }
  return "default";
}

function getServerThemePresetSnapshot(): ThemeName {
  return "default";
}

function setThemePreset(value: ThemeName) {
  const normalizedValue = normalizePreset(value);
  unpersistedPreset = normalizedValue;
  try {
    window.localStorage.setItem(STORAGE_KEY, normalizedValue);
  } catch {
    // Still apply the preset for this page when it cannot be persisted.
  }
  applyPresetClass(normalizedValue);
  window.dispatchEvent(new Event(PRESET_EVENT));
}

export function ThemePresetProvider({ children }: { children: ReactNode }) {
  const preset = useSyncExternalStore(
    subscribeThemePreset,
    getThemePresetSnapshot,
    getServerThemePresetSnapshot,
  );

  useEffect(() => {
    applyPresetClass(preset);
  }, [preset]);

  const value: ThemePresetContextValue = {
    preset,
    setPreset: setThemePreset,
  };

  return <ThemePresetContext.Provider value={value}>{children}</ThemePresetContext.Provider>;
}

export function useThemePreset() {
  const value = use(ThemePresetContext);
  if (!value) {
    throw new Error("useThemePreset must be used within ThemePresetProvider");
  }
  return value;
}
