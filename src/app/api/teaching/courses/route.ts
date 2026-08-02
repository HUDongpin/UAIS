import { randomUUID } from "node:crypto";
import {
  assertTeachingCourseManagementLocalJsonRuntimeAllowed,
  createTeachingCourseRecord,
  readTeachingCourseManagementSnapshot,
  resolveTeachingCourseManagementDataDir,
  rollbackTeachingCourseCreation,
  TeachingCourseManagementStoreError,
  type TeachingClassMembershipRecord,
  type TeachingClassRecord,
  type TeachingCourseManagementDatabase,
  type TeachingCourseDraftInput,
  type TeachingCourseManagementAuthSessionSummary,
  type TeachingCourseManagementRepository,
  type TeachingCourseRecord,
} from "@/lib/server/teaching-course-management-store";
import { createUaisTeachingCourseManagementRepository } from "@/lib/server/teaching-course-management-external-store";
import {
  assertTeachingCourseAssetsLocalJsonRuntimeAllowed,
  readTeachingCourseAssetsSnapshot,
  resolveTeachingCourseAssetsDataDir,
  TeachingCourseAssetsStoreError,
  type TeachingCourseAssetsRepository,
} from "@/lib/server/teaching-course-assets-store";
import { createUaisTeachingCourseAssetsRepository } from "@/lib/server/teaching-course-assets-external-store";
import {
  createUaisTeacherAiOwnershipMergeAdapter,
  type UaisTeacherAiOwnershipMergeInput,
  type UaisTeacherAiOwnershipMergeResult,
} from "@/lib/server/teacher-ai-ownership-store";
import { resolveUaisTeacherAuthProviderContract } from "@/lib/server/teacher-auth-provider-contract";
import { readUaisAuthenticatedTeacherSessionFromSignedCookies } from "@/lib/server/teacher-auth-session";
import { resolveUaisAppAuthProviderContract } from "@/lib/server/uais-app-auth-provider";
import { getUaisAppSessionClaimsFromCookieString } from "@/lib/server/uais-app-session";

export const dynamic = "force-dynamic";

type TeachingCoursePostHandlerDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
  mergeTeacherAiOwnershipRecord?: (
    input: UaisTeacherAiOwnershipMergeInput,
  ) => Promise<UaisTeacherAiOwnershipMergeResult>;
};

type TeachingCourseGetHandlerDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
  hasTrustedAccountProvider?: boolean;
};

type AuthenticatedTeacher = {
  actorId: string;
  role: "teacher";
  authSource: "signed-teacher-session" | "app-session";
  authSession: TeachingCourseManagementAuthSessionSummary;
};

type AuthenticatedStudent = {
  actorId: string;
  role: "student";
};

type TeachingCourseCreateValidationReason =
  | "body-required"
  | "body-too-large"
  | "body-malformed-json"
  | "body-not-object"
  | "missing-field";

type TeachingCourseCreateValidation = {
  target: "teaching-course-create";
  status: "invalid";
  reasonCode: TeachingCourseCreateValidationReason;
  field: string;
  maxBytes?: number;
  responsibleSession: "S12";
  redaction: ReturnType<typeof createRedaction>;
};

const maxBodyBytes = 50_000;

const studentVisibleMembershipStatuses = new Set<
  TeachingClassMembershipRecord["membershipStatus"]
>(["approved", "pending-teacher-review"]);

// Student-visible projections of the teacher-owned course/class/membership records.
// Students never receive the raw records: a class's live `invitationCode`/`joinUrl`
// is the teacher's access-granting credential, and `ownerTeacherId`/roster counts/
// course description are teacher-only metadata. Applied uniformly to approved AND
// pending memberships, so squatting a pending membership cannot be used to read a
// class's current invite code, and republishing a code actually revokes it.
type StudentVisibleCourse = {
  courseId: string;
  courseName: string;
  semester: string;
};

type StudentVisibleClass = {
  classId: string;
  courseId: string;
  className: string;
  semester: string;
};

