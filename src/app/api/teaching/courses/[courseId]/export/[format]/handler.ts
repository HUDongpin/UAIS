import { randomUUID } from "node:crypto";
import {
  authorizeTeachingOperationCourseAccess,
  createTeachingCourseCapabilityAdapter,
  createTeachingOperationCourseOwnershipAdapter,
  getTeachingOperationAccessDeniedStatus,
  type GetTeachingOperationCourseOwnership,
  type ReadTeachingCourseCapability,
} from "@/app/api/teaching/operations/course-access";
import {
  createTeachingManagedCourseOwnershipAdapter,
  type ReadManagedTeachingCourseOwnership,
} from "@/lib/server/teacher-managed-course-ownership";
import { resolveUaisTeacherAuthProviderContract } from "@/lib/server/teacher-auth-provider-contract";
import { readUaisAuthenticatedTeacherSessionFromSignedCookies } from "@/lib/server/teacher-auth-session";
import { getUaisAppSessionClaimsFromCookieString } from "@/lib/server/uais-app-session";
import { createTeachingCourseExportPackage } from "@/lib/server/teaching-course-export-package";
import {
  readTeachingCourseExportSource,
  TeachingCourseExportSourceError,
} from "@/lib/server/teaching-course-export-source";
import { TeachingCourseManagementStoreError } from "@/lib/server/teaching-course-management-store";

type ExportRouteContext = { params: Promise<{ courseId: string; format: string }> };
type ExportHandlerDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
  rootDir?: string;
  getTeachingOperationCourseOwnership?: GetTeachingOperationCourseOwnership;
  readManagedCourseOwnership?: ReadManagedTeachingCourseOwnership;
  readTeachingCourseCapability?: ReadTeachingCourseCapability;
  readSource?: typeof readTeachingCourseExportSource;
};

export function createTeachingCourseExportGetHandler(deps: ExportHandlerDeps = {}) {
  const env = deps.env ?? process.env;
  const usesDefaultOwnership = deps.getTeachingOperationCourseOwnership === undefined;
  const getTeachingOperationCourseOwnership = deps.getTeachingOperationCourseOwnership ??
    createTeachingOperationCourseOwnershipAdapter({ env, fetch: deps.fetch });
  const readManagedCourseOwnership = deps.readManagedCourseOwnership ??
    (usesDefaultOwnership ? createTeachingManagedCourseOwnershipAdapter({ env, fetch: deps.fetch }) : undefined);
  const readTeachingCourseCapability = deps.readTeachingCourseCapability ??
    createTeachingCourseCapabilityAdapter({ env, now: deps.now });
  const readSource = deps.readSource ?? readTeachingCourseExportSource;

  return async function GET(request: Request, context: ExportRouteContext) {
    const candidateTrace = request.headers.get("x-uais-trace-id")?.trim();
    const traceId = candidateTrace && isSafeId(candidateTrace) ? candidateTrace : `trace-${randomUUID()}`;
    try {
      const authProviderContract = resolveUaisTeacherAuthProviderContract({ env });
      if (
        (env.NODE_ENV === "production" || env.VERCEL_ENV === "production" || env.UAIS_DEPLOYMENT_ENV === "production") &&
        authProviderContract.productionStatus !== "ready"
      ) {
        return json(503, { error: "UAIS teacher auth provider is not production-ready.", access: denied("teacher-auth-provider-not-production-ready") }, traceId);
      }
      const appClaims = getUaisAppSessionClaimsFromCookieString(request.headers.get("cookie"), { env, now: deps.now });
      if (appClaims?.role === "student") {
        return json(403, { error: "UAIS teacher role is required.", access: denied("teacher-role-required") }, traceId);
      }
      const secret = env.UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET?.trim();
      const authenticatedTeacher = secret
        ? readUaisAuthenticatedTeacherSessionFromSignedCookies({ request, secret, now: deps.now })
        : undefined;
      if (
        !authenticatedTeacher || !isSafeId(authenticatedTeacher.actorId) ||
        !isSafeId(authenticatedTeacher.sessionId)
      ) {
        return json(401, { error: "UAIS teacher authentication is required.", access: denied("authenticated-session-required") }, traceId);
      }
      const { courseId, format } = await context.params;
      if (!isSafeId(courseId) || !["pptx", "resource-zip", "classroom-zip"].includes(format)) {
        return json(400, { error: "The requested course export format or course ID is invalid." }, traceId);
      }
      const access = await authorizeTeachingOperationCourseAccess({
        request, authenticatedTeacher, courseId, operationId: "data-export", actionSlot: "primary",
        getTeachingOperationCourseOwnership, readManagedCourseOwnership, readTeachingCourseCapability,
      });
      if (access.status === "denied") {
        return json(getTeachingOperationAccessDeniedStatus(access.reasonCode), {
          error: "Course export permission is required.", access,
        }, traceId);
      }
      const localeValue = new URL(request.url).searchParams.get("locale");
      if (localeValue !== null && localeValue !== "zh-CN" && localeValue !== "en-US") {
        return json(400, { error: "The requested export locale is invalid." }, traceId);
      }
      const locale = localeValue ?? "zh-CN";
      const source = await readSource({ courseId, locale, env, fetch: deps.fetch, rootDir: deps.rootDir });
      const artifact = await createTeachingCourseExportPackage({
        source, format: format as "pptx" | "resource-zip" | "classroom-zip", locale, now: deps.now,
      });
      // Stream the completed artifact in bounded chunks. A buffered response can
      // exceed the hosting platform's response limit for ordinary narrated decks.
      let offset = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset >= artifact.bytes.byteLength) {
            controller.close();
            return;
          }
          const end = Math.min(offset + 64 * 1024, artifact.bytes.byteLength);
          controller.enqueue(new Uint8Array(artifact.bytes.subarray(offset, end)));
          offset = end;
        },
        cancel() {
          offset = artifact.bytes.byteLength;
        },
      });
      return new Response(stream, {
        status: 200,
        headers: {
          "content-type": artifact.contentType,
          "content-disposition": `attachment; filename="${artifact.filename}"`,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
          "x-uais-trace-id": traceId,
        },
      });
    } catch (error) {
      if (error instanceof TeachingCourseExportSourceError) {
        return json(error.status, { error: error.message, reasonCode: error.reasonCode }, traceId);
      }
      if (error instanceof TeachingCourseManagementStoreError) {
        return json(error.status, { error: "Course export source storage is unavailable." }, traceId);
      }
      return json(500, { error: "Course file export failed." }, traceId);
    }
  };
}

function isSafeId(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value);
}

function denied(reasonCode: string) {
  return { status: "denied", reasonCode };
}

function json(status: number, body: Record<string, unknown>, traceId: string) {
  return Response.json({
    ...body, traceId, redaction: { secrets: "omitted", localFiles: "omitted", assets: "ids-only" },
  }, { status, headers: { "cache-control": "no-store", "x-uais-trace-id": traceId } });
}
