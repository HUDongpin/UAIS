import {
  createTeachingLearningGroupDeleteHandler,
  createTeachingLearningGroupPatchHandler,
} from "./handler";

export const dynamic = "force-dynamic";

export const PATCH = createTeachingLearningGroupPatchHandler();
export const DELETE = createTeachingLearningGroupDeleteHandler();