// A membership row is projected down to exactly the fields the student surfaces
// read (student dashboard: membershipId/courseId/classId/membershipStatus/
// joinedAt/approvedAt; learning page: courseId/classId/membershipStatus). The
// dropped fields are teacher-side or credential-bearing: `invitationCode` is the
// join-time class credential, `approvedByTeacherId` is the approving teacher's
// actor id (in practice the same value as the `ownerTeacherId` the course/class
// projections exist to remove), and `studentId`/`studentDisplayName`/
// `storagePolicy`/`storageWritePolicy`/`responsibleSession`/`redaction` are
// roster and storage metadata no student surface reads.
type StudentVisibleMembership = {
  membershipId: string;
  courseId: string;
  classId: string;
  membershipStatus: TeachingClassMembershipRecord["membershipStatus"];
  joinedAt: string;
  approvedAt?: string;
};

export const GET = createTeachingCourseGetHandler();
export const POST = createTeachingCoursePostHandler();

export function createTeachingCourseGetHandler(deps: TeachingCourseGetHandlerDeps = {}) {
  const env = deps.env ?? process.env;

  return async function GET(request: Request) {
    const traceId = readSafeTraceId(request);
    try {
      const authenticatedStudent = readAuthenticatedStudent({
        request,
        env,
        now: deps.now,
      });
      const authenticatedTeacher = authenticatedStudent
        ? undefined
        : readAuthenticatedTeacher({
            request,
            env,
            now: deps.now,
          }) ??
          readAuthenticatedAppSessionTeacher({
            request,
            env,
            now: deps.now,
          });
      if (!authenticatedTeacher && !authenticatedStudent) {
        return jsonResponse(401, {
          error: "UAIS teacher or student authentication is required.",
          traceId,
          access: createDeniedAccess("authenticated-session-required"),
          redaction: createRedaction(),
        }, traceId);
      }
      if (authenticatedTeacher) {
        const authProviderContract =
          authenticatedTeacher.authSource === "signed-teacher-session"
            ? resolveUaisTeacherAuthProviderContract({ env })
            : resolveUaisAppAuthProviderContract({
                env,
                hasTrustedAccountProvider: Boolean(deps.hasTrustedAccountProvider),
              });
        if (
          isTeachingCourseApiProductionRuntime(env) &&
          authProviderContract.productionStatus !== "ready"
        ) {
          return jsonResponse(503, {
            error: "UAIS teacher auth provider is not production-ready.",
            traceId,
            access: createDeniedAccess(
              "teacher-auth-provider-not-production-ready",
              authenticatedTeacher,
            ),
            authProviderContract,
            redaction: createRedaction(),
          }, traceId);
        }
      }
      if (authenticatedStudent) {
        const authProviderContract = resolveUaisAppAuthProviderContract({
          env,
          hasTrustedAccountProvider: Boolean(deps.hasTrustedAccountProvider),
        });
        if (
          isTeachingCourseApiProductionRuntime(env) &&
          authProviderContract.productionStatus !== "ready"
        ) {
          return jsonResponse(503, {
            error: "UAIS app auth provider is not production-ready.",
            traceId,
            access: createDeniedAccess(
              "student-auth-provider-not-production-ready",
              authenticatedStudent,
            ),
            authProviderContract,
            redaction: createRedaction(),
          }, traceId);
        }
      }
      const courseManagementRepository = createUaisTeachingCourseManagementRepository({
        env,
        fetch: deps.fetch,
      });
      if (!courseManagementRepository) {
        assertTeachingCourseManagementLocalJsonRuntimeAllowed(env);
      }

      let database: TeachingCourseManagementDatabase;
      try {
        ({ database } = await readTeachingCourseManagementSnapshot({
          dataDir: resolveTeachingCourseManagementDataDir(env.UAIS_TEACHING_COURSES_DATA_DIR),
          repository: courseManagementRepository,
        }));
      } catch (error) {
        if (
          authenticatedTeacher?.authSource === "app-session" &&
          isRecoverableTeachingCourseDemoReadbackError(error)
        ) {
          return jsonResponse(200, {
            courses: [],
            classes: [],
            memberships: [],
            traceId,
            receipt: {
              action: "list-courses",
              actorId: authenticatedTeacher.actorId,
              traceId,
              status: "read",
              responsibleSession: "S12",
              createdAt: (deps.now ?? new Date()).toISOString(),
              storageFallback: "demo-app-session-empty-readback",
              redaction: createRedaction(),
            },
            redaction: createRedaction(),
          }, traceId);
        }
        throw error;
      }
      if (authenticatedStudent) {
        // Students see their own approved memberships plus the ones still waiting
        // for teacher review, so the student dashboard can render the pending
        // join request. Access-granting surfaces (learning playback, AI guide)
        // gate on `approved` independently and stay unaffected by this list.
        const memberships = database.memberships.filter(
          (membership) =>
            membership.studentId === authenticatedStudent.actorId &&
            studentVisibleMembershipStatuses.has(membership.membershipStatus),
        );
        const courseIds = new Set(memberships.map((membership) => membership.courseId));
        const classIds = new Set(memberships.map((membership) => membership.classId));
        const courses: StudentVisibleCourse[] = database.courses
          .filter((course) => courseIds.has(course.courseId))
          .map(createStudentVisibleCourse);
        const classes: StudentVisibleClass[] = database.classes
          .filter(
            (classItem) => courseIds.has(classItem.courseId) && classIds.has(classItem.classId),
          )
          .map(createStudentVisibleClass);
        const studentVisibleMemberships: StudentVisibleMembership[] = memberships.map(
          createStudentVisibleMembership,
        );

        return jsonResponse(200, {
          courses,
          classes,
          memberships: studentVisibleMemberships,
          traceId,
          receipt: {
            action: "list-student-courses",
            actorId: authenticatedStudent.actorId,
            traceId,
            status: "read",
            responsibleSession: "S12",
            createdAt: (deps.now ?? new Date()).toISOString(),
            redaction: createRedaction(),
          },
          redaction: createRedaction(),
        }, traceId);
      }

      const teacher = authenticatedTeacher;
      if (!teacher) {
        return jsonResponse(401, {
          error: "UAIS teacher authentication is required.",
          traceId,
          access: createDeniedAccess("authenticated-session-required"),
          redaction: createRedaction(),
        }, traceId);
      }

      const courses = database.courses.filter(
        (course) => course.ownerTeacherId === teacher.actorId,
      );
      const courseIds = new Set(courses.map((course) => course.courseId));
      const classes = database.classes.filter(
        (classItem) =>
          classItem.ownerTeacherId === teacher.actorId &&
          courseIds.has(classItem.courseId),
      );
      const classIds = new Set(classes.map((classItem) => classItem.classId));
      const memberships = database.memberships.filter(
        (membership) =>
          courseIds.has(membership.courseId) && classIds.has(membership.classId),
      );

      return jsonResponse(200, {
        courses,
        classes,
        memberships,
        traceId,
        receipt: {
          action: "list-courses",
          actorId: teacher.actorId,
          traceId,
          status: "read",
          responsibleSession: "S12",
          createdAt: (deps.now ?? new Date()).toISOString(),
          redaction: createRedaction(),
        },
        redaction: createRedaction(),
      }, traceId);
    } catch (error) {
      return createErrorResponse(error, traceId);
    }
  };
}

