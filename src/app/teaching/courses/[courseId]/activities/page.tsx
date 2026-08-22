import type { Metadata } from "next";
import { TeachingLearningActivitiesPage } from "@/components/pages/teaching-learning-activities-page";

export const metadata: Metadata = {
  title: "Learning Activities | UAIS",
  description: "Publish real formative activities and review trustworthy learning evidence.",
};

export default async function Page({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  return <TeachingLearningActivitiesPage courseId={courseId} />;
}
