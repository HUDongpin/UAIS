import {
  createExternalStorageLearningChatroomSharesDatabaseGetHandler,
  createExternalStorageLearningChatroomSharesDatabasePutHandler,
} from "@/lib/server/external-storage-route-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = createExternalStorageLearningChatroomSharesDatabaseGetHandler();
export const PUT = createExternalStorageLearningChatroomSharesDatabasePutHandler();