export function createTeachingCoursePostHandler(deps: TeachingCoursePostHandlerDeps = {}) {
  const env = deps.env ?? process.env;
  const mergeTeacherAiOwnershipRecord =
    deps.mergeTeacherAiOwnershipRecord ??
    createUaisTeacherAiOwnershipMergeAdapter({
      env,
      fetch: deps.fetch,
    });

  return async function POST(request: Request) {
    const traceId = readSafeTraceId(request);
    try {
      const authenticatedStudent = readAuthenticatedStudent({
        request,
        env,
        now: deps.now,
      });
      if (authenticatedStudent) {
        return jsonResponse(403, {
          error: "UAIS teacher role is required.",
          traceId,
          access: createDeniedAccess("teacher-role-required"),
          redaction: createRedaction(),
        }, traceId);
      }

      const authenticatedTeacher = readAuthenticatedTeacher({
        request,
        env,
        now: deps.now,
      });
      if (!authenticatedTeacher) {
        return jsonResponse(401, {
          error: "UAIS teacher authentication is required.",
          traceId,
          access: createDeniedAccess("authenticated-session-required"),
          redaction: createRedaction(),
        }, traceId);
      }
      const authProviderContract = resolveUaisTeacherAuthProviderContract({ env });
      if (
        isTeachingCourseApiProductionRuntime(env) &&
        authProviderContract.productionStatus !== "ready"
      ) {
        return jsonResponse(503, {
          error: "UAIS teacher auth provider is not production-ready.",
          traceId,
          access: createDeniedAccess(
            "teacher-auth-provider-not-production-ready",
            authenticatedTeacher,
          ),
          authProviderContract,
          redaction: createRedaction(),
        }, traceId);
      }
      const courseManagementRepository = createUaisTeachingCourseManagementRepository({
        env,
        fetch: deps.fetch,
      });
      const courseAssetsRepository = createUaisTeachingCourseAssetsRepository({
        env,
        fetch: deps.fetch,
      });
      if (!courseManagementRepository) {
        assertTeachingCourseManagementLocalJsonRuntimeAllowed(env);
      }
      if (!deps.mergeTeacherAiOwnershipRecord) {
        assertProductionTeacherAiOwnershipPersistenceConfigured(env);
      }
      if (!mergeTeacherAiOwnershipRecord) {
        throw new TeachingCourseManagementStoreError(
          503,
          "UAIS teacher course ownership merge backend is not ready.",
        );
      }

      const body = await readJsonBody(request);
      const draft = parseCourseDraft(body);
      if (draft.coverAssetId) {
        try {
          await assertTeacherCourseCoverAssetAccess({
            dataDir: resolveTeachingCourseAssetsDataDir(
              env.UAIS_TEACHING_COURSE_ASSETS_DATA_DIR,
            ),
            env,
            actorId: authenticatedTeacher.actorId,
            coverAssetId: draft.coverAssetId,
            repository: courseAssetsRepository,
          });
        } catch (error) {
          if (isTeachingCourseCoverAssetOwnershipError(error)) {
            return jsonResponse(403, {
              error: "Teaching course cover asset ownership is required.",
              traceId,
              access: createDeniedAccess(
                "teacher-course-cover-asset-ownership-required",
                authenticatedTeacher,
                { coverAssetId: draft.coverAssetId },
              ),
              redaction: createRedaction(),
            }, traceId);
          }
          if (
            courseAssetsRepository &&
            isTeachingCourseCoverAssetReadbackFailure(error)
          ) {
            return jsonResponse(503, {
              error: "Teaching course cover asset ownership check failed.",
              traceId,
              access: createDeniedAccess(
                "teacher-course-cover-asset-check-failed",
                authenticatedTeacher,
              ),
              redaction: createRedaction(),
            }, traceId);
          }
          throw error;
        }
      }
      const dataDir = resolveTeachingCourseManagementDataDir(env.UAIS_TEACHING_COURSES_DATA_DIR);
      const { course, receipt } = await createTeachingCourseRecord({
        dataDir,
        repository: courseManagementRepository,
        actorId: authenticatedTeacher.actorId,
        draft,
        traceId,
        now: deps.now,
        audit: {
          requestSource: readAuditRequestSource(request),
          authSession: authenticatedTeacher.authSession,
        },
      });
      let ownershipReceipt: UaisTeacherAiOwnershipMergeResult;
      try {
        ownershipReceipt = await mergeTeacherAiOwnershipRecord({
          updatedAt: course.updatedAt,
          ownership: {
            teacherId: authenticatedTeacher.actorId,
            courseIds: [course.courseId],
          },
        });
      } catch {
        const rollback = await rollbackTeachingCourseCreationAfterOwnershipFailure({
          dataDir,
          repository: courseManagementRepository,
          actorId: authenticatedTeacher.actorId,
          courseId: course.courseId,
          traceId: receipt.traceId,
          rolledBackAt: course.updatedAt,
        });

        return jsonResponse(503, {
          error: "Teaching course ownership merge failed.",
          traceId,
          partialFailure: {
            status: "course-created-ownership-merge-failed",
            failedStep: "teacher-ai-ownership-merge",
            courseId: course.courseId,
            rollback,
            recoveryAction: "retry-course-create-after-ownership-merge-recovers",
            responsibleSession: "S12",
            redaction: createRedaction(),
          },
          redaction: createRedaction(),
        }, traceId);
      }

      return jsonResponse(201, {
        course,
        receipt,
        ownershipReceipt,
        traceId,
        redaction: createRedaction(),
      }, traceId);
    } catch (error) {
      return createErrorResponse(error, traceId);
    }
  };
}

