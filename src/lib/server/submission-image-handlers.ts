import { createSubmissionImageStore } from "@/lib/learning-loop/submission-image-store";
import { isSameOriginClassroomRequest } from "./classroom-request-origin";
import { submissionImageByteLimit } from "@/lib/learning-loop/submission-image-policy";
import { LearningLoopStoreError } from "@/lib/learning-loop/postgres-store";
import { authorizeLearningLoopStudentActivity } from "./learning-loop-student-route";
import { authorizeLearningLoopStudentCourse } from "./learning-loop-access";
import { authorizeLearningLoopTeacherSubmission } from "./learning-loop-teacher-route";
import { getUaisAppSessionClaimsFromCookieString } from "./uais-app-session";
import {
  createLearningLoopAccessDeniedResponse, createLearningLoopErrorResponse, createLearningLoopJsonResponse,
  readLearningLoopJsonBody, readLearningLoopRecord, readLearningLoopRevision, readLearningLoopSubmissionVersionId,
  readLearningLoopTraceId,
} from "./learning-loop-route-http";

type ImageStore = ReturnType<typeof createSubmissionImageStore>;
type Deps = {
  env?: Record<string, string | undefined>;
  store?: ImageStore;
  authorizeActivity?: typeof authorizeLearningLoopStudentActivity;
  authorizeStudentCourse?: typeof authorizeLearningLoopStudentCourse;
  authorizeTeacherSubmission?: typeof authorizeLearningLoopTeacherSubmission;
};

export function createSubmissionImagePostHandler(deps: Deps = {}) {
  const env = deps.env ?? process.env;
  return async (request: Request, context: { params: Promise<{ activityId: string }> }) => {
    const traceId = readLearningLoopTraceId(request);
    try {
      if (!isSameOriginClassroomRequest(request)) throw new LearningLoopStoreError(403, "same-origin-required");
      const { activityId } = await context.params;
      const { access } = await (deps.authorizeActivity ?? authorizeLearningLoopStudentActivity)({ request, env, activityId });
      if (access.status === "denied") return createLearningLoopAccessDeniedResponse(access.reasonCode, traceId);
      const form = await readSubmissionImageMultipart(request);
      const file = form.get("image");
      if (!file || typeof file === "string") throw new LearningLoopStoreError(400, "submission-image-required");
      const receipt = await (deps.store ?? createSubmissionImageStore({ env })).upload({
        studentAccount: access.studentAccount, activityId, classExternalId: access.classId,
        submissionVersionId: readLearningLoopSubmissionVersionId(form.get("expectedSubmissionVersionId")),
        expectedDraftRevision: readLearningLoopRevision(form.get("expectedDraftRevision"), "submission-draft-revision-required", 1),
        clientAttachmentId: String(form.get("clientAttachmentId") ?? ""), bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type,
      });
      return createLearningLoopJsonResponse(200, traceId, { status: "persisted", ...receipt });
    } catch (error) { return createLearningLoopErrorResponse(error, traceId, "submission-image-upload-failed"); }
  };
}

export function createSubmissionImageDeleteHandler(deps: Deps = {}) {
  const env = deps.env ?? process.env;
  return async (request: Request, context: { params: Promise<{ activityId: string; attachmentId: string }> }) => {
    const traceId = readLearningLoopTraceId(request);
    try {
      const { activityId, attachmentId } = await context.params;
      if (!isSameOriginClassroomRequest(request)) throw new LearningLoopStoreError(403, "same-origin-required");
      const { access } = await (deps.authorizeActivity ?? authorizeLearningLoopStudentActivity)({ request, env, activityId });
      if (access.status === "denied") return createLearningLoopAccessDeniedResponse(access.reasonCode, traceId);
      const body = readLearningLoopRecord(await readLearningLoopJsonBody(request, 4000));
      const receipt = await (deps.store ?? createSubmissionImageStore({ env })).remove({
        studentAccount: access.studentAccount, activityId, classExternalId: access.classId, attachmentId,
        submissionVersionId: readLearningLoopSubmissionVersionId(body.expectedSubmissionVersionId),
        expectedDraftRevision: readLearningLoopRevision(body.expectedDraftRevision, "submission-draft-revision-required", 1),
      });
      return createLearningLoopJsonResponse(200, traceId, receipt);
    } catch (error) { return createLearningLoopErrorResponse(error, traceId, "submission-image-remove-failed"); }
  };
}

export function createSubmissionImageGetHandler(deps: Deps = {}) {
  const env = deps.env ?? process.env;
  return async (request: Request, context: { params: Promise<{ attachmentId: string }> }) => {
    const traceId = readLearningLoopTraceId(request);
    try {
      const claims = getUaisAppSessionClaimsFromCookieString(request.headers.get("cookie"), { env });
      if (!claims || (claims.role !== "student" && claims.role !== "teacher")) return createLearningLoopAccessDeniedResponse("app-session-required", traceId);
      const { attachmentId } = await context.params;
      const image = await (deps.store ?? createSubmissionImageStore({ env })).read({ attachmentId, actorAccount: claims.account, role: claims.role });
      if (claims.role === "student") {
        const access = await (deps.authorizeStudentCourse ?? authorizeLearningLoopStudentCourse)({ request, env, courseId: image.courseId, classId: image.classId });
        if (access.status === "denied") return createLearningLoopAccessDeniedResponse(access.reasonCode, traceId);
        if (access.classId !== image.classId) return createLearningLoopAccessDeniedResponse("student-activity-membership-required", traceId);
      } else {
        const { access } = await (deps.authorizeTeacherSubmission ?? authorizeLearningLoopTeacherSubmission)({ request, env, submissionId: image.submissionId });
        if (access.status === "denied") return createLearningLoopAccessDeniedResponse(access.reasonCode, traceId);
      }
      return new Response(new Uint8Array(image.bytes), { headers: {
        "content-type": image.attachment.mime, "content-length": String(image.bytes.length),
        "cache-control": "private, no-store", "x-content-type-options": "nosniff",
        "content-disposition": `inline; filename="submission-image-${image.attachment.id}.${image.attachment.mime === "image/png" ? "png" : "jpg"}"`,
      } });
    } catch (error) { return createLearningLoopErrorResponse(error, traceId, "submission-image-read-failed"); }
  };
}

export async function readSubmissionImageMultipart(request: Request) {
  const type = request.headers.get("content-type") ?? "";
  if (!type.startsWith("multipart/form-data;")) throw new LearningLoopStoreError(400, "submission-image-multipart-required");
  const limit = submissionImageByteLimit + 32_768;
  if (Number(request.headers.get("content-length") ?? 0) > limit) throw new LearningLoopStoreError(413, "submission-image-too-large");
  if (!request.body) throw new LearningLoopStoreError(400, "submission-image-required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) { await reader.cancel(); throw new LearningLoopStoreError(413, "submission-image-too-large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let form: FormData;
  try { form = await new Response(Buffer.concat(chunks), { headers: { "content-type": type } }).formData(); }
  catch { throw new LearningLoopStoreError(400, "submission-image-multipart-invalid"); }
  const allowed = new Set(["image", "expectedSubmissionVersionId", "expectedDraftRevision", "clientAttachmentId"]);
  const seen = new Set<string>();
  for (const [key] of form.entries()) {
    if (!allowed.has(key) || seen.has(key)) throw new LearningLoopStoreError(400, "submission-image-fields-invalid");
    seen.add(key);
  }
  if (seen.size !== allowed.size) throw new LearningLoopStoreError(400, "submission-image-fields-invalid");
  return form;
}
