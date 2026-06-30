import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

let openServers: Server[] = [];

describe("teaching course management route smoke evidence", () => {
  afterEach(async () => {
    await Promise.all(openServers.map((server) => closeServerForTest(server)));
    openServers = [];
  });

  it("accepts local-production app auth readiness evidence as a local route binding", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teaching-course-local-app-auth-"));
    const appAuthEvidence = join(tmpDir, "app-auth-provider-readiness.json");
    writeFileSync(
      appAuthEvidence,
      JSON.stringify({
        target: "app-auth-provider-readiness",
        mode: "live",
        environment: "local-production",
        status: "ready",
        appAuthProviderMode: "trusted-account-provider",
      }),
    );

    const output = execFileSync("node", [
      "scripts/teaching-course-management-route-smoke.mjs",
      "--dry-run",
      "--environment",
      "local-production",
      "--app-auth-provider-readiness",
      appAuthEvidence,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.appAuthProviderReadinessEvidence).toEqual({
      target: "app-auth-provider-readiness",
      status: "matched",
      appAuthProviderMode: "trusted-account-provider",
      releaseRunIdStatus: "missing",
      valueRedacted: true,
    });
    expect(body.blockedReasons).not.toContain("app-auth-provider-readiness-not-proven");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("prints a ready production dry-run when ordinary course management has external persistence", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teaching-course-smoke-"));
    const envFile = join(tmpDir, "teaching-course.env");
    const releaseRunId = "release-teaching-course-route-smoke-auth-binding";
    const teacherAuthProviderReadiness = writeTeacherAuthProviderReadinessEvidenceForTest(
      tmpDir,
      {
        filename: "teacher-auth-provider-readiness.json",
        releaseRunId,
      },
    );
    const appAuthProviderReadiness = writeAppAuthProviderReadinessEvidenceForTest(
      tmpDir,
      {
        filename: "app-auth-provider-readiness.json",
        releaseRunId,
      },
    );
    const vercelProductionDeployment = writeVercelProductionDeploymentEvidenceForTest(
      tmpDir,
      {
        filename: "vercel-production-deployment.json",
        releaseRunId,
      },
    );
    const deploymentDomainReachability = writeDeploymentDomainReachabilityEvidenceForTest(
      tmpDir,
      {
        baseUrl: "https://teaching-course.example.test",
        filename: "deployment-domain-reachability.json",
        releaseRunId,
      },
    );
    const externalStorageServiceReadiness =
      writeExternalStorageServiceReadinessEvidenceForTest(tmpDir, {
        baseUrl: "https://external-storage.example.test",
        filename: "external-storage-service-readiness.json",
        releaseRunId,
      });
    writeFileSync(
      envFile,
      [
        "UAIS_DEPLOYMENT_BASE_URL=https://teaching-course.example.test",
        "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND=external",
        "UAIS_TEACHING_COURSE_ASSETS_BACKEND=external",
        "UAIS_TEACHING_OPERATIONS_BACKEND=external",
        "UAIS_EXTERNAL_STORAGE_BASE_URL=https://external-storage.example.test",
        "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=secret-external-storage-token-with-32-chars",
        "UAIS_TEACHER_AI_OWNERSHIP_BACKEND=external",
        "UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_COOKIE=secret-cookie-pair",
        "UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_TEACHER_ID=teacher-kang",
        "UAIS_TEACHING_COURSE_MANAGEMENT_OTHER_TEACHER_SMOKE_COOKIE=secret-other-teacher-cookie-pair",
        "UAIS_TEACHING_COURSE_MANAGEMENT_OTHER_TEACHER_SMOKE_TEACHER_ID=teacher-other",
        "UAIS_TEACHING_COURSE_MANAGEMENT_STUDENT_SMOKE_COOKIE=secret-student-cookie-pair",
        "UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_STUDENT_ID=Peter",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/teaching-course-management-route-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
      "--release-run-id",
      releaseRunId,
      "--teacher-auth-provider-readiness",
      teacherAuthProviderReadiness,
      "--app-auth-provider-readiness",
      appAuthProviderReadiness,
      "--vercel-production-deployment",
      vercelProductionDeployment,
      "--deployment-domain-reachability",
      deploymentDomainReachability,
      "--external-storage-service-readiness",
      externalStorageServiceReadiness,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "teaching-course-management-route-smoke",
        mode: "dry-run",
        environment: "production",
        network: "disabled",
        status: "ready",
        responsibleSessions: ["S12", "S22"],
        releaseRunId,
        routes: [
          "/api/teaching/course-cover",
          "/api/teaching/courses",
          "/api/teaching/operations",
          "/api/teaching/courses/{courseId}/classes",
          "/api/teaching/invite-codes/{code}/join",
          "/api/teaching/classes/{classId}/memberships/{membershipId}/approve",
        ],
        teacherAuthProviderReadinessEvidence: {
          target: "teacher-auth-provider-readiness",
          status: "matched",
          authProviderMode: "trusted-cookie-issuer",
          releaseRunIdStatus: "matched",
          valueRedacted: true,
        },
        auth: "issued-teacher-auth-cookie",
        appAuthProviderReadinessEvidence: {
          target: "app-auth-provider-readiness",
          status: "matched",
          appAuthProviderMode: "trusted-account-provider",
          releaseRunIdStatus: "matched",
          valueRedacted: true,
        },
        vercelProductionDeploymentEvidence: {
          target: "vercel-production-deployment",
          status: "matched",
          deploymentObservationStatus: "observed",
          releaseRunIdStatus: "matched",
          valueRedacted: true,
        },
        deploymentDomainReachabilityEvidence: {
          target: "deployment-domain-reachability",
          status: "matched",
          releaseRunIdStatus: "matched",
          deploymentFingerprintStatus: "matched",
          valueRedacted: true,
        },
        externalStorageServiceReadinessEvidence: {
          target: "external-storage-service-readiness",
          status: "matched",
          valueRedacted: true,
          releaseRunIdStatus: "matched",
        },
        deploymentOrigin: {
          status: "present",
          originClass: "remote-https",
          valueRedacted: true,
        },
        courseManagementBackend: "external",
        courseAssetsBackend: "external",
        teachingOperationsBackend: "external",
        requiredEnv: [
          { name: "UAIS_DEPLOYMENT_BASE_URL", status: "present" },
          { name: "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND", status: "present", requiredValue: "external" },
          { name: "UAIS_TEACHING_COURSE_ASSETS_BACKEND", status: "present", requiredValue: "external" },
          { name: "UAIS_TEACHING_OPERATIONS_BACKEND", status: "present", requiredValue: "external" },
          { name: "UAIS_EXTERNAL_STORAGE_BASE_URL", status: "present", valueRedacted: true },
          { name: "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN", status: "present", valueRedacted: true },
          { name: "UAIS_TEACHER_AI_OWNERSHIP_BACKEND", status: "present", requiredValue: "external" },
          { name: "UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_COOKIE", status: "present", valueRedacted: true },
          { name: "UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_TEACHER_ID", status: "present", valueRedacted: true },
          { name: "UAIS_TEACHING_COURSE_MANAGEMENT_OTHER_TEACHER_SMOKE_COOKIE", status: "present", valueRedacted: true },
          { name: "UAIS_TEACHING_COURSE_MANAGEMENT_OTHER_TEACHER_SMOKE_TEACHER_ID", status: "present", valueRedacted: true },
          { name: "UAIS_TEACHING_COURSE_MANAGEMENT_STUDENT_SMOKE_COOKIE", status: "present", valueRedacted: true },
          { name: "UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_STUDENT_ID", status: "present", valueRedacted: true },
        ],
        blockedReasons: [],
        safety: {
          valuesRedacted: true,
          cookieValuesOmitted: true,
          responseBodiesOmitted: true,
          liveRequiresApproval: true,
          remoteMutationRequiresApproval: true,
        },
      }),
    );
    expect(body.proves).toEqual([
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
    ]);
    expect(output).not.toContain("secret-cookie-pair");
    expect(output).not.toContain("secret-other-teacher-cookie-pair");
    expect(output).not.toContain("secret-student-cookie-pair");
    expect(output).not.toContain("secret-external-storage-token");
    expect(output).not.toContain("external-storage.example.test");
    expect(output).not.toContain("teacher-kang");
    expect(output).not.toContain("teacher-other");
    expect(output).not.toContain("teaching-course.example.test");
    expect(output).not.toContain("deployment.example.test");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("blocks production dry-run when deployment origin is local loopback", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teaching-course-local-origin-"));
    const envFile = join(tmpDir, "teaching-course.env");
    const releaseRunId = "release-teaching-course-route-smoke-local-origin";
    const teacherAuthProviderReadiness = writeTeacherAuthProviderReadinessEvidenceForTest(
      tmpDir,
      {
        filename: "teacher-auth-provider-readiness.json",
        releaseRunId,
      },
    );
    const vercelProductionDeployment = writeVercelProductionDeploymentEvidenceForTest(
      tmpDir,
      {
        filename: "vercel-production-deployment.json",
        releaseRunId,
      },
    );
    writeFileSync(
      envFile,
      [
        "UAIS_DEPLOYMENT_BASE_URL=http://127.0.0.1:3000",
        "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND=external",
        "UAIS_TEACHING_COURSE_ASSETS_BACKEND=external",
        "UAIS_EXTERNAL_STORAGE_BASE_URL=https://external-storage.example.test",
        "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=secret-external-storage-token-with-32-chars",
        "UAIS_TEACHER_AI_OWNERSHIP_BACKEND=external",
        "UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_COOKIE=secret-cookie-pair",
        "UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_TEACHER_ID=teacher-kang",
        "UAIS_TEACHING_COURSE_MANAGEMENT_OTHER_TEACHER_SMOKE_COOKIE=secret-other-teacher-cookie-pair",
        "UAIS_TEACHING_COURSE_MANAGEMENT_OTHER_TEACHER_SMOKE_TEACHER_ID=teacher-other",
        "UAIS_TEACHING_COURSE_MANAGEMENT_STUDENT_SMOKE_COOKIE=secret-student-cookie-pair",
        "UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_STUDENT_ID=Peter",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/teaching-course-management-route-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
      "--release-run-id",
      releaseRunId,
      "--teacher-auth-provider-readiness",
      teacherAuthProviderReadiness,
      "--vercel-production-deployment",
      vercelProductionDeployment,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "teaching-course-management-route-smoke",
        mode: "dry-run",
        environment: "production",
        status: "blocked",
        deploymentOrigin: {
          status: "present",
          originClass: "local-loopback",
          valueRedacted: true,
        },
      }),
    );
    expect(body.blockedReasons).toContain("deployment-origin-not-remote-https");
    expect(output).not.toContain("127.0.0.1");
    expect(output).not.toContain("secret-cookie-pair");
    expect(output).not.toContain("secret-other-teacher-cookie-pair");
    expect(output).not.toContain("secret-student-cookie-pair");
    expect(output).not.toContain("secret-external-storage-token");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("passes live approved smoke when deployed course/class routes deny unsigned reads and read back created records", async () => {
    const teacherCookie = "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig";
    const otherTeacherCookie =
      "uais_teacher_auth_claims=other-claims; uais_teacher_auth_signature=other-sig";
    const studentCookie = "uais_app_session=student-claims; uais_app_session_signature=student-sig";
    const externalStorageToken = "test-external-storage-token-with-32-chars";
    let createdCourseId = "teacher-course-route-smoke-enterprise-course-20260623-111500";
    let createdClassId = `${createdCourseId}-class-1`;
    let createdMembershipId = `membership-${createdClassId}-Peter`;
    let existingCourseCoverAssetId = "course-cover-request-course-smoke-existing-cover";
    let didGenerateExistingCourseCover = false;
    let didCreateClass = false;
    let didInviteJoin = false;
    let didApproveMembership = false;
    const requests: Array<{
      method: string;
      url: string;
      authorization?: string;
      cookie?: string;
      body?: unknown;
    }> = [];
    const server = createServer((request, response) => {
      let rawBody = "";
      request.on("data", (chunk) => {
        rawBody += chunk;
      });
      request.on("end", () => {
        const body = rawBody ? JSON.parse(rawBody) : undefined;
        requests.push({
          method: request.method ?? "GET",
          url: request.url ?? "",
          ...(request.headers.authorization
            ? { authorization: request.headers.authorization }
            : {}),
          ...(request.headers.cookie ? { cookie: request.headers.cookie } : {}),
          ...(body ? { body } : {}),
        });

        if (
          request.method === "GET" &&
          request.url === "/teaching-course-assets/database" &&
          request.headers.authorization === `Bearer ${externalStorageToken}`
        ) {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              database: {
                schemaVersion: "uais-teaching-course-assets-v1",
                updatedAt: "2026-06-23T11:00:00.000Z",
                assets: [
                  {
                    assetId: "course-cover-request-course-smoke-cover",
                    assetType: "course-cover",
                    courseId: "teacher-draft-route-smoke-enterprise-course",
                    storagePolicy: "external-redacted-teaching-course-cover-assets",
                  },
                  ...(didGenerateExistingCourseCover
                    ? [
                        {
                          assetId: "course-cover-request-course-smoke-existing-cover",
                          assetType: "course-cover",
                          courseId: createdCourseId,
                          storagePolicy:
                            "external-redacted-teaching-course-cover-assets",
                        },
                      ]
                    : []),
                ],
                auditEvents: [
                  {
                    traceId: "trace-course-smoke-course-cover",
                    eventType: "teaching-course-cover.generated",
                    actorId: "teacher-kang",
                    authMode: "signed-teacher-session",
                    authSession: {
                      sessionId: "teacher-cover-route-smoke-session",
                      authenticatedAt: "2026-06-23T11:00:00.000Z",
                      expiresAt: "2026-06-23T12:00:00.000Z",
                    },
                    assetId: "course-cover-request-course-smoke-cover",
                    storagePolicy: "external-redacted-teaching-course-cover-audit-log",
                  },
                  ...(didGenerateExistingCourseCover
                    ? [
                        {
                          traceId:
                            "trace-teaching-course-route-smoke-existing-course-cover",
                          eventType: "teaching-course-cover.generated",
                          actorId: "teacher-kang",
                          authMode: "signed-teacher-session",
                          authSession: {
                            sessionId: "teacher-cover-route-smoke-session",
                            authenticatedAt: "2026-06-23T11:00:00.000Z",
                            expiresAt: "2026-06-23T12:00:00.000Z",
                          },
                          assetId: "course-cover-request-course-smoke-existing-cover",
                          storagePolicy:
                            "external-redacted-teaching-course-cover-audit-log",
                        },
                      ]
                    : []),
                ],
              },
              revision: "rev-course-assets-smoke",
              productionDatabaseAdapter: {
                providerClass: "managed-database",
                migrationStatus: "up-to-date",
                backupPolicy: "point-in-time-restore",
                concurrencyControl: "transactional",
                valueRedacted: true,
              },
              secret: "must-not-leak",
            }),
          );
          return;
        }

        if (
          request.method === "GET" &&
          request.url === "/teaching-course-management/database" &&
          request.headers.authorization === `Bearer ${externalStorageToken}`
        ) {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              database: {
                schemaVersion: "uais-teaching-course-management-v1",
                updatedAt: "2026-06-23T11:05:00.000Z",
                courses: [
                  {
                    courseId: createdCourseId,
                    ownerTeacherId: "teacher-kang",
                    courseName: "Route Smoke Enterprise Course",
                    coverAssetId: existingCourseCoverAssetId,
                    storagePolicy: "external-redacted-teaching-course-management-snapshot",
                  },
                ],
                classes: didCreateClass
                  ? [
                      {
                        classId: createdClassId,
                        courseId: createdCourseId,
                        ownerTeacherId: "teacher-kang",
                        className: "Route Smoke Class",
                        storagePolicy:
                          "external-redacted-teaching-course-management-snapshot",
                      },
                    ]
                  : [],
                memberships: didInviteJoin
                  ? [
                      {
                        membershipId: createdMembershipId,
                        courseId: createdCourseId,
                        classId: createdClassId,
                        invitationCode: "66334455",
                        studentId: "Peter",
                        studentDisplayName: "Peter",
                        membershipStatus: didApproveMembership
                          ? "approved"
                          : "pending-teacher-review",
                        joinedAt: "2026-06-23T11:20:00.000Z",
                        ...(didApproveMembership
                          ? {
                              approvedAt: "2026-06-23T11:25:00.000Z",
                              approvedByTeacherId: "teacher-kang",
                            }
                          : {}),
                        storagePolicy:
                          "external-redacted-teaching-course-management-snapshot",
                      },
                    ]
                  : [],
                auditEvents: [
                  {
                    action: "create-course",
                    actorId: "teacher-kang",
                    courseId: createdCourseId,
                    traceId: "trace-teaching-course-route-smoke-create-course",
                    authMode: "signed-teacher-session",
                    authSession: {
                      sessionId: "teacher-kang-course-management-session",
                      authenticatedAt: "2026-06-23T11:00:00.000Z",
                      expiresAt: "2026-06-23T13:00:00.000Z",
                    },
                    storagePolicy: "external-redacted-teaching-course-management-audit-log",
                    requestSource: {
                      userAgent: "UAIS teaching course management route smoke",
                      ipAddress: "redacted",
                    },
                  },
                  {
                    action: "bind-course-cover-asset",
                    actorId: "teacher-kang",
                    courseId: createdCourseId,
                    traceId: "trace-teaching-course-route-smoke-existing-course-cover",
                    authMode: "signed-teacher-session",
                    storagePolicy: "external-redacted-teaching-course-management-audit-log",
                    requestSource: {
                      userAgent: "UAIS teaching course management route smoke",
                      ipAddress: "redacted",
                    },
                  },
                  ...(didCreateClass
                    ? [
                        {
                          action: "create-class",
                          actorId: "teacher-kang",
                          courseId: createdCourseId,
                          classId: createdClassId,
                          traceId: "trace-teaching-course-route-smoke-create-class",
                          authMode: "signed-teacher-session",
                          authSession: {
                            sessionId: "teacher-kang-course-management-session",
                            authenticatedAt: "2026-06-23T11:00:00.000Z",
                            expiresAt: "2026-06-23T13:00:00.000Z",
                          },
                          storagePolicy:
                            "external-redacted-teaching-course-management-audit-log",
                          requestSource: {
                            userAgent: "UAIS teaching course management route smoke",
                            ipAddress: "redacted",
                          },
                        },
                      ]
                    : []),
                  ...(didInviteJoin
                    ? [
                        {
                          action: "join-class-by-invite",
                          actorId: "Peter",
                          courseId: createdCourseId,
                          classId: createdClassId,
                          traceId: "trace-teaching-course-route-smoke-invite-join",
                          authMode: "app-student-session",
                          authSession: {
                            sessionId: "student-peter-app-session",
                            authenticatedAt: "2026-06-23T11:10:00.000Z",
                            expiresAt: "2026-06-23T13:10:00.000Z",
                          },
                          storagePolicy:
                            "external-redacted-teaching-course-management-audit-log",
                          requestSource: {
                            userAgent: "UAIS teaching course management route smoke",
                            ipAddress: "redacted",
                          },
                        },
                      ]
                    : []),
                  ...(didApproveMembership
                    ? [
                        {
                          action: "approve-class-membership",
                          actorId: "teacher-kang",
                          courseId: createdCourseId,
                          classId: createdClassId,
                          traceId: "trace-teaching-course-route-smoke-membership-approve",
                          authMode: "signed-teacher-session",
                          authSession: {
                            sessionId: "teacher-kang-course-management-session",
                            authenticatedAt: "2026-06-23T11:00:00.000Z",
                            expiresAt: "2026-06-23T13:00:00.000Z",
                          },
                          storagePolicy:
                            "external-redacted-teaching-course-management-audit-log",
                          requestSource: {
                            userAgent: "UAIS teaching course management route smoke",
                            ipAddress: "redacted",
                          },
                        },
                      ]
                    : []),
                ],
              },
              revision: "rev-course-management-smoke",
              secret: "must-not-leak",
            }),
          );
          return;
        }

        if (!request.headers.cookie) {
          response.writeHead(401, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-course-smoke-denied",
          });
          response.end(JSON.stringify({ error: "auth required", secret: "must-not-leak" }));
          return;
        }

        if (
          request.method === "POST" &&
          request.url === "/api/teaching/course-cover" &&
          request.headers.cookie === teacherCookie
        ) {
          const isExistingCourseCover = body.courseId === createdCourseId;
          const assetId = isExistingCourseCover
            ? "course-cover-request-course-smoke-existing-cover"
            : "course-cover-request-course-smoke-cover";
          const traceId = isExistingCourseCover
            ? "trace-teaching-course-route-smoke-existing-course-cover"
            : "trace-course-smoke-course-cover";
          existingCourseCoverAssetId = assetId;
          if (isExistingCourseCover) {
            didGenerateExistingCourseCover = true;
          }
          response.writeHead(200, {
            "content-type": "application/json",
            "x-uais-trace-id": traceId,
          });
          response.end(
            JSON.stringify({
              cover: {
                provider: "qwen",
                providerRole: "image-generation",
                model: "qwen-image-2.0-pro",
                imageUrl: "https://dashscope-result/course-cover.png",
                requestId: isExistingCourseCover
                  ? "request-course-smoke-existing-cover"
                  : "request-course-smoke-cover",
              },
              asset: {
                assetId,
                assetType: "course-cover",
                courseId: body.courseId,
                storagePolicy: "external-redacted-teaching-course-cover-assets",
                storageWritePolicy: "external-optimistic-snapshot-replace",
              },
              assetPersistence: {
                status: "persisted",
                storagePolicy: "external-redacted-teaching-course-cover-assets",
                storageWritePolicy: "external-optimistic-snapshot-replace",
                concurrencyControl: "optimistic-revision-retry",
                revisionRetry: {
                  status: "available",
                  attempts: 1,
                  conflicts: 0,
                  maxAttempts: 2,
                },
                responsibleSession: "S12",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "generated-url-only",
                },
              },
              ...(isExistingCourseCover
                ? {
                    courseBindingReceipt: {
                      action: "bind-course-cover-asset",
                      actorId: "teacher-kang",
                      courseId: createdCourseId,
                      traceId,
                      status: "persisted",
                      storagePolicy:
                        "external-redacted-teaching-course-management-snapshot",
                      storageWritePolicy: "external-optimistic-snapshot-replace",
                      responsibleSession: "S12",
                    },
                  }
                : {}),
              audit: {
                traceId,
                eventType: "teaching-course-cover.generated",
                actor: { actorId: "teacher-kang", role: "teacher" },
                authMode: "signed-teacher-session",
                authSession: {
                  sessionId: "teacher-cover-route-smoke-session",
                  authenticatedAt: "2026-06-23T11:00:00.000Z",
                  expiresAt: "2026-06-23T12:00:00.000Z",
                },
                storagePolicy: "external-redacted-teaching-course-cover-audit-log",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "generated-url-only",
                },
              },
              secret: "must-not-leak",
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url === "/api/teaching/courses" &&
          request.headers.cookie === studentCookie
        ) {
          response.writeHead(403, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-course-smoke-student-course-create-denied",
          });
          response.end(
            JSON.stringify({
              error: "teacher role required",
              access: {
                reasonCode: "teacher-role-required",
                actorRole: "student",
              },
              secret: "must-not-leak",
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url === "/api/teaching/course-cover" &&
          request.headers.cookie === studentCookie
        ) {
          response.writeHead(403, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-course-smoke-student-course-cover-denied",
          });
          response.end(
            JSON.stringify({
              error: "teacher role required",
              access: {
                reasonCode: "teacher-role-required",
                actorRole: "student",
              },
              secret: "must-not-leak",
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url === "/api/teaching/course-cover" &&
          request.headers.cookie === otherTeacherCookie
        ) {
          response.writeHead(403, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-course-smoke-other-teacher-course-cover-denied",
          });
          response.end(
            JSON.stringify({
              error: "teaching course ownership required",
              access: {
                reasonCode: "teacher-course-ownership-required",
                actorId: "teacher-other",
              },
              secret: "must-not-leak",
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url === "/api/teaching/courses" &&
          request.headers.cookie === teacherCookie
        ) {
          if (
            request.headers["x-uais-trace-id"] ===
            "trace-teaching-course-route-smoke-foreign-course-create-denied"
          ) {
            response.writeHead(403, {
              "content-type": "application/json",
              "x-uais-trace-id":
                "trace-teaching-course-route-smoke-foreign-course-create-denied",
            });
            response.end(
              JSON.stringify({
                error: "Teaching course provisional id must belong to the signed teacher.",
                traceId: "trace-teaching-course-route-smoke-foreign-course-create-denied",
                access: {
                  status: "denied",
                  reasonCode: "teacher-course-ownership-required",
                  redaction: {
                    secrets: "omitted",
                    localFiles: "omitted",
                    assets: "ids-only",
                  },
                },
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "ids-only",
                },
              }),
            );
            return;
          }
          if (
            request.headers["x-uais-trace-id"] ===
            "trace-teaching-course-route-smoke-duplicate-course-create"
          ) {
            response.writeHead(409, {
              "content-type": "application/json",
              "x-uais-trace-id":
                "trace-teaching-course-route-smoke-duplicate-course-create",
            });
            response.end(
              JSON.stringify({
                error: "Teaching course already exists.",
                traceId: "trace-teaching-course-route-smoke-duplicate-course-create",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "ids-only",
                },
              }),
            );
            return;
          }
          createdCourseId =
            typeof body.courseId === "string" ? body.courseId : createdCourseId;
          createdClassId = `${createdCourseId}-class-1`;
          createdMembershipId = `membership-${createdClassId}-Peter`;
          response.writeHead(201, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-course-smoke-create-course",
          });
          response.end(
            JSON.stringify({
              course: {
                courseId: createdCourseId,
                ownerTeacherId: "teacher-kang",
                courseName: body.name,
                coverAssetId: body.coverAssetId,
                students: 0,
              },
              receipt: {
                action: "create-course",
                actorId: "teacher-kang",
                status: "persisted",
                authSession: {
                  sessionId: "teacher-kang-course-management-session",
                  authenticatedAt: "2026-06-23T11:00:00.000Z",
                  expiresAt: "2026-06-23T13:00:00.000Z",
                },
                storagePolicy: "external-redacted-teaching-course-management-snapshot",
                storageWritePolicy: "external-optimistic-snapshot-replace",
              },
              ownershipReceipt: {
                teacherId: "teacher-kang",
                status: "merged",
                storagePolicy: "external-redacted-teacher-ai-ownership-merge",
                storageWritePolicy: "external-atomic-merge",
              },
              traceId: "trace-teaching-course-route-smoke-create-course",
              secret: "must-not-leak",
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url === `/api/teaching/courses/${createdCourseId}/classes` &&
          request.headers.cookie === studentCookie
        ) {
          response.writeHead(403, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-course-smoke-student-class-create-denied",
          });
          response.end(
            JSON.stringify({
              error: "teacher role required",
              access: {
                reasonCode: "teacher-role-required",
                actorRole: "student",
              },
              secret: "must-not-leak",
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url === `/api/teaching/courses/${createdCourseId}/classes` &&
          request.headers.cookie === otherTeacherCookie
        ) {
          response.writeHead(403, {
            "content-type": "application/json",
            "x-uais-trace-id":
              "trace-course-smoke-other-teacher-class-create-denied",
          });
          response.end(
            JSON.stringify({
              error: "teacher course ownership required",
              access: {
                reasonCode: "teacher-course-ownership-required",
                actorId: "teacher-other",
              },
              secret: "must-not-leak",
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url === `/api/teaching/courses/${createdCourseId}/classes` &&
          request.headers.cookie === teacherCookie &&
          request.headers["x-uais-trace-id"] ===
            "trace-teaching-course-route-smoke-duplicate-class-create"
        ) {
          response.writeHead(409, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-teaching-course-route-smoke-duplicate-class-create",
          });
          response.end(
            JSON.stringify({
              error: "Teaching class already exists.",
              traceId: "trace-teaching-course-route-smoke-duplicate-class-create",
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "ids-only",
              },
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url === `/api/teaching/courses/${createdCourseId}/classes` &&
          request.headers.cookie === teacherCookie
        ) {
          didCreateClass = true;
          response.writeHead(201, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-course-smoke-create-class",
          });
          response.end(
            JSON.stringify({
              classItem: {
                classId: createdClassId,
                courseId: createdCourseId,
                ownerTeacherId: "teacher-kang",
                className: body.className,
                invitationCode: "66334455",
              },
              receipt: {
                action: "create-class",
                actorId: "teacher-kang",
                status: "persisted",
                authSession: {
                  sessionId: "teacher-kang-course-management-session",
                  authenticatedAt: "2026-06-23T11:00:00.000Z",
                  expiresAt: "2026-06-23T13:00:00.000Z",
                },
                storagePolicy: "external-redacted-teaching-course-management-snapshot",
                storageWritePolicy: "external-optimistic-snapshot-replace",
              },
              traceId: "trace-teaching-course-route-smoke-create-class",
              secret: "must-not-leak",
            }),
          );
          return;
        }

        if (
          request.method === "GET" &&
          request.url === "/api/teaching/courses" &&
          request.headers.cookie === teacherCookie
        ) {
          response.writeHead(200, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-course-smoke-list-courses",
          });
          response.end(
            JSON.stringify({
              courses: [
	                {
	                  courseId: createdCourseId,
	                  ownerTeacherId: "teacher-kang",
	                  courseName: "Route Smoke Enterprise Course",
	                  coverAssetId: existingCourseCoverAssetId,
	                },
              ],
              classes: [
                {
                  classId: createdClassId,
                  courseId: createdCourseId,
                  ownerTeacherId: "teacher-kang",
                  className: "Route Smoke Class",
                  invitationCode: "66334455",
                },
              ],
              receipt: {
                action: "list-courses",
                actorId: "teacher-kang",
                status: "read",
              },
              secret: "must-not-leak",
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url === "/api/teaching/invite-codes/66334455/join" &&
          request.headers.cookie === studentCookie
        ) {
          const traceId =
            typeof request.headers["x-uais-trace-id"] === "string"
              ? request.headers["x-uais-trace-id"]
              : "trace-teaching-course-route-smoke-invite-join";
          didInviteJoin = true;
          response.writeHead(201, {
            "content-type": "application/json",
            "x-uais-trace-id": traceId,
          });
          response.end(
            JSON.stringify({
              membership: {
                membershipId: createdMembershipId,
                courseId: createdCourseId,
                classId: createdClassId,
                invitationCode: "66334455",
                studentId: "Peter",
                studentDisplayName: "Peter",
                membershipStatus: "pending-teacher-review",
              },
              receipt: {
                action: "join-class-by-invite",
                actorId: "Peter",
                status: "persisted",
                authSession: {
                  sessionId: "student-peter-app-session",
                  authenticatedAt: "2026-06-23T11:10:00.000Z",
                  expiresAt: "2026-06-23T13:10:00.000Z",
                },
              },
              traceId,
              secret: "must-not-leak",
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url === "/api/teaching/operations" &&
          request.headers.cookie === teacherCookie
        ) {
          response.writeHead(200, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-course-smoke-created-course-operation",
          });
          response.end(
            JSON.stringify({
              receipt: {
                operationId: "course-settings",
                actionSlot: "primary",
                actionId: "save-course-settings",
                actorId: "teacher-kang",
                courseId: createdCourseId,
                status: "persisted",
                storagePolicy: "external-redacted-teaching-operation-append",
                storageWritePolicy: "external-append-only-operation-log",
              },
              domainPersistenceSummary: {
                status: "persisted",
                required: true,
                operationId: "course-settings",
                actionSlot: "primary",
                courseId: createdCourseId,
                expectedObjectTypes: ["course-settings"],
                persistedObjectTypes: ["course-settings"],
                missingObjectTypes: [],
              },
              courseSettingsReceipt: {
                action: "save-course-settings",
                actorId: "teacher-kang",
                courseId: createdCourseId,
                status: "persisted",
                storagePolicy:
                  "external-redacted-teaching-course-management-snapshot",
                storageWritePolicy: "external-optimistic-snapshot-replace",
              },
              traceId: "trace-teaching-course-route-smoke-created-course-operation",
              secret: "must-not-leak",
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url ===
            `/api/teaching/classes/${createdClassId}/memberships/${createdMembershipId}/approve` &&
          request.headers.cookie === studentCookie
        ) {
          response.writeHead(403, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-course-smoke-student-membership-approve-denied",
          });
          response.end(
            JSON.stringify({
              error: "teacher role required",
              access: {
                reasonCode: "teacher-role-required",
                actorRole: "student",
              },
              secret: "must-not-leak",
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url ===
            `/api/teaching/classes/${createdClassId}/memberships/${createdMembershipId}/approve` &&
          request.headers.cookie === otherTeacherCookie
        ) {
          response.writeHead(403, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-course-smoke-other-teacher-membership-approve-denied",
          });
          response.end(
            JSON.stringify({
              error: "class ownership required",
              access: {
                reasonCode: "teacher-course-ownership-required",
                actor: { actorId: "teacher-other", role: "teacher" },
                resource: {
                  classId: createdClassId,
                  membershipId: createdMembershipId,
                },
              },
              secret: "must-not-leak",
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url ===
            `/api/teaching/classes/${createdClassId}/memberships/${createdMembershipId}/approve` &&
          request.headers.cookie === teacherCookie
        ) {
          const traceId =
            typeof request.headers["x-uais-trace-id"] === "string"
              ? request.headers["x-uais-trace-id"]
              : "trace-teaching-course-route-smoke-membership-approve";
          didApproveMembership = true;
          response.writeHead(200, {
            "content-type": "application/json",
            "x-uais-trace-id": traceId,
          });
          response.end(
            JSON.stringify({
              membership: {
                membershipId: createdMembershipId,
                courseId: createdCourseId,
                classId: createdClassId,
                studentId: "Peter",
                membershipStatus: "approved",
                approvedAt: "2026-06-23T11:25:00.000Z",
                approvedByTeacherId: "teacher-kang",
              },
              classItem: {
                classId: createdClassId,
                courseId: createdCourseId,
                ownerTeacherId: "teacher-kang",
                students: 1,
              },
              course: {
                courseId: createdCourseId,
                ownerTeacherId: "teacher-kang",
                students: 1,
              },
              receipt: {
                action: "approve-class-membership",
                actorId: "teacher-kang",
                status: "persisted",
                createdAt: "2026-06-23T11:25:00.000Z",
                authSession: {
                  sessionId: "teacher-kang-course-management-session",
                  authenticatedAt: "2026-06-23T11:00:00.000Z",
                  expiresAt: "2026-06-23T13:00:00.000Z",
                },
              },
              traceId,
              secret: "must-not-leak",
            }),
          );
          return;
        }

        if (
          request.method === "GET" &&
          request.url === "/api/teaching/courses" &&
          request.headers.cookie === otherTeacherCookie
        ) {
          response.writeHead(200, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-course-smoke-other-teacher-list-courses",
          });
          response.end(
            JSON.stringify({
              courses: [],
              classes: [],
              memberships: [],
              receipt: {
                action: "list-courses",
                actorId: "teacher-other",
                status: "read",
              },
              secret: "must-not-leak",
            }),
          );
          return;
        }

        if (
          request.method === "GET" &&
          request.url === "/api/teaching/courses" &&
          request.headers.cookie === studentCookie
        ) {
          if (
            request.headers["x-uais-trace-id"] ===
              "trace-teaching-course-route-smoke-student-prejoin-list-courses" ||
            request.headers["x-uais-trace-id"] ===
              "trace-teaching-course-route-smoke-student-pending-list-courses"
          ) {
            const traceHeader =
              request.headers["x-uais-trace-id"] ===
              "trace-teaching-course-route-smoke-student-pending-list-courses"
                ? "trace-course-smoke-student-pending-list-courses"
                : "trace-course-smoke-student-prejoin-list-courses";
            response.writeHead(200, {
              "content-type": "application/json",
              "x-uais-trace-id": traceHeader,
            });
            response.end(
              JSON.stringify({
                courses: [],
                classes: [],
                memberships: [],
                receipt: {
                  action: "list-student-courses",
                  actorId: "Peter",
                  status: "read",
                },
                secret: "must-not-leak",
              }),
            );
            return;
          }
          response.writeHead(200, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-course-smoke-student-list-courses",
          });
          response.end(
            JSON.stringify({
              courses: [
                {
                  courseId: createdCourseId,
                  ownerTeacherId: "teacher-kang",
                },
              ],
              classes: [
                {
                  classId: createdClassId,
                  courseId: createdCourseId,
                  ownerTeacherId: "teacher-kang",
                },
              ],
              memberships: [
                {
                  membershipId: createdMembershipId,
                  courseId: createdCourseId,
                  classId: createdClassId,
                  studentId: "Peter",
                  membershipStatus: "approved",
                },
              ],
              receipt: {
                action: "list-student-courses",
                actorId: "Peter",
                status: "read",
              },
              secret: "must-not-leak",
            }),
          );
          return;
        }

        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "unexpected" }));
      });
    });
    const baseUrl = await listenForTest(server);
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teaching-course-route-smoke-live-"));
    const envFile = join(tmpDir, "live.env");
    writeFileSync(
      envFile,
      [
        "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND=external",
        "UAIS_TEACHING_COURSE_ASSETS_BACKEND=external",
        `UAIS_EXTERNAL_STORAGE_BASE_URL=${baseUrl}`,
        `UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=${externalStorageToken}`,
        "UAIS_TEACHER_AI_OWNERSHIP_BACKEND=external",
      ].join("\n"),
    );

    const output = await execFileForTest("node", [
      "scripts/teaching-course-management-route-smoke.mjs",
      "--live",
      "--approved",
      "--environment",
      "local-production",
      "--base-url",
      baseUrl,
      "--env-file",
      envFile,
      "--teacher-id",
      "teacher-kang",
      "--student-id",
      "Peter",
      "--cookie",
      teacherCookie,
      "--other-teacher-id",
      "teacher-other",
      "--other-teacher-cookie",
      otherTeacherCookie,
      "--student-cookie",
      studentCookie,
    ]);
    const body = JSON.parse(output);
    const coverRequest = requests.find(
      (request) => request.url === "/api/teaching/course-cover",
    );
    const createCourseRequest = requests.find(
      (request) => request.url === "/api/teaching/courses" && request.method === "POST",
    );
    expect(coverRequest?.body).toEqual(
      expect.objectContaining({
        courseId: expect.stringMatching(
          /^teacher-draft-course-teacher-kang-route-smoke-enterprise-course-\d{8}-\d{6}$/,
        ),
      }),
    );
    expect(createCourseRequest?.body).toEqual(
      expect.objectContaining({
        courseId: (coverRequest?.body as { courseId?: string } | undefined)?.courseId,
      }),
    );

    expect(requests).toEqual([
      { method: "GET", url: "/api/teaching/courses" },
      {
        method: "POST",
        url: "/api/teaching/course-cover",
        body: expect.objectContaining({
          courseId: expect.stringMatching(
            /^teacher-draft-course-teacher-kang-route-smoke-enterprise-course-\d{8}-\d{6}$/,
          ),
          name: "Route Smoke Enterprise Course",
          instructor: "S22 Route Smoke",
          unit: "UAIS",
          department: "Production Reliability",
          semester: "2026 Smoke",
        }),
      },
      {
        method: "POST",
        url: "/api/teaching/courses",
        body: expect.objectContaining({
          name: "Route Smoke Enterprise Course",
          instructor: "S22 Route Smoke",
          unit: "UAIS",
          department: "Production Reliability",
          semester: "2026 Smoke",
          courseId: (coverRequest?.body as { courseId?: string } | undefined)?.courseId,
        }),
      },
      {
        method: "POST",
        url: "/api/teaching/courses",
        cookie: studentCookie,
        body: expect.objectContaining({
          name: "Route Smoke Enterprise Course",
          instructor: "S22 Route Smoke",
          unit: "UAIS",
          department: "Production Reliability",
          semester: "2026 Smoke",
          courseId: (coverRequest?.body as { courseId?: string } | undefined)?.courseId,
        }),
      },
      {
        method: "POST",
        url: "/api/teaching/course-cover",
        cookie: studentCookie,
        body: expect.objectContaining({
          courseId: expect.stringMatching(
            /^teacher-draft-course-teacher-kang-route-smoke-enterprise-course-\d{8}-\d{6}$/,
          ),
          name: "Route Smoke Enterprise Course",
          instructor: "S22 Route Smoke",
          unit: "UAIS",
          department: "Production Reliability",
          semester: "2026 Smoke",
        }),
      },
      {
        method: "POST",
        url: "/api/teaching/courses",
        cookie: teacherCookie,
        body: expect.objectContaining({
          courseId: expect.stringMatching(
            /^teacher-draft-course-teacher-other-route-smoke-enterprise-course-\d{8}-\d{6}$/,
          ),
          name: "Route Smoke Enterprise Course",
          instructor: "S22 Route Smoke",
          unit: "UAIS",
          department: "Production Reliability",
          semester: "2026 Smoke",
        }),
      },
      {
        method: "POST",
        url: "/api/teaching/course-cover",
        cookie: teacherCookie,
        body: expect.objectContaining({
          courseId: expect.stringMatching(
            /^teacher-draft-course-teacher-kang-route-smoke-enterprise-course-\d{8}-\d{6}$/,
          ),
          name: "Route Smoke Enterprise Course",
          instructor: "S22 Route Smoke",
          unit: "UAIS",
          department: "Production Reliability",
          semester: "2026 Smoke",
        }),
      },
      {
        method: "GET",
        url: "/teaching-course-assets/database",
        authorization: `Bearer ${externalStorageToken}`,
      },
      {
        method: "POST",
        url: "/api/teaching/courses",
        cookie: teacherCookie,
        body: expect.objectContaining({
          name: "Route Smoke Enterprise Course",
          instructor: "S22 Route Smoke",
          unit: "UAIS",
          department: "Production Reliability",
          semester: "2026 Smoke",
          courseId: (coverRequest?.body as { courseId?: string } | undefined)?.courseId,
          coverAssetId: "course-cover-request-course-smoke-cover",
        }),
      },
      {
        method: "POST",
        url: "/api/teaching/courses",
        cookie: teacherCookie,
        body: expect.objectContaining({
          name: "Route Smoke Enterprise Course",
          instructor: "S22 Route Smoke",
          unit: "UAIS",
          department: "Production Reliability",
          semester: "2026 Smoke",
          courseId: (coverRequest?.body as { courseId?: string } | undefined)?.courseId,
          coverAssetId: "course-cover-request-course-smoke-cover",
        }),
      },
      {
        method: "POST",
        url: "/api/teaching/course-cover",
        cookie: teacherCookie,
        body: expect.objectContaining({
          courseId: createdCourseId,
          name: "Route Smoke Enterprise Course",
          instructor: "S22 Route Smoke",
          unit: "UAIS",
          department: "Production Reliability",
          semester: "2026 Smoke",
        }),
      },
      {
        method: "GET",
        url: "/teaching-course-assets/database",
        authorization: `Bearer ${externalStorageToken}`,
      },
      {
        method: "POST",
        url: "/api/teaching/course-cover",
        cookie: otherTeacherCookie,
        body: expect.objectContaining({
          courseId: createdCourseId,
          name: "Route Smoke Enterprise Course",
          instructor: "S22 Route Smoke",
          unit: "UAIS",
          department: "Production Reliability",
          semester: "2026 Smoke",
        }),
      },
      {
        method: "GET",
        url: "/teaching-course-management/database",
        authorization: `Bearer ${externalStorageToken}`,
      },
      {
        method: "POST",
        url: `/api/teaching/courses/${createdCourseId}/classes`,
        body: {
          className: "Route Smoke Class",
          semester: "2026 Smoke",
        },
      },
      {
        method: "POST",
        url: `/api/teaching/courses/${createdCourseId}/classes`,
        cookie: studentCookie,
        body: {
          className: "Route Smoke Class",
          semester: "2026 Smoke",
        },
      },
      {
        method: "POST",
        url: `/api/teaching/courses/${createdCourseId}/classes`,
        cookie: otherTeacherCookie,
        body: {
          className: "Route Smoke Class",
          semester: "2026 Smoke",
        },
      },
      {
        method: "POST",
        url: `/api/teaching/courses/${createdCourseId}/classes`,
        cookie: teacherCookie,
        body: {
          className: "Route Smoke Class",
          semester: "2026 Smoke",
        },
      },
      {
        method: "POST",
        url: `/api/teaching/courses/${createdCourseId}/classes`,
        cookie: teacherCookie,
        body: {
          className: "Route Smoke Class",
          semester: "2026 Smoke",
        },
      },
      {
        method: "GET",
        url: "/teaching-course-management/database",
        authorization: `Bearer ${externalStorageToken}`,
      },
      {
        method: "GET",
        url: "/api/teaching/courses",
        cookie: teacherCookie,
      },
      {
        method: "GET",
        url: "/api/teaching/courses",
        cookie: otherTeacherCookie,
      },
      {
        method: "GET",
        url: "/api/teaching/courses",
        cookie: studentCookie,
      },
      {
        method: "POST",
        url: "/api/teaching/invite-codes/66334455/join",
      },
      {
        method: "POST",
        url: "/api/teaching/invite-codes/66334455/join",
        cookie: studentCookie,
      },
      {
        method: "POST",
        url: "/api/teaching/invite-codes/66334455/join",
        cookie: studentCookie,
      },
      {
        method: "GET",
        url: "/api/teaching/courses",
        cookie: studentCookie,
      },
      {
        method: "POST",
        url: "/api/teaching/operations",
        cookie: teacherCookie,
        body: expect.objectContaining({
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: createdCourseId,
          sourceAction: "route-smoke-created-course-operation",
        }),
      },
      {
        method: "POST",
        url:
          `/api/teaching/classes/${createdClassId}/memberships/${createdMembershipId}/approve`,
      },
      {
        method: "POST",
        url:
          `/api/teaching/classes/${createdClassId}/memberships/${createdMembershipId}/approve`,
        cookie: studentCookie,
      },
      {
        method: "POST",
        url:
          `/api/teaching/classes/${createdClassId}/memberships/${createdMembershipId}/approve`,
        cookie: otherTeacherCookie,
      },
      {
        method: "POST",
        url:
          `/api/teaching/classes/${createdClassId}/memberships/${createdMembershipId}/approve`,
        cookie: teacherCookie,
      },
      {
        method: "POST",
        url:
          `/api/teaching/classes/${createdClassId}/memberships/${createdMembershipId}/approve`,
        cookie: teacherCookie,
      },
      {
        method: "GET",
        url: "/teaching-course-management/database",
        authorization: `Bearer ${externalStorageToken}`,
      },
      {
        method: "GET",
        url: "/api/teaching/courses",
        cookie: studentCookie,
      },
    ]);
    expect(body).toEqual(
      expect.objectContaining({
        target: "teaching-course-management-route-smoke",
        mode: "live",
        environment: "local-production",
        network: "enabled",
        status: "passed",
        httpStatus: {
          unauthenticatedCourseList: 401,
          unauthenticatedCourseCover: 401,
          unauthenticatedCourseCreate: 401,
          signedStudentCourseCreate: 403,
          signedStudentCourseCover: 403,
          signedTeacherForeignCourseCreate: 403,
          signedOtherTeacherCourseCover: 403,
          unauthenticatedClassCreate: 401,
          signedStudentClassCreate: 403,
          signedOtherTeacherClassCreate: 403,
          courseCover: 200,
          createCourse: 201,
          duplicateCourseCreate: 409,
          existingCourseCover: 200,
          existingCourseAssetsReadback: 200,
          externalCourseManagementReadback: 200,
          createClass: 201,
          externalCourseManagementAfterClassReadback: 200,
          externalCourseManagementAfterMembershipReadback: 200,
          listCourses: 200,
          otherTeacherCourseList: 200,
          studentPreJoinCourseList: 200,
          unauthenticatedInviteJoin: 401,
          inviteJoin: 201,
          duplicateInviteJoin: 201,
          studentPendingCourseList: 200,
          createdCourseTeachingOperation: 200,
          unauthenticatedMembershipApprove: 401,
          signedStudentMembershipApprove: 403,
          signedOtherTeacherMembershipApprove: 403,
          approveMembership: 200,
          duplicateClassCreate: 409,
          duplicateMembershipApprove: 200,
          studentCourseList: 200,
        },
        results: {
          unauthenticatedCourseListDenied: "passed",
          unauthenticatedCourseCoverDenied: "passed",
          unauthenticatedCourseCoverNoWriteSideEffects: "passed",
          unauthenticatedCourseCreateDenied: "passed",
          unauthenticatedCourseCreateNoWriteSideEffects: "passed",
          signedStudentCourseCreateDenied: "passed",
          signedStudentCourseCreateNoWriteSideEffects: "passed",
          signedStudentCourseCoverDenied: "passed",
          signedStudentCourseCoverNoWriteSideEffects: "passed",
          signedTeacherForeignCourseCreateDenied: "passed",
          signedTeacherForeignCourseCreateNoWriteSideEffects: "passed",
          signedOtherTeacherCourseCoverDenied: "passed",
          signedOtherTeacherCourseCoverNoWriteSideEffects: "passed",
          unauthenticatedClassCreateDenied: "passed",
          unauthenticatedClassCreateNoWriteSideEffects: "passed",
          signedStudentClassCreateDenied: "passed",
          signedStudentClassCreateNoWriteSideEffects: "passed",
          signedOtherTeacherClassCreateDenied: "passed",
          signedOtherTeacherClassCreateNoWriteSideEffects: "passed",
          signedTeacherCourseCoverGenerated: "passed",
          externalCoverAssetPersistenceReturned: "passed",
          courseCoverAssetReadbackRevisionReturned: "passed",
          courseCoverAssetReadbackDatabaseAdapterReturned: "passed",
          signedTeacherCourseCoverAuditAuthSessionReturned: "passed",
          courseCoverExternalAssetAuditReadbackReturned: "passed",
          courseCoverAssetRevisionRetryContractReturned: "passed",
          signedTeacherCourseCoverTraceHeaderReturned: "passed",
          signedTeacherCourseCreated: "passed",
          duplicateCourseCreateDenied: "passed",
          duplicateCourseCreateNoDuplicateSideEffects: "passed",
          courseCreateExternalSnapshotPolicyReturned: "passed",
          courseCreateAuditSourceReadbackReturned: "passed",
          courseCreateAuthSessionReadbackReturned: "passed",
          createdCourseUsedCoverDraftScope: "passed",
          createdCourseBoundGeneratedCoverAsset: "passed",
          existingCourseCoverBindingReadbackReturned: "passed",
          existingCourseCoverListedReadbackReturned: "passed",
          existingCourseCoverExternalAssetAuditReadbackReturned: "passed",
          existingCourseCoverBindingAuditSourceReturned: "passed",
          externalOwnershipMerged: "passed",
          signedTeacherClassCreated: "passed",
          duplicateClassCreateDenied: "passed",
          duplicateClassCreateNoDuplicateSideEffects: "passed",
          classCreateExternalSnapshotPolicyReturned: "passed",
          classCreateAuditSourceReadbackReturned: "passed",
          classCreateAuthSessionReadbackReturned: "passed",
          signedTeacherCourseListReturned: "passed",
          createdCourseListed: "passed",
          createdClassListed: "passed",
          signedOtherTeacherCourseListReturned: "passed",
          otherTeacherCourseHidden: "passed",
          otherTeacherClassHidden: "passed",
          studentCourseHiddenBeforeMembership: "passed",
          unauthenticatedInviteJoinDenied: "passed",
          unauthenticatedInviteJoinNoWriteSideEffects: "passed",
          signedStudentInviteJoined: "passed",
          duplicateStudentInviteJoinIdempotentReturned: "passed",
          duplicateStudentInviteJoinNoDuplicateSideEffects: "passed",
          studentPendingCourseHiddenBeforeApproval: "passed",
          studentPendingClassHiddenBeforeApproval: "passed",
          studentPendingMembershipHiddenBeforeApproval: "passed",
          signedStudentPendingCourseListTraceHeaderReturned: "passed",
          signedStudentInviteJoinAuditSourceReturned: "passed",
          signedStudentInviteJoinAuthSessionReturned: "passed",
          signedStudentInviteJoinAuthSessionReadbackReturned: "passed",
          createdCourseTeachingOperationAccepted: "passed",
          unauthenticatedMembershipApprovalDenied: "passed",
          unauthenticatedMembershipApprovalNoWriteSideEffects: "passed",
          signedStudentMembershipApprovalDenied: "passed",
          signedStudentMembershipApprovalNoWriteSideEffects: "passed",
          signedOtherTeacherMembershipApprovalDenied: "passed",
          signedOtherTeacherMembershipApprovalActorResourceReturned: "passed",
          signedOtherTeacherMembershipApprovalNoWriteSideEffects: "passed",
          signedTeacherMembershipApproved: "passed",
          duplicateMembershipApprovalIdempotentReturned: "passed",
          duplicateMembershipApprovalNoDuplicateSideEffects: "passed",
          signedTeacherMembershipApprovalAuditSourceReturned: "passed",
          signedTeacherMembershipApprovalAuthSessionReturned: "passed",
          signedTeacherMembershipApprovalAuthSessionReadbackReturned: "passed",
          signedStudentCourseListReturned: "passed",
          approvedCourseVisibleForStudent: "passed",
          approvedMembershipListedForStudent: "passed",
          unauthenticatedCourseListTraceHeaderReturned: "passed",
          unauthenticatedCourseCoverTraceHeaderReturned: "passed",
          unauthenticatedCourseCreateTraceHeaderReturned: "passed",
          signedStudentCourseCreateTraceHeaderReturned: "passed",
          signedStudentCourseCoverTraceHeaderReturned: "passed",
          signedOtherTeacherCourseCoverTraceHeaderReturned: "passed",
          unauthenticatedClassCreateTraceHeaderReturned: "passed",
          signedStudentClassCreateTraceHeaderReturned: "passed",
          signedOtherTeacherClassCreateTraceHeaderReturned: "passed",
          signedTeacherCourseCreateTraceHeaderReturned: "passed",
          signedTeacherCourseCreateTraceBodyReturned: "passed",
          signedTeacherClassCreateTraceHeaderReturned: "passed",
          signedTeacherClassCreateTraceBodyReturned: "passed",
          signedTeacherCourseListTraceHeaderReturned: "passed",
          signedOtherTeacherCourseListTraceHeaderReturned: "passed",
          signedStudentPreJoinCourseListTraceHeaderReturned: "passed",
          unauthenticatedInviteJoinTraceHeaderReturned: "passed",
          signedStudentInviteJoinTraceHeaderReturned: "passed",
          signedStudentInviteJoinTraceBodyReturned: "passed",
          unauthenticatedMembershipApprovalTraceHeaderReturned: "passed",
          signedStudentMembershipApprovalTraceHeaderReturned: "passed",
          signedOtherTeacherMembershipApprovalTraceHeaderReturned: "passed",
          signedTeacherMembershipApproveTraceHeaderReturned: "passed",
          signedTeacherMembershipApproveTraceBodyReturned: "passed",
          signedStudentCourseListTraceHeaderReturned: "passed",
        },
      }),
    );
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain("claims");
    expect(output).not.toContain("other-claims");
    expect(output).not.toContain("student-claims");
    expect(output).not.toContain("teacher-kang");
    expect(output).not.toContain("teacher-other");
    expect(output).not.toContain("Peter");
    expect(output).not.toContain("must-not-leak");
  });

  it("blocks live smoke when course management route responses omit trace headers", async () => {
    const server = createServer((request, response) => {
      let rawBody = "";
      request.on("data", (chunk) => {
        rawBody += chunk;
      });
      request.on("end", () => {
        const body = rawBody ? JSON.parse(rawBody) : undefined;

        if (request.headers.cookie !== "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig") {
          response.writeHead(401, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "auth required" }));
          return;
        }

        if (request.method === "POST" && request.url === "/api/teaching/courses") {
          response.writeHead(201, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              course: {
                courseId: "teacher-course-route-smoke-enterprise-course-20260623-111500",
                ownerTeacherId: "teacher-kang",
                courseName: body.name,
              },
              receipt: {
                action: "create-course",
                actorId: "teacher-kang",
                status: "persisted",
              },
              ownershipReceipt: {
                teacherId: "teacher-kang",
                status: "merged",
                storagePolicy: "external-redacted-teacher-ai-ownership-merge",
                storageWritePolicy: "external-atomic-merge",
              },
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url === "/api/teaching/courses/teacher-course-route-smoke-enterprise-course-20260623-111500/classes"
        ) {
          response.writeHead(201, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              classItem: {
                classId:
                  "teacher-course-route-smoke-enterprise-course-20260623-111500-class-1",
                courseId: "teacher-course-route-smoke-enterprise-course-20260623-111500",
                ownerTeacherId: "teacher-kang",
                className: body.className,
              },
              receipt: {
                action: "create-class",
                actorId: "teacher-kang",
                status: "persisted",
              },
            }),
          );
          return;
        }

        if (request.method === "GET" && request.url === "/api/teaching/courses") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              courses: [
                {
                  courseId: "teacher-course-route-smoke-enterprise-course-20260623-111500",
                  ownerTeacherId: "teacher-kang",
                },
              ],
              classes: [
                {
                  classId:
                    "teacher-course-route-smoke-enterprise-course-20260623-111500-class-1",
                  courseId: "teacher-course-route-smoke-enterprise-course-20260623-111500",
                  ownerTeacherId: "teacher-kang",
                },
              ],
              receipt: {
                action: "list-courses",
                actorId: "teacher-kang",
                status: "read",
              },
            }),
          );
          return;
        }

        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "unexpected" }));
      });
    });
    const baseUrl = await listenForTest(server);

    await expect(
      execFileForTest("node", [
        "scripts/teaching-course-management-route-smoke.mjs",
        "--live",
        "--approved",
        "--environment",
        "local-production",
        "--base-url",
        baseUrl,
        "--teacher-id",
        "teacher-kang",
        "--cookie",
        "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
      ]),
    ).rejects.toThrow(/unauthenticatedCourseListTraceHeaderReturned/);
  });

  it("prints sanitized course-cover failure diagnostics without exposing response bodies", async () => {
    const teacherCookie = "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig";
    const studentCookie = "uais_app_session=student-claims; uais_app_session_signature=student-sig";
    const otherTeacherCookie =
      "uais_teacher_auth_claims=other-claims; uais_teacher_auth_signature=other-sig";
    const externalStorageToken = "test-external-storage-token-with-32-chars";
    let createdCourseId = "teacher-course-route-smoke-enterprise-course-20260627-502000";
    let createdClassId = `${createdCourseId}-class-1`;
    let createdMembershipId = `membership-${createdClassId}-Peter`;
    let didApproveMembership = false;
    const productionDatabaseAdapter = {
      providerClass: "managed-database",
      migrationStatus: "up-to-date",
      backupPolicy: "point-in-time-restore",
      concurrencyControl: "transactional",
      valueRedacted: true,
    };
    const server = createServer((request, response) => {
      let rawBody = "";
      request.on("data", (chunk) => {
        rawBody += chunk;
      });
      request.on("end", () => {
        const body = rawBody ? JSON.parse(rawBody) : undefined;
        const requestTraceId =
          typeof request.headers["x-uais-trace-id"] === "string"
            ? request.headers["x-uais-trace-id"]
            : "trace-course-smoke-denied";
        const send = (status: number, payload: unknown, traceId = requestTraceId) => {
          response.writeHead(status, {
            "content-type": "application/json",
            "x-uais-trace-id": traceId,
          });
          response.end(JSON.stringify(payload));
        };

        if (
          request.method === "GET" &&
          request.url === "/teaching-course-assets/database" &&
          request.headers.authorization === `Bearer ${externalStorageToken}`
        ) {
          send(200, {
            database: {
              schemaVersion: "uais-teaching-course-assets-v1",
              updatedAt: "2026-06-27T16:00:00.000Z",
              assets: [],
              auditEvents: [],
            },
            revision: "rev-course-assets-diagnostic",
            productionDatabaseAdapter,
            secret: "must-not-leak",
            localPath: "/Users/example/private/course-assets.json",
          });
          return;
        }

        if (
          request.method === "GET" &&
          request.url === "/teaching-course-management/database" &&
          request.headers.authorization === `Bearer ${externalStorageToken}`
        ) {
          send(200, {
            database: {
              schemaVersion: "uais-teaching-course-management-v1",
              updatedAt: "2026-06-27T16:00:00.000Z",
              courses: [
                {
                  courseId: createdCourseId,
                  ownerTeacherId: "teacher-kang",
                  courseName: "Route Smoke Enterprise Course",
                },
              ],
              classes: [
                {
                  classId: createdClassId,
                  courseId: createdCourseId,
                  ownerTeacherId: "teacher-kang",
                  className: "Route Smoke Class",
                  invitationCode: "66334455",
                },
              ],
              memberships: [
                {
                  membershipId: createdMembershipId,
                  courseId: createdCourseId,
                  classId: createdClassId,
                  studentId: "Peter",
                  membershipStatus: didApproveMembership
                    ? "approved"
                    : "pending-teacher-review",
                },
              ],
              auditEvents: [],
            },
            revision: "rev-course-management-diagnostic",
            productionDatabaseAdapter,
            secret: "must-not-leak",
          });
          return;
        }

        if (!request.headers.cookie) {
          send(401, { error: "auth required", secret: "must-not-leak" });
          return;
        }

        if (
          request.method === "POST" &&
          request.url === "/api/teaching/course-cover" &&
          request.headers.cookie === teacherCookie
        ) {
          const isExistingCourseCover = body.courseId === createdCourseId;
          send(502, {
            error: isExistingCourseCover
              ? "course cover binding failed after qwen success"
              : "fixture qwen authorization failed",
            traceId: requestTraceId,
            partialFailure: isExistingCourseCover
              ? {
                  status: "cover-asset-persisted-course-binding-failed",
                  failedStep: "course-cover-binding",
                }
              : undefined,
            secret: "must-not-leak",
            localPath: "/Users/example/private/dashscope.env",
          });
          return;
        }

        if (
          request.method === "POST" &&
          request.url === "/api/teaching/courses" &&
          request.headers.cookie === studentCookie
        ) {
          send(403, {
            error: "teacher role required",
            access: { reasonCode: "teacher-role-required" },
          });
          return;
        }

        if (
          request.method === "POST" &&
          request.url === "/api/teaching/course-cover" &&
          request.headers.cookie === studentCookie
        ) {
          send(403, {
            error: "teacher role required",
            access: { reasonCode: "teacher-role-required" },
          });
          return;
        }

        if (
          request.method === "POST" &&
          request.url === "/api/teaching/courses" &&
          request.headers.cookie === teacherCookie
        ) {
          createdCourseId = typeof body.courseId === "string" ? body.courseId : createdCourseId;
          createdClassId = `${createdCourseId}-class-1`;
          createdMembershipId = `membership-${createdClassId}-Peter`;
          send(201, {
            course: {
              courseId: createdCourseId,
              ownerTeacherId: "teacher-kang",
              courseName: body.name,
            },
            receipt: {
              action: "create-course",
              actorId: "teacher-kang",
              status: "persisted",
              storagePolicy: "external-redacted-teaching-course-management-snapshot",
              storageWritePolicy: "external-optimistic-snapshot-replace",
            },
            ownershipReceipt: {
              teacherId: "teacher-kang",
              status: "merged",
              storagePolicy: "external-redacted-teacher-ai-ownership-merge",
              storageWritePolicy: "external-atomic-merge",
            },
            traceId: requestTraceId,
          });
          return;
        }

        if (
          request.method === "POST" &&
          request.url === `/api/teaching/courses/${createdCourseId}/classes` &&
          request.headers.cookie === studentCookie
        ) {
          send(403, {
            error: "teacher role required",
            access: { reasonCode: "teacher-role-required" },
          });
          return;
        }

        if (
          request.method === "POST" &&
          request.url === `/api/teaching/courses/${createdCourseId}/classes` &&
          request.headers.cookie === teacherCookie
        ) {
          send(201, {
            classItem: {
              classId: createdClassId,
              courseId: createdCourseId,
              ownerTeacherId: "teacher-kang",
              className: body.className,
              invitationCode: "66334455",
            },
            receipt: {
              action: "create-class",
              actorId: "teacher-kang",
              status: "persisted",
              storagePolicy: "external-redacted-teaching-course-management-snapshot",
              storageWritePolicy: "external-optimistic-snapshot-replace",
            },
            traceId: requestTraceId,
          });
          return;
        }

        if (request.method === "GET" && request.url === "/api/teaching/courses") {
          const isStudent = request.headers.cookie === studentCookie;
          const isPreJoin =
            request.headers["x-uais-trace-id"] ===
            "trace-teaching-course-route-smoke-student-prejoin-list-courses";
          const isPending =
            request.headers["x-uais-trace-id"] ===
            "trace-teaching-course-route-smoke-student-pending-list-courses";
          const isStudentHiddenList = isStudent && (isPreJoin || isPending);
          send(200, {
            courses: isStudentHiddenList ? [] : [{ courseId: createdCourseId, ownerTeacherId: "teacher-kang" }],
            classes:
              isStudentHiddenList
                ? []
                : [{ classId: createdClassId, courseId: createdCourseId, ownerTeacherId: "teacher-kang" }],
            memberships:
              isStudentHiddenList
                ? []
                : [
                    {
                      membershipId: createdMembershipId,
                      courseId: createdCourseId,
                      classId: createdClassId,
                      studentId: "Peter",
                      membershipStatus: didApproveMembership
                        ? "approved"
                        : "pending-teacher-review",
                    },
                  ],
            receipt: {
              action: isStudent ? "list-student-courses" : "list-courses",
              actorId: isStudent ? "Peter" : "teacher-kang",
              status: "read",
            },
          });
          return;
        }

        if (
          request.method === "POST" &&
          request.url === "/api/teaching/invite-codes/66334455/join" &&
          request.headers.cookie === studentCookie
        ) {
          send(201, {
            membership: {
              membershipId: createdMembershipId,
              courseId: createdCourseId,
              classId: createdClassId,
              studentId: "Peter",
              membershipStatus: "pending-teacher-review",
            },
            receipt: { action: "join-class-by-invite", actorId: "Peter", status: "persisted" },
            traceId: requestTraceId,
          });
          return;
        }

        if (
          request.method === "POST" &&
          request.url === "/api/teaching/operations" &&
          request.headers.cookie === teacherCookie
        ) {
          send(200, {
            receipt: {
              operationId: "course-settings",
              actionSlot: "primary",
              courseId: createdCourseId,
              status: "persisted",
            },
            domainPersistenceSummary: { status: "persisted" },
            courseSettingsReceipt: { status: "persisted" },
            traceId: requestTraceId,
          });
          return;
        }

        if (
          request.method === "POST" &&
          request.url ===
            `/api/teaching/classes/${createdClassId}/memberships/${createdMembershipId}/approve` &&
          request.headers.cookie === studentCookie
        ) {
          send(403, {
            error: "teacher role required",
            access: { reasonCode: "teacher-role-required" },
          });
          return;
        }

        if (
          request.method === "POST" &&
          request.url ===
            `/api/teaching/classes/${createdClassId}/memberships/${createdMembershipId}/approve` &&
          request.headers.cookie === otherTeacherCookie
        ) {
          send(403, {
            error: "class ownership required",
            access: { reasonCode: "teacher-course-ownership-required" },
          });
          return;
        }

        if (
          request.method === "POST" &&
          request.url ===
            `/api/teaching/classes/${createdClassId}/memberships/${createdMembershipId}/approve` &&
          request.headers.cookie === teacherCookie
        ) {
          didApproveMembership = true;
          send(200, {
            membership: {
              membershipId: createdMembershipId,
              courseId: createdCourseId,
              classId: createdClassId,
              studentId: "Peter",
              membershipStatus: "approved",
            },
            classItem: { classId: createdClassId, students: 1 },
            course: { courseId: createdCourseId, students: 1 },
            receipt: { action: "approve-class-membership", status: "persisted" },
            traceId: requestTraceId,
          });
          return;
        }

        send(404, { error: "unexpected", secret: "must-not-leak" });
      });
    });
    const baseUrl = await listenForTest(server);
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teaching-course-cover-diagnostic-"));
    const envFile = join(tmpDir, "live.env");
    writeFileSync(
      envFile,
      [
        "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND=external",
        "UAIS_TEACHING_COURSE_ASSETS_BACKEND=external",
        "UAIS_TEACHING_OPERATIONS_BACKEND=external",
        `UAIS_EXTERNAL_STORAGE_BASE_URL=${baseUrl}`,
        `UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=${externalStorageToken}`,
        "UAIS_TEACHER_AI_OWNERSHIP_BACKEND=external",
      ].join("\n"),
    );

    const { error, stdout } = await execFileAllowFailureForTest("node", [
      "scripts/teaching-course-management-route-smoke.mjs",
      "--live",
      "--approved",
      "--environment",
      "local-production",
      "--base-url",
      baseUrl,
      "--env-file",
      envFile,
      "--teacher-id",
      "teacher-kang",
      "--student-id",
      "Peter",
      "--cookie",
      teacherCookie,
      "--other-teacher-id",
      "teacher-other",
      "--other-teacher-cookie",
      otherTeacherCookie,
      "--student-cookie",
      studentCookie,
    ]);
    const body = JSON.parse(stdout);

    expect(error).toBeTruthy();
    expect(body.status).toBe("blocked");
    expect(body.httpStatus.courseCover).toBe(502);
    expect(body.httpStatus.existingCourseCover).toBe(502);
    expect(body.diagnostics?.routeFailures).toEqual(
      expect.arrayContaining([
        {
          step: "courseCover",
          statusCode: 502,
          traceId: "trace-teaching-course-route-smoke-course-cover",
          error: "fixture qwen authorization failed",
          redaction: {
            responseBody: "omitted",
            secrets: "omitted",
            localFiles: "omitted",
          },
        },
        expect.objectContaining({
          step: "existingCourseCover",
          statusCode: 502,
          traceId: "trace-teaching-course-route-smoke-existing-course-cover",
          error: "course cover binding failed after qwen success",
          partialFailureStatus: "cover-asset-persisted-course-binding-failed",
          failedStep: "course-cover-binding",
        }),
      ]),
    );
    expect(body.safety.responseBodiesOmitted).toBe(true);
    expect(stdout).not.toContain("must-not-leak");
    expect(stdout).not.toContain("/Users/example");
    expect(stdout).not.toContain("claims");
    expect(stdout).not.toContain("student-claims");
    expect(stdout).not.toContain("test-external-storage-token");
  });
});

function listenForTest(server: Server) {
  openServers.push(server);
  return new Promise<string>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        resolve(`http://127.0.0.1:${address.port}`);
      }
    });
  });
}

