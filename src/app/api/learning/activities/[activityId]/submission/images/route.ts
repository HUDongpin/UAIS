import { createSubmissionImagePostHandler } from "@/lib/server/submission-image-handlers";
export const dynamic = "force-dynamic";
export const POST = Object.assign(createSubmissionImagePostHandler(), { createForTesting: createSubmissionImagePostHandler });
