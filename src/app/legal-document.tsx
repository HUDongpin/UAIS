"use client";

import { CaretDown } from "@phosphor-icons/react/dist/ssr/CaretDown";
import { useAppPreferences } from "@/components/providers/app-preferences";
import type { Locale } from "@/i18n/copy";

type LegalSection = {
  title: string;
  paragraphs: readonly string[];
};

type LegalDocumentContent = {
  title: string;
  eyebrow: string;
  effectiveDateLabel: string;
  effectiveDateText: string;
  backToLogin: string;
  regionLabel: string;
  intro: string;
  sections: readonly LegalSection[];
};

type LegalDocumentProps = {
  updatedAt: string;
  content: Record<Locale, LegalDocumentContent>;
};

export function LegalDocument({
  updatedAt,
  content,
}: LegalDocumentProps) {
  const { locale, toggleLocale } = useAppPreferences();
  const documentCopy = content[locale];
  const languageLabel = locale === "zh-CN" ? "中文" : "EN";
  const languageAriaLabel = locale === "zh-CN" ? "切换到英文" : "Switch to Chinese";

  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 pt-8 sm:px-6 lg:px-8">
      <div className="mb-7 flex justify-end">
        <button
          type="button"
          onClick={toggleLocale}
          className="inline-flex h-11 items-center gap-2 rounded-full px-3 text-lg font-bold text-[#202640] outline-none transition hover:bg-[#eef4ff] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[#1f6feb] dark:text-[#eef6ff] dark:hover:bg-[#17243a]"
          aria-label={languageAriaLabel}
        >
          {languageLabel}
          <CaretDown size={18} weight="bold" />
        </button>
      </div>

      <section className="border-b border-[#dce6f5] pb-8">
        <p className="text-sm font-semibold uppercase tracking-normal text-[#1f6feb]">
          {documentCopy.eyebrow}
        </p>
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-4xl font-black tracking-normal text-[#141833] dark:text-[#f5f8ff] sm:text-5xl">
              {documentCopy.title}
            </h1>
            <p className="mt-3 text-base font-medium text-[#657089] dark:text-[#b8c7dc]">
              {documentCopy.effectiveDateLabel}
              <time dateTime={updatedAt}>{documentCopy.effectiveDateText}</time>
            </p>
          </div>
          <a
            href="/login"
            className="inline-flex h-11 items-center justify-center rounded-lg border border-[#c9d8ef] bg-white px-4 text-sm font-semibold text-[#1f5fc7] shadow-[0_8px_22px_rgba(42,82,148,0.08)] outline-none transition hover:bg-[#f4f8ff] focus-visible:ring-2 focus-visible:ring-[#1f6feb] dark:border-[#31507a] dark:bg-[#111c2e] dark:text-[#8ab6ff] dark:hover:bg-[#162540]"
          >
            {documentCopy.backToLogin}
          </a>
        </div>
        <div className="mt-7 max-w-3xl text-base leading-8 text-[#39435e] dark:text-[#d7e4f5]">
          <p>{documentCopy.intro}</p>
        </div>
      </section>

      <section className="mt-8 grid gap-4" aria-label={documentCopy.regionLabel}>
        {documentCopy.sections.map((section, index) => (
          <article
            key={section.title}
            className="rounded-lg border border-[#dce6f5] bg-white p-5 shadow-[0_10px_30px_rgba(42,82,148,0.06)] dark:border-[#243b5e] dark:bg-[#111c2e]"
          >
            <p className="text-sm font-bold text-[#1f6feb]">
              {String(index + 1).padStart(2, "0")}
            </p>
            <h2 className="mt-2 text-xl font-bold tracking-normal text-[#17203a] dark:text-[#f5f8ff]">
              {section.title}
            </h2>
            <div className="mt-3 space-y-3 text-base leading-8 text-[#44506a] dark:text-[#d4e0f2]">
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
