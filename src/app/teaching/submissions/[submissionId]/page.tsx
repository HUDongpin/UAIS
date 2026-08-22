import type { Metadata } from "next";
import { TeachingSubmissionReviewPage } from "@/components/pages/teaching-submission-review-page";

export const metadata: Metadata = {
  title: "Review Submission | UAIS",
  description: "Review a sealed learning-evidence version and release teacher-confirmed feedback.",
};

export default async function Page({ params }: { params: Promise<{ submissionId: string }> }) {
  const { submissionId } = await params;
  return <TeachingSubmissionReviewPage submissionId={submissionId} />;
}
