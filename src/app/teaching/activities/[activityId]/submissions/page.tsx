import type { Metadata } from "next";
import { TeachingSubmissionQueuePage } from "@/components/pages/teaching-submission-queue-page";

export const metadata: Metadata = {
  title: "Submission Queue | UAIS",
  description: "Review real formative learning submissions.",
};

export default async function Page({ params }: { params: Promise<{ activityId: string }> }) {
  const { activityId } = await params;
  return <TeachingSubmissionQueuePage activityId={activityId} />;
}
