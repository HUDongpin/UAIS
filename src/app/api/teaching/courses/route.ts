import {
  createTeachingCourseGetHandler,
  createTeachingCoursePostHandler,
} from "./handler";

export const dynamic = "force-dynamic";

export const GET = createTeachingCourseGetHandler();
export const POST = createTeachingCoursePostHandler();
