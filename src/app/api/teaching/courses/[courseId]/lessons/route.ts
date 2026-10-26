import { createTeacherLessonsHandler } from "@/lib/classroom-lessons/route-handlers";
export const dynamic = "force-dynamic";
export const GET = createTeacherLessonsHandler("list");
export const POST = createTeacherLessonsHandler("import");
