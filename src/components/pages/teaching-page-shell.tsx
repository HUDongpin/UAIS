"use client";

import dynamic from "next/dynamic";
import { PageLoadingShell } from "@/components/pages/page-loading-shell";

const DynamicTeachingPage = dynamic(
  () => import("@/components/pages/teaching-page").then((module) => module.TeachingPage),
  {
    loading: () => <PageLoadingShell label="Teaching workspace loading" />,
  },
);

export function TeachingPageShell() {
  return <DynamicTeachingPage />;
}
