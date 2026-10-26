import { createTeacherLessonsHandler } from "@/lib/classroom-lessons/route-handlers";
export const dynamic = "force-dynamic";
export const POST = createTeacherLessonsHandler("publish");
