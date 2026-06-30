import {
  createExternalStorageLifecycleAuditGetHandler,
  createExternalStorageLifecycleAuditPostHandler,
} from "@/lib/server/external-storage-route-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = createExternalStorageLifecycleAuditGetHandler();
export const POST = createExternalStorageLifecycleAuditPostHandler();
