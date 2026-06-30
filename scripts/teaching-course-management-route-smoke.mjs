#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const courseRoute = "/api/teaching/courses";
const courseCoverRoute = "/api/teaching/course-cover";
const teachingOperationRoute = "/api/teaching/operations";
const classRouteTemplate = "/api/teaching/courses/{courseId}/classes";
const inviteJoinRouteTemplate = "/api/teaching/invite-codes/{code}/join";
const membershipApproveRouteTemplate =
  "/api/teaching/classes/{classId}/memberships/{membershipId}/approve";
const routes = [
  courseCoverRoute,
  courseRoute,
  teachingOperationRoute,
  classRouteTemplate,
  inviteJoinRouteTemplate,
  membershipApproveRouteTemplate,
];
const defaultCourseName = "Route Smoke Enterprise Course";
const defaultClassName = "Route Smoke Class";
const defaultSemester = "2026 Smoke";
const routeSmokeUserAgent = "UAIS teaching course management route smoke";
const acceptedTeacherAuthProviderModes = ["trusted-cookie-issuer", "oidc-jwks"];
const acceptedAppAuthProviderModes = ["trusted-account-provider"];
const proves = [
  "unauthenticated-course-list-denied",
  "unauthenticated-course-cover-denied",
  "unauthenticated-course-cover-no-write-side-effects",
  "unauthenticated-course-create-denied",
  "unauthenticated-course-create-no-write-side-effects",
  "signed-student-course-create-denied",
  "signed-student-course-create-no-write-side-effects",
  "signed-student-course-cover-denied",
  "signed-student-course-cover-no-write-side-effects",
  "signed-teacher-foreign-course-create-denied",
  "signed-teacher-foreign-course-create-no-write-side-effects",
  "signed-other-teacher-course-cover-denied",
  "signed-other-teacher-course-cover-no-write-side-effects",
  "unauthenticated-class-create-denied",
  "unauthenticated-class-create-no-write-side-effects",
  "signed-student-class-create-denied",
  "signed-student-class-create-no-write-side-effects",
  "signed-other-teacher-class-create-denied",
  "signed-other-teacher-class-create-no-write-side-effects",
  "signed-teacher-cookie-required",
  "course-cover-asset-generated",
  "course-cover-asset-external-storage-returned",
  "course-cover-asset-readback-revision-returned",
  "course-cover-asset-readback-managed-database-adapter-returned",
  "course-cover-audit-auth-session-returned",
  "course-cover-asset-audit-external-readback-returned",
  "course-cover-asset-revision-retry-contract-returned",
  "signed-course-cover-trace-header-returned",
  "teacher-owned-course-created",
  "duplicate-course-create-denied",
  "duplicate-course-create-no-duplicate-side-effects",
  "course-create-external-snapshot-policy-returned",
  "course-create-audit-source-readback-returned",
  "course-create-auth-session-readback-returned",
  "created-course-used-cover-draft-scope",
  "created-course-bound-generated-cover-asset",
  "existing-course-cover-binding-readback-returned",
  "existing-course-cover-listed-readback-returned",
  "existing-course-cover-asset-audit-external-readback-returned",
  "existing-course-cover-binding-audit-source-returned",
  "external-ownership-merge-returned",
  "teacher-owned-class-created",
  "duplicate-class-create-denied",
  "duplicate-class-create-no-duplicate-side-effects",
  "class-create-external-snapshot-policy-returned",
  "class-create-audit-source-readback-returned",
  "class-create-auth-session-readback-returned",
  "created-course-and-class-readable-after-write",
  "signed-other-teacher-course-list-returned",
  "other-teacher-course-hidden",
  "other-teacher-class-hidden",
  "student-course-hidden-before-membership",
  "unauthenticated-invite-join-denied",
  "unauthenticated-invite-join-no-write-side-effects",
  "student-invite-join-persisted",
  "duplicate-student-invite-join-idempotent-returned",
  "duplicate-student-invite-join-no-duplicate-side-effects",
  "student-pending-course-hidden-before-approval",
  "student-pending-class-hidden-before-approval",
  "student-pending-membership-hidden-before-approval",
  "signed-student-pending-course-list-trace-header-returned",
  "student-invite-join-audit-source-returned",
  "student-invite-join-auth-session-returned",
  "student-invite-join-auth-session-readback-returned",
  "created-course-teaching-operation-accepted",
  "unauthenticated-membership-approval-denied",
  "unauthenticated-membership-approval-no-write-side-effects",
  "signed-student-membership-approval-denied",
  "signed-student-membership-approval-no-write-side-effects",
  "signed-other-teacher-membership-approval-denied",
  "signed-other-teacher-membership-approval-actor-resource-returned",
  "signed-other-teacher-membership-approval-no-write-side-effects",
  "teacher-membership-approval-persisted",
  "duplicate-membership-approval-idempotent-returned",
  "duplicate-membership-approval-no-duplicate-side-effects",
  "teacher-membership-approval-audit-source-returned",
  "teacher-membership-approval-auth-session-returned",
  "teacher-membership-approval-auth-session-readback-returned",
  "approved-course-visible-for-student",
  "approved-membership-readable-for-student",
  "unauthenticated-course-list-trace-header-returned",
  "unauthenticated-course-cover-trace-header-returned",
  "unauthenticated-course-create-trace-header-returned",
  "signed-student-course-create-trace-header-returned",
  "signed-student-course-cover-trace-header-returned",
  "signed-other-teacher-course-cover-trace-header-returned",
  "unauthenticated-class-create-trace-header-returned",
  "signed-student-class-create-trace-header-returned",
  "signed-other-teacher-class-create-trace-header-returned",
  "signed-course-create-trace-header-returned",
  "signed-course-create-trace-body-returned",
  "signed-class-create-trace-header-returned",
  "signed-class-create-trace-body-returned",
  "signed-course-list-trace-header-returned",
  "signed-other-teacher-course-list-trace-header-returned",
  "signed-student-prejoin-course-list-trace-header-returned",
  "unauthenticated-invite-join-trace-header-returned",
  "signed-student-invite-join-trace-header-returned",
  "signed-student-invite-join-trace-body-returned",
  "unauthenticated-membership-approval-trace-header-returned",
  "signed-student-membership-approval-trace-header-returned",
  "signed-other-teacher-membership-approval-trace-header-returned",
  "signed-teacher-membership-approval-trace-header-returned",
  "signed-teacher-membership-approval-trace-body-returned",
  "signed-student-course-list-trace-header-returned",
  "response-values-redacted",
  "release-run-id-bound",
  "same-teacher-auth-provider-readiness-bound",
  "same-app-auth-provider-readiness-bound",
  "same-vercel-production-deployment-bound",
  "same-deployment-domain-reachability-bound",
  "same-external-storage-service-readiness-bound",
];

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.live && options.approved !== true) {
    throw new Error("Teaching course management route smoke requires explicit owner approval.");
  }
  if (options.live && options.environment === "production" && !hasValue(options.releaseRunId)) {
    throw new Error("Teaching course management route smoke requires --release-run-id.");
  }

  const env = {
    ...process.env,
    ...readEnvFile(options.envFile),
  };
  const mode = options.live ? "live" : "dry-run";
  const baseUrl = options.baseUrl || env.UAIS_DEPLOYMENT_BASE_URL;
  const cookie = options.cookie || env.UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_COOKIE;
  const otherTeacherCookie =
    options.otherTeacherCookie ||
    env.UAIS_TEACHING_COURSE_MANAGEMENT_OTHER_TEACHER_SMOKE_COOKIE;
  const studentCookie =
    options.studentCookie || env.UAIS_TEACHING_COURSE_MANAGEMENT_STUDENT_SMOKE_COOKIE;
  const teacherId =
    options.teacherId || env.UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_TEACHER_ID;
  const otherTeacherId =
    options.otherTeacherId ||
    env.UAIS_TEACHING_COURSE_MANAGEMENT_OTHER_TEACHER_SMOKE_TEACHER_ID;
  const studentId =
    options.studentId || env.UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_STUDENT_ID;
  const courseManagementBackend =
    options.courseManagementBackend || env.UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND;
  const courseAssetsBackend =
    options.courseAssetsBackend || env.UAIS_TEACHING_COURSE_ASSETS_BACKEND;
  const teachingOperationsBackend =
    options.teachingOperationsBackend || env.UAIS_TEACHING_OPERATIONS_BACKEND;
  const externalStorageBaseUrl =
    options.externalStorageBaseUrl || env.UAIS_EXTERNAL_STORAGE_BASE_URL;
  const externalStorageAccessToken =
    options.externalStorageAccessToken || env.UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN;
  const teacherAiOwnershipBackend =
    options.teacherAiOwnershipBackend || env.UAIS_TEACHER_AI_OWNERSHIP_BACKEND;
  const teacherAuthProviderReadiness = readJsonEvidence(options.teacherAuthProviderReadiness);
  const appAuthProviderReadiness = readJsonEvidence(options.appAuthProviderReadiness);
  const vercelProductionDeployment = readJsonEvidence(options.vercelProductionDeployment);
  const deploymentDomainReachability = readJsonEvidence(
    options.deploymentDomainReachability,
  );
  const externalStorageServiceReadiness = readJsonEvidence(
    options.externalStorageServiceReadiness,
  );
  const plan = buildPlan({
    mode,
    environment: options.environment,
    releaseRunId: options.releaseRunId,
    baseUrl,
    cookie,
    otherTeacherCookie,
    studentCookie,
    teacherId,
    otherTeacherId,
    studentId,
    courseManagementBackend,
    courseAssetsBackend,
    teachingOperationsBackend,
    externalStorageBaseUrl,
    externalStorageAccessToken,
    teacherAiOwnershipBackend,
    teacherAuthProviderReadiness,
    appAuthProviderReadiness,
    vercelProductionDeployment,
    deploymentDomainReachability,
    externalStorageServiceReadiness,
  });

  if (mode === "dry-run") {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exit(0);
  }

  if (plan.status === "blocked") {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exitCode = 1;
  } else {
    const courseName =
      options.courseName ||
      env.UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_COURSE_NAME ||
      defaultCourseName;
    const coverCourseId =
      options.coverCourseId ||
      env.UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_COVER_COURSE_ID ||
      createSmokeProvisionalCourseId({
        teacherId: teacherId || "teacher",
        courseName,
        now: new Date(),
      });
    const evidence = await executeLiveSmoke({
      plan,
      baseUrl,
      cookie,
      otherTeacherCookie,
      studentCookie,
      teacherId,
      otherTeacherId,
      studentId,
      externalStorageBaseUrl,
      externalStorageAccessToken,
      courseName,
      coverCourseId,
      className: options.className || env.UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_CLASS_NAME || defaultClassName,
      semester: options.semester || env.UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_SEMESTER || defaultSemester,
    });
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    if (evidence.status !== "passed") {
      process.exitCode = 1;
    }
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Teaching course management route smoke failed."}\n`,
  );
  process.exitCode = 1;
}

