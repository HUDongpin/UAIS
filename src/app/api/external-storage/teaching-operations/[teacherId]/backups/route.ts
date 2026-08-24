import {
  createExternalStorageTeachingOperationBackupPostHandler,
} from "@/lib/server/external-storage-route-service";

export const dynamic = "force-dynamic";

const createTeachingOperationBackup =
  createExternalStorageTeachingOperationBackupPostHandler();

export function POST(
  request: Request,
  context: { params: Promise<{ teacherId: string }> },
) {
  return createTeachingOperationBackup(request, context);
}
