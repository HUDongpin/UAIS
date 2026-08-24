import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { cookies } from "next/headers";
import { AppShell } from "@/components/layout/app-shell";
import { AppPreferencesProvider } from "@/components/providers/app-preferences";
import { SessionUserProvider } from "@/components/providers/session-user";
import { resolveThemeMode } from "@/components/providers/theme-mode";
import { UaisStagingInpReporter } from "@/components/observability/uais-staging-inp-reporter";
import { defaultLocale, supportedLocales, type Locale } from "@/i18n/copy";
import { getUaisAppSessionUserFromCookieString } from "@/lib/server/uais-app-session";
import { isApprovedUaisStagingInpOperator } from "@/lib/server/uais-staging-inp-access";
import {
  getUaisStagingInpBinding,
  getUaisStagingInpGuard,
} from "@/lib/server/uais-staging-inp-runtime";
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
  // `process.env` is not optional here. Without it the helper falls back to
  // `{}`, and an empty env reads as a NON-deployed runtime, so the signature is
  // verified against the committed development secret instead of the configured
  // one. Production cookies are signed with the configured secret, so every
  // verification failed, every render saw a null session, and the header dressed
  // every signed-in user - teacher, student, admin - in the same anonymous
  // fallback. Every other server caller on this module already passes its env.
  const initialSessionUser = getUaisAppSessionUserFromCookieString(
    cookieStore.toString(),
    { env: process.env },
  );
  const stagingInpGuard = getUaisStagingInpGuard(process.env);
  const stagingInpBinding = stagingInpGuard.enabled
    ? getUaisStagingInpBinding(process.env)
    : null;
  const stagingInpRoleEligible =
    initialSessionUser?.role === "student" || initialSessionUser?.role === "teacher";
  const stagingInpEnabled =
    stagingInpGuard.enabled &&
    stagingInpBinding !== null &&
    stagingInpRoleEligible &&
    initialSessionUser !== null &&
    isApprovedUaisStagingInpOperator(initialSessionUser.account, process.env);

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
        {stagingInpEnabled ? <UaisStagingInpReporter enabled /> : null}
        <Analytics />
      </body>
    </html>
  );
}

function getSupportedLocale(locale: string | undefined): Locale {
  return supportedLocales.includes(locale as Locale) ? (locale as Locale) : defaultLocale;
}