function buildPlan({
  mode,
  environment,
  releaseRunId,
  baseUrl,
  cookie,
  otherTeacherCookie,
  studentCookie,
  teacherId,
  otherTeacherId,
  studentId,
  courseManagementBackend,
  courseAssetsBackend,
  teachingOperationsBackend,
  externalStorageBaseUrl,
  externalStorageAccessToken,
  teacherAiOwnershipBackend,
  teacherAuthProviderReadiness,
  appAuthProviderReadiness,
  vercelProductionDeployment,
  deploymentDomainReachability,
  externalStorageServiceReadiness,
}) {
  const deploymentFingerprint = createDeploymentFingerprint(baseUrl);
  const storageServiceFingerprint = createStorageServiceFingerprint(externalStorageBaseUrl);
  const teacherAuthProviderReadinessEvidence =
    teacherAuthProviderReadiness === undefined && environment === "production"
      ? {
          target: "missing",
          status: "missing",
          authProviderMode: "missing",
          releaseRunIdStatus: "missing",
          valueRedacted: true,
        }
      : evaluateTeacherAuthProviderReadinessEvidence({
          evidence: teacherAuthProviderReadiness,
          releaseRunId,
        });
  const auth = describeTeachingCourseManagementRouteSmokeAuth({
    cookie,
    teacherAuthProviderReadinessEvidence,
  });
  const appAuthProviderReadinessEvidence =
    appAuthProviderReadiness === undefined && environment === "production"
      ? {
          target: "missing",
          status: "missing",
          appAuthProviderMode: "missing",
          releaseRunIdStatus: "missing",
          valueRedacted: true,
        }
      : evaluateAppAuthProviderReadinessEvidence({
          evidence: appAuthProviderReadiness,
          environment,
          releaseRunId,
        });
	  const vercelProductionDeploymentEvidence =
	    vercelProductionDeployment === undefined && environment === "production"
	      ? {
	          target: "missing",
          status: "missing",
          deploymentObservationStatus: "missing",
          releaseRunIdStatus: "missing",
          valueRedacted: true,
        }
	      : evaluateVercelProductionDeploymentEvidence({
	          evidence: vercelProductionDeployment,
	          releaseRunId,
	        });
  const deploymentDomainReachabilityEvidence =
    deploymentDomainReachability === undefined && environment === "production"
      ? {
          target: "missing",
          status: "missing",
          releaseRunIdStatus: "missing",
          deploymentFingerprintStatus: "missing",
          valueRedacted: true,
        }
      : evaluateDeploymentDomainReachabilityEvidence({
          evidence: deploymentDomainReachability,
          deploymentFingerprint,
          releaseRunId,
        });
  const externalStorageServiceReadinessEvidence =
    externalStorageServiceReadiness === undefined && environment === "production"
      ? {
          target: "missing",
          status: "missing",
          valueRedacted: true,
          releaseRunIdStatus: "missing",
        }
      : evaluateExternalStorageServiceReadinessEvidence({
          evidence: externalStorageServiceReadiness,
          releaseRunId,
          storageServiceFingerprint,
        });
	  const deploymentOrigin = describeDeploymentOrigin(baseUrl);
	  const requiredEnv = [
    {
      name: "UAIS_DEPLOYMENT_BASE_URL",
      status: hasValue(baseUrl) ? "present" : "missing",
    },
    {
      name: "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
      status:
        hasValue(courseManagementBackend) && courseManagementBackend === "external"
          ? "present"
          : environment === "production"
            ? "missing"
            : "optional",
      requiredValue: "external",
    },
    {
      name: "UAIS_TEACHING_COURSE_ASSETS_BACKEND",
      status:
        hasValue(courseAssetsBackend) && courseAssetsBackend === "external"
          ? "present"
          : environment === "production"
            ? "missing"
            : "optional",
      requiredValue: "external",
    },
    {
      name: "UAIS_TEACHING_OPERATIONS_BACKEND",
      status:
        hasValue(teachingOperationsBackend) && teachingOperationsBackend === "external"
          ? "present"
          : environment === "production"
            ? "missing"
            : "optional",
      requiredValue: "external",
    },
    {
      name: "UAIS_EXTERNAL_STORAGE_BASE_URL",
      status:
        courseManagementBackend === "external" &&
        courseAssetsBackend === "external" &&
        hasValue(externalStorageBaseUrl)
          ? "present"
          : environment === "production"
            ? "missing"
            : "optional",
      valueRedacted: true,
    },
    {
      name: "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
      status:
        courseManagementBackend === "external" &&
        courseAssetsBackend === "external" &&
        isStrongExternalStorageToken(externalStorageAccessToken)
          ? "present"
          : environment === "production"
            ? "missing"
            : "optional",
      valueRedacted: true,
    },
    {
      name: "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
      status:
        hasValue(teacherAiOwnershipBackend) && teacherAiOwnershipBackend === "external"
          ? "present"
          : environment === "production"
            ? "missing"
            : "optional",
      requiredValue: "external",
    },
    {
      name: "UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_COOKIE",
      status: hasValue(cookie) ? "present" : "missing",
      valueRedacted: true,
    },
    {
      name: "UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_TEACHER_ID",
      status: hasValue(teacherId) ? "present" : "missing",
      valueRedacted: true,
    },
    {
      name: "UAIS_TEACHING_COURSE_MANAGEMENT_OTHER_TEACHER_SMOKE_COOKIE",
      status: hasValue(otherTeacherCookie)
        ? "present"
        : environment === "production"
          ? "missing"
          : "optional",
      valueRedacted: true,
    },
    {
      name: "UAIS_TEACHING_COURSE_MANAGEMENT_OTHER_TEACHER_SMOKE_TEACHER_ID",
      status: hasValue(otherTeacherId)
        ? "present"
        : environment === "production"
          ? "missing"
          : "optional",
      valueRedacted: true,
    },
    {
      name: "UAIS_TEACHING_COURSE_MANAGEMENT_STUDENT_SMOKE_COOKIE",
      status: hasValue(studentCookie)
        ? "present"
        : environment === "production"
          ? "missing"
          : "optional",
      valueRedacted: true,
    },
    {
      name: "UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_STUDENT_ID",
      status: hasValue(studentId)
        ? "present"
        : environment === "production"
          ? "missing"
          : "optional",
      valueRedacted: true,
    },
  ];
	  const blockedReasons = requiredEnv
	    .filter((entry) => entry.status !== "present" && entry.status !== "optional")
	    .map((entry) => `missing-${entry.name}`)
	    .concat(readTeacherAuthProviderReadinessBlockedReasons(teacherAuthProviderReadinessEvidence))
    .concat(readAppAuthProviderReadinessBlockedReasons(appAuthProviderReadinessEvidence))
	    .concat(readVercelProductionDeploymentBlockedReasons(vercelProductionDeploymentEvidence))
    .concat(readDeploymentDomainReachabilityBlockedReasons(deploymentDomainReachabilityEvidence))
    .concat(readExternalStorageServiceReadinessBlockedReasons(externalStorageServiceReadinessEvidence))
	    .concat(readProductionDeploymentOriginBlockedReasons({ environment, deploymentOrigin }));

  return {
    target: "teaching-course-management-route-smoke",
    mode,
    environment,
    network: mode === "live" ? "enabled" : "disabled",
    status: blockedReasons.length === 0 ? "ready" : "blocked",
    responsibleSessions: ["S12", "S22"],
    ...(releaseRunId ? { releaseRunId } : {}),
	    routes,
	    deploymentFingerprint,
	    deploymentOrigin,
    storageServiceFingerprint,
	    ...(teacherAuthProviderReadinessEvidence
	      ? { teacherAuthProviderReadinessEvidence }
	      : {}),
    auth,
    ...(appAuthProviderReadinessEvidence
      ? { appAuthProviderReadinessEvidence }
      : {}),
    ...(vercelProductionDeploymentEvidence
      ? { vercelProductionDeploymentEvidence }
      : {}),
    ...(deploymentDomainReachabilityEvidence
      ? { deploymentDomainReachabilityEvidence }
      : {}),
    ...(externalStorageServiceReadinessEvidence
      ? { externalStorageServiceReadinessEvidence }
      : {}),
    courseManagementBackend:
      courseManagementBackend === "external" ? "external" : "not-proven",
    courseAssetsBackend:
      courseAssetsBackend === "external" ? "external" : "not-proven",
    teachingOperationsBackend:
      teachingOperationsBackend === "external" ? "external" : "not-proven",
    teacherAiOwnershipBackend:
      teacherAiOwnershipBackend === "external" ? "external" : "not-proven",
    requiredEnv,
    proves,
    blockedReasons,
    safety: createSafety(),
  };
}

function describeTeachingCourseManagementRouteSmokeAuth({
  cookie,
  teacherAuthProviderReadinessEvidence,
}) {
  if (!hasValue(cookie)) {
    return "missing";
  }
  if (
    teacherAuthProviderReadinessEvidence?.target === "teacher-auth-provider-readiness" &&
    teacherAuthProviderReadinessEvidence?.status === "matched" &&
    teacherAuthProviderReadinessEvidence?.authProviderMode === "trusted-cookie-issuer" &&
    teacherAuthProviderReadinessEvidence?.releaseRunIdStatus === "matched" &&
    teacherAuthProviderReadinessEvidence?.valueRedacted === true
  ) {
    return "issued-teacher-auth-cookie";
  }
  return "signed-teacher-auth-cookie";
}