function createStudentVisibleCourse(course: TeachingCourseRecord): StudentVisibleCourse {
  return {
    courseId: course.courseId,
    courseName: course.courseName,
    semester: course.semester,
  };
}

function createStudentVisibleClass(classItem: TeachingClassRecord): StudentVisibleClass {
  return {
    classId: classItem.classId,
    courseId: classItem.courseId,
    className: classItem.className,
    semester: classItem.semester,
  };
}

function createStudentVisibleMembership(
  membership: TeachingClassMembershipRecord,
): StudentVisibleMembership {
  return {
    membershipId: membership.membershipId,
    courseId: membership.courseId,
    classId: membership.classId,
    membershipStatus: membership.membershipStatus,
    joinedAt: membership.joinedAt,
    ...(membership.approvedAt === undefined ? {} : { approvedAt: membership.approvedAt }),
  };
}

function assertProductionTeacherAiOwnershipPersistenceConfigured(
  env: Record<string, string | undefined>,
) {
  if (!isTeachingCourseApiProductionRuntime(env)) {
    return;
  }
  const selector = env.UAIS_TEACHER_AI_OWNERSHIP_BACKEND?.trim().toLowerCase();
  if (
    selector === "external" ||
    selector === "postgres" ||
    selector === "managed"
  ) {
    return;
  }

  throw new TeachingCourseManagementStoreError(
    503,
    "Production teacher AI ownership persistence requires external storage.",
  );
}

