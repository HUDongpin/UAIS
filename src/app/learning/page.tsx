import type { Metadata } from "next";
import { LearningPageShell } from "@/components/pages/learning-page-shell";
import type { Locale } from "@/i18n/copy";
import { getLocalizedRouteMetadata } from "@/lib/server/localized-route-metadata";

const metadataByLocale = {
  "zh-CN": {
    title: "我的学习 | 优爱思",
    description: "学习进度、课程播放、字幕、笔记和 AI 导学工作区。",
  },
  "en-US": {
    title: "My Learning | UAIS",
    description: "Learning workspace for progress, playback, subtitles, notes, and AI guidance.",
  },
} satisfies Record<Locale, Metadata>;

type LearningRouteSearchParams = Promise<{
  courseId?: string | string[] | undefined;
  classId?: string | string[] | undefined;
}>;

export function generateMetadata(): Promise<Metadata> {
  return getLocalizedRouteMetadata(metadataByLocale);
}

function getFirstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Page({
  searchParams,
}: {
  searchParams?: LearningRouteSearchParams;
} = {}) {
  const query = searchParams ? await searchParams : {};

  return (
    <LearningPageShell
      initialCourseId={getFirstQueryValue(query.courseId)}
      initialClassId={getFirstQueryValue(query.classId)}
    />
  );
}