function closeServerForTest(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function execFileForTest(command: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile(command, args, { cwd: process.cwd(), encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}\n${stdout}\n${stderr}`));
        return;
      }
      resolve(stdout);
    });
  });
}

function execFileAllowFailureForTest(command: string, args: string[]) {
  return new Promise<{ error: Error | null; stdout: string; stderr: string }>((resolve) => {
    execFile(command, args, { cwd: process.cwd(), encoding: "utf8" }, (error, stdout, stderr) => {
      resolve({ error, stdout, stderr });
    });
  });
}

function writeTeacherAuthProviderReadinessEvidenceForTest(
  tmpDir: string,
  input: {
    filename: string;
    releaseRunId: string;
  },
) {
  const evidencePath = join(tmpDir, input.filename);
  writeFileSync(
    evidencePath,
    JSON.stringify({
      target: "teacher-auth-provider-readiness",
      mode: "live",
      environment: "production",
      status: "ready",
      releaseRunId: input.releaseRunId,
      authProviderMode: "trusted-cookie-issuer",
    }),
  );
  return evidencePath;
}

function writeVercelProductionDeploymentEvidenceForTest(
  tmpDir: string,
  input: {
    filename: string;
    releaseRunId: string;
  },
) {
  const evidencePath = join(tmpDir, input.filename);
  writeFileSync(
    evidencePath,
    JSON.stringify({
      target: "vercel-production-deployment",
      mode: "live",
      environment: "production",
      status: "deployed",
      releaseRunId: input.releaseRunId,
      deploymentObservation: {
        status: "observed",
        observedAt: "2026-06-25T15:55:00.000Z",
        source: "route-smoke-test",
      },
      deploymentUrl: "https://deployment.example.test",
    }),
  );
  return evidencePath;
}

function writeDeploymentDomainReachabilityEvidenceForTest(
  tmpDir: string,
  input: {
    baseUrl: string;
    filename: string;
    releaseRunId: string;
  },
) {
  const evidencePath = join(tmpDir, input.filename);
  writeFileSync(
    evidencePath,
    JSON.stringify({
      target: "deployment-domain-reachability",
      mode: "live",
      environment: "production",
      status: "reachable",
      releaseRunId: input.releaseRunId,
      deploymentFingerprint: createDeploymentFingerprintForTest(input.baseUrl),
      deploymentUrlRedacted: true,
    }),
  );
  return evidencePath;
}

function writeAppAuthProviderReadinessEvidenceForTest(
  tmpDir: string,
  input: {
    filename: string;
    releaseRunId: string;
  },
) {
  const evidencePath = join(tmpDir, input.filename);
  writeFileSync(
    evidencePath,
    JSON.stringify({
      target: "app-auth-provider-readiness",
      mode: "live",
      environment: "production",
      status: "ready",
      releaseRunId: input.releaseRunId,
      appAuthProviderMode: "trusted-account-provider",
    }),
  );
  return evidencePath;
}

function writeExternalStorageServiceReadinessEvidenceForTest(
  tmpDir: string,
  input: {
    baseUrl: string;
    filename: string;
    releaseRunId: string;
  },
) {
  const evidencePath = join(tmpDir, input.filename);
  writeFileSync(
    evidencePath,
    JSON.stringify({
      target: "external-storage-service-readiness",
      mode: "live",
      environment: "production",
      status: "ready",
      releaseRunId: input.releaseRunId,
      storageServiceFingerprint: createStorageServiceFingerprintForTest(input.baseUrl),
    }),
  );
  return evidencePath;
}

function createStorageServiceFingerprintForTest(baseUrl: string) {
  return {
    status: "present",
    value: `sha256:${createHash("sha256")
      .update(baseUrl)
      .digest("hex")
      .slice(0, 16)}`,
    source: "origin",
    valueRedacted: true,
  };
}

function createDeploymentFingerprintForTest(baseUrl: string) {
  return {
    status: "present",
    value: `sha256:${createHash("sha256").update(baseUrl).digest("hex").slice(0, 16)}`,
  };
}
