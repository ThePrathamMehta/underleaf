"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type ThemeMode = "light" | "dark" | "system";

type ThemeState = {
  /** The user's stored preference, including "system". */
  mode: ThemeMode;
  /** What's actually applied right now, after resolving "system". */
  resolved: "light" | "dark";
  setMode: (mode: ThemeMode) => void;
  /** Convenience for a two-state toggle: flips the *resolved* appearance. */
  toggle: () => void;
};

const STORAGE_KEY = "underleaf-theme";

const ThemeContext = createContext<ThemeState | null>(null);

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolve(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") return systemPrefersDark() ? "dark" : "light";
  return mode;
}

/** Adds/removes the `.dark` class the Tailwind class strategy keys off. */
function apply(resolved: "light" | "dark") {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}

/**
 * App-chrome theme. Persists the choice to localStorage; defaults to the OS
 * setting until the user picks. The inline script in app/layout.tsx applies the
 * class before first paint so there's no light-mode flash on load — this
 * provider only keeps React in sync and reacts to later changes.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Initialise from what the pre-paint script already decided, so state and DOM
  // agree on the very first render.
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as ThemeMode | null) ?? "system";
    setModeState(stored);
    setResolved(resolve(stored));
  }, []);

  // Follow the OS while the preference is "system".
  useEffect(() => {
    if (mode !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const next = media.matches ? "dark" : "light";
      setResolved(next);
      apply(next);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    localStorage.setItem(STORAGE_KEY, next);
    const nextResolved = resolve(next);
    setResolved(nextResolved);
    apply(nextResolved);
  }, []);

  const toggle = useCallback(() => {
    setMode(resolve(mode) === "dark" ? "light" : "dark");
  }, [mode, setMode]);

  return (
    <ThemeContext.Provider value={{ mode, resolved, setMode, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeState {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within a ThemeProvider");
  return context;
}
