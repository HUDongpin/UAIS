import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { cookies } from "next/headers";
import { AppShell } from "@/components/layout/app-shell";
import { AppPreferencesProvider } from "@/components/providers/app-preferences";
import { SessionUserProvider } from "@/components/providers/session-user";
import { resolveThemeMode } from "@/components/providers/theme-mode";
import { defaultLocale, supportedLocales, type Locale } from "@/i18n/copy";
import { getUaisAppSessionUserFromCookieString } from "@/lib/server/uais-app-session";
import "./globals.css";

const metadataByLocale: Record<Locale, Metadata> = {
  "zh-CN": {
    title: "优爱思 | 大学人工智能系统",
    description: "面向大学课程、学习和教学管理的个人教学网站模板。",
    metadataBase: new URL("https://uais.top"),
  },
  "en-US": {
    title: "UAIS | University AI System",
    description:
      "A personal teaching website template for university courses, learning, and teaching management.",
    metadataBase: new URL("https://uais.top"),
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const cookieStore = await cookies();
  return metadataByLocale[getSupportedLocale(cookieStore.get("uais-locale")?.value)];
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const initialLocale = getSupportedLocale(cookieStore.get("uais-locale")?.value);
  const initialTheme = resolveThemeMode(cookieStore.get("uais-theme")?.value);
  const initialSessionUser = getUaisAppSessionUserFromCookieString(
    cookieStore.toString(),
  );

  return (
    <html
      lang={initialLocale}
      data-theme={initialTheme}
      suppressHydrationWarning
      className={`h-full antialiased${initialTheme === "dark" ? " dark" : ""}`}
    >
      <body className="min-h-full">
        <AppPreferencesProvider
          initialLocale={initialLocale}
          initialTheme={initialTheme}
        >
          <SessionUserProvider initialSessionUser={initialSessionUser}>
            <AppShell initialSessionUser={initialSessionUser}>{children}</AppShell>
          </SessionUserProvider>
        </AppPreferencesProvider>
        <Analytics />
      </body>
    </html>
  );
}

function getSupportedLocale(locale: string | undefined): Locale {
  return supportedLocales.includes(locale as Locale) ? (locale as Locale) : defaultLocale;
}
