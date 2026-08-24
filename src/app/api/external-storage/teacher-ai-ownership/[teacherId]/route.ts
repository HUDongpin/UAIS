import {
  createExternalStorageTeacherOwnershipGetHandler,
} from "@/lib/server/external-storage-route-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getTeacherOwnership = createExternalStorageTeacherOwnershipGetHandler();

export function GET(
  request: Request,
  context: { params: Promise<{ teacherId: string }> },
) {
  return getTeacherOwnership(request, context);
}
