import {
  createExternalStorageTeachingCourseAssetsBackupRestoreDrillPostHandler,
} from "@/lib/server/external-storage-route-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const restoreTeachingCourseAssetsBackup =
  createExternalStorageTeachingCourseAssetsBackupRestoreDrillPostHandler();

export function POST(
  request: Request,
  context: { params: Promise<{ backupId: string }> },
) {
  return restoreTeachingCourseAssetsBackup(request, context);
}
