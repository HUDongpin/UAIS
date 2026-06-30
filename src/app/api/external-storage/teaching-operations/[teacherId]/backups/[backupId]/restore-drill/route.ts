import {
  createExternalStorageTeachingOperationBackupRestoreDrillPostHandler,
} from "@/lib/server/external-storage-route-service";

export const dynamic = "force-dynamic";

export const POST =
  createExternalStorageTeachingOperationBackupRestoreDrillPostHandler();
