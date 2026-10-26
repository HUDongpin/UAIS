import { createSubmissionImageGetHandler } from "@/lib/server/submission-image-handlers";
export const dynamic = "force-dynamic";
export const GET = Object.assign(createSubmissionImageGetHandler(), { createForTesting: createSubmissionImageGetHandler });
