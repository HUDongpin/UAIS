import { draftRequestByteLimit } from "@/lib/teaching/unit-draft-media";
import {
  assertProductionTeachingOperationCourseOwnershipAccessConfigured,
  authorizeTeachingOperationCourseAccess,
  createTeachingCourseCapabilityAdapter,
  createTeachingOperationCourseOwnershipAdapter,
  getTeachingOperationAccessDeniedError,
  getTeachingOperationAccessDeniedStatus,
  type GetTeachingOperationCourseOwnership,
  type ReadTeachingCourseCapability,
} from "@/app/api/teaching/operations/course-access";
import {
  isRecord,
  isTeachingOperationProductionRuntime,
  jsonResponse,
} from "@/app/api/teaching/operations/route-utils";
import { resolveUaisTeacherAuthProviderContract } from "@/lib/server/teacher-auth-provider-contract";
import { readUaisAuthenticatedTeacherSessionFromSignedCookies } from "@/lib/server/teacher-auth-session";
import {
  createTeachingManagedCourseOwnershipAdapter,
  type ReadManagedTeachingCourseOwnership,
} from "@/lib/server/teacher-managed-course-ownership";
import { runWithTeachingCourseManagementDelegatedAuthorization } from "@/lib/server/teaching-course-management-authorization";
import { TeachingCourseManagementStoreError } from "@/lib/server/teaching-course-management-error";
import { createUaisTeachingCourseManagementRepository } from "@/lib/server/teaching-course-management-external-store";
import {
  assertTeachingCourseManagementLocalJsonRuntimeAllowed,
  resolveTeachingCourseManagementDataDir,
} from "@/lib/server/teaching-course-management-store";
import { TeachingOperationStoreError } from "@/lib/server/teaching-operations-store";
import {
  readTeachingUnitDraft,
  updateTeachingUnitDraft,
} from "@/lib/server/teaching-unit-draft-store";
import { getUaisAppSessionClaimsFromCookieString } from "@/lib/server/uais-app-session";

type TeachingUnitDraftRouteContext = {
  params: Promise<{ courseId: string }>;
};

type TeachingUnitDraftHandlerDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
  getTeachingOperationCourseOwnership?: GetTeachingOperationCourseOwnership;
  readManagedCourseOwnership?: ReadManagedTeachingCourseOwnership;
  readTeachingCourseCapability?: ReadTeachingCourseCapability;
};

const maxBodyBytes = draftRequestByteLimit;

export function createTeachingUnitDraftGetHandler(deps: TeachingUnitDraftHandlerDeps = {}) {
  return createTeachingUnitDraftHandler("GET", deps);
}

export function createTeachingUnitDraftPatchHandler(deps: TeachingUnitDraftHandlerDeps = {}) {
  return createTeachingUnitDraftHandler("PATCH", deps);
}