async function rollbackTeachingCourseCreationAfterOwnershipFailure(input: {
  dataDir: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  traceId: string;
  rolledBackAt: string;
}) {
  try {
    await rollbackTeachingCourseCreation(input);
    return {
      status: "rolled-back",
      action: "rollback-teaching-course-creation",
      courseId: input.courseId,
      traceId: input.traceId,
      rolledBackAt: input.rolledBackAt,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
  } catch {
    return {
      status: "rollback-failed",
      action: "rollback-teaching-course-creation",
      courseId: input.courseId,
      traceId: input.traceId,
      rolledBackAt: input.rolledBackAt,
      error: "Teaching course rollback failed.",
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
  }
}

async function assertTeacherCourseCoverAssetAccess(input: {
  dataDir: string;
  env: Record<string, string | undefined>;
  actorId: string;
  coverAssetId: string;
  repository?: TeachingCourseAssetsRepository;
}) {
  if (!input.repository) {
    assertTeachingCourseAssetsLocalJsonRuntimeAllowed(input.env);
  }
  const { database } = await readTeachingCourseAssetsSnapshot({
    dataDir: input.dataDir,
    repository: input.repository,
  });
  const asset = database.assets.find((item) => item.assetId === input.coverAssetId);
  if (!asset) {
    throw new TeachingCourseManagementStoreError(
      404,
      "Teaching course cover asset was not found.",
    );
  }
  const generatedByTeacher = database.auditEvents.some(
    (event) =>
      event.assetId === input.coverAssetId &&
      event.actorId === input.actorId &&
      event.authMode === "signed-teacher-session",
  );
  if (!generatedByTeacher) {
    throw new TeachingCourseManagementStoreError(
      403,
      "Teaching course cover asset ownership is required.",
    );
  }
}

function isTeachingCourseApiProductionRuntime(env: Record<string, string | undefined>) {
  return (
    env.VERCEL_ENV === "production" ||
    env.NODE_ENV === "production" ||
    env.UAIS_DEPLOYMENT_ENV === "production"
  );
}

function parseCourseDraft(value: unknown): TeachingCourseDraftInput {
  if (!isRecord(value)) {
    throw new TeachingCourseManagementStoreError(
      400,
      "Course request body must be an object.",
      { validation: createCourseValidation("body-not-object", "body") },
    );
  }
  return {
    ...(typeof value.courseId === "string" ? { courseId: value.courseId } : {}),
    name: requireString(value.name, "name", "Course name is required."),
    instructor: requireString(value.instructor, "instructor", "Course instructor is required."),
    unit: requireString(value.unit, "unit", "Course unit is required."),
    department: requireString(value.department, "department", "Course department is required."),
    semester: requireString(value.semester, "semester", "Course semester is required."),
    ...(typeof value.description === "string" ? { description: value.description } : {}),
    ...(typeof value.coverAssetId === "string" ? { coverAssetId: value.coverAssetId } : {}),
  };
}

async function readJsonBody(request: Request) {
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBodyBytes) {
    throw new TeachingCourseManagementStoreError(413, "Course request body is too large.", {
      validation: createCourseValidation("body-too-large", "body", { maxBytes: maxBodyBytes }),
    });
  }
  if (!text.trim()) {
    throw new TeachingCourseManagementStoreError(400, "Course request body is required.", {
      validation: createCourseValidation("body-required", "body"),
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new TeachingCourseManagementStoreError(400, "Course request body must be JSON.", {
      validation: createCourseValidation("body-malformed-json", "body"),
    });
  }
}

function readAuthenticatedTeacher(input: {
  request: Request;
  env: Record<string, string | undefined>;
  now?: Date;
}): AuthenticatedTeacher | undefined {
  const secret = input.env.UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET?.trim();
  if (!secret) {
    return undefined;
  }
  const session = readUaisAuthenticatedTeacherSessionFromSignedCookies({
    request: input.request,
    secret,
    now: input.now,
  });
  if (
    !session ||
    session.role !== "teacher" ||
    !isSafeTeachingCourseActorId(session.actorId) ||
    !isSafeTeachingCourseActorId(session.sessionId)
  ) {
    return undefined;
  }
  return {
    actorId: session.actorId,
    role: "teacher",
    authSource: "signed-teacher-session",
    authSession: {
      sessionId: session.sessionId,
      authenticatedAt: session.authenticatedAt,
      expiresAt: session.expiresAt,
    },
  };
}

function readAuthenticatedAppSessionTeacher(input: {
  request: Request;
  env: Record<string, string | undefined>;
  now?: Date;
}): AuthenticatedTeacher | undefined {
  const claims = getUaisAppSessionClaimsFromCookieString(
    input.request.headers.get("cookie"),
    { env: input.env, now: input.now },
  );
  if (
    !claims ||
    claims.role !== "teacher" ||
    !isSafeTeachingCourseActorId(claims.account) ||
    !isSafeTeachingCourseActorId(claims.sessionId)
  ) {
    return undefined;
  }
  return {
    actorId: claims.account,
    role: "teacher",
    authSource: "app-session",
    authSession: {
      sessionId: claims.sessionId,
      authenticatedAt: claims.authenticatedAt,
      expiresAt: claims.expiresAt,
    },
  };
}

function isSafeTeachingCourseActorId(value: string) {
  return value.length >= 1 && value.length <= 120 && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value);
}

function readAuthenticatedStudent(input: {
  request: Request;
  env: Record<string, string | undefined>;
  now?: Date;
}): AuthenticatedStudent | undefined {
  const claims = getUaisAppSessionClaimsFromCookieString(
    input.request.headers.get("cookie"),
    { env: input.env, now: input.now },
  );
  if (
    !claims ||
    claims.role !== "student" ||
    !isSafeTeachingCourseActorId(claims.account) ||
    !isSafeTeachingCourseActorId(claims.sessionId)
  ) {
    return undefined;
  }
  return {
    actorId: claims.account,
    role: "student",
  };
}

function readSafeTraceId(request: Request) {
  const headerTraceId = request.headers.get("x-uais-trace-id")?.trim();
  if (headerTraceId && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(headerTraceId)) {
    return headerTraceId;
  }
  return `trace-${randomUUID()}`;
}

function readAuditRequestSource(request: Request) {
  return {
    userAgent: sanitizeRequestSourceHeader(request.headers.get("user-agent")) ?? "unknown",
    ipAddress: "redacted" as const,
  };
}

function sanitizeRequestSourceHeader(value: string | null) {
  const normalized = value?.trim().slice(0, 160);
  if (!normalized) {
    return undefined;
  }
  if (/\/Users\/|secret|api[_-]?key|token/i.test(normalized)) {
    return "redacted";
  }
  return normalized;
}

function requireString(value: unknown, field: string, message: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TeachingCourseManagementStoreError(400, message, {
      validation: createCourseValidation("missing-field", field),
    });
  }
  return value;
}

function createErrorResponse(error: unknown, traceId: string) {
  if (
    error instanceof TeachingCourseManagementStoreError ||
    error instanceof TeachingCourseAssetsStoreError
  ) {
    const validation = readCourseValidation(error);
    return jsonResponse(error.status, {
      error: error.message,
      traceId,
      ...(validation ? { validation } : {}),
      redaction: createRedaction(),
    }, traceId);
  }

  return jsonResponse(500, {
    error: "Teaching course management request failed.",
    traceId,
    redaction: createRedaction(),
  }, traceId);
}

function jsonResponse(status: number, body: unknown, traceId: string) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-uais-trace-id": traceId,
    },
  });
}

