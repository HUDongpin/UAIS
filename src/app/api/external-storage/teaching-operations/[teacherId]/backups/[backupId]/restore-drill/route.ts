import {
  createExternalStorageTeachingOperationBackupRestoreDrillPostHandler,
} from "@/lib/server/external-storage-route-service";

export const dynamic = "force-dynamic";

const restoreTeachingOperationBackup =
  createExternalStorageTeachingOperationBackupRestoreDrillPostHandler();

export function POST(
  request: Request,
  context: {
    params: Promise<{ teacherId: string; backupId: string }>;
  },
) {
  return restoreTeachingOperationBackup(request, context);
}
