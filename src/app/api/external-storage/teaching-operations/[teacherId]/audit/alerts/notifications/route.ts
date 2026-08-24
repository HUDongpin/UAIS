import {
  createExternalStorageTeachingOperationAuditAlertNotificationsGetHandler,
  createExternalStorageTeachingOperationAuditAlertNotificationsPostHandler,
} from "@/lib/server/external-storage-route-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getAuditAlertNotifications =
  createExternalStorageTeachingOperationAuditAlertNotificationsGetHandler();
const postAuditAlertNotification =
  createExternalStorageTeachingOperationAuditAlertNotificationsPostHandler();

type AuditAlertNotificationsRouteContext = {
  params: Promise<{ teacherId: string }>;
};

export function GET(
  request: Request,
  context: AuditAlertNotificationsRouteContext,
) {
  return getAuditAlertNotifications(request, context);
}

export function POST(
  request: Request,
  context: AuditAlertNotificationsRouteContext,
) {
  return postAuditAlertNotification(request, context);
}
