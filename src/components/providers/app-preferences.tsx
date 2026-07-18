"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { defaultLocale, type Locale } from "@/i18n/copy";
import { defaultThemeMode, type ThemeMode } from "./theme-mode";

type AppPreferences = {
  locale: Locale;
  theme: ThemeMode;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  toggleTheme: () => void;
};

const AppPreferencesContext = createContext<AppPreferences | null>(null);
const localeCookieName = "uais-locale";
const themeCookieName = "uais-theme";
const themeStorageKey = "uais-theme";
const preferenceCookieMaxAgeSeconds = 60 * 60 * 24 * 365;

export function AppPreferencesProvider({
  children,
  initialLocale = defaultLocale,
  initialTheme = defaultThemeMode,
}: {
  children: ReactNode;
  initialLocale?: Locale;
  initialTheme?: ThemeMode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  // Theme is seeded from the server-resolved value (the `uais-theme` cookie,
  // read in `layout.tsx`), exactly like locale. Seeding from the prop rather
  // than from `localStorage`/`matchMedia` keeps the first client render equal
  // to the server render, so the header toggle icon and the `<html>` `dark`
  // class no longer produce a hydration mismatch or a theme flash.
  const [theme, setTheme] = useState<ThemeMode>(initialTheme);

  useEffect(() => {
    document.documentElement.lang = locale;
    window.localStorage.setItem(localeCookieName, locale);
    document.cookie = `${localeCookieName}=${locale}; path=/; max-age=${preferenceCookieMaxAgeSeconds}; SameSite=Lax`;
  }, [locale]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(themeStorageKey, theme);
    // Persist the choice to a route-readable cookie so the next server render
    // resolves the same theme (mirrors the locale cookie).
    document.cookie = `${themeCookieName}=${theme}; path=/; max-age=${preferenceCookieMaxAgeSeconds}; SameSite=Lax`;
  }, [theme]);

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale);
  }, []);

  const toggleLocale = useCallback(() => {
    setLocaleState((current) => (current === "zh-CN" ? "en-US" : "zh-CN"));
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "light" ? "dark" : "light"));
  }, []);

  const value = useMemo(
    () => ({
      locale,
      theme,
      setLocale,
      toggleLocale,
      toggleTheme,
    }),
    [locale, setLocale, theme, toggleLocale, toggleTheme],
  );

  return (
    <AppPreferencesContext.Provider value={value}>
      {children}
    </AppPreferencesContext.Provider>
  );
}

export function useAppPreferences() {
  const context = useContext(AppPreferencesContext);
  if (!context) {
    throw new Error("useAppPreferences must be used inside AppPreferencesProvider");
  }
  return context;
}
