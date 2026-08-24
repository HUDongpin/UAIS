import {
  createExternalStorageTeachingOperationRollbackPostHandler,
} from "@/lib/server/external-storage-route-service";

export const dynamic = "force-dynamic";

const rollbackTeachingOperation =
  createExternalStorageTeachingOperationRollbackPostHandler();

export function POST(
  request: Request,
  context: {
    params: Promise<{ teacherId: string; recordId: string }>;
  },
) {
  return rollbackTeachingOperation(request, context);
}