async function executeLiveSmoke({
  plan,
  baseUrl,
  cookie,
  otherTeacherCookie,
  studentCookie,
  teacherId,
  otherTeacherId,
  studentId,
  externalStorageBaseUrl,
  externalStorageAccessToken,
  courseName,
  coverCourseId,
  className,
  semester,
}) {
  const unauthenticatedCourseList = await getCourses({ baseUrl });
  const unauthenticatedCourseCover = await postJson({
    baseUrl,
    path: courseCoverRoute,
    traceId: "trace-teaching-course-route-smoke-denied-course-cover",
    body: {
      courseId: coverCourseId,
      name: courseName,
      instructor: "S22 Route Smoke",
      unit: "UAIS",
      department: "Production Reliability",
      semester,
      description:
        "Route smoke denied cover generation to prove signed teacher cookie enforcement.",
    },
  });
  const unauthenticatedCourseCreate = await postJson({
    baseUrl,
    path: courseRoute,
    traceId: "trace-teaching-course-route-smoke-denied-course-create",
    body: {
      courseId: coverCourseId,
      name: courseName,
      instructor: "S22 Route Smoke",
      unit: "UAIS",
      department: "Production Reliability",
      semester,
      description:
        "Route smoke denied course creation to prove signed teacher cookie enforcement.",
    },
  });
  const signedStudentCourseCreate = studentCookie
    ? await postJson({
        baseUrl,
        path: courseRoute,
        cookie: studentCookie,
        traceId: "trace-teaching-course-route-smoke-denied-student-course-create",
        body: {
          courseId: coverCourseId,
          name: courseName,
          instructor: "S22 Route Smoke",
          unit: "UAIS",
          department: "Production Reliability",
          semester,
          description:
            "Route smoke denied student course creation to prove teacher role enforcement.",
        },
      })
    : {
        statusCode: 0,
        headers: undefined,
        body: undefined,
      };
  const signedStudentCourseCover = studentCookie
    ? await postJson({
        baseUrl,
        path: courseCoverRoute,
        cookie: studentCookie,
        traceId: "trace-teaching-course-route-smoke-denied-student-course-cover",
        body: {
          courseId: coverCourseId,
          name: courseName,
          instructor: "S22 Route Smoke",
          unit: "UAIS",
          department: "Production Reliability",
          semester,
          description:
            "Route smoke denied student course cover generation to prove teacher role enforcement.",
        },
      })
    : {
        statusCode: 0,
        headers: undefined,
        body: undefined,
      };
  const foreignCourseId = createSmokeProvisionalCourseId({
    teacherId: otherTeacherId || `${teacherId || "teacher"}-other`,
    courseName,
    now: new Date(),
  });
  const signedTeacherForeignCourseCreate = await postJson({
    baseUrl,
    path: courseRoute,
    cookie,
    traceId: "trace-teaching-course-route-smoke-foreign-course-create-denied",
    body: {
      courseId: foreignCourseId,
      name: courseName,
      instructor: "S22 Route Smoke",
      unit: "UAIS",
      department: "Production Reliability",
      semester,
      description:
        "Route smoke denied foreign provisional course id to prove teacher ownership.",
    },
  });
  const courseCover = await postJson({
    baseUrl,
    path: courseCoverRoute,
    cookie,
    traceId: "trace-teaching-course-route-smoke-course-cover",
    body: {
      courseId: coverCourseId,
      name: courseName,
      instructor: "S22 Route Smoke",
      unit: "UAIS",
      department: "Production Reliability",
      semester,
      description: "Route smoke cover generated to prove ordinary teaching course cover assets.",
    },
  });
  const coverAsset = isRecord(courseCover.body?.asset) ? courseCover.body.asset : undefined;
  const coverAssetPersistence = isRecord(courseCover.body?.assetPersistence)
    ? courseCover.body.assetPersistence
    : undefined;
  const coverAudit = isRecord(courseCover.body?.audit) ? courseCover.body.audit : undefined;
  const coverAuditAuthSession = isRecord(coverAudit?.authSession)
    ? coverAudit.authSession
    : undefined;
  const coverAssetId =
    typeof coverAsset?.assetId === "string" ? coverAsset.assetId : undefined;
  const courseAssetsReadback = await getExternalCourseAssetsDatabase({
    externalStorageBaseUrl,
    externalStorageAccessToken,
  });
  const createCourseBody = {
    courseId: coverCourseId,
    name: courseName,
    instructor: "S22 Route Smoke",
    unit: "UAIS",
    department: "Production Reliability",
    semester,
    description: "Route smoke course created to prove ordinary teaching course management.",
    ...(coverAssetId ? { coverAssetId } : {}),
  };
  const createCourse = await postJson({
    baseUrl,
    path: courseRoute,
    cookie,
    traceId: "trace-teaching-course-route-smoke-create-course",
    body: createCourseBody,
  });
  const createdCourse = isRecord(createCourse.body?.course) ? createCourse.body.course : undefined;
  const createCourseReceipt = isRecord(createCourse.body?.receipt)
    ? createCourse.body.receipt
    : undefined;
  const createCourseAuthSession = isRecord(createCourseReceipt?.authSession)
    ? createCourseReceipt.authSession
    : undefined;
  const courseId = typeof createdCourse?.courseId === "string" ? createdCourse.courseId : undefined;
  const ownershipReceipt = isRecord(createCourse.body?.ownershipReceipt)
    ? createCourse.body.ownershipReceipt
    : undefined;
  const duplicateCourseCreate = courseId
    ? await postJson({
        baseUrl,
        path: courseRoute,
        cookie,
        traceId: "trace-teaching-course-route-smoke-duplicate-course-create",
        body: createCourseBody,
      })
    : {
        statusCode: 0,
        headers: undefined,
        body: undefined,
      };
  const existingCourseCover = courseId
    ? await postJson({
        baseUrl,
        path: courseCoverRoute,
        cookie,
        traceId: "trace-teaching-course-route-smoke-existing-course-cover",
        body: {
          courseId,
          name: courseName,
          instructor: "S22 Route Smoke",
          unit: "UAIS",
          department: "Production Reliability",
          semester,
          description:
            "Route smoke existing course cover generated to prove course record binding.",
        },
      })
    : {
        statusCode: 0,
        headers: undefined,
        body: undefined,
      };
  const existingCoverAsset = isRecord(existingCourseCover.body?.asset)
    ? existingCourseCover.body.asset
    : undefined;
  const existingCoverAssetId =
    typeof existingCoverAsset?.assetId === "string" ? existingCoverAsset.assetId : undefined;
  const existingCoverAudit = isRecord(existingCourseCover.body?.audit)
    ? existingCourseCover.body.audit
    : undefined;
  const existingCoverAuditAuthSession = isRecord(existingCoverAudit?.authSession)
    ? existingCoverAudit.authSession
    : undefined;
  const existingCourseBindingReceipt = isRecord(
    existingCourseCover.body?.courseBindingReceipt,
  )
    ? existingCourseCover.body.courseBindingReceipt
    : undefined;
  const existingCourseAssetsReadback =
    existingCourseCover.statusCode === 200 && existingCoverAssetId
      ? await getExternalCourseAssetsDatabase({
          externalStorageBaseUrl,
          externalStorageAccessToken,
        })
      : {
          statusCode: 0,
          headers: undefined,
          body: undefined,
        };
  const signedOtherTeacherCourseCover =
    courseId && otherTeacherCookie
      ? await postJson({
          baseUrl,
          path: courseCoverRoute,
          cookie: otherTeacherCookie,
          traceId: "trace-teaching-course-route-smoke-denied-other-teacher-course-cover",
          body: {
            courseId,
            name: courseName,
            instructor: "S22 Route Smoke",
            unit: "UAIS",
            department: "Production Reliability",
            semester,
            description:
              "Route smoke denied other-teacher existing course cover generation to prove course ownership.",
          },
        })
      : {
          statusCode: 0,
          headers: undefined,
          body: undefined,
        };
  const courseManagementReadback = await getExternalCourseManagementDatabase({
    externalStorageBaseUrl,
    externalStorageAccessToken,
  });
  const unauthenticatedClassCreate = courseId
    ? await postJson({
        baseUrl,
        path: classRouteTemplate.replace("{courseId}", encodeURIComponent(courseId)),
        traceId: "trace-teaching-course-route-smoke-denied-class-create",
        body: {
          className,
          semester,
        },
      })
    : {
        statusCode: 0,
        headers: undefined,
        body: undefined,
      };
  const signedStudentClassCreate =
    courseId && studentCookie
      ? await postJson({
          baseUrl,
          path: classRouteTemplate.replace("{courseId}", encodeURIComponent(courseId)),
          cookie: studentCookie,
          traceId: "trace-teaching-course-route-smoke-denied-student-class-create",
          body: {
            className,
            semester,
          },
        })
      : {
          statusCode: 0,
          headers: undefined,
          body: undefined,
        };
  const signedOtherTeacherClassCreate =
    courseId && otherTeacherCookie
      ? await postJson({
          baseUrl,
          path: classRouteTemplate.replace("{courseId}", encodeURIComponent(courseId)),
          cookie: otherTeacherCookie,
          traceId: "trace-teaching-course-route-smoke-denied-other-teacher-class-create",
          body: {
            className,
            semester,
          },
        })
      : {
          statusCode: 0,
          headers: undefined,
          body: undefined,
        };
  const createClass = courseId
    ? await postJson({
        baseUrl,
        path: classRouteTemplate.replace("{courseId}", encodeURIComponent(courseId)),
        cookie,
        traceId: "trace-teaching-course-route-smoke-create-class",
        body: {
          className,
          semester,
        },
      })
    : {
        statusCode: 0,
        body: undefined,
      };
  const createdClass = isRecord(createClass.body?.classItem)
    ? createClass.body.classItem
    : undefined;
  const createClassReceipt = isRecord(createClass.body?.receipt)
    ? createClass.body.receipt
    : undefined;
  const createClassAuthSession = isRecord(createClassReceipt?.authSession)
    ? createClassReceipt.authSession
    : undefined;
  const classId = typeof createdClass?.classId === "string" ? createdClass.classId : undefined;
  const invitationCode =
    typeof createdClass?.invitationCode === "string" ? createdClass.invitationCode : undefined;
  const duplicateClassCreate = courseId
    ? await postJson({
        baseUrl,
        path: classRouteTemplate.replace("{courseId}", encodeURIComponent(courseId)),
        cookie,
        traceId: "trace-teaching-course-route-smoke-duplicate-class-create",
        body: {
          className,
          semester,
        },
      })
    : {
        statusCode: 0,
        headers: undefined,
        body: undefined,
      };
  const courseManagementAfterClassReadback = await getExternalCourseManagementDatabase({
    externalStorageBaseUrl,
    externalStorageAccessToken,
  });
  const listCourses = await getCourses({ baseUrl, cookie });
  const otherTeacherCourseList = otherTeacherCookie
    ? await getCourses({
        baseUrl,
        cookie: otherTeacherCookie,
        traceId: "trace-teaching-course-route-smoke-other-teacher-list-courses",
      })
    : {
        statusCode: 0,
        headers: undefined,
        body: undefined,
      };
  const studentPreJoinCourseList = studentCookie
    ? await getCourses({
        baseUrl,
        cookie: studentCookie,
        traceId: "trace-teaching-course-route-smoke-student-prejoin-list-courses",
      })
    : {
        statusCode: 0,
        headers: undefined,
        body: undefined,
      };
  const unauthenticatedInviteJoin = invitationCode
    ? await postJson({
        baseUrl,
        path: inviteJoinRouteTemplate.replace(
          "{code}",
          encodeURIComponent(invitationCode),
        ),
        traceId: "trace-teaching-course-route-smoke-denied-invite-join",
      })
    : {
        statusCode: 0,
        headers: undefined,
        body: undefined,
      };
  const inviteJoin =
    invitationCode && studentCookie
      ? await postJson({
          baseUrl,
          path: inviteJoinRouteTemplate.replace(
            "{code}",
            encodeURIComponent(invitationCode),
          ),
          cookie: studentCookie,
          traceId: "trace-teaching-course-route-smoke-invite-join",
        })
      : {
          statusCode: 0,
          headers: undefined,
          body: undefined,
        };
  const duplicateInviteJoin =
    invitationCode && studentCookie
      ? await postJson({
          baseUrl,
          path: inviteJoinRouteTemplate.replace(
            "{code}",
            encodeURIComponent(invitationCode),
          ),
          cookie: studentCookie,
          traceId: "trace-teaching-course-route-smoke-duplicate-invite-join",
        })
      : {
          statusCode: 0,
          headers: undefined,
          body: undefined,
        };
  const studentPendingCourseList = studentCookie
    ? await getCourses({
        baseUrl,
        cookie: studentCookie,
        traceId: "trace-teaching-course-route-smoke-student-pending-list-courses",
      })
    : {
        statusCode: 0,
        headers: undefined,
        body: undefined,
      };
  const createdCourseTeachingOperation = courseId
    ? await postJson({
        baseUrl,
        path: teachingOperationRoute,
        cookie,
        traceId: "trace-teaching-course-route-smoke-created-course-operation",
        body: {
          operationId: "course-settings",
          actionSlot: "primary",
          courseId,
          sourceAction: "route-smoke-created-course-operation",
          idempotencyKey: createSmokeTeachingOperationIdempotencyKey({
            courseId,
            releaseRunId: plan.releaseRunId,
          }),
        },
      })
    : {
        statusCode: 0,
        headers: undefined,
        body: undefined,
      };
  const joinedMembership = isRecord(inviteJoin.body?.membership)
    ? inviteJoin.body.membership
    : undefined;
  const inviteJoinReceipt = isRecord(inviteJoin.body?.receipt)
    ? inviteJoin.body.receipt
    : undefined;
  const inviteJoinAuthSession = isRecord(inviteJoinReceipt?.authSession)
    ? inviteJoinReceipt.authSession
    : undefined;
  const membershipId =
    typeof joinedMembership?.membershipId === "string"
      ? joinedMembership.membershipId
      : undefined;
  const unauthenticatedMembershipApprove =
    classId && membershipId
      ? await postJson({
          baseUrl,
          path: membershipApproveRouteTemplate
            .replace("{classId}", encodeURIComponent(classId))
            .replace("{membershipId}", encodeURIComponent(membershipId)),
          traceId: "trace-teaching-course-route-smoke-denied-membership-approve",
        })
      : {
          statusCode: 0,
          headers: undefined,
          body: undefined,
        };
  const signedStudentMembershipApprove =
    classId && membershipId && studentCookie
      ? await postJson({
          baseUrl,
          path: membershipApproveRouteTemplate
            .replace("{classId}", encodeURIComponent(classId))
            .replace("{membershipId}", encodeURIComponent(membershipId)),
          cookie: studentCookie,
          traceId: "trace-teaching-course-route-smoke-denied-student-membership-approve",
        })
      : {
          statusCode: 0,
          headers: undefined,
          body: undefined,
        };
  const signedOtherTeacherMembershipApprove =
    classId && membershipId && otherTeacherCookie
      ? await postJson({
          baseUrl,
          path: membershipApproveRouteTemplate
            .replace("{classId}", encodeURIComponent(classId))
            .replace("{membershipId}", encodeURIComponent(membershipId)),
          cookie: otherTeacherCookie,
          traceId:
            "trace-teaching-course-route-smoke-denied-other-teacher-membership-approve",
        })
      : {
          statusCode: 0,
          headers: undefined,
          body: undefined,
        };
  const approveMembership =
    classId && membershipId
      ? await postJson({
          baseUrl,
          path: membershipApproveRouteTemplate
            .replace("{classId}", encodeURIComponent(classId))
            .replace("{membershipId}", encodeURIComponent(membershipId)),
          cookie,
          traceId: "trace-teaching-course-route-smoke-membership-approve",
        })
      : {
          statusCode: 0,
          headers: undefined,
          body: undefined,
        };
  const duplicateMembershipApprove =
    classId && membershipId
      ? await postJson({
          baseUrl,
          path: membershipApproveRouteTemplate
            .replace("{classId}", encodeURIComponent(classId))
            .replace("{membershipId}", encodeURIComponent(membershipId)),
          cookie,
          traceId: "trace-teaching-course-route-smoke-duplicate-membership-approve",
        })
      : {
          statusCode: 0,
          headers: undefined,
          body: undefined,
        };
  const approveMembershipReceipt = isRecord(approveMembership.body?.receipt)
    ? approveMembership.body.receipt
    : undefined;
  const approveMembershipAuthSession = isRecord(approveMembershipReceipt?.authSession)
    ? approveMembershipReceipt.authSession
    : undefined;
  const approvedMembership = isRecord(approveMembership.body?.membership)
    ? approveMembership.body.membership
    : undefined;
  const approvedClass = isRecord(approveMembership.body?.classItem)
    ? approveMembership.body.classItem
    : undefined;
  const approvedCourse = isRecord(approveMembership.body?.course)
    ? approveMembership.body.course
    : undefined;
  const courseManagementAfterMembershipReadback = await getExternalCourseManagementDatabase({
    externalStorageBaseUrl,
    externalStorageAccessToken,
  });
  const studentCourseList = studentCookie
    ? await getCourses({
        baseUrl,
        cookie: studentCookie,
        traceId: "trace-teaching-course-route-smoke-student-list-courses",
      })
    : {
        statusCode: 0,
        headers: undefined,
        body: undefined,
      };
  const listedCourses = Array.isArray(listCourses.body?.courses) ? listCourses.body.courses : [];
  const listedClasses = Array.isArray(listCourses.body?.classes) ? listCourses.body.classes : [];
  const otherTeacherListedCourses = Array.isArray(otherTeacherCourseList.body?.courses)
    ? otherTeacherCourseList.body.courses
    : [];
  const otherTeacherListedClasses = Array.isArray(otherTeacherCourseList.body?.classes)
    ? otherTeacherCourseList.body.classes
    : [];
  const otherTeacherListedMemberships = Array.isArray(
    otherTeacherCourseList.body?.memberships,
  )
    ? otherTeacherCourseList.body.memberships
    : [];
  const studentPreJoinListedCourses = Array.isArray(studentPreJoinCourseList.body?.courses)
    ? studentPreJoinCourseList.body.courses
    : [];
  const studentPreJoinListedClasses = Array.isArray(studentPreJoinCourseList.body?.classes)
    ? studentPreJoinCourseList.body.classes
    : [];
  const studentPreJoinListedMemberships = Array.isArray(
    studentPreJoinCourseList.body?.memberships,
  )
    ? studentPreJoinCourseList.body.memberships
    : [];
  const studentPendingListedCourses = Array.isArray(studentPendingCourseList.body?.courses)
    ? studentPendingCourseList.body.courses
    : [];
  const studentPendingListedClasses = Array.isArray(studentPendingCourseList.body?.classes)
    ? studentPendingCourseList.body.classes
    : [];
  const studentPendingListedMemberships = Array.isArray(
    studentPendingCourseList.body?.memberships,
  )
    ? studentPendingCourseList.body.memberships
    : [];
  const studentListedCourses = Array.isArray(studentCourseList.body?.courses)
    ? studentCourseList.body.courses
    : [];
  const studentListedClasses = Array.isArray(studentCourseList.body?.classes)
    ? studentCourseList.body.classes
    : [];
  const studentListedMemberships = Array.isArray(studentCourseList.body?.memberships)
    ? studentCourseList.body.memberships
    : [];

  const results = {
    unauthenticatedCourseListDenied:
      unauthenticatedCourseList.statusCode === 401 ||
      unauthenticatedCourseList.statusCode === 403
        ? "passed"
        : "failed",
    unauthenticatedCourseCoverDenied:
      unauthenticatedCourseCover.statusCode === 401 ||
      unauthenticatedCourseCover.statusCode === 403
        ? "passed"
        : "failed",
    unauthenticatedCourseCoverNoWriteSideEffects:
      (unauthenticatedCourseCover.statusCode === 401 ||
        unauthenticatedCourseCover.statusCode === 403) &&
      hasNoCourseCoverDenialWriteSideEffects({
        courseAssetsBody: courseAssetsReadback.body,
        courseManagementBody: courseManagementReadback.body,
        deniedTraceId: "trace-teaching-course-route-smoke-denied-course-cover",
      })
        ? "passed"
        : "failed",
    unauthenticatedCourseCreateDenied:
      unauthenticatedCourseCreate.statusCode === 401 ||
      unauthenticatedCourseCreate.statusCode === 403
        ? "passed"
        : "failed",
    unauthenticatedCourseCreateNoWriteSideEffects:
      (unauthenticatedCourseCreate.statusCode === 401 ||
        unauthenticatedCourseCreate.statusCode === 403) &&
      hasNoCourseManagementDenialWriteSideEffects({
        body: courseManagementReadback.body,
        deniedTraceId: "trace-teaching-course-route-smoke-denied-course-create",
      })
        ? "passed"
        : "failed",
    signedStudentCourseCreateDenied:
      signedStudentCourseCreate.statusCode === 403
        ? "passed"
        : "failed",
    signedStudentCourseCreateNoWriteSideEffects:
      signedStudentCourseCreate.statusCode === 403 &&
      hasNoCourseManagementDenialWriteSideEffects({
        body: courseManagementReadback.body,
        deniedTraceId: "trace-teaching-course-route-smoke-denied-student-course-create",
      })
        ? "passed"
        : "failed",
    signedStudentCourseCoverDenied:
      signedStudentCourseCover.statusCode === 403
        ? "passed"
        : "failed",
    signedStudentCourseCoverNoWriteSideEffects:
      signedStudentCourseCover.statusCode === 403 &&
      hasNoCourseCoverDenialWriteSideEffects({
        courseAssetsBody: courseAssetsReadback.body,
        courseManagementBody: courseManagementReadback.body,
        deniedTraceId: "trace-teaching-course-route-smoke-denied-student-course-cover",
      })
        ? "passed"
        : "failed",
    signedTeacherForeignCourseCreateDenied:
      isSignedTeacherForeignCourseCreateDeniedReady({
        response: signedTeacherForeignCourseCreate,
        foreignCourseId,
        traceId: "trace-teaching-course-route-smoke-foreign-course-create-denied",
      })
        ? "passed"
        : "failed",
    signedTeacherForeignCourseCreateNoWriteSideEffects:
      signedTeacherForeignCourseCreate.statusCode === 403 &&
      hasNoCourseManagementDenialWriteSideEffects({
        body: courseManagementReadback.body,
        deniedTraceId: "trace-teaching-course-route-smoke-foreign-course-create-denied",
      })
        ? "passed"
        : "failed",
    signedOtherTeacherCourseCoverDenied:
      signedOtherTeacherCourseCover.statusCode === 403 &&
      signedOtherTeacherCourseCover.body?.access?.reasonCode ===
        "teacher-course-ownership-required" &&
      hasValue(otherTeacherId) &&
      otherTeacherId !== teacherId
        ? "passed"
        : "failed",
    signedOtherTeacherCourseCoverNoWriteSideEffects:
      signedOtherTeacherCourseCover.statusCode === 403 &&
      hasNoCourseCoverDenialWriteSideEffects({
        courseAssetsBody: courseAssetsReadback.body,
        courseManagementBody: courseManagementReadback.body,
        deniedTraceId: "trace-teaching-course-route-smoke-denied-other-teacher-course-cover",
      })
        ? "passed"
        : "failed",
    unauthenticatedClassCreateDenied:
      unauthenticatedClassCreate.statusCode === 401 ||
      unauthenticatedClassCreate.statusCode === 403
        ? "passed"
        : "failed",
    unauthenticatedClassCreateNoWriteSideEffects:
      (unauthenticatedClassCreate.statusCode === 401 ||
        unauthenticatedClassCreate.statusCode === 403) &&
      hasNoCourseManagementDenialWriteSideEffects({
        body: courseManagementAfterClassReadback.body,
        deniedTraceId: "trace-teaching-course-route-smoke-denied-class-create",
      })
        ? "passed"
        : "failed",
    signedStudentClassCreateDenied:
      signedStudentClassCreate.statusCode === 403
        ? "passed"
        : "failed",
    signedStudentClassCreateNoWriteSideEffects:
      signedStudentClassCreate.statusCode === 403 &&
      hasNoCourseManagementDenialWriteSideEffects({
        body: courseManagementAfterClassReadback.body,
        deniedTraceId: "trace-teaching-course-route-smoke-denied-student-class-create",
      })
        ? "passed"
        : "failed",
    signedOtherTeacherClassCreateDenied:
      signedOtherTeacherClassCreate.statusCode === 403 &&
      signedOtherTeacherClassCreate.body?.access?.reasonCode ===
        "teacher-course-ownership-required" &&
      hasValue(otherTeacherId) &&
      otherTeacherId !== teacherId
        ? "passed"
        : "failed",
    signedOtherTeacherClassCreateNoWriteSideEffects:
      signedOtherTeacherClassCreate.statusCode === 403 &&
      hasNoCourseManagementDenialWriteSideEffects({
        body: courseManagementAfterClassReadback.body,
        deniedTraceId: "trace-teaching-course-route-smoke-denied-other-teacher-class-create",
      })
        ? "passed"
        : "failed",
    signedTeacherCourseCreated:
      createCourse.statusCode === 201 &&
      createdCourse?.ownerTeacherId === teacherId &&
      createCourse.body?.receipt?.status === "persisted"
        ? "passed"
        : "failed",
    duplicateCourseCreateDenied:
      isDuplicateCourseCreateDeniedReady({
        response: duplicateCourseCreate,
        courseId,
        traceId: "trace-teaching-course-route-smoke-duplicate-course-create",
      })
        ? "passed"
        : "failed",
    duplicateCourseCreateNoDuplicateSideEffects:
      isDuplicateCourseCreateDeniedReady({
        response: duplicateCourseCreate,
        courseId,
        traceId: "trace-teaching-course-route-smoke-duplicate-course-create",
      }) &&
      hasDuplicateCourseCreateNoDuplicateSideEffects({
        body: courseManagementReadback.body,
        courseId,
        duplicateTraceId: "trace-teaching-course-route-smoke-duplicate-course-create",
      })
        ? "passed"
        : "failed",
    courseCreateExternalSnapshotPolicyReturned:
      createCourseReceipt?.storagePolicy ===
        "external-redacted-teaching-course-management-snapshot" &&
      createCourseReceipt?.storageWritePolicy ===
        "external-optimistic-snapshot-replace"
        ? "passed"
        : "failed",
    courseCreateAuditSourceReadbackReturned:
      hasTeachingCourseManagementAuditSourceReadback({
        body: courseManagementReadback.body,
        action: "create-course",
        courseId,
        actorId: teacherId,
        traceId: "trace-teaching-course-route-smoke-create-course",
      })
        ? "passed"
        : "failed",
    courseCreateAuthSessionReadbackReturned:
      hasTeachingCourseManagementAuthSessionReadback({
        body: courseManagementReadback.body,
        action: "create-course",
        courseId,
        actorId: teacherId,
        traceId: "trace-teaching-course-route-smoke-create-course",
        authSession: createCourseAuthSession,
      })
        ? "passed"
        : "failed",
    createdCourseUsedCoverDraftScope:
      createCourse.statusCode === 201 &&
      typeof coverCourseId === "string" &&
      createdCourse?.courseId === coverCourseId
        ? "passed"
        : "failed",
    signedTeacherCourseCoverGenerated:
      courseCover.statusCode === 200 &&
      courseCover.body?.cover?.provider === "qwen" &&
      typeof coverAssetId === "string"
        ? "passed"
        : "failed",
    externalCoverAssetPersistenceReturned:
      coverAsset?.storagePolicy === "external-redacted-teaching-course-cover-assets" &&
      coverAsset?.storageWritePolicy === "external-optimistic-snapshot-replace"
        ? "passed"
        : "failed",
    courseCoverAssetReadbackRevisionReturned:
      hasNonEmptyRevision(courseAssetsReadback.body) ? "passed" : "failed",
    courseCoverAssetReadbackDatabaseAdapterReturned:
      hasManagedDatabaseAdapterProof(courseAssetsReadback.body?.productionDatabaseAdapter)
        ? "passed"
        : "failed",
    signedTeacherCourseCoverAuditAuthSessionReturned:
      coverAudit?.authMode === "signed-teacher-session" &&
      typeof coverAuditAuthSession?.sessionId === "string" &&
      coverAuditAuthSession.sessionId.length > 0
        ? "passed"
        : "failed",
    courseCoverExternalAssetAuditReadbackReturned:
      hasCourseCoverAssetAuditReadback({
        body: courseAssetsReadback.body,
        coverAssetId,
        traceId: typeof coverAudit?.traceId === "string" ? coverAudit.traceId : undefined,
        authSessionId:
          typeof coverAuditAuthSession?.sessionId === "string"
            ? coverAuditAuthSession.sessionId
            : undefined,
      })
        ? "passed"
        : "failed",
    courseCoverAssetRevisionRetryContractReturned:
      hasCourseCoverAssetRevisionRetryContract(coverAssetPersistence)
        ? "passed"
        : "failed",
    signedTeacherCourseCoverTraceHeaderReturned: hasSafeTraceHeader(courseCover.headers)
      ? "passed"
      : "failed",
    createdCourseBoundGeneratedCoverAsset:
      createCourse.statusCode === 201 &&
      typeof coverAssetId === "string" &&
      createdCourse?.coverAssetId === coverAssetId
        ? "passed"
        : "failed",
    existingCourseCoverBindingReadbackReturned:
      existingCourseCover.statusCode === 200 &&
      existingCourseBindingReceipt?.action === "bind-course-cover-asset" &&
      existingCourseBindingReceipt?.status === "persisted" &&
      existingCourseBindingReceipt?.storagePolicy ===
        "external-redacted-teaching-course-management-snapshot" &&
      existingCourseBindingReceipt?.storageWritePolicy ===
        "external-optimistic-snapshot-replace" &&
      hasExistingCourseCoverBindingReadback({
        body: courseManagementReadback.body,
        courseId,
        coverAssetId: existingCoverAssetId,
        traceId:
          typeof existingCourseBindingReceipt?.traceId === "string"
            ? existingCourseBindingReceipt.traceId
            : undefined,
      })
        ? "passed"
        : "failed",
    existingCourseCoverListedReadbackReturned:
      existingCourseCover.statusCode === 200 &&
      typeof existingCoverAssetId === "string" &&
      listedCourses.some(
        (course) =>
          isRecord(course) &&
          course.courseId === courseId &&
          course.coverAssetId === existingCoverAssetId,
      )
        ? "passed"
        : "failed",
    existingCourseCoverExternalAssetAuditReadbackReturned:
      existingCourseCover.statusCode === 200 &&
      hasCourseCoverAssetAuditReadback({
        body: existingCourseAssetsReadback.body,
        coverAssetId: existingCoverAssetId,
        traceId:
          typeof existingCoverAudit?.traceId === "string"
            ? existingCoverAudit.traceId
            : undefined,
        authSessionId:
          typeof existingCoverAuditAuthSession?.sessionId === "string"
            ? existingCoverAuditAuthSession.sessionId
            : undefined,
      })
        ? "passed"
        : "failed",
    existingCourseCoverBindingAuditSourceReturned:
      hasTeachingCourseManagementAuditSourceReadback({
        body: courseManagementReadback.body,
        action: "bind-course-cover-asset",
        courseId,
        actorId: teacherId,
        traceId:
          typeof existingCourseBindingReceipt?.traceId === "string"
            ? existingCourseBindingReceipt.traceId
            : undefined,
      })
        ? "passed"
        : "failed",
    externalOwnershipMerged:
      ownershipReceipt?.status === "merged" &&
      ownershipReceipt?.storagePolicy === "external-redacted-teacher-ai-ownership-merge" &&
      ownershipReceipt?.storageWritePolicy === "external-atomic-merge"
        ? "passed"
        : "failed",
    signedTeacherClassCreated:
      createClass.statusCode === 201 &&
      createdClass?.ownerTeacherId === teacherId &&
      createdClass?.courseId === courseId &&
      createClass.body?.receipt?.status === "persisted"
        ? "passed"
        : "failed",
    duplicateClassCreateDenied:
      isDuplicateClassCreateDeniedReady({
        response: duplicateClassCreate,
        courseId,
        classId,
        traceId: "trace-teaching-course-route-smoke-duplicate-class-create",
      })
        ? "passed"
        : "failed",
    duplicateClassCreateNoDuplicateSideEffects:
      isDuplicateClassCreateDeniedReady({
        response: duplicateClassCreate,
        courseId,
        classId,
        traceId: "trace-teaching-course-route-smoke-duplicate-class-create",
      }) &&
      hasDuplicateClassCreateNoDuplicateSideEffects({
        body: courseManagementAfterClassReadback.body,
        courseId,
        classId,
        duplicateTraceId: "trace-teaching-course-route-smoke-duplicate-class-create",
      })
        ? "passed"
        : "failed",
    classCreateExternalSnapshotPolicyReturned:
      createClassReceipt?.storagePolicy ===
        "external-redacted-teaching-course-management-snapshot" &&
      createClassReceipt?.storageWritePolicy ===
        "external-optimistic-snapshot-replace"
        ? "passed"
        : "failed",
    classCreateAuditSourceReadbackReturned:
      hasTeachingCourseManagementAuditSourceReadback({
        body: courseManagementAfterClassReadback.body,
        action: "create-class",
        courseId,
        classId,
        actorId: teacherId,
        traceId: "trace-teaching-course-route-smoke-create-class",
      })
        ? "passed"
        : "failed",
    classCreateAuthSessionReadbackReturned:
      hasTeachingCourseManagementAuthSessionReadback({
        body: courseManagementAfterClassReadback.body,
        action: "create-class",
        courseId,
        classId,
        actorId: teacherId,
        traceId: "trace-teaching-course-route-smoke-create-class",
        authSession: createClassAuthSession,
      })
        ? "passed"
        : "failed",
    signedTeacherCourseListReturned:
      listCourses.statusCode === 200 && listCourses.body?.receipt?.status === "read"
        ? "passed"
        : "failed",
    createdCourseListed:
      courseId &&
      listedCourses.some(
        (course) =>
          isRecord(course) &&
          course.courseId === courseId &&
          course.ownerTeacherId === teacherId,
      )
        ? "passed"
        : "failed",
    createdClassListed:
      courseId &&
      classId &&
      listedClasses.some(
        (classItem) =>
          isRecord(classItem) &&
          classItem.classId === classId &&
          classItem.courseId === courseId &&
          classItem.ownerTeacherId === teacherId,
      )
        ? "passed"
        : "failed",
    signedOtherTeacherCourseListReturned:
      otherTeacherCourseList.statusCode === 200 &&
      otherTeacherCourseList.body?.receipt?.status === "read"
        ? "passed"
        : "failed",
    otherTeacherCourseHidden:
      courseId &&
      classId &&
      otherTeacherCourseList.statusCode === 200 &&
      !otherTeacherListedCourses.some(
        (course) => isRecord(course) && course.courseId === courseId,
      ) &&
      !otherTeacherListedMemberships.some(
        (membership) =>
          isRecord(membership) &&
          (membership.courseId === courseId || membership.classId === classId),
      )
        ? "passed"
        : "failed",
    otherTeacherClassHidden:
      courseId &&
      classId &&
      otherTeacherCourseList.statusCode === 200 &&
      !otherTeacherListedClasses.some(
        (classItem) =>
          isRecord(classItem) &&
          (classItem.classId === classId || classItem.courseId === courseId),
      )
        ? "passed"
        : "failed",
    studentCourseHiddenBeforeMembership:
      courseId &&
      classId &&
      studentPreJoinCourseList.statusCode === 200 &&
      studentPreJoinCourseList.body?.receipt?.status === "read" &&
      !studentPreJoinListedCourses.some(
        (course) => isRecord(course) && course.courseId === courseId,
      ) &&
      !studentPreJoinListedClasses.some(
        (classItem) => isRecord(classItem) && classItem.classId === classId,
      ) &&
      !studentPreJoinListedMemberships.some(
        (membership) =>
          isRecord(membership) &&
          (membership.courseId === courseId || membership.classId === classId),
      )
        ? "passed"
        : "failed",
    unauthenticatedInviteJoinDenied:
      unauthenticatedInviteJoin.statusCode === 401 ||
      unauthenticatedInviteJoin.statusCode === 403
        ? "passed"
        : "failed",
    unauthenticatedInviteJoinNoWriteSideEffects:
      (unauthenticatedInviteJoin.statusCode === 401 ||
        unauthenticatedInviteJoin.statusCode === 403) &&
      hasNoCourseManagementDenialWriteSideEffects({
        body: courseManagementAfterMembershipReadback.body,
        deniedTraceId: "trace-teaching-course-route-smoke-denied-invite-join",
      })
        ? "passed"
        : "failed",
    signedStudentInviteJoined:
      inviteJoin.statusCode === 201 &&
      joinedMembership?.courseId === courseId &&
      joinedMembership?.classId === classId &&
      joinedMembership?.studentId === studentId &&
      joinedMembership?.membershipStatus === "pending-teacher-review" &&
      inviteJoin.body?.receipt?.status === "persisted"
        ? "passed"
        : "failed",
    duplicateStudentInviteJoinIdempotentReturned:
      isDuplicateStudentInviteJoinIdempotentReady({
        response: duplicateInviteJoin,
        readbackBody: courseManagementAfterMembershipReadback.body,
        courseId,
        classId,
        membershipId,
        invitationCode,
        studentId,
        traceId: "trace-teaching-course-route-smoke-duplicate-invite-join",
      })
        ? "passed"
        : "failed",
    duplicateStudentInviteJoinNoDuplicateSideEffects:
      hasDuplicateStudentInviteJoinNoDuplicateSideEffects({
        readbackBody: courseManagementAfterMembershipReadback.body,
        courseId,
        classId,
        membershipId,
        studentId,
        duplicateTraceId: "trace-teaching-course-route-smoke-duplicate-invite-join",
      })
        ? "passed"
        : "failed",
    studentPendingCourseHiddenBeforeApproval:
      courseId &&
      studentPendingCourseList.statusCode === 200 &&
      studentPendingCourseList.body?.receipt?.status === "read" &&
      !studentPendingListedCourses.some(
        (course) => isRecord(course) && course.courseId === courseId,
      )
        ? "passed"
        : "failed",
    studentPendingClassHiddenBeforeApproval:
      courseId &&
      classId &&
      studentPendingCourseList.statusCode === 200 &&
      studentPendingCourseList.body?.receipt?.status === "read" &&
      !studentPendingListedClasses.some(
        (classItem) =>
          isRecord(classItem) &&
          (classItem.classId === classId || classItem.courseId === courseId),
      )
        ? "passed"
        : "failed",
    studentPendingMembershipHiddenBeforeApproval:
      courseId &&
      classId &&
      studentPendingCourseList.statusCode === 200 &&
      studentPendingCourseList.body?.receipt?.status === "read" &&
      !studentPendingListedMemberships.some(
        (membership) =>
          isRecord(membership) &&
          (membership.courseId === courseId || membership.classId === classId),
      )
        ? "passed"
        : "failed",
    signedStudentInviteJoinAuditSourceReturned:
      hasTeachingCourseManagementAuditSourceReadback({
        body: courseManagementAfterMembershipReadback.body,
        action: "join-class-by-invite",
        courseId,
        classId,
        actorId: studentId,
        authMode: "app-student-session",
        traceId: "trace-teaching-course-route-smoke-invite-join",
      })
        ? "passed"
        : "failed",
    signedStudentInviteJoinAuthSessionReturned:
      inviteJoinReceipt?.action === "join-class-by-invite" &&
      inviteJoinReceipt?.actorId === studentId &&
      hasAuthSessionSummary(inviteJoinAuthSession)
        ? "passed"
        : "failed",
    signedStudentInviteJoinAuthSessionReadbackReturned:
      hasTeachingCourseManagementAuthSessionReadback({
        body: courseManagementAfterMembershipReadback.body,
        action: "join-class-by-invite",
        courseId,
        classId,
        actorId: studentId,
        authMode: "app-student-session",
        traceId: "trace-teaching-course-route-smoke-invite-join",
        authSession: inviteJoinAuthSession,
      })
        ? "passed"
        : "failed",
    createdCourseTeachingOperationAccepted:
      createdCourseTeachingOperation.statusCode === 200 &&
      createdCourseTeachingOperation.body?.receipt?.operationId === "course-settings" &&
      createdCourseTeachingOperation.body?.receipt?.actionSlot === "primary" &&
      createdCourseTeachingOperation.body?.receipt?.courseId === courseId &&
      createdCourseTeachingOperation.body?.receipt?.status === "persisted" &&
      createdCourseTeachingOperation.body?.domainPersistenceSummary?.status ===
        "persisted" &&
      createdCourseTeachingOperation.body?.courseSettingsReceipt?.status === "persisted"
        ? "passed"
        : "failed",
    unauthenticatedMembershipApprovalDenied:
      unauthenticatedMembershipApprove.statusCode === 401 ||
      unauthenticatedMembershipApprove.statusCode === 403
        ? "passed"
        : "failed",
    unauthenticatedMembershipApprovalNoWriteSideEffects:
      (unauthenticatedMembershipApprove.statusCode === 401 ||
        unauthenticatedMembershipApprove.statusCode === 403) &&
      hasNoCourseManagementDenialWriteSideEffects({
        body: courseManagementAfterMembershipReadback.body,
        deniedTraceId: "trace-teaching-course-route-smoke-denied-membership-approve",
      })
        ? "passed"
        : "failed",
    signedStudentMembershipApprovalDenied:
      signedStudentMembershipApprove.statusCode === 401 ||
      signedStudentMembershipApprove.statusCode === 403
        ? "passed"
        : "failed",
    signedStudentMembershipApprovalNoWriteSideEffects:
      (signedStudentMembershipApprove.statusCode === 401 ||
        signedStudentMembershipApprove.statusCode === 403) &&
      hasNoCourseManagementDenialWriteSideEffects({
        body: courseManagementAfterMembershipReadback.body,
        deniedTraceId:
          "trace-teaching-course-route-smoke-denied-student-membership-approve",
      })
        ? "passed"
        : "failed",
    signedOtherTeacherMembershipApprovalDenied:
      signedOtherTeacherMembershipApprove.statusCode === 403 &&
      signedOtherTeacherMembershipApprove.body?.access?.reasonCode ===
        "teacher-course-ownership-required" &&
      hasValue(otherTeacherId) &&
      otherTeacherId !== teacherId
        ? "passed"
        : "failed",
    signedOtherTeacherMembershipApprovalActorResourceReturned:
      signedOtherTeacherMembershipApprove.statusCode === 403 &&
      signedOtherTeacherMembershipApprove.body?.access?.reasonCode ===
        "teacher-course-ownership-required" &&
      signedOtherTeacherMembershipApprove.body?.access?.actor?.actorId ===
        otherTeacherId &&
      signedOtherTeacherMembershipApprove.body?.access?.actor?.role === "teacher" &&
      signedOtherTeacherMembershipApprove.body?.access?.resource?.classId ===
        classId &&
      signedOtherTeacherMembershipApprove.body?.access?.resource?.membershipId ===
        membershipId
        ? "passed"
        : "failed",
    signedOtherTeacherMembershipApprovalNoWriteSideEffects:
      signedOtherTeacherMembershipApprove.statusCode === 403 &&
      hasNoCourseManagementDenialWriteSideEffects({
        body: courseManagementAfterMembershipReadback.body,
        deniedTraceId:
          "trace-teaching-course-route-smoke-denied-other-teacher-membership-approve",
      })
        ? "passed"
        : "failed",
    signedTeacherMembershipApproved:
      approveMembership.statusCode === 200 &&
      approvedMembership?.membershipId === membershipId &&
      approvedMembership?.courseId === courseId &&
      approvedMembership?.classId === classId &&
      approvedMembership?.studentId === studentId &&
      approvedMembership?.membershipStatus === "approved" &&
      approvedClass?.classId === classId &&
      approvedClass?.students === 1 &&
      approvedCourse?.courseId === courseId &&
      approvedCourse?.students === 1 &&
      approveMembership.body?.receipt?.status === "persisted"
        ? "passed"
        : "failed",
    duplicateMembershipApprovalIdempotentReturned:
      isDuplicateMembershipApprovalIdempotentReady({
        response: duplicateMembershipApprove,
        readbackBody: courseManagementAfterMembershipReadback.body,
        courseId,
        classId,
        membershipId,
        studentId,
        teacherId,
        traceId: "trace-teaching-course-route-smoke-duplicate-membership-approve",
      })
        ? "passed"
        : "failed",
    duplicateMembershipApprovalNoDuplicateSideEffects:
      hasDuplicateMembershipApprovalNoDuplicateSideEffects({
        readbackBody: courseManagementAfterMembershipReadback.body,
        courseId,
        classId,
        membershipId,
        studentId,
        duplicateTraceId:
          "trace-teaching-course-route-smoke-duplicate-membership-approve",
      })
        ? "passed"
        : "failed",
    signedTeacherMembershipApprovalAuditSourceReturned:
      hasTeachingCourseManagementAuditSourceReadback({
        body: courseManagementAfterMembershipReadback.body,
        action: "approve-class-membership",
        courseId,
        classId,
        actorId: teacherId,
        authMode: "signed-teacher-session",
        traceId: "trace-teaching-course-route-smoke-membership-approve",
      })
        ? "passed"
        : "failed",
    signedTeacherMembershipApprovalAuthSessionReturned:
      approveMembershipReceipt?.action === "approve-class-membership" &&
      approveMembershipReceipt?.actorId === teacherId &&
      hasAuthSessionSummary(approveMembershipAuthSession)
        ? "passed"
        : "failed",
    signedTeacherMembershipApprovalAuthSessionReadbackReturned:
      hasTeachingCourseManagementAuthSessionReadback({
        body: courseManagementAfterMembershipReadback.body,
        action: "approve-class-membership",
        courseId,
        classId,
        actorId: teacherId,
        authMode: "signed-teacher-session",
        traceId: "trace-teaching-course-route-smoke-membership-approve",
        authSession: approveMembershipAuthSession,
      })
        ? "passed"
        : "failed",
    signedStudentCourseListReturned:
      studentCourseList.statusCode === 200 &&
      studentCourseList.body?.receipt?.status === "read"
        ? "passed"
        : "failed",
    approvedCourseVisibleForStudent:
      courseId &&
      classId &&
      studentListedCourses.some(
        (course) =>
          isRecord(course) &&
          course.courseId === courseId,
      ) &&
      studentListedClasses.some(
        (classItem) =>
          isRecord(classItem) &&
          classItem.classId === classId &&
          classItem.courseId === courseId,
      )
        ? "passed"
        : "failed",
    approvedMembershipListedForStudent:
      courseId &&
      classId &&
      membershipId &&
      studentListedCourses.some(
        (course) =>
          isRecord(course) &&
          course.courseId === courseId,
      ) &&
      studentListedClasses.some(
        (classItem) =>
          isRecord(classItem) &&
          classItem.classId === classId &&
          classItem.courseId === courseId,
      ) &&
      studentListedMemberships.some(
        (membership) =>
          isRecord(membership) &&
          membership.membershipId === membershipId &&
          membership.classId === classId &&
          membership.courseId === courseId &&
          membership.studentId === studentId &&
          membership.membershipStatus === "approved",
      )
        ? "passed"
        : "failed",
    unauthenticatedCourseListTraceHeaderReturned: hasSafeTraceHeader(
      unauthenticatedCourseList.headers,
    )
      ? "passed"
      : "failed",
    unauthenticatedCourseCoverTraceHeaderReturned: hasSafeTraceHeader(
      unauthenticatedCourseCover.headers,
    )
      ? "passed"
      : "failed",
    unauthenticatedCourseCreateTraceHeaderReturned: hasSafeTraceHeader(
      unauthenticatedCourseCreate.headers,
    )
      ? "passed"
      : "failed",
    signedStudentCourseCreateTraceHeaderReturned: hasSafeTraceHeader(
      signedStudentCourseCreate.headers,
    )
      ? "passed"
      : "failed",
    signedStudentCourseCoverTraceHeaderReturned: hasSafeTraceHeader(
      signedStudentCourseCover.headers,
    )
      ? "passed"
      : "failed",
    signedOtherTeacherCourseCoverTraceHeaderReturned: hasSafeTraceHeader(
      signedOtherTeacherCourseCover.headers,
    )
      ? "passed"
      : "failed",
    unauthenticatedClassCreateTraceHeaderReturned: hasSafeTraceHeader(
      unauthenticatedClassCreate.headers,
    )
      ? "passed"
      : "failed",
    signedStudentClassCreateTraceHeaderReturned: hasSafeTraceHeader(
      signedStudentClassCreate.headers,
    )
      ? "passed"
      : "failed",
    signedOtherTeacherClassCreateTraceHeaderReturned: hasSafeTraceHeader(
      signedOtherTeacherClassCreate.headers,
    )
      ? "passed"
      : "failed",
    signedTeacherCourseCreateTraceHeaderReturned: hasSafeTraceHeader(createCourse.headers)
      ? "passed"
      : "failed",
    signedTeacherCourseCreateTraceBodyReturned:
      createCourse.body?.traceId === "trace-teaching-course-route-smoke-create-course"
        ? "passed"
        : "failed",
    signedTeacherClassCreateTraceHeaderReturned: hasSafeTraceHeader(createClass.headers)
      ? "passed"
      : "failed",
    signedTeacherClassCreateTraceBodyReturned:
      createClass.body?.traceId === "trace-teaching-course-route-smoke-create-class"
        ? "passed"
        : "failed",
    signedTeacherCourseListTraceHeaderReturned: hasSafeTraceHeader(listCourses.headers)
      ? "passed"
      : "failed",
    signedOtherTeacherCourseListTraceHeaderReturned: hasSafeTraceHeader(
      otherTeacherCourseList.headers,
    )
      ? "passed"
      : "failed",
    signedStudentPreJoinCourseListTraceHeaderReturned: hasSafeTraceHeader(
      studentPreJoinCourseList.headers,
    )
      ? "passed"
      : "failed",
    signedStudentPendingCourseListTraceHeaderReturned: hasSafeTraceHeader(
      studentPendingCourseList.headers,
    )
      ? "passed"
      : "failed",
    unauthenticatedInviteJoinTraceHeaderReturned: hasSafeTraceHeader(
      unauthenticatedInviteJoin.headers,
    )
      ? "passed"
      : "failed",
    signedStudentInviteJoinTraceHeaderReturned: hasSafeTraceHeader(inviteJoin.headers)
      ? "passed"
      : "failed",
    signedStudentInviteJoinTraceBodyReturned:
      inviteJoin.body?.traceId === "trace-teaching-course-route-smoke-invite-join"
        ? "passed"
        : "failed",
    unauthenticatedMembershipApprovalTraceHeaderReturned: hasSafeTraceHeader(
      unauthenticatedMembershipApprove.headers,
    )
      ? "passed"
      : "failed",
    signedStudentMembershipApprovalTraceHeaderReturned: hasSafeTraceHeader(
      signedStudentMembershipApprove.headers,
    )
      ? "passed"
      : "failed",
    signedOtherTeacherMembershipApprovalTraceHeaderReturned: hasSafeTraceHeader(
      signedOtherTeacherMembershipApprove.headers,
    )
      ? "passed"
      : "failed",
    signedTeacherMembershipApproveTraceHeaderReturned: hasSafeTraceHeader(
      approveMembership.headers,
    )
      ? "passed"
      : "failed",
    signedTeacherMembershipApproveTraceBodyReturned:
      approveMembership.body?.traceId ===
      "trace-teaching-course-route-smoke-membership-approve"
        ? "passed"
        : "failed",
    signedStudentCourseListTraceHeaderReturned: hasSafeTraceHeader(studentCourseList.headers)
      ? "passed"
      : "failed",
  };
  const status = Object.values(results).every((result) => result === "passed")
    ? "passed"
    : "blocked";
  const diagnostics = createRouteFailureDiagnostics([
    {
      step: "courseCover",
      response: courseCover,
      expectedStatusCode: 200,
    },
    {
      step: "existingCourseCover",
      response: existingCourseCover,
      expectedStatusCode: 200,
    },
  ]);

  return {
    ...plan,
    status,
    httpStatus: {
      unauthenticatedCourseList: unauthenticatedCourseList.statusCode,
      unauthenticatedCourseCover: unauthenticatedCourseCover.statusCode,
      unauthenticatedCourseCreate: unauthenticatedCourseCreate.statusCode,
      signedStudentCourseCreate: signedStudentCourseCreate.statusCode,
      signedStudentCourseCover: signedStudentCourseCover.statusCode,
      signedTeacherForeignCourseCreate: signedTeacherForeignCourseCreate.statusCode,
      signedOtherTeacherCourseCover: signedOtherTeacherCourseCover.statusCode,
      unauthenticatedClassCreate: unauthenticatedClassCreate.statusCode,
      signedStudentClassCreate: signedStudentClassCreate.statusCode,
      signedOtherTeacherClassCreate: signedOtherTeacherClassCreate.statusCode,
      courseCover: courseCover.statusCode,
      createCourse: createCourse.statusCode,
      duplicateCourseCreate: duplicateCourseCreate.statusCode,
      existingCourseCover: existingCourseCover.statusCode,
      existingCourseAssetsReadback: existingCourseAssetsReadback.statusCode,
      externalCourseManagementReadback: courseManagementReadback.statusCode,
      createClass: createClass.statusCode,
      duplicateClassCreate: duplicateClassCreate.statusCode,
      externalCourseManagementAfterClassReadback:
        courseManagementAfterClassReadback.statusCode,
      externalCourseManagementAfterMembershipReadback:
        courseManagementAfterMembershipReadback.statusCode,
      listCourses: listCourses.statusCode,
      otherTeacherCourseList: otherTeacherCourseList.statusCode,
      studentPreJoinCourseList: studentPreJoinCourseList.statusCode,
      unauthenticatedInviteJoin: unauthenticatedInviteJoin.statusCode,
      inviteJoin: inviteJoin.statusCode,
      duplicateInviteJoin: duplicateInviteJoin.statusCode,
      studentPendingCourseList: studentPendingCourseList.statusCode,
      createdCourseTeachingOperation: createdCourseTeachingOperation.statusCode,
      unauthenticatedMembershipApprove: unauthenticatedMembershipApprove.statusCode,
      signedStudentMembershipApprove: signedStudentMembershipApprove.statusCode,
      signedOtherTeacherMembershipApprove:
        signedOtherTeacherMembershipApprove.statusCode,
      approveMembership: approveMembership.statusCode,
      duplicateMembershipApprove: duplicateMembershipApprove.statusCode,
      studentCourseList: studentCourseList.statusCode,
    },
    results,
    ...(diagnostics.routeFailures.length > 0 ? { diagnostics } : {}),
    safety: createSafety(),
  };
}

