import {
  createTeachingCourseCollaboratorGetHandler,
  createTeachingCourseCollaboratorPostHandler,
} from "./handler";

export const dynamic = "force-dynamic";

export const GET = createTeachingCourseCollaboratorGetHandler();
export const POST = createTeachingCourseCollaboratorPostHandler();