function createDeniedAccess(
  reasonCode:
    | "authenticated-session-required"
    | "teacher-role-required"
    | "teacher-auth-provider-not-production-ready"
    | "student-auth-provider-not-production-ready"
    | "teacher-course-cover-asset-check-failed"
    | "teacher-course-cover-asset-ownership-required",
  actor?: { actorId: string; role: "teacher" | "student" },
  resource?: { courseId?: string; coverAssetId?: string },
) {
  return {
    status: "denied",
    reasonCode,
    responsibleSession: "S12",
    ...(actor ? { actor: { actorId: actor.actorId, role: actor.role } } : {}),
    ...(resource ? { resource } : {}),
    redaction: createRedaction(),
  };
}

function isTeachingCourseCoverAssetOwnershipError(error: unknown) {
  return (
    error instanceof TeachingCourseManagementStoreError &&
    error.status === 403 &&
    error.message === "Teaching course cover asset ownership is required."
  );
}

function isTeachingCourseCoverAssetReadbackFailure(error: unknown) {
  return error instanceof TeachingCourseAssetsStoreError && error.status >= 500;
}

function isRecoverableTeachingCourseDemoReadbackError(error: unknown) {
  return error instanceof TeachingCourseManagementStoreError && error.status >= 500;
}

function createRedaction() {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  };
}

function createCourseValidation(
  reasonCode: TeachingCourseCreateValidationReason,
  field: string,
  options: { maxBytes?: number } = {},
): TeachingCourseCreateValidation {
  return {
    target: "teaching-course-create",
    status: "invalid",
    reasonCode,
    field,
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function readCourseValidation(error: TeachingCourseManagementStoreError | TeachingCourseAssetsStoreError) {
  if (!(error instanceof TeachingCourseManagementStoreError)) {
    return undefined;
  }
  const validation = error.diagnostics?.validation;
  if (!isCourseValidation(validation)) {
    return undefined;
  }
  return validation;
}

function isCourseValidation(value: unknown): value is TeachingCourseCreateValidation {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.target === "teaching-course-create" &&
    value.status === "invalid" &&
    typeof value.reasonCode === "string" &&
    typeof value.field === "string" &&
    value.responsibleSession === "S12" &&
    isRecord(value.redaction)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