function createRouteFailureDiagnostics(entries) {
  return {
    routeFailures: entries
      .map(createRouteFailureDiagnostic)
      .filter((entry) => entry !== undefined),
  };
}

function createRouteFailureDiagnostic({ step, response, expectedStatusCode }) {
  if (!response || response.statusCode === expectedStatusCode || response.statusCode === 0) {
    return undefined;
  }
  const body = isRecord(response.body) ? response.body : undefined;
  const partialFailure = isRecord(body?.partialFailure) ? body.partialFailure : undefined;
  const traceId =
    readSafeDiagnosticId(body?.traceId) ??
    readSafeDiagnosticId(readHeaderValue(response.headers, "x-uais-trace-id"));
  const error = sanitizeDiagnosticText(
    typeof body?.error === "string"
      ? body.error
      : typeof body?.message === "string"
        ? body.message
        : undefined,
  );
  const partialFailureStatus = readSafeDiagnosticId(partialFailure?.status);
  const failedStep = readSafeDiagnosticId(partialFailure?.failedStep);

  return {
    step,
    statusCode: response.statusCode,
    ...(traceId ? { traceId } : {}),
    ...(error ? { error } : {}),
    ...(partialFailureStatus ? { partialFailureStatus } : {}),
    ...(failedStep ? { failedStep } : {}),
    redaction: {
      responseBody: "omitted",
      secrets: "omitted",
      localFiles: "omitted",
    },
  };
}

