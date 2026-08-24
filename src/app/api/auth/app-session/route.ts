import {
  createUaisAppSessionDeleteHandler,
  createUaisAppSessionPostHandler,
} from "./handler";

export const dynamic = "force-dynamic";

export const POST = createUaisAppSessionPostHandler();
export const DELETE = createUaisAppSessionDeleteHandler();
