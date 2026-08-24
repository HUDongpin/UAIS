import {
  createExternalStorageTeachingOperationAuditGetHandler,
} from "@/lib/server/external-storage-route-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getTeachingOperationAudit = createExternalStorageTeachingOperationAuditGetHandler();

export function GET(
  request: Request,
  context: { params: Promise<{ teacherId: string }> },
) {
  return getTeachingOperationAudit(request, context);
}