function readHeaderValue(headers, name) {
  const value = headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function readSafeDiagnosticId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(value)
    ? value
    : undefined;
}

function sanitizeDiagnosticText(value) {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const sanitized = value
    .trim()
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/uais_[a-z0-9_]+=[^;\s]+/gi, "[cookie-redacted]")
    .replace(/\/Users\/[^\s"',}]+/g, "[local-path-redacted]")
    .replace(/\/private\/[^\s"',}]+/g, "[local-path-redacted]")
    .replace(/\b(?:secret|token|password)[-_a-z0-9]{4,}\b/gi, "[secret-redacted]")
    .slice(0, 240);
  return sanitized || undefined;
}

function getCourses({ baseUrl, cookie, traceId }) {
  return requestJson({
    baseUrl,
    path: courseRoute,
    method: "GET",
    cookie,
    traceId: traceId ?? (cookie ? "trace-teaching-course-route-smoke-list-courses" : undefined),
  });
}

function getExternalCourseAssetsDatabase({
  externalStorageBaseUrl,
  externalStorageAccessToken,
}) {
  if (!hasValue(externalStorageBaseUrl) || !isStrongExternalStorageToken(externalStorageAccessToken)) {
    return {
      statusCode: 0,
      headers: undefined,
      body: undefined,
    };
  }

  return requestJson({
    url: `${externalStorageBaseUrl.replace(/\/+$/, "")}/teaching-course-assets/database`,
    method: "GET",
    authorization: `Bearer ${externalStorageAccessToken}`,
  });
}

function getExternalCourseManagementDatabase({
  externalStorageBaseUrl,
  externalStorageAccessToken,
}) {
  if (!hasValue(externalStorageBaseUrl) || !isStrongExternalStorageToken(externalStorageAccessToken)) {
    return {
      statusCode: 0,
      headers: undefined,
      body: undefined,
    };
  }

  return requestJson({
    url: `${externalStorageBaseUrl.replace(/\/+$/, "")}/teaching-course-management/database`,
    method: "GET",
    authorization: `Bearer ${externalStorageAccessToken}`,
  });
}

function postJson({ baseUrl, path, body, cookie, traceId }) {
  return requestJson({
    baseUrl,
    path,
    method: "POST",
    body,
    cookie,
    traceId,
  });
}

function requestJson({ baseUrl, path, url: fullUrl, method, body, cookie, traceId, authorization }) {
  const url = fullUrl ? new URL(fullUrl) : new URL(path, baseUrl);
  const payload = body ? JSON.stringify(body) : undefined;
  const requestImpl = url.protocol === "https:" ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const request = requestImpl(
      url,
      {
        method,
        headers: {
          accept: "application/json",
          ...(payload
            ? {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(payload),
              }
            : {}),
          ...(cookie ? { cookie } : {}),
          ...(traceId ? { "x-uais-trace-id": traceId } : {}),
          ...(authorization ? { authorization } : {}),
          "user-agent": routeSmokeUserAgent,
        },
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            body: parseJson(raw),
          });
        });
      },
    );
    request.on("error", reject);
    request.setTimeout(10_000, () => {
      request.destroy(new Error("Teaching course management route smoke request timed out."));
    });
    request.end(payload);
  });
}

