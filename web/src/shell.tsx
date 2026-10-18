// Theme persistence (light / dark), shared by the Studio page and its side maps.
import { useEffect, useState } from "react";

export type Theme = "light" | "dark";
const KEY = "ocean-studio-theme";
export function initialTheme(): Theme {
  const saved = localStorage.getItem(KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
export function applyTheme(t: Theme) { document.documentElement.dataset.theme = t; }
applyTheme(initialTheme());

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => { applyTheme(theme); localStorage.setItem(KEY, theme); window.dispatchEvent(new CustomEvent("ocean-studio-theme", { detail: theme })); }, [theme]);
  useEffect(() => {
    const sync = (e: StorageEvent) => { if (e.key === KEY && (e.newValue === "light" || e.newValue === "dark")) setTheme(e.newValue); };
    window.addEventListener("storage", sync); return () => window.removeEventListener("storage", sync);
  }, []);
  return [theme, () => setTheme(t => (t === "dark" ? "light" : "dark"))] as const;
}
