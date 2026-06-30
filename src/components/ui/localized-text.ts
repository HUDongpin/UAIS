import { defaultLocale, type Locale, type LocalizedText } from "@/i18n/copy";

export function localizedText(text: LocalizedText, locale: Locale) {
  return text[locale] ?? text[defaultLocale];
}