function parseArgs(args) {
  const options = {
    live: false,
    approved: false,
    environment: "local-production",
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      options.live = false;
    } else if (arg === "--live") {
      options.live = true;
    } else if (arg === "--approved") {
      options.approved = true;
    } else if (arg === "--environment") {
      options.environment = readNextArg(args, ++index, arg);
    } else if (arg === "--env-file") {
      options.envFile = readNextArg(args, ++index, arg);
    } else if (arg === "--base-url") {
      options.baseUrl = readNextArg(args, ++index, arg);
    } else if (arg === "--teacher-id") {
      options.teacherId = readNextArg(args, ++index, arg);
    } else if (arg === "--other-teacher-id") {
      options.otherTeacherId = readNextArg(args, ++index, arg);
    } else if (arg === "--student-id") {
      options.studentId = readNextArg(args, ++index, arg);
    } else if (arg === "--cookie") {
      options.cookie = readNextArg(args, ++index, arg);
    } else if (arg === "--other-teacher-cookie") {
      options.otherTeacherCookie = readNextArg(args, ++index, arg);
    } else if (arg === "--student-cookie") {
      options.studentCookie = readNextArg(args, ++index, arg);
    } else if (arg === "--release-run-id") {
      options.releaseRunId = readNextArg(args, ++index, arg);
    } else if (arg === "--teacher-auth-provider-readiness") {
      options.teacherAuthProviderReadiness = readNextArg(args, ++index, arg);
    } else if (arg === "--app-auth-provider-readiness") {
      options.appAuthProviderReadiness = readNextArg(args, ++index, arg);
    } else if (arg === "--vercel-production-deployment") {
      options.vercelProductionDeployment = readNextArg(args, ++index, arg);
    } else if (arg === "--deployment-domain-reachability") {
      options.deploymentDomainReachability = readNextArg(args, ++index, arg);
    } else if (arg === "--external-storage-service-readiness") {
      options.externalStorageServiceReadiness = readNextArg(args, ++index, arg);
    } else if (arg === "--teacher-ai-ownership-backend") {
      options.teacherAiOwnershipBackend = readNextArg(args, ++index, arg);
    } else if (arg === "--course-management-backend") {
      options.courseManagementBackend = readNextArg(args, ++index, arg);
    } else if (arg === "--course-assets-backend") {
      options.courseAssetsBackend = readNextArg(args, ++index, arg);
    } else if (arg === "--teaching-operations-backend") {
      options.teachingOperationsBackend = readNextArg(args, ++index, arg);
    } else if (arg === "--cover-course-id") {
      options.coverCourseId = readNextArg(args, ++index, arg);
    } else if (arg === "--course-name") {
      options.courseName = readNextArg(args, ++index, arg);
    } else if (arg === "--class-name") {
      options.className = readNextArg(args, ++index, arg);
    } else if (arg === "--semester") {
      options.semester = readNextArg(args, ++index, arg);
    } else {
      throw new Error(
        "Usage: node -- scripts/teaching-course-management-route-smoke.mjs [--dry-run] [--live --approved] [--environment production|local-production] [--base-url URL] [--env-file PATH] [--teacher-id ID] [--other-teacher-id ID] [--student-id ID] [--cookie COOKIE] [--other-teacher-cookie COOKIE] [--student-cookie COOKIE] [--release-run-id ID] [--teacher-auth-provider-readiness PATH] [--app-auth-provider-readiness PATH] [--vercel-production-deployment PATH] [--deployment-domain-reachability PATH] [--external-storage-service-readiness PATH] [--teacher-ai-ownership-backend external] [--course-management-backend external] [--course-assets-backend external] [--teaching-operations-backend external] [--cover-course-id ID] [--course-name NAME] [--class-name NAME] [--semester SEMESTER]",
      );
    }
  }
  return options;
}

function readNextArg(args, index, flag) {
  const value = args[index];
  if (!value) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function readEnvFile(envFile) {
  if (!envFile) {
    return {};
  }
  const entries = {};
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    entries[trimmed.slice(0, separatorIndex)] = trimmed.slice(separatorIndex + 1);
  }
  return entries;
}

function readJsonEvidence(evidencePath) {
  if (!evidencePath) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(evidencePath, "utf8"));
  } catch {
    return null;
  }
}

function evaluateTeacherAuthProviderReadinessEvidence({ evidence, releaseRunId }) {
  if (evidence === undefined) {
    return undefined;
  }
  if (!isRecord(evidence)) {
    return {
      target: "missing",
      status: "invalid",
      authProviderMode: "missing",
      releaseRunIdStatus: "missing",
      valueRedacted: true,
    };
  }

  const target = typeof evidence.target === "string" ? evidence.target : "missing";
  const authProviderMode = acceptedTeacherAuthProviderModes.includes(evidence.authProviderMode)
    ? evidence.authProviderMode
    : "missing";
  const releaseRunIdStatus = releaseRunId
    ? evidence.releaseRunId === releaseRunId
      ? "matched"
      : "mismatched"
    : "missing";
  const summary = {
    target,
    authProviderMode,
    releaseRunIdStatus,
    valueRedacted: true,
  };
  if (target !== "teacher-auth-provider-readiness") {
    return { ...summary, status: "invalid-target" };
  }
  if (
    evidence.mode !== "live" ||
    evidence.environment !== "production" ||
    evidence.status !== "ready"
  ) {
    return { ...summary, status: "not-ready" };
  }
  if (!acceptedTeacherAuthProviderModes.includes(authProviderMode)) {
    return { ...summary, status: "auth-provider-mode-missing" };
  }
  if (releaseRunId && releaseRunIdStatus !== "matched") {
    return { ...summary, status: "release-run-id-mismatch" };
  }
  return { ...summary, status: "matched" };
}

