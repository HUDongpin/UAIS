import {
  createTeachingOperationAuditAlertNotificationsGetHandler,
  createTeachingOperationAuditAlertNotificationsPostHandler,
} from "./handler";

export const dynamic = "force-dynamic";

export const POST = createTeachingOperationAuditAlertNotificationsPostHandler();
export const GET = createTeachingOperationAuditAlertNotificationsGetHandler();
