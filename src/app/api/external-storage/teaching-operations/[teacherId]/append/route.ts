import {
  createExternalStorageTeachingOperationAppendPostHandler,
} from "@/lib/server/external-storage-route-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const appendTeachingOperation = createExternalStorageTeachingOperationAppendPostHandler();

export function POST(
  request: Request,
  context: { params: Promise<{ teacherId: string }> },
) {
  return appendTeachingOperation(request, context);
}
