import type { Metadata } from "next";
import { TeachingPageShell } from "@/components/pages/teaching-page-shell";
import type { Locale } from "@/i18n/copy";
import { getLocalizedRouteMetadata } from "@/lib/server/localized-route-metadata";

const metadataByLocale = {
  "zh-CN": {
    title: "我的教学 | 优爱思",
    description: "教师课程、班级、内容、智能体和数据管理工作台。",
  },
  "en-US": {
    title: "My Teaching | UAIS",
    description: "Teacher workspace for courses, classes, content, AI agents, and data.",
  },
} satisfies Record<Locale, Metadata>;

export function generateMetadata(): Promise<Metadata> {
  return getLocalizedRouteMetadata(metadataByLocale);
}

export default function Page() {
  return <TeachingPageShell />;
}
