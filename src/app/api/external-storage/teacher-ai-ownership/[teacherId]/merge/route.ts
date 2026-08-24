import {
  createExternalStorageTeacherOwnershipMergePostHandler,
} from "@/lib/server/external-storage-route-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const mergeTeacherOwnership = createExternalStorageTeacherOwnershipMergePostHandler();

export function POST(
  request: Request,
  context: { params: Promise<{ teacherId: string }> },
) {
  return mergeTeacherOwnership(request, context);
}
