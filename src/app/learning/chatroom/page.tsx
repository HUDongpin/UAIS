import type { Metadata } from "next";
import { LearningChatroomPageShell } from "@/components/pages/learning-page-shell";
import type { Locale } from "@/i18n/copy";
import { getLocalizedRouteMetadata } from "@/lib/server/localized-route-metadata";

const metadataByLocale = {
  "zh-CN": {
    title: "人机协作聊天室 | 优爱思",
    description: "学生小组与 AI 智能体协作、导出和分享学习记录。",
  },
  "en-US": {
    title: "Human-AI Chatroom | UAIS",
    description: "Student group chat with AI agents, export, and share workflows.",
  },
} satisfies Record<Locale, Metadata>;

export function generateMetadata(): Promise<Metadata> {
  return getLocalizedRouteMetadata(metadataByLocale);
}

export default function Page() {
  return <LearningChatroomPageShell />;
}
