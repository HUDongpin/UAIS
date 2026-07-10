import type { Metadata } from "next";
import { cookies } from "next/headers";
import { defaultLocale, supportedLocales, type Locale } from "@/i18n/copy";

export async function getLocalizedRouteMetadata(
  metadataByLocale: Record<Locale, Metadata>,
): Promise<Metadata> {
  const cookieStore = await cookies();
  const locale = cookieStore.get("uais-locale")?.value;
  return metadataByLocale[getSupportedLocale(locale)];
}

function getSupportedLocale(locale: string | undefined): Locale {
  return supportedLocales.includes(locale as Locale) ? (locale as Locale) : defaultLocale;
}