function evaluateAppAuthProviderReadinessEvidence({ evidence, environment, releaseRunId }) {
  if (evidence === undefined) {
    return undefined;
  }
  if (!isRecord(evidence)) {
    return {
      target: "missing",
      status: "invalid",
      appAuthProviderMode: "missing",
      releaseRunIdStatus: "missing",
      valueRedacted: true,
    };
  }

  const target = typeof evidence.target === "string" ? evidence.target : "missing";
  const appAuthProviderMode = acceptedAppAuthProviderModes.includes(
    evidence.appAuthProviderMode,
  )
    ? evidence.appAuthProviderMode
    : "missing";
  const releaseRunIdStatus = releaseRunId
    ? evidence.releaseRunId === releaseRunId
      ? "matched"
      : "mismatched"
    : "missing";
  const summary = {
    target,
    appAuthProviderMode,
    releaseRunIdStatus,
    valueRedacted: true,
  };
  if (target !== "app-auth-provider-readiness") {
    return { ...summary, status: "invalid-target" };
  }
  const requiredEnvironment =
    environment === "local-production" ? "local-production" : "production";
  if (
    evidence.mode !== "live" ||
    evidence.environment !== requiredEnvironment ||
    evidence.status !== "ready"
  ) {
    return { ...summary, status: "not-ready" };
  }
  if (!acceptedAppAuthProviderModes.includes(appAuthProviderMode)) {
    return { ...summary, status: "app-auth-provider-mode-missing" };
  }
  if (releaseRunId && releaseRunIdStatus !== "matched") {
    return { ...summary, status: "release-run-id-mismatch" };
  }
  return { ...summary, status: "matched" };
}

function evaluateExternalStorageServiceReadinessEvidence({
  evidence,
  releaseRunId,
  storageServiceFingerprint,
}) {
  if (evidence === undefined) {
    return undefined;
  }
  if (!isRecord(evidence)) {
    return {
      target: "missing",
      status: "invalid",
      valueRedacted: true,
      releaseRunIdStatus: "missing",
    };
  }

  const target = typeof evidence.target === "string" ? evidence.target : "missing";
  const releaseRunIdStatus = releaseRunId
    ? evidence.releaseRunId === releaseRunId
      ? "matched"
      : "mismatched"
    : "missing";
  const summary = {
    target,
    valueRedacted: true,
    releaseRunIdStatus,
  };
  if (target !== "external-storage-service-readiness") {
    return { ...summary, status: "invalid-target" };
  }
  if (
    evidence.mode !== "live" ||
    evidence.environment !== "production" ||
    evidence.status !== "ready"
  ) {
    return { ...summary, status: "not-ready" };
  }
  if (releaseRunId && releaseRunIdStatus !== "matched") {
    return { ...summary, status: "release-run-id-mismatch" };
  }

  const readinessFingerprint = readStorageServiceFingerprint(evidence);
  if (!readinessFingerprint) {
    return { ...summary, status: "fingerprint-missing" };
  }
  if (
    storageServiceFingerprint.status !== "present" ||
    typeof storageServiceFingerprint.value !== "string"
  ) {
    return { ...summary, status: "smoke-fingerprint-missing" };
  }
  if (readinessFingerprint !== storageServiceFingerprint.value) {
    return { ...summary, status: "mismatched" };
  }
  return { ...summary, status: "matched" };
}

function evaluateDeploymentDomainReachabilityEvidence({
  evidence,
  deploymentFingerprint,
  releaseRunId,
}) {
  if (evidence === undefined) {
    return undefined;
  }
  if (!isRecord(evidence)) {
    return {
      target: "missing",
      status: "invalid",
      releaseRunIdStatus: "missing",
      deploymentFingerprintStatus: "missing",
      valueRedacted: true,
    };
  }

  const target = typeof evidence.target === "string" ? evidence.target : "missing";
  const releaseRunIdStatus = releaseRunId
    ? evidence.releaseRunId === releaseRunId
      ? "matched"
      : "mismatched"
    : "missing";
  const summary = {
    target,
    releaseRunIdStatus,
    deploymentFingerprintStatus: "missing",
    valueRedacted: true,
  };
  if (target !== "deployment-domain-reachability") {
    return { ...summary, status: "invalid-target" };
  }
  if (
    evidence.mode !== "live" ||
    evidence.environment !== "production" ||
    evidence.status !== "reachable"
  ) {
    return { ...summary, status: "not-reachable" };
  }
  if (releaseRunId && releaseRunIdStatus !== "matched") {
    return { ...summary, status: "release-run-id-mismatch" };
  }

  const evidenceFingerprint = isRecord(evidence.deploymentFingerprint)
    ? evidence.deploymentFingerprint
    : undefined;
  if (
    !evidenceFingerprint ||
    evidenceFingerprint.status !== "present" ||
    typeof evidenceFingerprint.value !== "string"
  ) {
    return { ...summary, status: "fingerprint-missing" };
  }
  if (deploymentFingerprint.status !== "present") {
    return { ...summary, status: "deployment-fingerprint-missing" };
  }
  if (evidenceFingerprint.value !== deploymentFingerprint.value) {
    return {
      ...summary,
      status: "mismatched",
      deploymentFingerprintStatus: "mismatched",
    };
  }

  return {
    ...summary,
    status: "matched",
    deploymentFingerprintStatus: "matched",
  };
}

function readStorageServiceFingerprint(evidence) {
  if (!isRecord(evidence) || !isRecord(evidence.storageServiceFingerprint)) {
    return undefined;
  }
  const fingerprint = evidence.storageServiceFingerprint;
  if (
    fingerprint.status === "present" &&
    typeof fingerprint.value === "string" &&
    /^sha256:[a-f0-9]{16}$/.test(fingerprint.value) &&
    fingerprint.source === "origin" &&
    fingerprint.valueRedacted === true
  ) {
    return fingerprint.value;
  }
  return undefined;
}

function readTeacherAuthProviderReadinessBlockedReasons(evidenceStatus) {
  if (!evidenceStatus || evidenceStatus.status === "matched") {
    return [];
  }
  if (evidenceStatus.status === "missing") {
    return ["teacher-auth-provider-readiness-evidence-missing"];
  }
  if (evidenceStatus.status === "release-run-id-mismatch") {
    return ["teacher-auth-provider-readiness-release-run-mismatch"];
  }
  return ["teacher-auth-provider-readiness-not-proven"];
}

function readAppAuthProviderReadinessBlockedReasons(evidenceStatus) {
  if (!evidenceStatus || evidenceStatus.status === "matched") {
    return [];
  }
  if (evidenceStatus.status === "missing") {
    return ["app-auth-provider-readiness-evidence-missing"];
  }
  if (evidenceStatus.status === "release-run-id-mismatch") {
    return ["app-auth-provider-readiness-release-run-mismatch"];
  }
  return ["app-auth-provider-readiness-not-proven"];
}

function readExternalStorageServiceReadinessBlockedReasons(evidenceStatus) {
  if (!evidenceStatus || evidenceStatus.status === "matched") {
    return [];
  }
  if (evidenceStatus.status === "missing") {
    return ["external-storage-service-readiness-evidence-missing"];
  }
  if (evidenceStatus.status === "release-run-id-mismatch") {
    return ["external-storage-service-readiness-release-run-mismatch"];
  }
  if (evidenceStatus.status === "mismatched") {
    return ["external-storage-service-readiness-fingerprint-mismatch"];
  }
  return [`external-storage-service-readiness-evidence-${evidenceStatus.status}`];
}

function readDeploymentDomainReachabilityBlockedReasons(evidenceStatus) {
  if (!evidenceStatus || evidenceStatus.status === "matched") {
    return [];
  }
  if (evidenceStatus.status === "missing") {
    return ["deployment-domain-reachability-evidence-missing"];
  }
  if (evidenceStatus.status === "release-run-id-mismatch") {
    return ["deployment-domain-reachability-release-run-mismatch"];
  }
  if (evidenceStatus.status === "mismatched") {
    return ["deployment-domain-reachability-fingerprint-mismatch"];
  }
  return [`deployment-domain-reachability-evidence-${evidenceStatus.status}`];
}

function evaluateVercelProductionDeploymentEvidence({ evidence, releaseRunId }) {
  if (evidence === undefined) {
    return undefined;
  }
  if (!isRecord(evidence)) {
    return {
      target: "missing",
      status: "invalid",
      deploymentObservationStatus: "missing",
      releaseRunIdStatus: "missing",
      valueRedacted: true,
    };
  }

  const target = typeof evidence.target === "string" ? evidence.target : "missing";
  const deploymentObservation = isRecord(evidence.deploymentObservation)
    ? evidence.deploymentObservation
    : {};
  const deploymentObservationStatus =
    deploymentObservation.status === "observed" ? "observed" : "missing";
  const releaseRunIdStatus = releaseRunId
    ? evidence.releaseRunId === releaseRunId
      ? "matched"
      : "mismatched"
    : "missing";
  const summary = {
    target,
    deploymentObservationStatus,
    releaseRunIdStatus,
    valueRedacted: true,
  };
  if (target !== "vercel-production-deployment") {
    return { ...summary, status: "invalid-target" };
  }
  if (
    evidence.mode !== "live" ||
    evidence.environment !== "production" ||
    evidence.status !== "deployed"
  ) {
    return { ...summary, status: "not-deployed" };
  }
  if (deploymentObservationStatus !== "observed") {
    return { ...summary, status: "deployment-not-observed" };
  }
  if (releaseRunId && releaseRunIdStatus !== "matched") {
    return { ...summary, status: "release-run-id-mismatch" };
  }
  return { ...summary, status: "matched" };
}

function readVercelProductionDeploymentBlockedReasons(evidenceStatus) {
  if (!evidenceStatus || evidenceStatus.status === "matched") {
    return [];
  }
  if (evidenceStatus.status === "missing") {
    return ["vercel-production-deployment-evidence-missing"];
  }
  if (evidenceStatus.status === "release-run-id-mismatch") {
    return ["vercel-production-deployment-release-run-mismatch"];
  }
  return ["vercel-production-deployment-not-proven"];
}

function readProductionDeploymentOriginBlockedReasons({ environment, deploymentOrigin }) {
  if (
    environment !== "production" ||
    (deploymentOrigin.status === "present" && deploymentOrigin.originClass === "remote-https")
  ) {
    return [];
  }
  return ["deployment-origin-not-remote-https"];
}

function describeDeploymentOrigin(baseUrl) {
  const originClass = classifyDeploymentOrigin(baseUrl);
  return {
    status: originClass === "missing" ? "missing" : "present",
    originClass,
    valueRedacted: true,
  };
}

function classifyDeploymentOrigin(baseUrl) {
  if (!hasValue(baseUrl)) {
    return "missing";
  }
  try {
    const origin = new URL(baseUrl);
    const hostClass = classifyOriginHost(origin.hostname);
    if (hostClass !== "remote") {
      return hostClass;
    }
    return origin.protocol === "https:" ? "remote-https" : "insecure-http";
  } catch {
    return "invalid";
  }
}

function classifyOriginHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host === "0.0.0.0") {
    return "local-loopback";
  }
  const octets = host.split(".").map((part) => Number(part));
  if (
    octets.length === 4 &&
    octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    if (octets[0] === 127) {
      return "local-loopback";
    }
    if (
      octets[0] === 10 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 169 && octets[1] === 254)
    ) {
      return "private-network";
    }
  }
  if (host.endsWith(".local")) {
    return "local-loopback";
  }
  return "remote";
}

function createDeploymentFingerprint(baseUrl) {
  if (!hasValue(baseUrl)) {
    return {
      status: "missing",
      valueRedacted: true,
    };
  }
  return {
    status: "present",
    value: `sha256:${createHash("sha256").update(baseUrl).digest("hex").slice(0, 16)}`,
  };
}

function createStorageServiceFingerprint(baseUrl) {
  if (!hasValue(baseUrl)) {
    return {
      status: "missing",
      valueRedacted: true,
    };
  }
  return {
    status: "present",
    value: `sha256:${createHash("sha256").update(baseUrl).digest("hex").slice(0, 16)}`,
    source: "origin",
    valueRedacted: true,
  };
}

