import { createCourseRetentionHandlers } from "./handler";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const handlers = createCourseRetentionHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;
