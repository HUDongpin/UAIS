"use client";

import dynamic from "next/dynamic";
import { PageLoadingShell } from "@/components/pages/page-loading-shell";

type LearningPageShellProps = {
  initialCourseId?: string;
  initialClassId?: string;
};

const DynamicLearningPage = dynamic<LearningPageShellProps>(
  () => import("@/components/pages/learning-page").then((module) => module.LearningPage),
  {
    loading: () => <PageLoadingShell label="Learning workspace loading" />,
  },
);

const DynamicLearningChatroomPage = dynamic(
  () => import("@/components/pages/learning-page").then((module) => module.LearningChatroomPage),
  {
    loading: () => <PageLoadingShell label="Learning chatroom loading" />,
  },
);

export function LearningPageShell(props: LearningPageShellProps) {
  return <DynamicLearningPage {...props} />;
}

export function LearningChatroomPageShell() {
  return <DynamicLearningChatroomPage />;
}
