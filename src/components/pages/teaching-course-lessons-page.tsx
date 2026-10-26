"use client";
import Link from "next/link";
import { useAppPreferences } from "@/components/providers/app-preferences";
import { TeachingLessonsWorkspace } from "./teaching-lessons-workspace";
export function TeachingCourseLessonsPage({ courseId }: { courseId: string }) {
  const { locale } = useAppPreferences();
  return (
    <main className="space-y-5">
      <Link
        href="/teaching"
        className="text-sm font-semibold text-[var(--accent)] underline"
      >
        {locale === "zh-CN" ? "返回我的教学" : "Back to My Teaching"}
      </Link>
      <TeachingLessonsWorkspace courseId={courseId} locale={locale} />
    </main>
  );
}
