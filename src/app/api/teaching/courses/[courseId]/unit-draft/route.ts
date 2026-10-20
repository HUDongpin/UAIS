import {
  createTeachingUnitDraftGetHandler,
  createTeachingUnitDraftPatchHandler,
} from "./handler";

export const dynamic = "force-dynamic";

export const GET = createTeachingUnitDraftGetHandler();
export const PATCH = createTeachingUnitDraftPatchHandler();