function createTeachingUnitDraftHandler(
  method: "GET" | "PATCH",
  deps: TeachingUnitDraftHandlerDeps,
) {
  const env = deps.env ?? process.env;
  return async (request: Request, context: TeachingUnitDraftRouteContext) => {
    try {
      const appClaims = getUaisAppSessionClaimsFromCookieString(request.headers.get("cookie"), {
        env,
        now: deps.now,
      });
      if (appClaims && appClaims.role !== "teacher") {
        return jsonResponse(403, { error: "UAIS teacher role is required." });
      }
      const secret = env.UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET?.trim();
      const teacher = secret
        ? readUaisAuthenticatedTeacherSessionFromSignedCookies({ request, secret, now: deps.now })
        : undefined;
      if (
        !teacher ||
        teacher.role !== "teacher" ||
        !isSafeId(teacher.actorId) ||
        !isSafeId(teacher.sessionId)
      ) {
        return jsonResponse(401, { error: "UAIS teacher authentication is required." });
      }
      if (
        isTeachingOperationProductionRuntime(env) &&
        resolveUaisTeacherAuthProviderContract({ env }).productionStatus !== "ready"
      ) {
        return jsonResponse(503, { error: "UAIS teacher auth provider is not production-ready." });
      }

      const { courseId } = await context.params;
      const repository = createUaisTeachingCourseManagementRepository({ env, fetch: deps.fetch });
      if (!repository) {
        assertTeachingCourseManagementLocalJsonRuntimeAllowed(env);
      }
      const getTeachingOperationCourseOwnership = deps.getTeachingOperationCourseOwnership ??
        createTeachingOperationCourseOwnershipAdapter({ env, fetch: deps.fetch });
      if (!deps.getTeachingOperationCourseOwnership) {
        assertProductionTeachingOperationCourseOwnershipAccessConfigured({
          env,
          courseId,
          getTeachingOperationCourseOwnership,
        });
      }
      const access = await authorizeTeachingOperationCourseAccess({
        request,
        authenticatedTeacher: teacher,
        courseId,
        operationId: "content",
        actionSlot: "secondary",
        getTeachingOperationCourseOwnership,
        readManagedCourseOwnership: deps.readManagedCourseOwnership ??
          createTeachingManagedCourseOwnershipAdapter({ env, fetch: deps.fetch }),
        readTeachingCourseCapability: deps.readTeachingCourseCapability ??
          createTeachingCourseCapabilityAdapter({ env, now: deps.now }),
      });
      if (access.status === "denied") {
        return jsonResponse(getTeachingOperationAccessDeniedStatus(access.reasonCode), {
          error: getTeachingOperationAccessDeniedError(access.reasonCode),
          reasonCode: access.reasonCode,
        });
      }
      const dataDir = resolveTeachingCourseManagementDataDir(env.UAIS_TEACHING_COURSES_DATA_DIR);
      const readOrUpdate = async () => {
        if (method === "GET") {
          return readTeachingUnitDraft({
            dataDir,
            repository,
            actorId: teacher.actorId,
            courseId,
          });
        }
        const body = await readJsonBody(request);
        if (
          !isRecord(body) ||
          typeof body.expectedRevision !== "number" ||
          !Number.isSafeInteger(body.expectedRevision) ||
          body.expectedRevision < 0
        ) {
          throw new TeachingCourseManagementStoreError(400, "Unit draft revision is required.");
        }
        return updateTeachingUnitDraft({
          dataDir,
          repository,
          actorId: teacher.actorId,
          courseId,
          content: body.content,
          expectedRevision: body.expectedRevision,
          now: deps.now,
        });
      };
      const delegatedAuthorization = access.reasonCode === "collaborator-exact-scope"
        ? access.delegatedAuthorization
        : undefined;
      if (access.reasonCode === "collaborator-exact-scope" && !delegatedAuthorization) {
        return jsonResponse(403, { error: "Verified course content authorization is required." });
      }
      const unitDraft = delegatedAuthorization
        ? await runWithTeachingCourseManagementDelegatedAuthorization(
            delegatedAuthorization,
            readOrUpdate,
          )
        : await readOrUpdate();
      return unitDraft
        ? jsonResponse(200, { unitDraft })
        : jsonResponse(404, { error: "Teaching unit draft was not found." });
    } catch (error) {
      if (
        error instanceof TeachingCourseManagementStoreError ||
        error instanceof TeachingOperationStoreError
      ) {
        return jsonResponse(error.status, {
          error: error.status < 500 ? error.message : "Teaching unit draft service is unavailable.",
          ...(error.reasonCode ? { reasonCode: error.reasonCode } : {}),
        });
      }
      return jsonResponse(500, { error: "Teaching unit draft request failed." });
    }
  };
}

function isSafeId(value: string) {
  return value.length <= 120 && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value);
}

async function readJsonBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > maxBodyBytes) {
    throw new TeachingCourseManagementStoreError(413, "Unit draft request body is too large.");
  }
  const reader = request.body?.getReader();
  if (!reader) {
    throw new TeachingCourseManagementStoreError(400, "Unit draft request body is required.");
  }
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBodyBytes) {
        await reader.cancel();
        throw new TeachingCourseManagementStoreError(413, "Unit draft request body is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new TeachingCourseManagementStoreError(400, "Unit draft request body must be JSON.");
  }
}
