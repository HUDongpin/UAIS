import { createStudentLessonsHandler } from "@/lib/classroom-lessons/route-handlers";
export const dynamic = "force-dynamic";
export const GET = createStudentLessonsHandler("read");
