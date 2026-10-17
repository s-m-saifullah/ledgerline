import { createContext, useEffect, useState } from "react";

export const PrivacyContext = createContext(false);
/** Privacy mode with its setter, for the Settings page (the header eye button changes it too). */
export const PrivacyControlContext = createContext<{
  privateMode: boolean;
  setPrivateMode: (on: boolean) => void;
}>({ privateMode: false, setPrivateMode: () => {} });
/** Whether amounts are typed from the cents (digits fill in from the right), and how to change it. */
export const AmountEntryContext = createContext<{
  centsFirst: boolean;
  setCentsFirst: (on: boolean) => void;
}>({ centsFirst: false, setCentsFirst: () => {} });

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
  const [centsFirst, setCentsFirst] = useState(
    () => localStorage.getItem("ledgerline.centsFirst") === "true",
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
  useEffect(() => {
    localStorage.setItem("ledgerline.centsFirst", String(centsFirst));
  }, [centsFirst]);
  return {
    theme,
    resolvedTheme,
    setTheme,
    privateMode,
    setPrivateMode,
    centsFirst,
    setCentsFirst,
  };
}
