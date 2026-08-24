import {
  createExternalStorageTeachingOperationAuditAlertsGetHandler,
} from "@/lib/server/external-storage-route-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getTeachingOperationAuditAlerts =
  createExternalStorageTeachingOperationAuditAlertsGetHandler();

export function GET(
  request: Request,
  context: { params: Promise<{ teacherId: string }> },
) {
  return getTeachingOperationAuditAlerts(request, context);
}
