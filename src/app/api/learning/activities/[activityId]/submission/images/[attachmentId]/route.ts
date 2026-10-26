import { createSubmissionImageDeleteHandler } from "@/lib/server/submission-image-handlers";
export const dynamic = "force-dynamic";
export const DELETE = Object.assign(createSubmissionImageDeleteHandler(), { createForTesting: createSubmissionImageDeleteHandler });