function createSafety() {
  return {
    valuesRedacted: true,
    cookieValuesOmitted: true,
    responseBodiesOmitted: true,
    liveRequiresApproval: true,
    remoteMutationRequiresApproval: true,
  };
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function hasValue(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isStrongExternalStorageToken(value) {
  return hasValue(value) && value.trim().length >= 32;
}

function createSmokeProvisionalCourseId({ teacherId, courseName, now }) {
  const teacherSegment = createSafeIdSegment(teacherId) || "teacher";
  const courseSegment = createCourseSlug(courseName) || "course";
  return `teacher-draft-course-${teacherSegment}-${courseSegment}-${formatTimestampId(now)}`;
}

function createSmokeTeachingOperationIdempotencyKey({ courseId, releaseRunId }) {
  return `route-smoke-created-course-operation-${createSafeIdSegment(courseId) || "course"}-${
    createSafeIdSegment(releaseRunId) || "local"
  }`.slice(0, 120);
}

function createSafeIdSegment(value) {
  const segment = String(value ?? "")
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(segment) ? segment : undefined;
}

function createCourseSlug(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function formatTimestampId(now) {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "").replace("T", "-");
}

function hasSafeTraceHeader(headers) {
  const traceId = headers?.["x-uais-trace-id"];
  const value = Array.isArray(traceId) ? traceId[0] : traceId;
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(value);
}

function hasCourseCoverAssetAuditReadback({ body, coverAssetId, traceId, authSessionId }) {
  if (!isRecord(body?.database) || !coverAssetId || !traceId || !authSessionId) {
    return false;
  }
  const assets = Array.isArray(body.database.assets) ? body.database.assets : [];
  const auditEvents = Array.isArray(body.database.auditEvents)
    ? body.database.auditEvents
    : [];
  const hasAsset = assets.some(
    (asset) =>
      isRecord(asset) &&
      asset.assetId === coverAssetId &&
      asset.storagePolicy === "external-redacted-teaching-course-cover-assets",
  );
  const hasAuditEvent = auditEvents.some((event) => {
    const authSession = isRecord(event) && isRecord(event.authSession)
      ? event.authSession
      : undefined;
    return (
      isRecord(event) &&
      event.assetId === coverAssetId &&
      event.traceId === traceId &&
      event.authMode === "signed-teacher-session" &&
      authSession?.sessionId === authSessionId &&
      event.storagePolicy === "external-redacted-teaching-course-cover-audit-log"
    );
  });
  return hasAsset && hasAuditEvent;
}

function hasNonEmptyRevision(body) {
  return isRecord(body) && typeof body.revision === "string" && body.revision.trim().length > 0;
}

function hasManagedDatabaseAdapterProof(value) {
  return (
    isRecord(value) &&
    value.providerClass === "managed-database" &&
    value.migrationStatus === "up-to-date" &&
    value.backupPolicy === "point-in-time-restore" &&
    value.concurrencyControl === "transactional" &&
    value.valueRedacted === true
  );
}

function hasCourseCoverAssetRevisionRetryContract(persistence) {
  if (!isRecord(persistence) || !isRecord(persistence.revisionRetry)) {
    return false;
  }
  const retry = persistence.revisionRetry;
  return (
    persistence.status === "persisted" &&
    persistence.storagePolicy === "external-redacted-teaching-course-cover-assets" &&
    persistence.storageWritePolicy === "external-optimistic-snapshot-replace" &&
    persistence.concurrencyControl === "optimistic-revision-retry" &&
    (retry.status === "available" || retry.status === "retried") &&
    Number.isInteger(retry.attempts) &&
    retry.attempts >= 1 &&
    Number.isInteger(retry.conflicts) &&
    retry.conflicts >= 0 &&
    Number.isInteger(retry.maxAttempts) &&
    retry.maxAttempts >= 2 &&
    persistence.responsibleSession === "S12" &&
    isRedactedCourseCoverPersistenceReceipt(persistence.redaction)
  );
}

function isRedactedCourseCoverPersistenceReceipt(redaction) {
  return (
    isRecord(redaction) &&
    redaction.secrets === "omitted" &&
    redaction.localFiles === "omitted" &&
    redaction.assets === "generated-url-only"
  );
}

function hasExistingCourseCoverBindingReadback({ body, courseId, coverAssetId, traceId }) {
  if (!isRecord(body?.database) || !courseId || !coverAssetId || !traceId) {
    return false;
  }
  const courses = Array.isArray(body.database.courses) ? body.database.courses : [];
  const auditEvents = Array.isArray(body.database.auditEvents)
    ? body.database.auditEvents
    : [];
  const hasCourse = courses.some(
    (course) =>
      isRecord(course) &&
      course.courseId === courseId &&
      course.coverAssetId === coverAssetId &&
      course.storagePolicy === "external-redacted-teaching-course-management-snapshot",
  );
  const hasAuditEvent = auditEvents.some(
    (event) =>
      isRecord(event) &&
      event.action === "bind-course-cover-asset" &&
      event.courseId === courseId &&
      event.traceId === traceId &&
      event.authMode === "signed-teacher-session" &&
      event.storagePolicy === "external-redacted-teaching-course-management-audit-log",
  );
  return hasCourse && hasAuditEvent;
}

function hasNoCourseCoverDenialWriteSideEffects({
  courseAssetsBody,
  courseManagementBody,
  deniedTraceId,
}) {
  if (!deniedTraceId) {
    return false;
  }
  return [courseAssetsBody, courseManagementBody].every((body) => {
    const bodyText = JSON.stringify(body ?? {});
    return !bodyText.includes(deniedTraceId);
  });
}

function hasNoCourseManagementDenialWriteSideEffects({ body, deniedTraceId }) {
  if (!deniedTraceId) {
    return false;
  }
  const bodyText = JSON.stringify(body ?? {});
  return !bodyText.includes(deniedTraceId);
}

function hasDuplicateCourseCreateNoDuplicateSideEffects({ body, courseId, duplicateTraceId }) {
  if (!isRecord(body?.database) || !courseId || !duplicateTraceId) {
    return false;
  }
  const courses = Array.isArray(body.database.courses) ? body.database.courses : [];
  const matchingCourses = courses.filter(
    (course) => isRecord(course) && course.courseId === courseId,
  );
  const bodyText = JSON.stringify(body);
  return matchingCourses.length === 1 && !bodyText.includes(duplicateTraceId);
}

function hasDuplicateClassCreateNoDuplicateSideEffects({
  body,
  courseId,
  classId,
  duplicateTraceId,
}) {
  if (!isRecord(body?.database) || !courseId || !classId || !duplicateTraceId) {
    return false;
  }
  const classes = Array.isArray(body.database.classes) ? body.database.classes : [];
  const matchingClasses = classes.filter(
    (classItem) =>
      isRecord(classItem) &&
      classItem.courseId === courseId &&
      classItem.classId === classId,
  );
  const bodyText = JSON.stringify(body);
  return matchingClasses.length === 1 && !bodyText.includes(duplicateTraceId);
}

function hasDuplicateStudentInviteJoinNoDuplicateSideEffects({
  readbackBody,
  courseId,
  classId,
  membershipId,
  studentId,
  duplicateTraceId,
}) {
  if (
    !isRecord(readbackBody?.database) ||
    !courseId ||
    !classId ||
    !membershipId ||
    !studentId ||
    !duplicateTraceId
  ) {
    return false;
  }
  const memberships = Array.isArray(readbackBody.database.memberships)
    ? readbackBody.database.memberships
    : [];
  const matchingMemberships = memberships.filter(
    (membership) =>
      isRecord(membership) &&
      membership.membershipId === membershipId &&
      membership.courseId === courseId &&
      membership.classId === classId &&
      membership.studentId === studentId,
  );
  const bodyText = JSON.stringify(readbackBody);
  return matchingMemberships.length === 1 && !bodyText.includes(duplicateTraceId);
}

function isDuplicateCourseCreateDeniedReady({ response, courseId, traceId }) {
  const body = isRecord(response?.body) ? response.body : undefined;
  const bodyText = JSON.stringify(body ?? {});
  const encodedCourseId = courseId ? encodeURIComponent(courseId) : undefined;
  return (
    response?.statusCode === 409 &&
    readHeaderValue(response.headers, "x-uais-trace-id") === traceId &&
    body?.traceId === traceId &&
    typeof body?.error === "string" &&
    body.error.toLowerCase().includes("already exists") &&
    isRecord(body?.redaction) &&
    body.redaction.secrets === "omitted" &&
    body.redaction.localFiles === "omitted" &&
    !bodyText.includes("/Users/") &&
    (!courseId || !bodyText.includes(courseId)) &&
    (!encodedCourseId || !bodyText.includes(encodedCourseId))
  );
}

function isSignedTeacherForeignCourseCreateDeniedReady({
  response,
  foreignCourseId,
  traceId,
}) {
  const body = isRecord(response?.body) ? response.body : undefined;
  const bodyText = JSON.stringify(body ?? {});
  const encodedCourseId = foreignCourseId
    ? encodeURIComponent(foreignCourseId)
    : undefined;
  return (
    response?.statusCode === 403 &&
    readHeaderValue(response.headers, "x-uais-trace-id") === traceId &&
    body?.traceId === traceId &&
    typeof body?.error === "string" &&
    body.error.toLowerCase().includes("provisional id") &&
    isRecord(body?.redaction) &&
    body.redaction.secrets === "omitted" &&
    body.redaction.localFiles === "omitted" &&
    !bodyText.includes("/Users/") &&
    (!foreignCourseId || !bodyText.includes(foreignCourseId)) &&
    (!encodedCourseId || !bodyText.includes(encodedCourseId))
  );
}

function isDuplicateClassCreateDeniedReady({ response, courseId, classId, traceId }) {
  const body = isRecord(response?.body) ? response.body : undefined;
  const bodyText = JSON.stringify(body ?? {});
  const encodedCourseId = courseId ? encodeURIComponent(courseId) : undefined;
  return (
    response?.statusCode === 409 &&
    Boolean(courseId) &&
    Boolean(classId) &&
    typeof traceId === "string" &&
    body?.traceId === traceId &&
    bodyText.includes("Teaching class already exists") &&
    !bodyText.includes(String(classId)) &&
    (!encodedCourseId || !bodyText.includes(encodedCourseId))
  );
}

function isDuplicateStudentInviteJoinIdempotentReady({
  response,
  readbackBody,
  courseId,
  classId,
  membershipId,
  invitationCode,
  studentId,
  traceId,
}) {
  const body = isRecord(response?.body) ? response.body : undefined;
  const membership = isRecord(body?.membership) ? body.membership : undefined;
  const receipt = isRecord(body?.receipt) ? body.receipt : undefined;
  const auditEvents = Array.isArray(readbackBody?.database?.auditEvents)
    ? readbackBody.database.auditEvents
    : [];
  const duplicateAuditEvent = auditEvents.some(
    (event) =>
      isRecord(event) &&
      event.action === "join-class-by-invite" &&
      event.traceId === traceId,
  );

  return (
    response?.statusCode === 201 &&
    readHeaderValue(response.headers, "x-uais-trace-id") === traceId &&
    body?.traceId === traceId &&
    membership?.membershipId === membershipId &&
    membership?.courseId === courseId &&
    membership?.classId === classId &&
    membership?.invitationCode === invitationCode &&
    membership?.studentId === studentId &&
    membership?.membershipStatus === "pending-teacher-review" &&
    receipt?.action === "join-class-by-invite" &&
    receipt?.actorId === studentId &&
    receipt?.status === "persisted" &&
    duplicateAuditEvent === false
  );
}

function hasDuplicateMembershipApprovalNoDuplicateSideEffects({
  readbackBody,
  courseId,
  classId,
  membershipId,
  studentId,
  duplicateTraceId,
}) {
  if (
    !isRecord(readbackBody?.database) ||
    !courseId ||
    !classId ||
    !membershipId ||
    !studentId ||
    !duplicateTraceId
  ) {
    return false;
  }
  const memberships = Array.isArray(readbackBody.database.memberships)
    ? readbackBody.database.memberships
    : [];
  const matchingMemberships = memberships.filter(
    (membership) =>
      isRecord(membership) &&
      membership.membershipId === membershipId &&
      membership.courseId === courseId &&
      membership.classId === classId &&
      membership.studentId === studentId,
  );
  const bodyText = JSON.stringify(readbackBody);
  return matchingMemberships.length === 1 && !bodyText.includes(duplicateTraceId);
}

function isDuplicateMembershipApprovalIdempotentReady({
  response,
  readbackBody,
  courseId,
  classId,
  membershipId,
  studentId,
  teacherId,
  traceId,
}) {
  const body = isRecord(response?.body) ? response.body : undefined;
  const membership = isRecord(body?.membership) ? body.membership : undefined;
  const classItem = isRecord(body?.classItem) ? body.classItem : undefined;
  const course = isRecord(body?.course) ? body.course : undefined;
  const receipt = isRecord(body?.receipt) ? body.receipt : undefined;
  const auditEvents = Array.isArray(readbackBody?.database?.auditEvents)
    ? readbackBody.database.auditEvents
    : [];
  const duplicateAuditEvent = auditEvents.some(
    (event) =>
      isRecord(event) &&
      event.action === "approve-class-membership" &&
      event.traceId === traceId,
  );

  return (
    response?.statusCode === 200 &&
    readHeaderValue(response.headers, "x-uais-trace-id") === traceId &&
    body?.traceId === traceId &&
    membership?.membershipId === membershipId &&
    membership?.courseId === courseId &&
    membership?.classId === classId &&
    membership?.studentId === studentId &&
    membership?.membershipStatus === "approved" &&
    membership?.approvedByTeacherId === teacherId &&
    classItem?.classId === classId &&
    classItem?.courseId === courseId &&
    classItem?.students === 1 &&
    course?.courseId === courseId &&
    course?.students === 1 &&
    receipt?.action === "approve-class-membership" &&
    receipt?.actorId === teacherId &&
    receipt?.status === "persisted" &&
    duplicateAuditEvent === false
  );
}

function hasAuthSessionSummary(authSession) {
  return (
    isRecord(authSession) &&
    typeof authSession.sessionId === "string" &&
    authSession.sessionId.trim().length > 0 &&
    typeof authSession.authenticatedAt === "string" &&
    authSession.authenticatedAt.trim().length > 0 &&
    typeof authSession.expiresAt === "string" &&
    authSession.expiresAt.trim().length > 0
  );
}

function hasTeachingCourseManagementAuditSourceReadback({
  body,
  action,
  courseId,
  classId,
  actorId,
  authMode = "signed-teacher-session",
  traceId,
}) {
  if (!isRecord(body?.database) || !action || !courseId || !actorId || !traceId) {
    return false;
  }
  const auditEvents = Array.isArray(body.database.auditEvents)
    ? body.database.auditEvents
    : [];
  return auditEvents.some((event) => {
    const requestSource = isRecord(event) && isRecord(event.requestSource)
      ? event.requestSource
      : undefined;
    return (
      isRecord(event) &&
      event.action === action &&
      event.courseId === courseId &&
      (!classId || event.classId === classId) &&
      event.actorId === actorId &&
      event.traceId === traceId &&
      event.authMode === authMode &&
      event.storagePolicy === "external-redacted-teaching-course-management-audit-log" &&
      requestSource?.userAgent === routeSmokeUserAgent &&
      requestSource?.ipAddress === "redacted"
    );
  });
}

function hasTeachingCourseManagementAuthSessionReadback({
  body,
  action,
  courseId,
  classId,
  actorId,
  authMode = "signed-teacher-session",
  traceId,
  authSession,
}) {
  if (!isRecord(body?.database) || !action || !courseId || !actorId || !traceId) {
    return false;
  }
  if (!isRecord(authSession) || typeof authSession.sessionId !== "string") {
    return false;
  }
  const sessionId = authSession.sessionId.trim();
  if (!sessionId) {
    return false;
  }
  const auditEvents = Array.isArray(body.database.auditEvents)
    ? body.database.auditEvents
    : [];
  return auditEvents.some((event) => {
    const eventAuthSession = isRecord(event) && isRecord(event.authSession)
      ? event.authSession
      : undefined;
    return (
      isRecord(event) &&
      event.action === action &&
      event.courseId === courseId &&
      (!classId || event.classId === classId) &&
      event.actorId === actorId &&
      event.traceId === traceId &&
      event.authMode === authMode &&
      event.storagePolicy === "external-redacted-teaching-course-management-audit-log" &&
      eventAuthSession?.sessionId === sessionId &&
      typeof eventAuthSession.authenticatedAt === "string" &&
      eventAuthSession.authenticatedAt.length > 0 &&
      typeof eventAuthSession.expiresAt === "string" &&
      eventAuthSession.expiresAt.length > 0
    );
  });
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
