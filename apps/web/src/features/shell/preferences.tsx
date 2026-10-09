import { createContext, useEffect, useState } from "react";

export const PrivacyContext = createContext(false);

export type Theme = "light" | "dark" | "system";
/** The saved theme choice, including "system", for the Appearance setting. */
export const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (theme: Theme) => void;
}>({ theme: "system", setTheme: () => {} });
export type Preferences = ReturnType<typeof usePreferences>;
export function usePreferences() {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem("ledgerline.theme");
    return stored === "light" || stored === "dark" ? stored : "system";
  });
  const [privateMode, setPrivateMode] = useState(
    () => localStorage.getItem("ledgerline.privacy") === "true",
  );
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const resolvedTheme =
    theme === "system" ? (systemDark ? "dark" : "light") : theme;
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    localStorage.setItem("ledgerline.theme", theme);
  }, [theme, resolvedTheme]);
  useEffect(() => {
    document.documentElement.dataset.privacy = String(privateMode);
    localStorage.setItem("ledgerline.privacy", String(privateMode));
  }, [privateMode]);
  return { theme, resolvedTheme, setTheme, privateMode, setPrivateMode };
}
