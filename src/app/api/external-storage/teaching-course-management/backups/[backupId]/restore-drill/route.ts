import {
  createExternalStorageTeachingCourseManagementBackupRestoreDrillPostHandler,
} from "@/lib/server/external-storage-route-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const restoreTeachingCourseManagementBackup =
  createExternalStorageTeachingCourseManagementBackupRestoreDrillPostHandler();

export function POST(
  request: Request,
  context: { params: Promise<{ backupId: string }> },
) {
  return restoreTeachingCourseManagementBackup(request, context);
}
