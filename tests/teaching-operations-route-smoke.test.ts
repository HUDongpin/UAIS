import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

let openServers: Server[] = [];

describe("teaching operations route smoke evidence", () => {
  afterEach(async () => {
    await Promise.all(openServers.map((server) => closeServerForTest(server)));
    openServers = [];
  });

  it("routes provider-backed operation failures into diagnostics", () => {
    const source = readFileSync("scripts/teaching-operations-route-smoke.mjs", "utf8");
    const diagnosticsCall = source.match(
      /failureDiagnostics: createFailureDiagnostics\(\{([\s\S]*?)\}\),/,
    );

    expect(diagnosticsCall?.[1]).toContain("studentRosterSync,");
    expect(diagnosticsCall?.[1]).toContain("courseExportManifest,");
    expect(diagnosticsCall?.[1]).toContain("gradingFeedbackDraft,");
  });

  it("preserves redacted backend diagnostics in failure diagnostics evidence", () => {
    const source = readFileSync("scripts/teaching-operations-route-smoke.mjs", "utf8");

    expect(source).toContain(
      "const diagnostics = sanitizeDiagnosticObject(response?.body?.diagnostics);",
    );
    expect(source).toContain("...(diagnostics ? { diagnostics } : {}),");
  });

  it("accepts local-production app auth readiness evidence as a local route binding", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teaching-ops-local-app-auth-"));
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
      "scripts/teaching-operations-route-smoke.mjs",
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

  it("sends browser provenance headers on ordinary teaching operation posts", () => {
    const source = readFileSync("scripts/teaching-operations-route-smoke.mjs", "utf8");
    const start = source.indexOf("function postTeachingOperation({ baseUrl, body, cookie, traceId })");
    const end = source.indexOf("function hasSafeTraceHeader", start);
    const postFunction = source.slice(start, end);

    expect(postFunction).toContain("origin: url.origin,");
    expect(postFunction).toContain("referer: new URL(\"/teaching\", url).toString(),");
    expect(postFunction).toContain("\"user-agent\": \"UAIS teaching operations route smoke\",");
  });

  it("requires unauthenticated teaching operation posts to prove no write side effects", () => {
    const routeSmokeSource = readFileSync("scripts/teaching-operations-route-smoke.mjs", "utf8");
    const releaseGateSource = readFileSync("scripts/production-e2e-release-gate.mjs", "utf8");

    expect(routeSmokeSource).toContain("\"unauthenticated-post-no-write-side-effects\"");
    expect(releaseGateSource).toContain("\"unauthenticatedPostNoWriteSideEffects\"");
    expect(routeSmokeSource).toContain("unauthenticatedPostNoWriteSideEffects:");
    expect(routeSmokeSource).toContain("deniedSourceAction: unauthenticatedBody.sourceAction");
    expect(routeSmokeSource).toContain(
      "deniedIdempotencyKey: unauthenticatedBody.idempotencyKey",
    );
  });

  it("prints a redacted dry-run plan for the ordinary teaching operations route", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teaching-ops-smoke-"));
    const envFile = join(tmpDir, "teaching-ops.env");
    const releaseRunId = "release-teaching-ops-route-smoke-vercel-binding";
    const vercelProductionDeployment = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl: "https://teaching-ops.example.test",
      filename: "vercel-production-deployment.json",
      releaseRunId,
    });
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
    const externalStorageServiceReadiness = writeExternalStorageServiceReadinessEvidenceForTest(
      tmpDir,
      {
        baseUrl: "https://external-storage.example.test",
        filename: "external-storage-service-readiness.json",
        releaseRunId,
      },
    );
    writeFileSync(
      envFile,
      [
        "UAIS_DEPLOYMENT_BASE_URL=https://teaching-ops.example.test",
        "UAIS_TEACHING_OPERATIONS_BACKEND=external",
        "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND=external",
        "UAIS_EXTERNAL_STORAGE_BASE_URL=https://external-storage.example.test",
        "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=secret-external-storage-token-with-32-chars",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER=external",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_URL=https://email-provider.example.test/collaboration-invite",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN=secret-email-provider-token-with-32-chars",
        "UAIS_COLLABORATION_INVITE_EMAIL_CALLBACK_TOKEN=secret-email-callback-token-with-32-chars",
        "UAIS_STUDENT_ROSTER_SYNC_PROVIDER=external",
        "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_URL=https://sis-provider.example.test/student-roster-sync",
        "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_TOKEN=secret-student-roster-provider-token-32",
        "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER=external",
        "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_URL=https://knowledge-provider.example.test/index/sync",
        "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_TOKEN=secret-knowledge-provider-token-32",
        "UAIS_GRADEBOOK_RELEASE_PROVIDER=external",
        "UAIS_GRADEBOOK_RELEASE_PROVIDER_URL=https://gradebook-provider.example.test/releases",
        "UAIS_GRADEBOOK_RELEASE_PROVIDER_TOKEN=secret-gradebook-provider-token-32",
        "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER=external",
        "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_URL=https://content-provider.example.test/course-content/publish",
        "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_TOKEN=secret-course-content-provider-token-32",
        "UAIS_COURSE_EXPORT_PROVIDER=external",
        "UAIS_COURSE_EXPORT_PROVIDER_URL=https://export-provider.example.test/exports",
        "UAIS_COURSE_EXPORT_PROVIDER_TOKEN=secret-export-provider-token-with-32-chars",
        "UAIS_GRADING_FEEDBACK_PROVIDER=external",
        "UAIS_GRADING_FEEDBACK_PROVIDER_URL=https://feedback-provider.example.test/grading-feedback",
        "UAIS_GRADING_FEEDBACK_PROVIDER_TOKEN=secret-feedback-provider-token-with-32-chars",
        "UAIS_TEACHING_OPERATIONS_SMOKE_COOKIE=secret-cookie-pair",
        "UAIS_TEACHING_OPERATIONS_SMOKE_STUDENT_COOKIE=secret-student-cookie-pair",
        "UAIS_TEACHING_OPERATIONS_SMOKE_TEACHER_ID=teacher-kang",
        "UAIS_TEACHING_OPERATIONS_SMOKE_COURSE_ID=teacher-research-methods",
        "UAIS_TEACHING_OPERATIONS_SMOKE_CLASS_ID=teacher-research-methods-class-1",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/teaching-operations-route-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
      "--release-run-id",
      releaseRunId,
      "--vercel-production-deployment",
      vercelProductionDeployment,
      "--teacher-auth-provider-readiness",
      teacherAuthProviderReadiness,
      "--app-auth-provider-readiness",
      appAuthProviderReadiness,
      "--external-storage-service-readiness",
      externalStorageServiceReadiness,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "teaching-operations-route-smoke",
        mode: "dry-run",
        environment: "production",
        network: "disabled",
        status: "ready",
        responsibleSessions: ["S12", "S22"],
        vercelProductionDeploymentEvidence: {
          target: "vercel-production-deployment",
          status: "matched",
          deploymentObservationStatus: "observed",
          releaseRunIdStatus: "matched",
          valueRedacted: true,
        },
        deploymentOrigin: {
          status: "present",
          originClass: "remote-https",
          valueRedacted: true,
        },
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
        externalStorageServiceReadinessEvidence: {
          target: "external-storage-service-readiness",
          status: "matched",
          productionDatabaseAdapterStatus: "ready",
          productionDatabaseAdapters: {
            teachingOperations: createReadyProductionDatabaseAdapterForTest(),
            teachingCourseManagement: createReadyProductionDatabaseAdapterForTest(),
            teachingCourseAssets: createReadyProductionDatabaseAdapterForTest(),
          },
          valueRedacted: true,
          releaseRunIdStatus: "matched",
        },
        route: "/api/teaching/operations",
        teachingOperationsSchema: {
          schemaVersion: "uais-teaching-operations-v1",
          backupSchemaVersion: "uais-teaching-operations-backup-v1",
          supportedSchemaVersions: ["uais-teaching-operations-v1"],
          migrationPolicy: "explicit-versioned-schema-normalization",
          unsupportedSchemaVersionPolicy: "fail-closed",
          responsibleSession: "S12",
        },
        requiredEnv: [
          { name: "UAIS_DEPLOYMENT_BASE_URL", status: "present" },
          { name: "UAIS_TEACHING_OPERATIONS_BACKEND", status: "present", requiredValue: "external" },
          {
            name: "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
            status: "present",
            requiredValue: "external",
          },
          { name: "UAIS_EXTERNAL_STORAGE_BASE_URL", status: "present", valueRedacted: true },
          { name: "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN", status: "present", valueRedacted: true },
          {
            name: "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER",
            status: "present",
            requiredValue: "external",
          },
          {
            name: "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_URL",
            status: "present",
            valueRedacted: true,
          },
          {
            name: "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN",
            status: "present",
            valueRedacted: true,
          },
          {
            name: "UAIS_COLLABORATION_INVITE_EMAIL_CALLBACK_TOKEN",
            status: "present",
            valueRedacted: true,
          },
          {
            name: "UAIS_STUDENT_ROSTER_SYNC_PROVIDER",
            status: "present",
            requiredValue: "external",
          },
          {
            name: "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_URL",
            status: "present",
            valueRedacted: true,
          },
          {
            name: "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_TOKEN",
            status: "present",
            valueRedacted: true,
          },
          {
            name: "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER",
            status: "present",
            requiredValue: "external",
          },
          {
            name: "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_URL",
            status: "present",
            valueRedacted: true,
          },
          {
            name: "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_TOKEN",
            status: "present",
            valueRedacted: true,
          },
          {
            name: "UAIS_GRADEBOOK_RELEASE_PROVIDER",
            status: "present",
            requiredValue: "external",
          },
          {
            name: "UAIS_GRADEBOOK_RELEASE_PROVIDER_URL",
            status: "present",
            valueRedacted: true,
          },
          {
            name: "UAIS_GRADEBOOK_RELEASE_PROVIDER_TOKEN",
            status: "present",
            valueRedacted: true,
          },
          {
            name: "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER",
            status: "present",
            requiredValue: "external",
          },
          {
            name: "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_URL",
            status: "present",
            valueRedacted: true,
          },
          {
            name: "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_TOKEN",
            status: "present",
            valueRedacted: true,
          },
          {
            name: "UAIS_COURSE_EXPORT_PROVIDER",
            status: "present",
            requiredValue: "external",
          },
          {
            name: "UAIS_COURSE_EXPORT_PROVIDER_URL",
            status: "present",
            valueRedacted: true,
          },
          {
            name: "UAIS_COURSE_EXPORT_PROVIDER_TOKEN",
            status: "present",
            valueRedacted: true,
          },
          {
            name: "UAIS_GRADING_FEEDBACK_PROVIDER",
            status: "present",
            requiredValue: "external",
          },
          {
            name: "UAIS_GRADING_FEEDBACK_PROVIDER_URL",
            status: "present",
            valueRedacted: true,
          },
          {
            name: "UAIS_GRADING_FEEDBACK_PROVIDER_TOKEN",
            status: "present",
            valueRedacted: true,
          },
          { name: "UAIS_TEACHING_OPERATIONS_SMOKE_COOKIE", status: "present", valueRedacted: true },
          {
            name: "UAIS_TEACHING_OPERATIONS_SMOKE_STUDENT_COOKIE",
            status: "present",
            valueRedacted: true,
          },
          { name: "UAIS_TEACHING_OPERATIONS_SMOKE_TEACHER_ID", status: "present" },
          { name: "UAIS_TEACHING_OPERATIONS_SMOKE_COURSE_ID", status: "present" },
          { name: "UAIS_TEACHING_OPERATIONS_SMOKE_CLASS_ID", status: "present" },
        ],
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
      "unauthenticated-post-denied",
      "unauthenticated-post-no-write-side-effects",
      "signed-teacher-cookie-required",
      "signed-student-post-denied",
      "signed-student-post-no-write-side-effects",
      "unsafe-app-session-post-denied",
      "unsafe-app-session-post-trace-header-returned",
      "unsafe-app-session-post-no-write-side-effects",
      "signed-teacher-course-id-required",
      "signed-teacher-course-id-required-no-write-side-effects",
      "signed-teacher-course-scope-denied",
      "signed-teacher-course-scope-no-write-side-effects",
      "course-ownership-bound-operation-persisted",
      "durable-external-persistence-returned",
      "domain-persistence-summary-returned",
      "operations-schema-migration-policy-returned",
      "append-ledger-sequence-returned",
      "append-ledger-sequence-readback-returned",
      "audit-trace-returned",
      "audit-auth-session-returned",
      "audit-request-source-provenance-returned",
      "unauthenticated-response-trace-header-returned",
      "signed-student-response-trace-header-returned",
      "unauthenticated-audit-readback-denied",
      "unauthenticated-audit-readback-trace-header-returned",
      "signed-student-audit-readback-denied",
      "signed-student-audit-readback-trace-header-returned",
      "unsafe-app-session-audit-readback-denied",
      "unsafe-app-session-audit-readback-trace-header-returned",
      "unauthenticated-alert-notification-enqueue-denied",
      "unauthenticated-alert-notification-trace-header-returned",
      "signed-student-alert-notification-enqueue-denied",
      "signed-student-alert-notification-trace-header-returned",
      "unauthenticated-alert-notification-readback-denied",
      "unauthenticated-alert-notification-readback-trace-header-returned",
      "signed-student-alert-notification-readback-denied",
      "signed-student-alert-notification-readback-trace-header-returned",
      "authorized-response-trace-header-returned",
      "audit-readback-returned",
      "audit-auth-session-readback-returned",
      "audit-readback-response-trace-header-returned",
      "domain-projection-readback-returned",
      "external-domain-projection-readback-returned",
      "course-settings-domain-object-returned",
      "course-settings-patch-readback-returned",
      "student-preview-session-domain-object-returned",
      "student-preview-session-audit-source-returned",
      "student-roster-domain-object-returned",
      "student-roster-domain-persistence-summary-returned",
      "student-roster-provider-sync-returned",
      "student-roster-provider-sync-audit-source-returned",
      "student-group-suggestion-domain-object-returned",
      "student-group-suggestion-audit-source-returned",
      "knowledge-index-domain-object-returned",
      "knowledge-index-domain-persistence-summary-returned",
      "knowledge-index-provider-sync-returned",
      "knowledge-index-provider-sync-audit-source-returned",
      "resource-review-item-domain-object-returned",
      "resource-review-item-audit-source-returned",
      "course-content-domain-object-returned",
      "course-content-domain-persistence-summary-returned",
      "course-content-provider-publish-returned",
      "course-content-provider-publish-audit-source-returned",
      "course-unit-draft-domain-object-returned",
      "course-unit-draft-audit-source-returned",
      "dashboard-state-domain-object-returned",
      "dashboard-state-domain-persistence-summary-returned",
      "dashboard-state-audit-source-returned",
      "dashboard-snapshot-domain-object-returned",
      "dashboard-snapshot-audit-source-returned",
      "quiz-assessment-domain-object-returned",
      "quiz-assessment-domain-persistence-summary-returned",
      "quiz-item-review-domain-object-returned",
      "quiz-item-review-domain-persistence-summary-returned",
      "quiz-item-review-audit-source-returned",
      "agent-settings-domain-object-returned",
      "agent-settings-audit-source-returned",
      "agent-permission-preflight-domain-object-returned",
      "agent-permission-preflight-audit-source-returned",
      "admin-settings-domain-object-returned",
      "admin-settings-audit-source-returned",
      "collaboration-invite-notification-domain-object-returned",
      "collaboration-invite-domain-persistence-summary-returned",
      "collaboration-invite-email-delivery-returned",
      "collaboration-invite-email-delivery-audit-source-returned",
      "unauthenticated-collaboration-invite-email-callback-denied",
      "unauthenticated-collaboration-invite-email-callback-trace-header-returned",
      "unauthenticated-collaboration-invite-email-callback-no-write-side-effects",
      "signed-student-collaboration-invite-email-callback-denied",
      "signed-student-collaboration-invite-email-callback-trace-header-returned",
      "signed-student-collaboration-invite-email-callback-no-write-side-effects",
      "invalid-token-collaboration-invite-email-callback-denied",
      "invalid-token-collaboration-invite-email-callback-trace-header-returned",
      "invalid-token-collaboration-invite-email-callback-no-write-side-effects",
      "unsafe-collaboration-invite-email-callback-denied",
      "unsafe-collaboration-invite-email-callback-trace-header-returned",
      "unsafe-collaboration-invite-email-callback-no-write-side-effects",
      "collaboration-invite-email-bounce-callback-returned",
      "collaboration-invite-email-callback-audit-source-returned",
      "course-export-manifest-domain-object-returned",
      "course-export-provider-returned",
      "course-export-provider-audit-source-returned",
      "course-export-manifest-audit-source-returned",
      "unauthenticated-export-manifest-download-denied",
      "unauthenticated-export-manifest-download-trace-header-returned",
      "signed-student-export-manifest-download-denied",
      "signed-student-export-manifest-download-trace-header-returned",
      "export-manifest-download-readback-returned",
      "unsafe-export-manifest-id-denied",
      "export-redaction-validation-domain-object-returned",
      "export-redaction-validation-audit-source-returned",
      "grading-queue-domain-object-returned",
      "gradebook-update-domain-object-returned",
      "grading-domain-persistence-summary-returned",
      "grading-feedback-draft-domain-object-returned",
      "grading-feedback-provider-returned",
      "grading-feedback-provider-audit-source-returned",
      "idempotent-retry-returned",
      "idempotent-retry-append-sequence-stable-returned",
      "concurrent-idempotent-retry-append-sequence-stable-returned",
      "idempotency-conflict-denied",
      "unauthenticated-rollback-denied",
      "unauthenticated-rollback-trace-header-returned",
      "unauthenticated-rollback-no-write-side-effects",
      "signed-student-rollback-denied",
      "signed-student-rollback-trace-header-returned",
      "signed-student-rollback-no-write-side-effects",
      "rollback-record-persisted",
      "rollback-production-database-adapter-returned",
      "rollback-response-trace-header-returned",
      "rollback-trace-closure-returned",
      "rollback-readback-returned",
      "rollback-readback-response-trace-header-returned",
      "unauthenticated-alert-summary-readback-denied",
      "unauthenticated-alert-summary-readback-trace-header-returned",
      "signed-student-alert-summary-readback-denied",
      "signed-student-alert-summary-readback-trace-header-returned",
      "alert-summary-readback-returned",
      "unauthenticated-alert-notification-no-write-side-effects",
      "signed-student-alert-notification-no-write-side-effects",
      "alert-notification-queued-returned",
      "alert-notification-readback-returned",
      "invite-code-draft-domain-object-returned",
      "invite-code-draft-audit-source-returned",
      "invite-publish-class-join-entry-returned",
      "invite-publish-domain-persistence-summary-returned",
      "invite-code-publish-audit-source-returned",
      "student-invite-join-returned",
      "unauthenticated-gradebook-release-denied",
      "unauthenticated-gradebook-release-trace-header-returned",
      "unauthenticated-gradebook-rollback-denied",
      "unauthenticated-gradebook-rollback-trace-header-returned",
      "signed-student-gradebook-release-denied",
      "signed-student-gradebook-release-trace-header-returned",
      "signed-student-gradebook-rollback-denied",
      "signed-student-gradebook-rollback-trace-header-returned",
      "unauthenticated-gradebook-release-no-write-side-effects",
      "unauthenticated-gradebook-rollback-no-write-side-effects",
      "signed-student-gradebook-release-no-write-side-effects",
      "signed-student-gradebook-rollback-no-write-side-effects",
      "unsafe-gradebook-release-object-id-denied",
      "unsafe-gradebook-rollback-object-id-denied",
      "gradebook-release-trace-closure-returned",
      "gradebook-release-audit-source-returned",
      "gradebook-release-external-storage-returned",
      "gradebook-provider-release-returned",
      "gradebook-rollback-trace-closure-returned",
      "gradebook-rollback-audit-source-returned",
      "gradebook-rollback-external-storage-returned",
      "gradebook-provider-rollback-returned",
      "external-backup-created-returned",
      "unauthenticated-backup-restore-denied",
      "unauthenticated-backup-restore-trace-header-returned",
      "unauthenticated-backup-restore-no-write-side-effects",
      "signed-student-backup-restore-denied",
      "signed-student-backup-restore-trace-header-returned",
      "signed-student-backup-restore-no-write-side-effects",
      "direct-backup-restore-disabled-returned",
      "direct-backup-restore-trace-closure-returned",
      "direct-backup-restore-no-write-side-effects",
      "unsafe-backup-restore-id-denied",
      "unsafe-backup-restore-no-write-side-effects",
      "external-restore-drill-verified-returned",
      "response-values-redacted",
      "release-run-id-bound",
      "same-vercel-production-deployment-bound",
      "same-teacher-auth-provider-readiness-bound",
      "same-app-auth-provider-readiness-bound",
      "same-external-storage-service-readiness-bound",
    ]);
    expect(output).not.toContain("secret-cookie-pair");
    expect(output).not.toContain("secret-student-cookie-pair");
    expect(output).not.toContain("secret-external-storage-token-with-32-chars");
    expect(output).not.toContain("secret-email-provider-token-with-32-chars");
    expect(output).not.toContain("secret-email-callback-token-with-32-chars");
    expect(output).not.toContain("secret-student-roster-provider-token-32");
    expect(output).not.toContain("secret-knowledge-provider-token-32");
    expect(output).not.toContain("secret-gradebook-provider-token-32");
    expect(output).not.toContain("secret-course-content-provider-token-32");
    expect(output).not.toContain("secret-export-provider-token-with-32-chars");
    expect(output).not.toContain("secret-feedback-provider-token-with-32-chars");
    expect(output).not.toContain("external-storage.example.test");
    expect(output).not.toContain("email-provider.example.test");
    expect(output).not.toContain("sis-provider.example.test");
    expect(output).not.toContain("knowledge-provider.example.test");
    expect(output).not.toContain("gradebook-provider.example.test");
    expect(output).not.toContain("content-provider.example.test");
    expect(output).not.toContain("export-provider.example.test");
    expect(output).not.toContain("feedback-provider.example.test");
    expect(output).not.toContain("teaching-ops.example.test");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("blocks production route smoke when external storage readiness lacks managed database adapter proof", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teaching-ops-storage-db-proof-"));
    const envFile = join(tmpDir, "teaching-ops.env");
    const releaseRunId = "release-teaching-ops-route-smoke-storage-db-proof";
    const vercelProductionDeployment = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl: "https://teaching-ops.example.test",
      filename: "vercel-production-deployment.json",
      releaseRunId,
    });
    const teacherAuthProviderReadiness = writeTeacherAuthProviderReadinessEvidenceForTest(
      tmpDir,
      {
        filename: "teacher-auth-provider-readiness.json",
        releaseRunId,
      },
    );
    const externalStorageServiceReadiness = join(
      tmpDir,
      "external-storage-service-readiness-without-db-proof.json",
    );
    writeFileSync(
      externalStorageServiceReadiness,
      JSON.stringify({
        target: "external-storage-service-readiness",
        mode: "live",
        environment: "production",
        status: "ready",
        releaseRunId,
        storageServiceFingerprint: createStorageServiceFingerprintForTest(
          "https://external-storage.example.test",
        ),
      }),
    );
    writeFileSync(
      envFile,
      [
        "UAIS_DEPLOYMENT_BASE_URL=https://teaching-ops.example.test",
        "UAIS_TEACHING_OPERATIONS_BACKEND=external",
        "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND=external",
        "UAIS_EXTERNAL_STORAGE_BASE_URL=https://external-storage.example.test",
        "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=secret-external-storage-token-with-32-chars",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER=external",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_URL=https://email-provider.example.test/collaboration-invite",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN=secret-email-provider-token-with-32-chars",
        "UAIS_COLLABORATION_INVITE_EMAIL_CALLBACK_TOKEN=secret-email-callback-token-with-32-chars",
        "UAIS_STUDENT_ROSTER_SYNC_PROVIDER=external",
        "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_URL=https://sis-provider.example.test/student-roster-sync",
        "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_TOKEN=secret-student-roster-provider-token-32",
        "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER=external",
        "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_URL=https://knowledge-provider.example.test/index/sync",
        "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_TOKEN=secret-knowledge-provider-token-32",
        "UAIS_GRADEBOOK_RELEASE_PROVIDER=external",
        "UAIS_GRADEBOOK_RELEASE_PROVIDER_URL=https://gradebook-provider.example.test/releases",
        "UAIS_GRADEBOOK_RELEASE_PROVIDER_TOKEN=secret-gradebook-provider-token-32",
        "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER=external",
        "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_URL=https://content-provider.example.test/course-content/publish",
        "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_TOKEN=secret-course-content-provider-token-32",
        "UAIS_COURSE_EXPORT_PROVIDER=external",
        "UAIS_COURSE_EXPORT_PROVIDER_URL=https://export-provider.example.test/exports",
        "UAIS_COURSE_EXPORT_PROVIDER_TOKEN=secret-export-provider-token-with-32-chars",
        "UAIS_GRADING_FEEDBACK_PROVIDER=external",
        "UAIS_GRADING_FEEDBACK_PROVIDER_URL=https://feedback-provider.example.test/grading-feedback",
        "UAIS_GRADING_FEEDBACK_PROVIDER_TOKEN=secret-feedback-provider-token-with-32-chars",
        "UAIS_TEACHING_OPERATIONS_SMOKE_COOKIE=secret-cookie-pair",
        "UAIS_TEACHING_OPERATIONS_SMOKE_STUDENT_COOKIE=secret-student-cookie-pair",
        "UAIS_TEACHING_OPERATIONS_SMOKE_TEACHER_ID=teacher-kang",
        "UAIS_TEACHING_OPERATIONS_SMOKE_COURSE_ID=teacher-research-methods",
        "UAIS_TEACHING_OPERATIONS_SMOKE_CLASS_ID=teacher-research-methods-class-1",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/teaching-operations-route-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
      "--release-run-id",
      releaseRunId,
      "--vercel-production-deployment",
      vercelProductionDeployment,
      "--teacher-auth-provider-readiness",
      teacherAuthProviderReadiness,
      "--external-storage-service-readiness",
      externalStorageServiceReadiness,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.blockedReasons).toContain(
      "external-storage-service-readiness-database-adapter-not-proven",
    );
    expect(body.externalStorageServiceReadinessEvidence).toEqual(
      expect.objectContaining({
        target: "external-storage-service-readiness",
        status: "database-adapter-not-proven",
        productionDatabaseAdapterStatus: "missing",
        valueRedacted: true,
      }),
    );
    expect(output).not.toContain("secret-cookie-pair");
    expect(output).not.toContain("secret-external-storage-token-with-32-chars");
    expect(output).not.toContain("external-storage.example.test");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("accepts production deployment evidence through domain reachability for custom teaching domains", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teaching-ops-domain-reachability-"));
    const envFile = join(tmpDir, "teaching-ops.env");
    const releaseRunId = "release-teaching-ops-route-smoke-domain-reachability";
    const deploymentBaseUrl = "https://teaching-ops.example.test";
    const vercelProductionDeployment = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl: "https://uais-teaching-ops.vercel.app",
      filename: "vercel-production-deployment.json",
      releaseRunId,
    });
    const deploymentDomainReachability = writeDeploymentDomainReachabilityEvidenceForTest(
      tmpDir,
      {
        baseUrl: deploymentBaseUrl,
        filename: "deployment-domain-reachability.json",
        releaseRunId,
      },
    );
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
    const externalStorageServiceReadiness = writeExternalStorageServiceReadinessEvidenceForTest(
      tmpDir,
      {
        baseUrl: "https://external-storage.example.test",
        filename: "external-storage-service-readiness.json",
        releaseRunId,
      },
    );
    writeFileSync(
      envFile,
      [
        `UAIS_DEPLOYMENT_BASE_URL=${deploymentBaseUrl}`,
        "UAIS_TEACHING_OPERATIONS_BACKEND=external",
        "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND=external",
        "UAIS_EXTERNAL_STORAGE_BASE_URL=https://external-storage.example.test",
        "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=secret-external-storage-token-with-32-chars",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER=external",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_URL=https://email-provider.example.test/collaboration-invite",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN=secret-email-provider-token-with-32-chars",
        "UAIS_COLLABORATION_INVITE_EMAIL_CALLBACK_TOKEN=secret-email-callback-token-with-32-chars",
        "UAIS_STUDENT_ROSTER_SYNC_PROVIDER=external",
        "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_URL=https://sis-provider.example.test/student-roster-sync",
        "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_TOKEN=secret-student-roster-provider-token-32",
        "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER=external",
        "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_URL=https://knowledge-provider.example.test/index/sync",
        "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_TOKEN=secret-knowledge-provider-token-32",
        "UAIS_GRADEBOOK_RELEASE_PROVIDER=external",
        "UAIS_GRADEBOOK_RELEASE_PROVIDER_URL=https://gradebook-provider.example.test/releases",
        "UAIS_GRADEBOOK_RELEASE_PROVIDER_TOKEN=secret-gradebook-provider-token-32",
        "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER=external",
        "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_URL=https://content-provider.example.test/course-content/publish",
        "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_TOKEN=secret-course-content-provider-token-32",
        "UAIS_COURSE_EXPORT_PROVIDER=external",
        "UAIS_COURSE_EXPORT_PROVIDER_URL=https://export-provider.example.test/exports",
        "UAIS_COURSE_EXPORT_PROVIDER_TOKEN=secret-export-provider-token-with-32-chars",
        "UAIS_GRADING_FEEDBACK_PROVIDER=external",
        "UAIS_GRADING_FEEDBACK_PROVIDER_URL=https://feedback-provider.example.test/grading-feedback",
        "UAIS_GRADING_FEEDBACK_PROVIDER_TOKEN=secret-feedback-provider-token-with-32-chars",
        "UAIS_TEACHING_OPERATIONS_SMOKE_COOKIE=secret-cookie-pair",
        "UAIS_TEACHING_OPERATIONS_SMOKE_STUDENT_COOKIE=secret-student-cookie-pair",
        "UAIS_TEACHING_OPERATIONS_SMOKE_TEACHER_ID=teacher-kang",
        "UAIS_TEACHING_OPERATIONS_SMOKE_COURSE_ID=teacher-research-methods",
        "UAIS_TEACHING_OPERATIONS_SMOKE_CLASS_ID=teacher-research-methods-class-1",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/teaching-operations-route-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
      "--release-run-id",
      releaseRunId,
      "--vercel-production-deployment",
      vercelProductionDeployment,
      "--deployment-domain-reachability",
      deploymentDomainReachability,
      "--teacher-auth-provider-readiness",
      teacherAuthProviderReadiness,
      "--app-auth-provider-readiness",
      appAuthProviderReadiness,
      "--external-storage-service-readiness",
      externalStorageServiceReadiness,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("ready");
    expect(body.vercelProductionDeploymentEvidence).toEqual({
      target: "vercel-production-deployment",
      status: "matched-via-domain-reachability",
      deploymentObservationStatus: "observed",
      releaseRunIdStatus: "matched",
      deploymentDomainReachabilityStatus: "matched",
      valueRedacted: true,
    });
    expect(body.deploymentDomainReachabilityEvidence).toEqual({
      target: "deployment-domain-reachability",
      status: "matched",
      releaseRunIdStatus: "matched",
      deploymentFingerprintStatus: "matched",
      valueRedacted: true,
    });
    expect(body.blockedReasons).not.toContain("vercel-production-deployment-fingerprint-mismatch");
    expect(output).not.toContain("uais-teaching-ops.vercel.app");
    expect(output).not.toContain("teaching-ops.example.test");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("blocks production dry-run when the SIS roster provider is not configured", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teaching-ops-smoke-sis-provider-"));
    const envFile = join(tmpDir, "teaching-ops.env");
    const releaseRunId = "release-teaching-ops-route-smoke-sis-provider";
    const vercelProductionDeployment = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl: "https://teaching-ops.example.test",
      filename: "vercel-production-deployment.json",
      releaseRunId,
    });
    const teacherAuthProviderReadiness = writeTeacherAuthProviderReadinessEvidenceForTest(
      tmpDir,
      {
        filename: "teacher-auth-provider-readiness.json",
        releaseRunId,
      },
    );
    const externalStorageServiceReadiness = writeExternalStorageServiceReadinessEvidenceForTest(
      tmpDir,
      {
        baseUrl: "https://external-storage.example.test",
        filename: "external-storage-service-readiness.json",
        releaseRunId,
      },
    );
    writeFileSync(
      envFile,
      [
        "UAIS_DEPLOYMENT_BASE_URL=https://teaching-ops.example.test",
        "UAIS_TEACHING_OPERATIONS_BACKEND=external",
        "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND=external",
        "UAIS_EXTERNAL_STORAGE_BASE_URL=https://external-storage.example.test",
        "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=secret-external-storage-token-with-32-chars",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER=external",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_URL=https://email-provider.example.test/collaboration-invite",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN=secret-email-provider-token-with-32-chars",
        "UAIS_COLLABORATION_INVITE_EMAIL_CALLBACK_TOKEN=secret-email-callback-token-with-32-chars",
        "UAIS_TEACHING_OPERATIONS_SMOKE_COOKIE=secret-cookie-pair",
        "UAIS_TEACHING_OPERATIONS_SMOKE_STUDENT_COOKIE=secret-student-cookie-pair",
        "UAIS_TEACHING_OPERATIONS_SMOKE_TEACHER_ID=teacher-kang",
        "UAIS_TEACHING_OPERATIONS_SMOKE_COURSE_ID=teacher-research-methods",
        "UAIS_TEACHING_OPERATIONS_SMOKE_CLASS_ID=teacher-research-methods-class-1",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/teaching-operations-route-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
      "--release-run-id",
      releaseRunId,
      "--vercel-production-deployment",
      vercelProductionDeployment,
      "--teacher-auth-provider-readiness",
      teacherAuthProviderReadiness,
      "--external-storage-service-readiness",
      externalStorageServiceReadiness,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.blockedReasons).toContain("missing-UAIS_STUDENT_ROSTER_SYNC_PROVIDER");
    expect(body.requiredEnv).toContainEqual({
      name: "UAIS_STUDENT_ROSTER_SYNC_PROVIDER",
      status: "missing",
      requiredValue: "external",
    });
  });

  it("blocks production dry-run when the gradebook release provider is not configured", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teaching-ops-smoke-gradebook-provider-"));
    const envFile = join(tmpDir, "teaching-ops.env");
    const releaseRunId = "release-teaching-ops-route-smoke-gradebook-provider";
    const vercelProductionDeployment = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl: "https://teaching-ops.example.test",
      filename: "vercel-production-deployment.json",
      releaseRunId,
    });
    const teacherAuthProviderReadiness = writeTeacherAuthProviderReadinessEvidenceForTest(
      tmpDir,
      {
        filename: "teacher-auth-provider-readiness.json",
        releaseRunId,
      },
    );
    const externalStorageServiceReadiness = writeExternalStorageServiceReadinessEvidenceForTest(
      tmpDir,
      {
        baseUrl: "https://external-storage.example.test",
        filename: "external-storage-service-readiness.json",
        releaseRunId,
      },
    );
    writeFileSync(
      envFile,
      [
        "UAIS_DEPLOYMENT_BASE_URL=https://teaching-ops.example.test",
        "UAIS_TEACHING_OPERATIONS_BACKEND=external",
        "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND=external",
        "UAIS_EXTERNAL_STORAGE_BASE_URL=https://external-storage.example.test",
        "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=secret-external-storage-token-with-32-chars",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER=external",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_URL=https://email-provider.example.test/collaboration-invite",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN=secret-email-provider-token-with-32-chars",
        "UAIS_COLLABORATION_INVITE_EMAIL_CALLBACK_TOKEN=secret-email-callback-token-with-32-chars",
        "UAIS_STUDENT_ROSTER_SYNC_PROVIDER=external",
        "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_URL=https://sis-provider.example.test/student-roster-sync",
        "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_TOKEN=secret-student-roster-provider-token-32",
        "UAIS_TEACHING_OPERATIONS_SMOKE_COOKIE=secret-cookie-pair",
        "UAIS_TEACHING_OPERATIONS_SMOKE_STUDENT_COOKIE=secret-student-cookie-pair",
        "UAIS_TEACHING_OPERATIONS_SMOKE_TEACHER_ID=teacher-kang",
        "UAIS_TEACHING_OPERATIONS_SMOKE_COURSE_ID=teacher-research-methods",
        "UAIS_TEACHING_OPERATIONS_SMOKE_CLASS_ID=teacher-research-methods-class-1",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/teaching-operations-route-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
      "--release-run-id",
      releaseRunId,
      "--vercel-production-deployment",
      vercelProductionDeployment,
      "--teacher-auth-provider-readiness",
      teacherAuthProviderReadiness,
      "--external-storage-service-readiness",
      externalStorageServiceReadiness,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.blockedReasons).toContain("missing-UAIS_GRADEBOOK_RELEASE_PROVIDER");
    expect(body.requiredEnv).toContainEqual({
      name: "UAIS_GRADEBOOK_RELEASE_PROVIDER",
      status: "missing",
      requiredValue: "external",
    });
    expect(output).not.toContain("secret-student-roster-provider-token-32");
    expect(output).not.toContain("sis-provider.example.test");
    expect(output).not.toContain("email-provider.example.test");
  });

  it("blocks production dry-run when the knowledge index sync provider is not configured", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teaching-ops-knowledge-provider-"));
    const envFile = join(tmpDir, "teaching-ops.env");
    const releaseRunId = "release-teaching-ops-route-smoke-knowledge-provider";
    const vercelProductionDeployment = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl: "https://teaching-ops.example.test",
      filename: "vercel-production-deployment.json",
      releaseRunId,
    });
    const teacherAuthProviderReadiness = writeTeacherAuthProviderReadinessEvidenceForTest(
      tmpDir,
      {
        filename: "teacher-auth-provider-readiness.json",
        releaseRunId,
      },
    );
    const externalStorageServiceReadiness = writeExternalStorageServiceReadinessEvidenceForTest(
      tmpDir,
      {
        baseUrl: "https://external-storage.example.test",
        filename: "external-storage-service-readiness.json",
        releaseRunId,
      },
    );
    writeFileSync(
      envFile,
      [
        "UAIS_DEPLOYMENT_BASE_URL=https://teaching-ops.example.test",
        "UAIS_TEACHING_OPERATIONS_BACKEND=external",
        "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND=external",
        "UAIS_EXTERNAL_STORAGE_BASE_URL=https://external-storage.example.test",
        "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=secret-external-storage-token-with-32-chars",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER=external",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_URL=https://email-provider.example.test/collaboration-invite",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN=secret-email-provider-token-with-32-chars",
        "UAIS_COLLABORATION_INVITE_EMAIL_CALLBACK_TOKEN=secret-email-callback-token-with-32-chars",
        "UAIS_STUDENT_ROSTER_SYNC_PROVIDER=external",
        "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_URL=https://sis-provider.example.test/student-roster-sync",
        "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_TOKEN=secret-student-roster-provider-token-32",
        "UAIS_GRADEBOOK_RELEASE_PROVIDER=external",
        "UAIS_GRADEBOOK_RELEASE_PROVIDER_URL=https://gradebook-provider.example.test/releases",
        "UAIS_GRADEBOOK_RELEASE_PROVIDER_TOKEN=secret-gradebook-provider-token-32",
        "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER=external",
        "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_URL=https://content-provider.example.test/course-content/publish",
        "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_TOKEN=secret-course-content-provider-token-32",
        "UAIS_COURSE_EXPORT_PROVIDER=external",
        "UAIS_COURSE_EXPORT_PROVIDER_URL=https://export-provider.example.test/exports",
        "UAIS_COURSE_EXPORT_PROVIDER_TOKEN=secret-export-provider-token-with-32-chars",
        "UAIS_GRADING_FEEDBACK_PROVIDER=external",
        "UAIS_GRADING_FEEDBACK_PROVIDER_URL=https://feedback-provider.example.test/grading-feedback",
        "UAIS_GRADING_FEEDBACK_PROVIDER_TOKEN=secret-feedback-provider-token-with-32-chars",
        "UAIS_TEACHING_OPERATIONS_SMOKE_COOKIE=secret-cookie-pair",
        "UAIS_TEACHING_OPERATIONS_SMOKE_STUDENT_COOKIE=secret-student-cookie-pair",
        "UAIS_TEACHING_OPERATIONS_SMOKE_TEACHER_ID=teacher-kang",
        "UAIS_TEACHING_OPERATIONS_SMOKE_COURSE_ID=teacher-research-methods",
        "UAIS_TEACHING_OPERATIONS_SMOKE_CLASS_ID=teacher-research-methods-class-1",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/teaching-operations-route-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
      "--release-run-id",
      releaseRunId,
      "--vercel-production-deployment",
      vercelProductionDeployment,
      "--teacher-auth-provider-readiness",
      teacherAuthProviderReadiness,
      "--external-storage-service-readiness",
      externalStorageServiceReadiness,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.blockedReasons).toContain("missing-UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER");
    expect(body.requiredEnv).toContainEqual({
      name: "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER",
      status: "missing",
      requiredValue: "external",
    });
    expect(output).not.toContain("secret-course-content-provider-token-32");
    expect(output).not.toContain("content-provider.example.test");
    expect(output).not.toContain("secret-gradebook-provider-token-32");
    expect(output).not.toContain("gradebook-provider.example.test");
    expect(output).not.toContain("sis-provider.example.test");
    expect(output).not.toContain("email-provider.example.test");
  });

  it("blocks production dry-run when the course content publish provider is not configured", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teaching-ops-smoke-content-provider-"));
    const envFile = join(tmpDir, "teaching-ops.env");
    const releaseRunId = "release-teaching-ops-route-smoke-content-provider";
    const vercelProductionDeployment = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl: "https://teaching-ops.example.test",
      filename: "vercel-production-deployment.json",
      releaseRunId,
    });
    const teacherAuthProviderReadiness = writeTeacherAuthProviderReadinessEvidenceForTest(
      tmpDir,
      {
        filename: "teacher-auth-provider-readiness.json",
        releaseRunId,
      },
    );
    const externalStorageServiceReadiness = writeExternalStorageServiceReadinessEvidenceForTest(
      tmpDir,
      {
        baseUrl: "https://external-storage.example.test",
        filename: "external-storage-service-readiness.json",
        releaseRunId,
      },
    );
    writeFileSync(
      envFile,
      [
        "UAIS_DEPLOYMENT_BASE_URL=https://teaching-ops.example.test",
        "UAIS_TEACHING_OPERATIONS_BACKEND=external",
        "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND=external",
        "UAIS_EXTERNAL_STORAGE_BASE_URL=https://external-storage.example.test",
        "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=secret-external-storage-token-with-32-chars",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER=external",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_URL=https://email-provider.example.test/collaboration-invite",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN=secret-email-provider-token-with-32-chars",
        "UAIS_COLLABORATION_INVITE_EMAIL_CALLBACK_TOKEN=secret-email-callback-token-with-32-chars",
        "UAIS_STUDENT_ROSTER_SYNC_PROVIDER=external",
        "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_URL=https://sis-provider.example.test/student-roster-sync",
        "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_TOKEN=secret-student-roster-provider-token-32",
        "UAIS_GRADEBOOK_RELEASE_PROVIDER=external",
        "UAIS_GRADEBOOK_RELEASE_PROVIDER_URL=https://gradebook-provider.example.test/releases",
        "UAIS_GRADEBOOK_RELEASE_PROVIDER_TOKEN=secret-gradebook-provider-token-32",
        "UAIS_TEACHING_OPERATIONS_SMOKE_COOKIE=secret-cookie-pair",
        "UAIS_TEACHING_OPERATIONS_SMOKE_STUDENT_COOKIE=secret-student-cookie-pair",
        "UAIS_TEACHING_OPERATIONS_SMOKE_TEACHER_ID=teacher-kang",
        "UAIS_TEACHING_OPERATIONS_SMOKE_COURSE_ID=teacher-research-methods",
        "UAIS_TEACHING_OPERATIONS_SMOKE_CLASS_ID=teacher-research-methods-class-1",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/teaching-operations-route-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
      "--release-run-id",
      releaseRunId,
      "--vercel-production-deployment",
      vercelProductionDeployment,
      "--teacher-auth-provider-readiness",
      teacherAuthProviderReadiness,
      "--external-storage-service-readiness",
      externalStorageServiceReadiness,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.blockedReasons).toContain("missing-UAIS_COURSE_CONTENT_PUBLISH_PROVIDER");
    expect(body.requiredEnv).toContainEqual({
      name: "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER",
      status: "missing",
      requiredValue: "external",
    });
    expect(output).not.toContain("secret-gradebook-provider-token-32");
    expect(output).not.toContain("gradebook-provider.example.test");
    expect(output).not.toContain("sis-provider.example.test");
    expect(output).not.toContain("email-provider.example.test");
  });

  it("blocks production dry-run when the course export provider is not configured", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teaching-ops-smoke-export-provider-"));
    const envFile = join(tmpDir, "teaching-ops.env");
    const releaseRunId = "release-teaching-ops-route-smoke-export-provider";
    const vercelProductionDeployment = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl: "https://teaching-ops.example.test",
      filename: "vercel-production-deployment.json",
      releaseRunId,
    });
    const teacherAuthProviderReadiness = writeTeacherAuthProviderReadinessEvidenceForTest(
      tmpDir,
      {
        filename: "teacher-auth-provider-readiness.json",
        releaseRunId,
      },
    );
    const externalStorageServiceReadiness = writeExternalStorageServiceReadinessEvidenceForTest(
      tmpDir,
      {
        baseUrl: "https://external-storage.example.test",
        filename: "external-storage-service-readiness.json",
        releaseRunId,
      },
    );
    writeFileSync(
      envFile,
      [
        "UAIS_DEPLOYMENT_BASE_URL=https://teaching-ops.example.test",
        "UAIS_TEACHING_OPERATIONS_BACKEND=external",
        "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND=external",
        "UAIS_EXTERNAL_STORAGE_BASE_URL=https://external-storage.example.test",
        "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=secret-external-storage-token-with-32-chars",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER=external",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_URL=https://email-provider.example.test/collaboration-invite",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN=secret-email-provider-token-with-32-chars",
        "UAIS_COLLABORATION_INVITE_EMAIL_CALLBACK_TOKEN=secret-email-callback-token-with-32-chars",
        "UAIS_STUDENT_ROSTER_SYNC_PROVIDER=external",
        "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_URL=https://sis-provider.example.test/student-roster-sync",
        "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_TOKEN=secret-student-roster-provider-token-32",
        "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER=external",
        "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_URL=https://knowledge-provider.example.test/index/sync",
        "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_TOKEN=secret-knowledge-provider-token-32",
        "UAIS_GRADEBOOK_RELEASE_PROVIDER=external",
        "UAIS_GRADEBOOK_RELEASE_PROVIDER_URL=https://gradebook-provider.example.test/releases",
        "UAIS_GRADEBOOK_RELEASE_PROVIDER_TOKEN=secret-gradebook-provider-token-32",
        "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER=external",
        "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_URL=https://content-provider.example.test/course-content/publish",
        "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_TOKEN=secret-course-content-provider-token-32",
        "UAIS_TEACHING_OPERATIONS_SMOKE_COOKIE=secret-cookie-pair",
        "UAIS_TEACHING_OPERATIONS_SMOKE_STUDENT_COOKIE=secret-student-cookie-pair",
        "UAIS_TEACHING_OPERATIONS_SMOKE_TEACHER_ID=teacher-kang",
        "UAIS_TEACHING_OPERATIONS_SMOKE_COURSE_ID=teacher-research-methods",
        "UAIS_TEACHING_OPERATIONS_SMOKE_CLASS_ID=teacher-research-methods-class-1",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/teaching-operations-route-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
      "--release-run-id",
      releaseRunId,
      "--vercel-production-deployment",
      vercelProductionDeployment,
      "--teacher-auth-provider-readiness",
      teacherAuthProviderReadiness,
      "--external-storage-service-readiness",
      externalStorageServiceReadiness,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.blockedReasons).toContain("missing-UAIS_COURSE_EXPORT_PROVIDER");
    expect(body.requiredEnv).toContainEqual({
      name: "UAIS_COURSE_EXPORT_PROVIDER",
      status: "missing",
      requiredValue: "external",
    });
    expect(output).not.toContain("secret-course-content-provider-token-32");
    expect(output).not.toContain("content-provider.example.test");
    expect(output).not.toContain("secret-gradebook-provider-token-32");
    expect(output).not.toContain("gradebook-provider.example.test");
    expect(output).not.toContain("sis-provider.example.test");
    expect(output).not.toContain("email-provider.example.test");
  });

  it("blocks production dry-run when the grading feedback provider is not configured", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teaching-ops-smoke-feedback-provider-"));
    const envFile = join(tmpDir, "teaching-ops.env");
    const releaseRunId = "release-teaching-ops-route-smoke-feedback-provider";
    const vercelProductionDeployment = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl: "https://teaching-ops.example.test",
      filename: "vercel-production-deployment.json",
      releaseRunId,
    });
    const teacherAuthProviderReadiness = writeTeacherAuthProviderReadinessEvidenceForTest(
      tmpDir,
      {
        filename: "teacher-auth-provider-readiness.json",
        releaseRunId,
      },
    );
    const externalStorageServiceReadiness = writeExternalStorageServiceReadinessEvidenceForTest(
      tmpDir,
      {
        baseUrl: "https://external-storage.example.test",
        filename: "external-storage-service-readiness.json",
        releaseRunId,
      },
    );
    writeFileSync(
      envFile,
      [
        "UAIS_DEPLOYMENT_BASE_URL=https://teaching-ops.example.test",
        "UAIS_TEACHING_OPERATIONS_BACKEND=external",
        "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND=external",
        "UAIS_EXTERNAL_STORAGE_BASE_URL=https://external-storage.example.test",
        "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=secret-external-storage-token-with-32-chars",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER=external",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_URL=https://email-provider.example.test/collaboration-invite",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN=secret-email-provider-token-with-32-chars",
        "UAIS_COLLABORATION_INVITE_EMAIL_CALLBACK_TOKEN=secret-email-callback-token-with-32-chars",
        "UAIS_STUDENT_ROSTER_SYNC_PROVIDER=external",
        "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_URL=https://sis-provider.example.test/student-roster-sync",
        "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_TOKEN=secret-student-roster-provider-token-32",
        "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER=external",
        "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_URL=https://knowledge-provider.example.test/index/sync",
        "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_TOKEN=secret-knowledge-provider-token-32",
        "UAIS_GRADEBOOK_RELEASE_PROVIDER=external",
        "UAIS_GRADEBOOK_RELEASE_PROVIDER_URL=https://gradebook-provider.example.test/releases",
        "UAIS_GRADEBOOK_RELEASE_PROVIDER_TOKEN=secret-gradebook-provider-token-32",
        "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER=external",
        "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_URL=https://content-provider.example.test/course-content/publish",
        "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_TOKEN=secret-course-content-provider-token-32",
        "UAIS_COURSE_EXPORT_PROVIDER=external",
        "UAIS_COURSE_EXPORT_PROVIDER_URL=https://export-provider.example.test/exports",
        "UAIS_COURSE_EXPORT_PROVIDER_TOKEN=secret-export-provider-token-with-32-chars",
        "UAIS_TEACHING_OPERATIONS_SMOKE_COOKIE=secret-cookie-pair",
        "UAIS_TEACHING_OPERATIONS_SMOKE_STUDENT_COOKIE=secret-student-cookie-pair",
        "UAIS_TEACHING_OPERATIONS_SMOKE_TEACHER_ID=teacher-kang",
        "UAIS_TEACHING_OPERATIONS_SMOKE_COURSE_ID=teacher-research-methods",
        "UAIS_TEACHING_OPERATIONS_SMOKE_CLASS_ID=teacher-research-methods-class-1",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/teaching-operations-route-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
      "--release-run-id",
      releaseRunId,
      "--vercel-production-deployment",
      vercelProductionDeployment,
      "--teacher-auth-provider-readiness",
      teacherAuthProviderReadiness,
      "--external-storage-service-readiness",
      externalStorageServiceReadiness,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.blockedReasons).toContain("missing-UAIS_GRADING_FEEDBACK_PROVIDER");
    expect(body.requiredEnv).toContainEqual({
      name: "UAIS_GRADING_FEEDBACK_PROVIDER",
      status: "missing",
      requiredValue: "external",
    });
    expect(output).not.toContain("secret-export-provider-token-with-32-chars");
    expect(output).not.toContain("export-provider.example.test");
    expect(output).not.toContain("secret-course-content-provider-token-32");
    expect(output).not.toContain("content-provider.example.test");
    expect(output).not.toContain("secret-gradebook-provider-token-32");
    expect(output).not.toContain("gradebook-provider.example.test");
  });

  it("blocks production dry-run when the ordinary teaching operations origin is local loopback", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teaching-ops-local-origin-"));
    const envFile = join(tmpDir, "teaching-ops.env");
    const releaseRunId = "release-teaching-ops-route-smoke-local-origin";
    const vercelProductionDeployment = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl: "http://127.0.0.1:3000",
      filename: "vercel-production-deployment.json",
      releaseRunId,
    });
    const teacherAuthProviderReadiness = writeTeacherAuthProviderReadinessEvidenceForTest(
      tmpDir,
      {
        filename: "teacher-auth-provider-readiness.json",
        releaseRunId,
      },
    );
    writeFileSync(
      envFile,
      [
        "UAIS_DEPLOYMENT_BASE_URL=http://127.0.0.1:3000",
        "UAIS_TEACHING_OPERATIONS_BACKEND=external",
        "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND=external",
        "UAIS_EXTERNAL_STORAGE_BASE_URL=https://external-storage.example.test",
        "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=secret-external-storage-token-with-32-chars",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER=external",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_URL=https://email-provider.example.test/collaboration-invite",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN=secret-email-provider-token-with-32-chars",
        "UAIS_COLLABORATION_INVITE_EMAIL_CALLBACK_TOKEN=secret-email-callback-token-with-32-chars",
        "UAIS_TEACHING_OPERATIONS_SMOKE_COOKIE=secret-cookie-pair",
        "UAIS_TEACHING_OPERATIONS_SMOKE_STUDENT_COOKIE=secret-student-cookie-pair",
        "UAIS_TEACHING_OPERATIONS_SMOKE_TEACHER_ID=teacher-kang",
        "UAIS_TEACHING_OPERATIONS_SMOKE_COURSE_ID=teacher-research-methods",
        "UAIS_TEACHING_OPERATIONS_SMOKE_CLASS_ID=teacher-research-methods-class-1",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/teaching-operations-route-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
      "--release-run-id",
      releaseRunId,
      "--vercel-production-deployment",
      vercelProductionDeployment,
      "--teacher-auth-provider-readiness",
      teacherAuthProviderReadiness,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "teaching-operations-route-smoke",
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
    expect(output).not.toContain("secret-student-cookie-pair");
    expect(output).not.toContain("secret-external-storage-token-with-32-chars");
    expect(output).not.toContain("secret-email-provider-token-with-32-chars");
    expect(output).not.toContain("secret-email-callback-token-with-32-chars");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("blocks production dry-run when the smoke teacher id is not explicitly configured", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teaching-ops-missing-teacher-"));
    const envFile = join(tmpDir, "teaching-ops.env");
    const releaseRunId = "release-teaching-ops-route-smoke-missing-teacher";
    const vercelProductionDeployment = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl: "https://teaching-ops.example.test",
      filename: "vercel-production-deployment.json",
      releaseRunId,
    });
    const teacherAuthProviderReadiness = writeTeacherAuthProviderReadinessEvidenceForTest(
      tmpDir,
      {
        filename: "teacher-auth-provider-readiness.json",
        releaseRunId,
      },
    );
    writeFileSync(
      envFile,
      [
        "UAIS_DEPLOYMENT_BASE_URL=https://teaching-ops.example.test",
        "UAIS_TEACHING_OPERATIONS_BACKEND=external",
        "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND=external",
        "UAIS_EXTERNAL_STORAGE_BASE_URL=https://external-storage.example.test",
        "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=secret-external-storage-token-with-32-chars",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER=external",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_URL=https://email-provider.example.test/collaboration-invite",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN=secret-email-provider-token-with-32-chars",
        "UAIS_COLLABORATION_INVITE_EMAIL_CALLBACK_TOKEN=secret-email-callback-token-with-32-chars",
        "UAIS_TEACHING_OPERATIONS_SMOKE_COOKIE=secret-cookie-pair",
        "UAIS_TEACHING_OPERATIONS_SMOKE_STUDENT_COOKIE=secret-student-cookie-pair",
        "UAIS_TEACHING_OPERATIONS_SMOKE_COURSE_ID=teacher-research-methods",
        "UAIS_TEACHING_OPERATIONS_SMOKE_CLASS_ID=teacher-research-methods-class-1",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/teaching-operations-route-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
      "--release-run-id",
      releaseRunId,
      "--vercel-production-deployment",
      vercelProductionDeployment,
      "--teacher-auth-provider-readiness",
      teacherAuthProviderReadiness,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        UAIS_TEACHING_OPERATIONS_SMOKE_TEACHER_ID: "",
      },
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.blockedReasons).toContain("missing-UAIS_TEACHING_OPERATIONS_SMOKE_TEACHER_ID");
    expect(body.requiredEnv).toContainEqual({
      name: "UAIS_TEACHING_OPERATIONS_SMOKE_TEACHER_ID",
      status: "missing",
    });
    expect(output).not.toContain("secret-cookie-pair");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("blocks production teaching operations route smoke when course management storage is not external", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teaching-ops-smoke-course-mgmt-"));
    const envFile = join(tmpDir, "teaching-ops.env");
    const releaseRunId = "release-teaching-ops-route-smoke-course-mgmt";
    const vercelProductionDeployment = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl: "https://teaching-ops.example.test",
      filename: "vercel-production-deployment.json",
      releaseRunId,
    });
    const teacherAuthProviderReadiness = writeTeacherAuthProviderReadinessEvidenceForTest(
      tmpDir,
      {
        filename: "teacher-auth-provider-readiness.json",
        releaseRunId,
      },
    );
    writeFileSync(
      envFile,
      [
        "UAIS_DEPLOYMENT_BASE_URL=https://teaching-ops.example.test",
        "UAIS_TEACHING_OPERATIONS_BACKEND=external",
        "UAIS_EXTERNAL_STORAGE_BASE_URL=https://external-storage.example.test",
        "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=secret-external-storage-token-with-32-chars",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER=external",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_URL=https://email-provider.example.test/collaboration-invite",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN=secret-email-provider-token-with-32-chars",
        "UAIS_COLLABORATION_INVITE_EMAIL_CALLBACK_TOKEN=secret-email-callback-token-with-32-chars",
        "UAIS_TEACHING_OPERATIONS_SMOKE_COOKIE=secret-cookie-pair",
        "UAIS_TEACHING_OPERATIONS_SMOKE_STUDENT_COOKIE=secret-student-cookie-pair",
        "UAIS_TEACHING_OPERATIONS_SMOKE_TEACHER_ID=teacher-kang",
        "UAIS_TEACHING_OPERATIONS_SMOKE_COURSE_ID=teacher-research-methods",
        "UAIS_TEACHING_OPERATIONS_SMOKE_CLASS_ID=teacher-research-methods-class-1",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/teaching-operations-route-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
      "--release-run-id",
      releaseRunId,
      "--vercel-production-deployment",
      vercelProductionDeployment,
      "--teacher-auth-provider-readiness",
      teacherAuthProviderReadiness,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.requiredEnv).toEqual(
      expect.arrayContaining([
        {
          name: "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
          status: "missing",
          requiredValue: "external",
        },
      ]),
    );
    expect(body.blockedReasons).toContain(
      "missing-UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
    );
    expect(output).not.toContain("secret-cookie-pair");
    expect(output).not.toContain("secret-external-storage-token-with-32-chars");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("requires Vercel production deployment evidence for production route smoke plans", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teaching-ops-missing-vercel-"));
    const envFile = join(tmpDir, "teaching-ops.env");
    const releaseRunId = "release-teaching-ops-route-smoke-missing-vercel";
    writeFileSync(
      envFile,
      [
        "UAIS_DEPLOYMENT_BASE_URL=https://teaching-ops.example.test",
        "UAIS_TEACHING_OPERATIONS_BACKEND=external",
        "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND=external",
        "UAIS_EXTERNAL_STORAGE_BASE_URL=https://external-storage.example.test",
        "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=secret-external-storage-token-with-32-chars",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER=external",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_URL=https://email-provider.example.test/collaboration-invite",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN=secret-email-provider-token-with-32-chars",
        "UAIS_COLLABORATION_INVITE_EMAIL_CALLBACK_TOKEN=secret-email-callback-token-with-32-chars",
        "UAIS_STUDENT_ROSTER_SYNC_PROVIDER=external",
        "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_URL=https://sis-provider.example.test/student-roster-sync",
        "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_TOKEN=secret-student-roster-provider-token-32",
        "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER=external",
        "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_URL=https://knowledge-provider.example.test/index/sync",
        "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_TOKEN=secret-knowledge-provider-token-32",
        "UAIS_GRADEBOOK_RELEASE_PROVIDER=external",
        "UAIS_GRADEBOOK_RELEASE_PROVIDER_URL=https://gradebook-provider.example.test/releases",
        "UAIS_GRADEBOOK_RELEASE_PROVIDER_TOKEN=secret-gradebook-provider-token-32",
        "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER=external",
        "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_URL=https://content-provider.example.test/course-content/publish",
        "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_TOKEN=secret-course-content-provider-token-32",
        "UAIS_COURSE_EXPORT_PROVIDER=external",
        "UAIS_COURSE_EXPORT_PROVIDER_URL=https://export-provider.example.test/exports",
        "UAIS_COURSE_EXPORT_PROVIDER_TOKEN=secret-export-provider-token-with-32-chars",
        "UAIS_GRADING_FEEDBACK_PROVIDER=external",
        "UAIS_GRADING_FEEDBACK_PROVIDER_URL=https://feedback-provider.example.test/grading-feedback",
        "UAIS_GRADING_FEEDBACK_PROVIDER_TOKEN=secret-feedback-provider-token-with-32-chars",
        "UAIS_TEACHING_OPERATIONS_SMOKE_COOKIE=secret-cookie-pair",
        "UAIS_TEACHING_OPERATIONS_SMOKE_STUDENT_COOKIE=secret-student-cookie-pair",
        "UAIS_TEACHING_OPERATIONS_SMOKE_TEACHER_ID=teacher-kang",
        "UAIS_TEACHING_OPERATIONS_SMOKE_COURSE_ID=teacher-research-methods",
        "UAIS_TEACHING_OPERATIONS_SMOKE_CLASS_ID=teacher-research-methods-class-1",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/teaching-operations-route-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
      "--release-run-id",
      releaseRunId,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "teaching-operations-route-smoke",
        mode: "dry-run",
        environment: "production",
        status: "blocked",
        blockedReasons: [
          "vercel-production-deployment-evidence-missing",
          "teacher-auth-provider-readiness-evidence-missing",
          "app-auth-provider-readiness-evidence-missing",
          "external-storage-service-readiness-evidence-missing",
        ],
        vercelProductionDeploymentEvidence: {
          target: "missing",
          status: "missing",
          deploymentObservationStatus: "missing",
          releaseRunIdStatus: "missing",
          valueRedacted: true,
        },
        teacherAuthProviderReadinessEvidence: {
          target: "missing",
          status: "missing",
          authProviderMode: "missing",
          releaseRunIdStatus: "missing",
          valueRedacted: true,
        },
        appAuthProviderReadinessEvidence: {
          target: "missing",
          status: "missing",
          appAuthProviderMode: "missing",
          releaseRunIdStatus: "missing",
          valueRedacted: true,
        },
        externalStorageServiceReadinessEvidence: {
          target: "missing",
          status: "missing",
          releaseRunIdStatus: "missing",
          valueRedacted: true,
        },
      }),
    );
    expect(output).not.toContain("teaching-ops.example.test");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("passes live approved smoke when the route denies unauthenticated and out-of-scope course writes", async () => {
    const requests: Array<{
      url: string;
      cookie?: string;
      authorization?: string;
      body: unknown;
    }> = [];
    let auditReadbackCount = 0;
    const server = createServer((request, response) => {
      let rawBody = "";
      request.on("data", (chunk) => {
        rawBody += chunk;
      });
      request.on("end", () => {
        const parsedBody = rawBody ? JSON.parse(rawBody) : undefined;
        requests.push({
          url: request.url ?? "",
          cookie: request.headers.cookie,
          authorization: request.headers.authorization,
          body: parsedBody,
        });

        if (
          request.method === "POST" &&
          request.url === "/api/teaching/operations" &&
          typeof parsedBody === "object" &&
          parsedBody !== null &&
          "sourceAction" in parsedBody &&
          parsedBody.sourceAction === "route-smoke-student-role-denial"
        ) {
          response.writeHead(403, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-teaching-operations-route-smoke-student-denied",
          });
          response.end(
            JSON.stringify({
              error: "UAIS teacher role is required.",
              traceId: "trace-teaching-operations-route-smoke-student-denied",
              access: {
                status: "denied",
                reasonCode: "teacher-role-required",
                responsibleSession: "S12",
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

        if (request.url?.startsWith("/teaching-course-management/")) {
          if (request.headers.authorization !== "Bearer secret-external-storage-token-with-32-chars") {
            response.writeHead(401, {
              "content-type": "application/json",
            });
            response.end(JSON.stringify({ error: "external storage auth required" }));
            return;
          }
          if (
            request.method === "GET" &&
            request.url === "/teaching-course-management/database"
          ) {
            response.writeHead(200, {
              "content-type": "application/json",
            });
            response.end(
              JSON.stringify({
                database: {
                  schemaVersion: "uais-teaching-course-management-v1",
                  updatedAt: "2026-06-23T00:00:00.000Z",
                  courses: [],
                  classes: [
                    {
                      classId: "teacher-research-methods-class-1",
                      courseId: "teacher-research-methods",
                      ownerTeacherId: "teacher-kang",
                      className: "Research Methods Class 1",
                      students: 0,
                      semester: "2026 Spring",
                      invitationCode: "77441121",
                      joinUrl: "/courses?invite=77441121",
                      createdAt: "2026-06-23T00:00:00.000Z",
                      updatedAt: "2026-06-23T00:00:00.000Z",
                      storagePolicy: "external-redacted-teaching-course-management-snapshot",
                      storageWritePolicy: "external-optimistic-snapshot-replace",
                      responsibleSession: "S12",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                  ],
                  memberships: [],
                  inviteCodeDrafts: [
                    {
                      inviteCodeDraftId: "invite-code-draft-teacher-research-methods-77441122",
                      courseId: "teacher-research-methods",
                      classId: "teacher-research-methods-class-1",
                      ownerTeacherId: "teacher-kang",
                      generatedBy: "teacher-kang",
                      draftStatus: "generated",
                      operationRecordId: "invite-draft-record-route-smoke",
                      sourceAction: "route-smoke-invite-draft",
                      inviteCode: "77441122",
                      joinUrl: "/courses?invite=77441122",
                      invitePolicy: "teacher-review-before-publication",
                      generatedAt: "2026-06-23T00:11:00.000Z",
                      storagePolicy: "external-redacted-teaching-course-management-snapshot",
                      storageWritePolicy: "external-optimistic-snapshot-replace",
                      responsibleSession: "S12",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                  ],
                  courseSettings: [
                    {
                      settingsId: "course-settings-teacher-research-methods",
                      courseId: "teacher-research-methods",
                      ownerTeacherId: "teacher-kang",
                      updatedBy: "teacher-kang",
                      settingsStatus: "saved",
                      operationRecordId: "operation-record-route-smoke",
                      sourceAction: "route-smoke",
                      appliedFields: ["courseName", "semester", "description"],
                      courseName: "Route Smoke Applied Course Settings",
                      semester: "2026 Fall",
                      description:
                        "Route smoke verifies persisted course settings patch readback.",
                      updatedAt: "2026-06-23T00:00:00.000Z",
                      storagePolicy: "external-redacted-teaching-course-management-snapshot",
                      storageWritePolicy: "external-optimistic-snapshot-replace",
                      responsibleSession: "S12",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                  ],
                  studentPreviewSessions: [
                    {
                      previewSessionId: "student-preview-session-teacher-research-methods",
                      courseId: "teacher-research-methods",
                      ownerTeacherId: "teacher-kang",
                      previewedBy: "teacher-kang",
                      previewStatus: "generated",
                      operationRecordId: "student-preview-session-record-route-smoke",
                      sourceAction: "route-smoke-student-preview",
                      previewId: "student-preview-20260623-000010",
                      previewUrl: "/learning?teacherPreview=1&course=teacher-research-methods",
                      previewScope: "teacher-course-preview",
                      previewPolicy: "teacher-visible-preview-only",
                      generatedAt: "2026-06-23T00:00:10.000Z",
                      storagePolicy: "external-redacted-teaching-course-management-snapshot",
                      storageWritePolicy: "external-optimistic-snapshot-replace",
                      responsibleSession: "S12",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                  ],
                  studentRosters: [
                    {
                      rosterId: "student-roster-teacher-research-methods",
                      courseId: "teacher-research-methods",
                      ownerTeacherId: "teacher-kang",
                      syncedBy: "teacher-kang",
                      syncStatus: "synced",
                      operationRecordId: "student-roster-record-route-smoke",
                      sourceAction: "route-smoke-student-roster",
                      approvedStudentCount: 1,
                      pendingTeacherReviewCount: 1,
                      classCount: 1,
                      sourceSystems: ["sis-roster", "invite-code-joins", "withdrawals"],
                      syncedAt: "2026-06-23T00:01:00.000Z",
                      storagePolicy: "external-redacted-teaching-course-management-snapshot",
                      storageWritePolicy: "external-optimistic-snapshot-replace",
                      responsibleSession: "S12",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                  ],
                  studentGroupSuggestions: [
                    {
                      groupSuggestionId: "group-suggestion-teacher-research-methods",
                      courseId: "teacher-research-methods",
                      ownerTeacherId: "teacher-kang",
                      generatedBy: "teacher-kang",
                      suggestionStatus: "generated",
                      operationRecordId: "student-group-suggestion-record-route-smoke",
                      sourceAction: "route-smoke-student-group-suggestion",
                      suggestionScope: "teacher-editable-student-groups",
                      sourceSignals: [
                        "learning-progress",
                        "participation-frequency",
                        "role-preferences",
                      ],
                      reviewPolicy: "teacher-review-before-group-assignment",
                      generatedAt: "2026-06-23T00:01:30.000Z",
                      storagePolicy: "external-redacted-teaching-course-management-snapshot",
                      storageWritePolicy: "external-optimistic-snapshot-replace",
                      responsibleSession: "S12",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                  ],
                  knowledgeIndexes: [
                    {
                      indexId: "knowledge-index-teacher-research-methods",
                      courseId: "teacher-research-methods",
                      ownerTeacherId: "teacher-kang",
                      syncedBy: "teacher-kang",
                      syncStatus: "synced",
                      operationRecordId: "knowledge-index-record-route-smoke",
                      sourceAction: "route-smoke-knowledge-index",
                      sourceSystems: [
                        "course-files",
                        "teacher-resources",
                        "agent-grounding-index",
                      ],
                      syncedAt: "2026-06-23T00:02:00.000Z",
                      storagePolicy: "external-redacted-teaching-course-management-snapshot",
                      storageWritePolicy: "external-optimistic-snapshot-replace",
                      responsibleSession: "S12",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                  ],
                  resourceReviewItems: [
                    {
                      resourceReviewItemId: "resource-review-item-teacher-research-methods",
                      courseId: "teacher-research-methods",
                      ownerTeacherId: "teacher-kang",
                      queuedBy: "teacher-kang",
                      reviewStatus: "pending-teacher-review",
                      operationRecordId: "resource-review-item-record-route-smoke",
                      sourceAction: "route-smoke-resource-review",
                      resourceSource: "teacher-placeholder",
                      reviewPolicy: "teacher-review-before-knowledge-index",
                      queuedAt: "2026-06-23T00:02:30.000Z",
                      storagePolicy: "external-redacted-teaching-course-management-snapshot",
                      storageWritePolicy: "external-optimistic-snapshot-replace",
                      responsibleSession: "S12",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                  ],
                  contentPackages: [
                    {
                      contentId: "course-content-teacher-research-methods",
                      courseId: "teacher-research-methods",
                      ownerTeacherId: "teacher-kang",
                      publishedBy: "teacher-kang",
                      publicationStatus: "published",
                      operationRecordId: "course-content-record-route-smoke",
                      sourceAction: "route-smoke-course-content",
                      releaseScope: "course-visible-content",
                      publishedAt: "2026-06-23T00:03:00.000Z",
                      storagePolicy: "external-redacted-teaching-course-management-snapshot",
                      storageWritePolicy: "external-optimistic-snapshot-replace",
                      responsibleSession: "S12",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                  ],
                  courseUnitDrafts: [
                    {
                      unitDraftId: "course-unit-draft-teacher-research-methods",
                      courseId: "teacher-research-methods",
                      ownerTeacherId: "teacher-kang",
                      generatedBy: "teacher-kang",
                      draftStatus: "generated",
                      operationRecordId: "course-unit-draft-record-route-smoke",
                      sourceAction: "route-smoke-course-unit-draft",
                      draftScope: "teacher-editable-unit-plan",
                      sourceSystems: [
                        "course-knowledge-index",
                        "teaching-objectives",
                        "quiz-bank",
                      ],
                      reviewPolicy: "teacher-review-before-student-release",
                      generatedAt: "2026-06-23T00:03:30.000Z",
                      storagePolicy: "external-redacted-teaching-course-management-snapshot",
                      storageWritePolicy: "external-optimistic-snapshot-replace",
                      responsibleSession: "S12",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                  ],
                  dashboardStates: [
                    {
                      dashboardStateId: "dashboard-state-teacher-research-methods",
                      courseId: "teacher-research-methods",
                      ownerTeacherId: "teacher-kang",
                      refreshedBy: "teacher-kang",
                      refreshStatus: "refreshed",
                      operationRecordId: "dashboard-state-record-route-smoke",
                      sourceAction: "route-smoke-dashboard-state",
                      visibleMetrics: ["engagement", "progress", "assessment-quality"],
                      refreshPolicy: "teacher-visible-course-dashboard",
                      refreshedAt: "2026-06-23T00:04:00.000Z",
                      storagePolicy: "external-redacted-teaching-course-management-snapshot",
                      storageWritePolicy: "external-optimistic-snapshot-replace",
                      responsibleSession: "S12",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                  ],
                  dashboardSnapshots: [
                    {
                      dashboardSnapshotId: "dashboard-snapshot-teacher-research-methods",
                      courseId: "teacher-research-methods",
                      ownerTeacherId: "teacher-kang",
                      lockedBy: "teacher-kang",
                      snapshotStatus: "locked",
                      operationRecordId: "dashboard-snapshot-record-route-smoke",
                      sourceAction: "route-smoke-dashboard-snapshot",
                      teachingOperationSnapshotId: "daily-snapshot-20260623-000420",
                      snapshotScope: "daily-course-dashboard",
                      retentionPolicy: "teacher-locked-dashboard-snapshot",
                      lockedAt: "2026-06-23T00:04:20.000Z",
                      storagePolicy: "external-redacted-teaching-course-management-snapshot",
                      storageWritePolicy: "external-optimistic-snapshot-replace",
                      responsibleSession: "S12",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                  ],
                  quizAssessments: [
                    {
                      quizAssessmentId: "quiz-assessment-teacher-research-methods",
                      courseId: "teacher-research-methods",
                      ownerTeacherId: "teacher-kang",
                      refreshedBy: "teacher-kang",
                      assessmentStatus: "refreshed",
                      operationRecordId: "quiz-assessment-record-route-smoke",
                      sourceAction: "route-smoke-quiz-assessment",
                      quizBoardStateId: "quiz-board-state-teacher-research-methods",
                      visibleMetrics: [
                        "completion-rate",
                        "item-quality",
                        "misconception-clusters",
                      ],
                      reviewPolicy: "teacher-visible-quiz-quality-board",
                      reusePolicy: "teacher-review-before-quiz-reuse",
                      refreshedAt: "2026-06-23T00:05:00.000Z",
                      storagePolicy: "external-redacted-teaching-course-management-snapshot",
                      storageWritePolicy: "external-optimistic-snapshot-replace",
                      responsibleSession: "S12",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                  ],
                  quizItemReviews: [
                    {
                      quizItemReviewId: "quiz-item-review-teacher-research-methods",
                      courseId: "teacher-research-methods",
                      ownerTeacherId: "teacher-kang",
                      flaggedBy: "teacher-kang",
                      reviewStatus: "flagged-for-review",
                      operationRecordId: "quiz-item-review-record-route-smoke",
                      sourceAction: "route-smoke-quiz-item-review",
                      flaggedSignals: [
                        "low-discrimination",
                        "high-error-rate",
                        "teacher-review-needed",
                      ],
                      reviewPolicy: "teacher-review-before-quiz-reuse",
                      flaggedAt: "2026-06-23T00:05:30.000Z",
                      storagePolicy: "external-redacted-teaching-course-management-snapshot",
                      storageWritePolicy: "external-optimistic-snapshot-replace",
                      responsibleSession: "S12",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                  ],
                  agentSettings: [
                    {
                      agentSettingsId: "agent-settings-teacher-research-methods",
                      courseId: "teacher-research-methods",
                      ownerTeacherId: "teacher-kang",
                      savedBy: "teacher-kang",
                      settingsStatus: "saved",
                      operationRecordId: "agent-settings-record-route-smoke",
                      sourceAction: "route-smoke-agent-settings",
                      agentScopes: [
                        "research-agent",
                        "method-agent",
                        "writing-agent",
                        "math-agent",
                      ],
                      governancePolicy: "teacher-controlled-agent-settings",
                      savedAt: "2026-06-23T00:05:15.000Z",
                      storagePolicy: "external-redacted-teaching-course-management-snapshot",
                      storageWritePolicy: "external-optimistic-snapshot-replace",
                      responsibleSession: "S12",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                  ],
                  agentPermissionPreflights: [
                    {
                      preflightId: "agent-permission-preflight-teacher-research-methods",
                      courseId: "teacher-research-methods",
                      ownerTeacherId: "teacher-kang",
                      checkedBy: "teacher-kang",
                      preflightStatus: "passed",
                      operationRecordId: "agent-permission-preflight-record-route-smoke",
                      sourceAction: "route-smoke-agent-permission-preflight",
                      checkedPermissions: ["course-bindings", "agent-roles", "student-access"],
                      preflightPolicy: "teacher-agent-permission-gate",
                      checkedAt: "2026-06-23T00:05:20.000Z",
                      storagePolicy: "external-redacted-teaching-course-management-snapshot",
                      storageWritePolicy: "external-optimistic-snapshot-replace",
                      responsibleSession: "S12",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                  ],
                  adminSettings: [
                    {
                      adminSettingsId: "admin-settings-teacher-research-methods",
                      courseId: "teacher-research-methods",
                      ownerTeacherId: "teacher-kang",
                      savedBy: "teacher-kang",
                      settingsStatus: "saved",
                      operationRecordId: "admin-settings-record-route-smoke",
                      sourceAction: "route-smoke-admin-settings",
                      adminScopes: [
                        "course-collaborators",
                        "permission-boundary",
                        "audit-routing",
                      ],
                      governancePolicy: "teacher-controlled-admin-settings",
                      savedAt: "2026-06-23T00:05:00.000Z",
                      storagePolicy: "external-redacted-teaching-course-management-snapshot",
                      storageWritePolicy: "external-optimistic-snapshot-replace",
                      responsibleSession: "S12",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                  ],
                  collaborationInviteNotifications: [
                    {
                      notificationId:
                        "collaboration-invite-notification-teacher-research-methods",
                      courseId: "teacher-research-methods",
                      ownerTeacherId: "teacher-kang",
                      queuedBy: "teacher-kang",
                      notificationStatus: "delivery-failed",
                      operationRecordId: "collaboration-invite-record-route-smoke",
                      sourceAction: "route-smoke-collaboration-invite",
                      outboxId: "collaboration-invite-teacher-kang-route-smoke",
                      deliveryChannel: "collaboration-invite-email",
                      providerStatus: "smtp-provider-bounced",
                      providerDeliveryId: "email-delivery-collaboration-invite-route-smoke",
                      deliveryFailureReason: "route-smoke-bounce",
                      providerCallbackAt: "2026-06-23T00:05:45.000Z",
                      deliveryPolicy: "server-outbox-before-smtp-provider",
                      queuedAt: "2026-06-23T00:05:30.000Z",
                      deliveredAt: "2026-06-23T00:05:45.000Z",
                      storagePolicy: "external-redacted-teaching-course-management-snapshot",
                      storageWritePolicy: "external-optimistic-snapshot-replace",
                      responsibleSession: "S12",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                  ],
                  exportManifests: [
                    {
                      exportManifestId: "export-manifest-teacher-research-methods",
                      courseId: "teacher-research-methods",
                      ownerTeacherId: "teacher-kang",
                      createdBy: "teacher-kang",
                      exportStatus: "generated",
                      operationRecordId: "course-export-manifest-record-route-smoke",
                      sourceAction: "route-smoke-export-manifest",
                      teachingOperationManifestId: "export-manifest-teacher-kang-route-smoke",
                      downloadRoute:
                        "/api/teaching/operations/export/export-manifest-teacher-kang-route-smoke",
                      datasetScopes: ["learning-records", "chat-threads", "grades", "activities"],
                      formats: ["json", "csv"],
                      exportPolicy: "redacted-teacher-export-manifest",
                      createdAt: "2026-06-23T00:06:00.000Z",
                      storagePolicy: "external-redacted-teaching-course-management-snapshot",
                      storageWritePolicy: "external-optimistic-snapshot-replace",
                      responsibleSession: "S12",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                  ],
                  exportRedactionValidations: [
                    {
                      exportRedactionValidationId:
                        "export-redaction-validation-teacher-research-methods",
                      courseId: "teacher-research-methods",
                      ownerTeacherId: "teacher-kang",
                      validatedBy: "teacher-kang",
                      validationStatus: "passed",
                      operationRecordId: "export-redaction-validation-record-route-smoke",
                      sourceAction: "route-smoke-export-redaction",
                      checkedScopes: [
                        "identity-fields",
                        "ai-chat-transcripts",
                        "voice-references",
                        "local-file-paths",
                      ],
                      blockedSecretCount: 0,
                      validationPolicy: "no-secrets-or-local-paths-before-export",
                      validatedAt: "2026-06-23T00:06:30.000Z",
                      storagePolicy: "external-redacted-teaching-course-management-snapshot",
                      storageWritePolicy: "external-optimistic-snapshot-replace",
                      responsibleSession: "S12",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                  ],
                  gradingQueues: [
                    {
                      gradingQueueId: "grading-queue-teacher-research-methods",
                      courseId: "teacher-research-methods",
                      ownerTeacherId: "teacher-kang",
                      savedBy: "teacher-kang",
                      queueStatus: "saved",
                      operationRecordId: "gradebook-seed-record-route-smoke",
                      sourceAction: "route-smoke-gradebook-release",
                      gradebookUpdateId: "gradebook-update-teacher-research-methods",
                      reviewPolicy: "teacher-review-before-release",
                      releasePolicy: "teacher-confirmed-grade-release",
                      savedAt: "2026-06-23T00:07:00.000Z",
                      storagePolicy: "external-redacted-teaching-course-management-snapshot",
                      storageWritePolicy: "external-optimistic-snapshot-replace",
                      responsibleSession: "S12",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                  ],
                  gradebookUpdates: [
                    {
                      objectId: "gradebook-update-teacher-research-methods",
                      objectType: "gradebook-update",
                      courseId: "teacher-research-methods",
                      updatedBy: "teacher-kang",
                      updateStatus: "pending-release",
                      operationRecordId: "gradebook-seed-record-route-smoke",
                      sourceAction: "route-smoke-gradebook-release",
                      releasePolicy: "teacher-confirmed-grade-release",
                      updatedAt: "2026-06-23T00:07:00.000Z",
                      storagePolicy: "domain-projection-teaching-gradebook-update",
                      responsibleSession: "S12",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                  ],
                  gradingFeedbackDrafts: [
                    {
                      gradingFeedbackDraftId: "grading-feedback-draft-teacher-research-methods",
                      courseId: "teacher-research-methods",
                      ownerTeacherId: "teacher-kang",
                      generatedBy: "teacher-kang",
                      feedbackStatus: "generated",
                      operationRecordId: "grading-feedback-draft-record-route-smoke",
                      sourceAction: "route-smoke-grading-feedback",
                      teachingOperationFeedbackArtifactId: "ai-feedback-20260623-000730",
                      feedbackScope: "grading-review-queue",
                      reviewPolicy: "teacher-review-before-student-release",
                      releasePolicy: "teacher-confirmed-feedback-release",
                      generatedAt: "2026-06-23T00:07:30.000Z",
                      storagePolicy: "external-redacted-teaching-course-management-snapshot",
                      storageWritePolicy: "external-optimistic-snapshot-replace",
                      responsibleSession: "S12",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                  ],
                  auditEvents: [
                    {
                      auditId: "audit-generate-student-preview-session-20260623-000010",
                      action: "generate-student-preview-session",
                      actorId: "teacher-kang",
                      actorRole: "teacher",
                      authMode: "signed-teacher-session",
                      courseId: "teacher-research-methods",
                      traceId: "trace-teaching-operations-route-smoke-student-preview",
                      createdAt: "2026-06-23T00:00:10.000Z",
                      requestSource: {
                        userAgent: "UAIS teaching operations route smoke",
                        ipAddress: "redacted",
                      },
                      storagePolicy: "external-redacted-teaching-course-management-audit-log",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                    {
                      auditId: "audit-sync-student-roster-provider-20260623-000110",
                      action: "sync-student-roster-provider",
                      actorId: "teacher-kang",
                      actorRole: "teacher",
                      authMode: "signed-teacher-session",
                      courseId: "teacher-research-methods",
                      traceId: "trace-teaching-operations-route-smoke-student-roster",
                      createdAt: "2026-06-23T00:01:10.000Z",
                      requestSource: {
                        userAgent: "UAIS teaching operations route smoke",
                        ipAddress: "redacted",
                      },
                      storagePolicy: "external-redacted-teaching-course-management-audit-log",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                    {
                      auditId: "audit-generate-student-group-suggestions-20260623-000130",
                      action: "generate-student-group-suggestions",
                      actorId: "teacher-kang",
                      actorRole: "teacher",
                      authMode: "signed-teacher-session",
                      courseId: "teacher-research-methods",
                      traceId:
                        "trace-teaching-operations-route-smoke-student-group-suggestion",
                      createdAt: "2026-06-23T00:01:30.000Z",
                      requestSource: {
                        userAgent: "UAIS teaching operations route smoke",
                        ipAddress: "redacted",
                      },
                      storagePolicy: "external-redacted-teaching-course-management-audit-log",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                    {
                      auditId: "audit-queue-resource-review-item-20260623-000230",
                      action: "queue-resource-review-item",
                      actorId: "teacher-kang",
                      actorRole: "teacher",
                      authMode: "signed-teacher-session",
                      courseId: "teacher-research-methods",
                      traceId: "trace-teaching-operations-route-smoke-resource-review",
                      createdAt: "2026-06-23T00:02:30.000Z",
                      requestSource: {
                        userAgent: "UAIS teaching operations route smoke",
                        ipAddress: "redacted",
                      },
                      storagePolicy: "external-redacted-teaching-course-management-audit-log",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                    {
                      auditId: "audit-sync-knowledge-index-provider-20260623-000215",
                      action: "sync-knowledge-index-provider",
                      actorId: "teacher-kang",
                      actorRole: "teacher",
                      authMode: "signed-teacher-session",
                      courseId: "teacher-research-methods",
                      traceId: "trace-teaching-operations-route-smoke-knowledge-index",
                      createdAt: "2026-06-23T00:02:15.000Z",
                      requestSource: {
                        userAgent: "UAIS teaching operations route smoke",
                        ipAddress: "redacted",
                      },
                      storagePolicy: "external-redacted-teaching-course-management-audit-log",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                    {
                      auditId: "audit-generate-course-unit-draft-20260623-000330",
                      action: "generate-course-unit-draft",
                      actorId: "teacher-kang",
                      actorRole: "teacher",
                      authMode: "signed-teacher-session",
                      courseId: "teacher-research-methods",
                      traceId: "trace-teaching-operations-route-smoke-course-unit-draft",
                      createdAt: "2026-06-23T00:03:30.000Z",
                      requestSource: {
                        userAgent: "UAIS teaching operations route smoke",
                        ipAddress: "redacted",
                      },
                      storagePolicy: "external-redacted-teaching-course-management-audit-log",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                    {
                      auditId: "audit-publish-course-content-provider-20260623-000315",
                      action: "publish-course-content-provider",
                      actorId: "teacher-kang",
                      actorRole: "teacher",
                      authMode: "signed-teacher-session",
                      courseId: "teacher-research-methods",
                      traceId: "trace-teaching-operations-route-smoke-course-content",
                      createdAt: "2026-06-23T00:03:15.000Z",
                      requestSource: {
                        userAgent: "UAIS teaching operations route smoke",
                        ipAddress: "redacted",
                      },
                      storagePolicy: "external-redacted-teaching-course-management-audit-log",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                    {
                      auditId: "audit-create-export-manifest-20260623-000600",
                      action: "create-export-manifest",
                      actorId: "teacher-kang",
                      actorRole: "teacher",
                      authMode: "signed-teacher-session",
                      courseId: "teacher-research-methods",
                      traceId: "trace-teaching-operations-route-smoke-export-manifest",
                      createdAt: "2026-06-23T00:06:00.000Z",
                      requestSource: {
                        userAgent: "UAIS teaching operations route smoke",
                        ipAddress: "redacted",
                      },
                      storagePolicy: "external-redacted-teaching-course-management-audit-log",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                    {
                      auditId: "audit-export-course-data-provider-20260623-000610",
                      action: "export-course-data-provider",
                      actorId: "teacher-kang",
                      actorRole: "teacher",
                      authMode: "signed-teacher-session",
                      courseId: "teacher-research-methods",
                      traceId: "trace-teaching-operations-route-smoke-export-manifest",
                      createdAt: "2026-06-23T00:06:10.000Z",
                      requestSource: {
                        userAgent: "UAIS teaching operations route smoke",
                        ipAddress: "redacted",
                      },
                      storagePolicy: "external-redacted-teaching-course-management-audit-log",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                    {
                      auditId: "audit-validate-export-redaction-scope-20260623-000630",
                      action: "validate-export-redaction-scope",
                      actorId: "teacher-kang",
                      actorRole: "teacher",
                      authMode: "signed-teacher-session",
                      courseId: "teacher-research-methods",
                      traceId: "trace-teaching-operations-route-smoke-export-redaction",
                      createdAt: "2026-06-23T00:06:30.000Z",
                      requestSource: {
                        userAgent: "UAIS teaching operations route smoke",
                        ipAddress: "redacted",
                      },
                      storagePolicy: "external-redacted-teaching-course-management-audit-log",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                    {
                      auditId: "audit-refresh-dashboard-20260623-000400",
                      action: "refresh-dashboard",
                      actorId: "teacher-kang",
                      actorRole: "teacher",
                      authMode: "signed-teacher-session",
                      courseId: "teacher-research-methods",
                      traceId: "trace-teaching-operations-route-smoke-dashboard-state",
                      createdAt: "2026-06-23T00:04:00.000Z",
                      requestSource: {
                        userAgent: "UAIS teaching operations route smoke",
                        ipAddress: "redacted",
                      },
                      storagePolicy: "external-redacted-teaching-course-management-audit-log",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                    {
                      auditId: "audit-lock-dashboard-snapshot-20260623-000430",
                      action: "lock-dashboard-snapshot",
                      actorId: "teacher-kang",
                      actorRole: "teacher",
                      authMode: "signed-teacher-session",
                      courseId: "teacher-research-methods",
                      traceId: "trace-teaching-operations-route-smoke-dashboard-snapshot",
                      createdAt: "2026-06-23T00:04:30.000Z",
                      requestSource: {
                        userAgent: "UAIS teaching operations route smoke",
                        ipAddress: "redacted",
                      },
                      storagePolicy: "external-redacted-teaching-course-management-audit-log",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                    {
                      auditId: "audit-save-admin-settings-20260623-000500",
                      action: "save-admin-settings",
                      actorId: "teacher-kang",
                      actorRole: "teacher",
                      authMode: "signed-teacher-session",
                      courseId: "teacher-research-methods",
                      traceId: "trace-teaching-operations-route-smoke-admin-settings",
                      createdAt: "2026-06-23T00:05:00.000Z",
                      requestSource: {
                        userAgent: "UAIS teaching operations route smoke",
                        ipAddress: "redacted",
                      },
                      storagePolicy: "external-redacted-teaching-course-management-audit-log",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                    {
                      auditId: "audit-save-agent-settings-20260623-000515",
                      action: "save-agent-settings",
                      actorId: "teacher-kang",
                      actorRole: "teacher",
                      authMode: "signed-teacher-session",
                      courseId: "teacher-research-methods",
                      traceId: "trace-teaching-operations-route-smoke-agent-settings",
                      createdAt: "2026-06-23T00:05:15.000Z",
                      requestSource: {
                        userAgent: "UAIS teaching operations route smoke",
                        ipAddress: "redacted",
                      },
                      storagePolicy: "external-redacted-teaching-course-management-audit-log",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                    {
                      auditId: "audit-record-agent-permission-preflight-20260623-000520",
                      action: "record-agent-permission-preflight",
                      actorId: "teacher-kang",
                      actorRole: "teacher",
                      authMode: "signed-teacher-session",
                      courseId: "teacher-research-methods",
                      traceId:
                        "trace-teaching-operations-route-smoke-agent-permission-preflight",
                      createdAt: "2026-06-23T00:05:20.000Z",
                      requestSource: {
                        userAgent: "UAIS teaching operations route smoke",
                        ipAddress: "redacted",
                      },
                      storagePolicy: "external-redacted-teaching-course-management-audit-log",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                    {
                      auditId: "audit-flag-quiz-item-review-20260623-000530",
                      action: "flag-quiz-item-review",
                      actorId: "teacher-kang",
                      actorRole: "teacher",
                      authMode: "signed-teacher-session",
                      courseId: "teacher-research-methods",
                      traceId: "trace-teaching-operations-route-smoke-quiz-item-review",
                      createdAt: "2026-06-23T00:05:30.000Z",
                      requestSource: {
                        userAgent: "UAIS teaching operations route smoke",
                        ipAddress: "redacted",
                      },
                      storagePolicy: "external-redacted-teaching-course-management-audit-log",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                    {
                      auditId: "audit-generate-grading-feedback-provider-20260623-000740",
                      action: "generate-grading-feedback-provider",
                      actorId: "teacher-kang",
                      actorRole: "teacher",
                      authMode: "signed-teacher-session",
                      courseId: "teacher-research-methods",
                      traceId: "trace-teaching-operations-route-smoke-grading-feedback",
                      createdAt: "2026-06-23T00:07:40.000Z",
                      requestSource: {
                        userAgent: "UAIS teaching operations route smoke",
                        ipAddress: "redacted",
                      },
                      storagePolicy: "external-redacted-teaching-course-management-audit-log",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                    {
                      auditId: "audit-deliver-collaboration-invite-email-20260623-000500",
                      action: "deliver-collaboration-invite-email",
                      actorId: "teacher-kang",
                      actorRole: "teacher",
                      authMode: "signed-teacher-session",
                      courseId: "teacher-research-methods",
                      traceId: "trace-teaching-operations-route-smoke-collaboration-invite",
                      createdAt: "2026-06-23T00:05:00.000Z",
                      requestSource: {
                        userAgent: "UAIS teaching operations route smoke",
                        ipAddress: "redacted",
                      },
                      storagePolicy: "external-redacted-teaching-course-management-audit-log",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                    {
                      auditId:
                        "audit-record-collaboration-invite-email-delivery-callback-20260623-000510",
                      action: "record-collaboration-invite-email-delivery-callback",
                      actorId: "teacher-kang",
                      actorRole: "teacher",
                      authMode: "signed-teacher-session",
                      courseId: "teacher-research-methods",
                      traceId:
                        "trace-teaching-operations-route-smoke-collaboration-invite-bounce",
                      createdAt: "2026-06-23T00:05:10.000Z",
                      requestSource: {
                        userAgent: "redacted",
                        ipAddress: "redacted",
                      },
                      storagePolicy: "external-redacted-teaching-course-management-audit-log",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                    {
                      auditId: "audit-generate-class-invite-code-draft-20260623-001100",
                      action: "generate-class-invite-code-draft",
                      actorId: "teacher-kang",
                      actorRole: "teacher",
                      authMode: "signed-teacher-session",
                      courseId: "teacher-research-methods",
                      classId: "teacher-research-methods-class-1",
                      traceId: "trace-teaching-operations-route-smoke-invite-draft",
                      createdAt: "2026-06-23T00:11:00.000Z",
                      requestSource: {
                        userAgent: "UAIS teaching operations route smoke",
                        ipAddress: "redacted",
                      },
                      storagePolicy: "external-redacted-teaching-course-management-audit-log",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                    {
                      auditId: "audit-publish-class-invite-code-20260623-001130",
                      action: "publish-class-invite-code",
                      actorId: "teacher-kang",
                      actorRole: "teacher",
                      authMode: "signed-teacher-session",
                      courseId: "teacher-research-methods",
                      classId: "teacher-research-methods-class-1",
                      traceId: "trace-teaching-operations-route-smoke-invite-publish",
                      createdAt: "2026-06-23T00:11:30.000Z",
                      requestSource: {
                        userAgent: "UAIS teaching operations route smoke",
                        ipAddress: "redacted",
                      },
                      storagePolicy: "external-redacted-teaching-course-management-audit-log",
                      redaction: {
                        secrets: "omitted",
                        localFiles: "omitted",
                        assets: "ids-only",
                      },
                    },
                  ],
                },
                revision: "course-settings-route-smoke-revision",
              }),
            );
            return;
          }
        }

        if (request.url?.startsWith("/teaching-operations/")) {
          if (request.headers.authorization !== "Bearer secret-external-storage-token-with-32-chars") {
            response.writeHead(401, {
              "content-type": "application/json",
            });
            response.end(JSON.stringify({ error: "external storage auth required" }));
            return;
          }

          if (request.url === "/teaching-operations/teacher-kang/append") {
            response.writeHead(200, {
              "content-type": "application/json",
            });
            response.end(
              JSON.stringify({
                status: "persisted",
                recordId: "admins-send-admin-email-route-smoke-alert",
                auditId: "audit-admins-send-admin-email-route-smoke-alert",
                storagePolicy: "external-redacted-teaching-operation-append",
                storageWritePolicy: "external-append-only-operation-log",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "ids-only",
                },
              }),
            );
            return;
          }

          if (request.method === "GET" && request.url === "/teaching-operations/teacher-kang/audit") {
            response.writeHead(200, {
              "content-type": "application/json",
            });
            response.end(
              JSON.stringify({
                teacherId: "teacher-kang",
                courseIds: ["teacher-research-methods"],
                records: [
                  {
                    recordId: "operation-record-route-smoke",
                    courseId: "teacher-research-methods",
                    operationId: "course-settings",
                    actionSlot: "primary",
                    status: "persisted",
                    storagePolicy: "external-redacted-teaching-operation-append",
                  },
                ],
                auditEvents: [
                  {
                    traceId: "trace-teaching-operations-route-smoke",
                    courseId: "teacher-research-methods",
                    actorId: "teacher-kang",
                  },
                  {
                    traceId: "trace-teaching-operations-route-smoke-gradebook-release",
                    eventType: "teaching-gradebook-update.released",
                    courseId: "teacher-research-methods",
                    actorId: "teacher-kang",
                    gradebookUpdateId: "gradebook-update-teacher-research-methods",
                    requestSource: {
                      userAgent: "UAIS teaching operations route smoke",
                      ipAddress: "redacted",
                    },
                  },
                  {
                    traceId: "trace-teaching-operations-route-smoke-gradebook-rollback",
                    eventType: "teaching-gradebook-update.release-rolled-back",
                    courseId: "teacher-research-methods",
                    actorId: "teacher-kang",
                    gradebookUpdateId: "gradebook-update-teacher-research-methods",
                    requestSource: {
                      userAgent: "UAIS teaching operations route smoke",
                      ipAddress: "redacted",
                    },
                  },
                ],
                domainProjections: [
                  {
                    objectId: "course-settings-teacher-research-methods",
                    objectType: "course-settings",
                    courseId: "teacher-research-methods",
                    operationRecordId: "operation-record-route-smoke",
                    storagePolicy: "domain-projection-teaching-course-settings",
                  },
                ],
                storagePolicy: "external-redacted-teaching-operation-audit-log",
              }),
            );
            return;
          }

          if (request.url === "/teaching-operations/teacher-kang/audit/alerts") {
            response.writeHead(200, {
              "content-type": "application/json",
            });
            response.end(
              JSON.stringify({
                teacherId: "teacher-kang",
                status: "attention-required",
                eventType: "teaching-operation-audit-alert-summary",
                storagePolicy: "external-redacted-teaching-operation-audit-alerts",
                sourceStoragePolicy: "external-redacted-teaching-operation-audit-log",
                alertCount: 1,
                alerts: [
                  {
                    alertId:
                      "missing-course-context-audit-admins-send-admin-email-route-smoke-alert",
                    severity: "high",
                    reason: "missing-course-context",
                    auditId: "audit-admins-send-admin-email-route-smoke-alert",
                    traceId: "trace-teaching-operations-route-smoke-alert",
                    actorId: "teacher-kang",
                    operationId: "admins",
                    actionSlot: "secondary",
                    actionId: "send-collaboration-invite",
                  },
                ],
              }),
            );
            return;
          }

          if (
            request.method === "POST" &&
            request.url === "/teaching-operations/teacher-kang/audit/alerts/notifications"
          ) {
            response.writeHead(200, {
              "content-type": "application/json",
            });
            response.end(
              JSON.stringify({
                teacherId: "teacher-kang",
                status: "queued",
                eventType: "teaching-operation-audit-alert-notification-dispatch",
                storagePolicy:
                  "external-redacted-teaching-operation-audit-alert-notification-outbox",
                storageWritePolicy: "external-append-only-notification-outbox",
                notificationCount: 1,
                notifications: [
                  {
                    notificationId:
                      "alert-notification-missing-course-context-audit-admins-send-admin-email-route-smoke-alert",
                    alertId:
                      "missing-course-context-audit-admins-send-admin-email-route-smoke-alert",
                    deliveryStatus: "queued",
                    traceId: "trace-teaching-operations-route-smoke-alert",
                  },
                ],
              }),
            );
            return;
          }

          if (
            request.method === "GET" &&
            request.url === "/teaching-operations/teacher-kang/audit/alerts/notifications"
          ) {
            response.writeHead(200, {
              "content-type": "application/json",
            });
            response.end(
              JSON.stringify({
                teacherId: "teacher-kang",
                eventType: "teaching-operation-audit-alert-notification-outbox",
                storagePolicy:
                  "external-redacted-teaching-operation-audit-alert-notification-outbox",
                recordCount: 1,
                notifications: [
                  {
                    notificationId:
                      "alert-notification-missing-course-context-audit-admins-send-admin-email-route-smoke-alert",
                    deliveryStatus: "queued",
                    traceId: "trace-teaching-operations-route-smoke-alert",
                  },
                ],
              }),
            );
            return;
          }

          if (
            request.method === "POST" &&
            request.url === "/teaching-operations/teacher-kang/backups"
          ) {
            response.writeHead(200, {
              "content-type": "application/json",
            });
            response.end(
              JSON.stringify({
                teacherId: "teacher-kang",
                backupId: "teaching-operations-backup-teacher-kang-20260623-001000",
                status: "persisted",
                eventType: "teaching-operation-backup.created",
                traceId: "trace-teaching-operations-route-smoke-backup",
                requestedBy: "s22-route-smoke",
                sourceRecordCounts: {
                  operations: 2,
                  auditEvents: 2,
                  rollbacks: 1,
                  alertNotifications: 1,
                },
                storagePolicy: "external-redacted-teaching-operation-backup",
                storageWritePolicy: "external-atomic-backup-snapshot",
                responsibleSession: "S12",
              }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url ===
            "/teaching-operations/teacher-kang/backups/teaching-operations-backup-teacher-kang-20260623-001000/restore-drill"
          ) {
            response.writeHead(200, {
              "content-type": "application/json",
            });
            response.end(
              JSON.stringify({
                teacherId: "teacher-kang",
                backupId: "teaching-operations-backup-teacher-kang-20260623-001000",
                drillId:
                  "teaching-operations-restore-drill-teaching-operations-backup-teacher-kang-20260623-001000",
                status: "verified",
                eventType: "teaching-operation-backup.restore-drill-verified",
                traceId: "trace-teaching-operations-route-smoke-restore-drill",
                requestedBy: "s22-route-smoke",
                restoredRecordCounts: {
                  operations: 2,
                  auditEvents: 2,
                  rollbacks: 1,
                  alertNotifications: 1,
                },
                storagePolicy: "external-redacted-teaching-operation-restore-drill",
                storageWritePolicy: "external-append-only-restore-drill-log",
                responsibleSession: "S12",
              }),
            );
            return;
          }
        }

        if (
          request.method === "POST" &&
          request.url === "/api/teaching/operations/collaboration-invite-deliveries"
        ) {
          if (request.headers.authorization !== "Bearer secret-email-callback-token-with-32-chars") {
            response.writeHead(401, {
              "content-type": "application/json",
              "x-uais-trace-id":
                String(request.headers["x-uais-trace-id"] ?? "") ||
                "trace-teaching-ops-collaboration-invite-bounce-denied",
            });
            response.end(JSON.stringify({ error: "callback auth required" }));
            return;
          }
          expect(request.headers["user-agent"]).toBe(
            "UAIS teaching operations route smoke /Users/redacted/secret-token callback",
          );
          if (
            typeof parsedBody === "object" &&
            parsedBody !== null &&
            "deliveryId" in parsedBody &&
            parsedBody.deliveryId === "unsafe/../callback-delivery"
          ) {
            response.writeHead(400, {
              "content-type": "application/json",
              "x-uais-trace-id":
                String(request.headers["x-uais-trace-id"] ?? "") ||
                "trace-teaching-operations-route-smoke-collaboration-invite-bounce-unsafe-denied",
            });
            response.end(
              JSON.stringify({
                error: "Invalid callback delivery id.",
                traceId:
                  String(request.headers["x-uais-trace-id"] ?? "") ||
                  "trace-teaching-operations-route-smoke-collaboration-invite-bounce-unsafe-denied",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                },
              }),
            );
            return;
          }
          response.writeHead(200, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-teaching-ops-collaboration-invite-bounce",
          });
          response.end(
            JSON.stringify({
              traceId: "trace-teaching-operations-route-smoke-collaboration-invite-bounce",
              collaborationInviteEmailDeliveryCallbackReceipt: {
                action: "record-collaboration-invite-email-delivery-callback",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                traceId: "trace-teaching-operations-route-smoke-collaboration-invite-bounce",
                status: "persisted",
                deliveryStatus: "failed",
                providerStatus: "smtp-provider-bounced",
                deliveryId: "email-delivery-collaboration-invite-route-smoke",
                outboxId: "collaboration-invite-teacher-kang-route-smoke",
                failureReason: "route-smoke-bounce",
                storagePolicy: "external-redacted-teaching-course-management-snapshot",
                storageWritePolicy: "external-optimistic-snapshot-replace",
                responsibleSession: "S12",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "ids-only",
                },
              },
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url === "/api/teaching/invite-codes/77441122/join"
        ) {
          response.writeHead(201, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-teaching-ops-student-join",
          });
          response.end(
            JSON.stringify({
              membership: {
                membershipId: "membership-teacher-research-methods-class-1-Peter",
                courseId: "teacher-research-methods",
                classId: "teacher-research-methods-class-1",
                invitationCode: "77441122",
                studentId: "Peter",
                studentDisplayName: "Peter",
                membershipStatus: "pending-teacher-review",
              },
              receipt: {
                action: "join-class-by-invite",
                actorId: "Peter",
                courseId: "teacher-research-methods",
                classId: "teacher-research-methods-class-1",
                traceId: "trace-teaching-operations-route-smoke-student-join",
                status: "persisted",
              },
              gradingQueueReceipt: {
                action: "save-grading-queue",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                traceId: "trace-teaching-operations-route-smoke-gradebook-seed",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-course-management-snapshot",
                storageWritePolicy: "external-optimistic-snapshot-replace",
              },
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url === "/api/teaching/operations/backups/..%2Funsafe-backup-id/restore"
        ) {
          response.writeHead(400, {
            "content-type": "application/json",
            "x-uais-trace-id":
              request.headers["x-uais-trace-id"] ??
              "trace-teaching-operations-route-smoke-unsafe-backup-restore-id",
          });
          response.end(
            JSON.stringify({
              error: "UAIS teaching operation backup id is invalid.",
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
          request.url ===
            "/api/teaching/operations/backups/teaching-operations-backup-teacher-kang-20260623-001000/restore"
        ) {
          if (!request.headers.cookie) {
            response.writeHead(401, {
              "content-type": "application/json",
              "x-uais-trace-id": "trace-teaching-operations-route-smoke-direct-restore-denied",
            });
            response.end(
              JSON.stringify({
                error: "UAIS teacher authentication is required.",
                traceId: "trace-teaching-operations-route-smoke-direct-restore-denied",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "ids-only",
                },
              }),
            );
            return;
          }
          if (String(request.headers.cookie).includes("uais_app_session=student-session")) {
            response.writeHead(403, {
              "content-type": "application/json",
              "x-uais-trace-id":
                "trace-teaching-operations-route-smoke-direct-restore-student-denied",
            });
            response.end(
              JSON.stringify({
                error: "UAIS teacher role is required.",
                traceId:
                  "trace-teaching-operations-route-smoke-direct-restore-student-denied",
                access: {
                  status: "denied",
                  reasonCode: "teacher-role-required",
                  responsibleSession: "S12",
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
          response.writeHead(409, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-teaching-operations-route-smoke-direct-restore",
          });
          response.end(
            JSON.stringify({
              error:
                "Teaching operation backup restore is only available for local JSON fallback storage.",
              traceId: "trace-teaching-operations-route-smoke-direct-restore",
              restorePlan: {
                status: "external-restore-drill-required",
                action: "verify-teaching-operation-backup-restore",
                backupId: "teaching-operations-backup-teacher-kang-20260623-001000",
                route:
                  "/api/external-storage/teaching-operations/teacher-kang/backups/teaching-operations-backup-teacher-kang-20260623-001000/restore-drill",
                storagePolicy: "external-redacted-teaching-operation-restore-drill",
                storageWritePolicy: "external-append-only-restore-drill-log",
                responsibleSession: "S12",
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
          request.method === "POST" &&
          (
            request.url === "/api/teaching/gradebook-updates/..%2Funsafe-gradebook-object-id/release" ||
            request.url === "/api/teaching/gradebook-updates/..%2Funsafe-gradebook-object-id/rollback"
          )
        ) {
          response.writeHead(400, {
            "content-type": "application/json",
            "x-uais-trace-id":
              request.headers["x-uais-trace-id"] ??
              "trace-teaching-operations-route-smoke-unsafe-gradebook-id",
          });
          response.end(
            JSON.stringify({
              error: "UAIS teaching gradebook update id is invalid.",
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
          request.headers.cookie === "uais_app_session=student-session" &&
          (
            request.url ===
              "/api/teaching/gradebook-updates/gradebook-update-teacher-research-methods/release" ||
            request.url ===
              "/api/teaching/gradebook-updates/gradebook-update-teacher-research-methods/rollback"
          )
        ) {
          response.writeHead(403, {
            "content-type": "application/json",
            "x-uais-trace-id": request.headers["x-uais-trace-id"] ?? "trace-gradebook-student-denied",
          });
          response.end(
            JSON.stringify({
              error: "UAIS teacher role is required.",
              traceId:
                request.headers["x-uais-trace-id"] ?? "trace-gradebook-student-denied",
              access: {
                status: "denied",
                reasonCode: "teacher-role-required",
                responsibleSession: "S12",
              },
            }),
          );
          return;
        }

        if (
          request.method === "GET" &&
          request.url === "/api/teaching/operations/audit" &&
          String(request.headers.cookie ?? "").includes("uais_app_session=student-session")
        ) {
          response.writeHead(403, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-teaching-operations-audit-student-denied",
          });
          response.end(
            JSON.stringify({
              error: "UAIS teacher role is required.",
              traceId: "trace-teaching-operations-audit-student-denied",
              access: {
                status: "denied",
                reasonCode: "teacher-role-required",
                responsibleSession: "S12",
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
          request.method === "GET" &&
          request.url === "/api/teaching/operations/audit/alerts" &&
          String(request.headers.cookie ?? "").includes("uais_app_session=student-session")
        ) {
          response.writeHead(403, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-teaching-operations-alerts-student-denied",
          });
          response.end(
            JSON.stringify({
              error: "UAIS teacher role is required.",
              traceId: "trace-teaching-operations-alerts-student-denied",
              access: {
                status: "denied",
                reasonCode: "teacher-role-required",
                responsibleSession: "S12",
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
          request.url === "/api/teaching/operations/audit/alerts/notifications" &&
          String(request.headers.cookie ?? "").includes("uais_app_session=student-session")
        ) {
          const traceId =
            request.headers["x-uais-trace-id"] ??
            "trace-teaching-operations-alert-notifications-student-denied";
          response.writeHead(403, {
            "content-type": "application/json",
            "x-uais-trace-id": traceId,
          });
          response.end(
            JSON.stringify({
              error: "UAIS teacher role is required.",
              traceId,
              access: {
                status: "denied",
                reasonCode: "teacher-role-required",
                responsibleSession: "S12",
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
          request.method === "GET" &&
          request.url ===
            "/api/teaching/operations/export/export-manifest-teacher-kang-route-smoke" &&
          String(request.headers.cookie ?? "").includes("uais_app_session=student-session")
        ) {
          response.writeHead(403, {
            "content-type": "application/json",
            "x-uais-trace-id":
              "trace-teaching-operations-route-smoke-export-download-student-denied",
          });
          response.end(
            JSON.stringify({
              error: "UAIS teacher role is required.",
              traceId:
                "trace-teaching-operations-route-smoke-export-download-student-denied",
              access: {
                status: "denied",
                reasonCode: "teacher-role-required",
                responsibleSession: "S12",
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
          request.url === "/api/teaching/operations/records/operation-record-route-smoke/rollback" &&
          String(request.headers.cookie ?? "").includes("uais_app_session=student-session")
        ) {
          response.writeHead(403, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-teaching-operations-route-smoke-rollback-student-denied",
          });
          response.end(
            JSON.stringify({
              error: "UAIS teacher role is required.",
              traceId: "trace-teaching-operations-route-smoke-rollback-student-denied",
              access: {
                status: "denied",
                reasonCode: "teacher-role-required",
                responsibleSession: "S12",
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

        if (request.headers.cookie !== "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig") {
          response.writeHead(401, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-teaching-ops-denied",
          });
          response.end(JSON.stringify({ error: "auth required", secret: "must-not-leak" }));
          return;
        }

        if (request.url === "/api/teaching/operations/audit") {
          auditReadbackCount += 1;
          response.writeHead(200, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-teaching-ops-audit-readback",
          });
          response.end(
            JSON.stringify({
              actorId: "teacher-kang",
              courseIds: ["teacher-research-methods"],
              records: [
                {
                  recordId: "operation-record-route-smoke",
                  courseId: "teacher-research-methods",
                  operationId: "course-settings",
                  actionSlot: "primary",
                  status: "persisted",
                  appendSequence: 1,
                },
              ],
              auditEvents: [
                {
                  traceId: "trace-teaching-operations-route-smoke",
                  courseId: "teacher-research-methods",
                  actorId: "teacher-kang",
                  authSession: {
                    sessionId: "teacher-route-smoke-session",
                    authenticatedAt: "2026-06-23T00:00:00.000Z",
                    expiresAt: "2026-06-23T01:00:00.000Z",
                  },
                },
              ],
              domainProjections: [
                {
                  objectId: "course-settings-teacher-research-methods",
                  objectType: "course-settings",
                  courseId: "teacher-research-methods",
                  operationRecordId: "operation-record-route-smoke",
                  storagePolicy: "domain-projection-teaching-course-settings",
                },
              ],
              rollbackRecords:
                auditReadbackCount > 1
                  ? [
                      {
                        rollbackId:
                          "teaching-operation-rollback-operation-record-route-smoke",
                        action: "rollback-teaching-operation-record",
                        teacherId: "teacher-kang",
                        targetRecordId: "operation-record-route-smoke",
                        courseId: "teacher-research-methods",
                        targetOperationId: "course-settings",
                        targetActionSlot: "primary",
                        targetActionId: "save-course-settings",
                        rollbackReason: "route-smoke-rollback",
                        status: "persisted",
                        rolledBackAt: "2026-06-23T00:05:00.000Z",
                        storagePolicy: "external-redacted-teaching-operation-rollback",
                        storageWritePolicy: "external-append-only-rollback-log",
                      },
                    ]
                  : [],
              recordCount: 1,
              auditEventCount: 1,
              domainProjectionCount: 1,
              rollbackRecordCount: auditReadbackCount > 1 ? 1 : 0,
              secret: "must-not-leak",
            }),
          );
          return;
        }

        if (
          request.method === "GET" &&
          request.url === "/api/teaching/operations/export/..%2Funsafe-export-manifest-id"
        ) {
          response.writeHead(400, {
            "content-type": "application/json",
            "x-uais-trace-id":
              request.headers["x-uais-trace-id"] ??
              "trace-teaching-operations-route-smoke-unsafe-export-manifest-id",
          });
          response.end(
            JSON.stringify({
              error: "UAIS teaching operation export manifest id is invalid.",
              traceId:
                request.headers["x-uais-trace-id"] ??
                "trace-teaching-operations-route-smoke-unsafe-export-manifest-id",
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
          request.method === "GET" &&
          request.url ===
            "/api/teaching/operations/export/export-manifest-teacher-kang-route-smoke"
        ) {
          if (!request.headers.cookie) {
            response.writeHead(401, {
              "content-type": "application/json",
              "x-uais-trace-id": "trace-teaching-operations-route-smoke-export-download-denied",
            });
            response.end(
              JSON.stringify({
                error: "UAIS teacher authentication is required.",
                traceId: "trace-teaching-operations-route-smoke-export-download-denied",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "ids-only",
                },
              }),
            );
            return;
          }
          if (request.headers.cookie === "uais_app_session=student-session") {
            response.writeHead(403, {
              "content-type": "application/json",
              "x-uais-trace-id":
                "trace-teaching-operations-route-smoke-export-download-student-denied",
            });
            response.end(
              JSON.stringify({
                error: "UAIS teacher role is required.",
                traceId:
                  "trace-teaching-operations-route-smoke-export-download-student-denied",
                access: {
                  status: "denied",
                  reasonCode: "teacher-role-required",
                  responsibleSession: "S12",
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
          response.writeHead(200, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-teaching-operations-route-smoke-export-download",
          });
          response.end(
            JSON.stringify({
              manifestId: "export-manifest-teacher-kang-route-smoke",
              operationId: "data-export",
              courseId: "teacher-research-methods",
              actorId: "teacher-kang",
              createdAt: "2026-06-23T00:03:30.000Z",
              datasets: ["learning-records", "chat-threads", "grades", "activities"],
              formats: ["json", "csv"],
              redactionScope: {
                studentPrivateNotes: "excluded",
                credentials: "excluded",
                localPaths: "excluded",
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
          request.method === "POST" &&
          request.url === "/api/teaching/operations" &&
          typeof parsedBody === "object" &&
          parsedBody !== null &&
          "operationId" in parsedBody &&
          parsedBody.operationId === "data-export" &&
          "actionSlot" in parsedBody &&
          parsedBody.actionSlot === "primary"
        ) {
          response.writeHead(200, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-teaching-ops-course-export-manifest",
          });
          response.end(
            JSON.stringify({
              receipt: {
                receiptId: "course-export-manifest-record-route-smoke",
                operationId: "data-export",
                actionSlot: "primary",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-operation-append",
                storageWritePolicy: "external-append-only-operation-log",
                artifacts: [
                  {
                    kind: "export-file",
                    manifestId: "export-manifest-teacher-kang-route-smoke",
                    downloadUrl:
                      "/api/teaching/operations/export/export-manifest-teacher-kang-route-smoke",
                    contentType: "application/json",
                  },
                ],
              },
              courseExportManifestReceipt: {
                action: "create-export-manifest",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                traceId: "trace-teaching-operations-route-smoke-export-manifest",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-course-management-snapshot",
                storageWritePolicy: "external-optimistic-snapshot-replace",
              },
              courseExportProviderReceipt: {
                action: "export-course-data-provider",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                traceId: "trace-teaching-operations-route-smoke-export-manifest",
                status: "exported",
                providerStatus: "export-provider-exported",
                providerExportId: "export-provider-run-route-smoke",
                exportManifestId: "export-manifest-teacher-research-methods",
                teachingOperationManifestId: "export-manifest-teacher-kang-route-smoke",
              },
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url === "/api/teaching/operations" &&
          typeof parsedBody === "object" &&
          parsedBody !== null &&
          "operationId" in parsedBody &&
          parsedBody.operationId === "data-export" &&
          "actionSlot" in parsedBody &&
          parsedBody.actionSlot === "secondary"
        ) {
          response.writeHead(200, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-teaching-ops-export-redaction",
          });
          response.end(
            JSON.stringify({
              receipt: {
                receiptId: "export-redaction-validation-record-route-smoke",
                operationId: "data-export",
                actionSlot: "secondary",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-operation-append",
                storageWritePolicy: "external-append-only-operation-log",
              },
              courseExportRedactionValidationReceipt: {
                action: "validate-export-redaction-scope",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                traceId: "trace-teaching-operations-route-smoke-export-redaction",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-course-management-snapshot",
                storageWritePolicy: "external-optimistic-snapshot-replace",
              },
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url === "/api/teaching/operations" &&
          typeof parsedBody === "object" &&
          parsedBody !== null &&
          "operationId" in parsedBody &&
          parsedBody.operationId === "agents" &&
          "actionSlot" in parsedBody &&
          parsedBody.actionSlot === "secondary"
        ) {
          response.writeHead(200, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-teaching-ops-agent-permission-preflight",
          });
          response.end(
            JSON.stringify({
              receipt: {
                receiptId: "agent-permission-preflight-record-route-smoke",
                operationId: "agents",
                actionSlot: "secondary",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-operation-append",
                storageWritePolicy: "external-append-only-operation-log",
              },
              agentPermissionPreflightReceipt: {
                action: "record-agent-permission-preflight",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                traceId: "trace-teaching-operations-route-smoke-agent-permission-preflight",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-course-management-snapshot",
                storageWritePolicy: "external-optimistic-snapshot-replace",
              },
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url === "/api/teaching/operations" &&
          typeof parsedBody === "object" &&
          parsedBody !== null &&
          "operationId" in parsedBody &&
          parsedBody.operationId === "agents" &&
          "actionSlot" in parsedBody &&
          parsedBody.actionSlot === "primary"
        ) {
          response.writeHead(200, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-teaching-ops-agent-settings",
          });
          response.end(
            JSON.stringify({
              receipt: {
                receiptId: "agent-settings-record-route-smoke",
                operationId: "agents",
                actionSlot: "primary",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-operation-append",
                storageWritePolicy: "external-append-only-operation-log",
              },
              agentSettingsReceipt: {
                action: "save-agent-settings",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                traceId: "trace-teaching-operations-route-smoke-agent-settings",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-course-management-snapshot",
                storageWritePolicy: "external-optimistic-snapshot-replace",
              },
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url === "/api/teaching/operations" &&
          typeof parsedBody === "object" &&
          parsedBody !== null &&
          "operationId" in parsedBody &&
          parsedBody.operationId === "quiz-board"
        ) {
          if ("actionSlot" in parsedBody && parsedBody.actionSlot === "secondary") {
            response.writeHead(200, {
              "content-type": "application/json",
              "x-uais-trace-id": "trace-teaching-ops-quiz-item-review",
            });
            response.end(
              JSON.stringify({
                receipt: {
                  receiptId: "quiz-item-review-record-route-smoke",
                  operationId: "quiz-board",
                  actionSlot: "secondary",
                  actorId: "teacher-kang",
                  courseId: "teacher-research-methods",
                  status: "persisted",
                  storagePolicy: "external-redacted-teaching-operation-append",
                  storageWritePolicy: "external-append-only-operation-log",
                },
                quizItemReviewReceipt: {
                  action: "flag-quiz-item-review",
                  actorId: "teacher-kang",
                  courseId: "teacher-research-methods",
                traceId: "trace-teaching-operations-route-smoke-quiz-item-review",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-course-management-snapshot",
                storageWritePolicy: "external-optimistic-snapshot-replace",
              },
              domainPersistenceSummary: {
                status: "persisted",
                required: true,
                operationId: "quiz-board",
                actionSlot: "secondary",
                operationReceiptId: "quiz-item-review-record-route-smoke",
                courseId: "teacher-research-methods",
                expectedObjectTypes: ["quiz-item-review"],
                persistedObjectTypes: ["quiz-item-review"],
                missingObjectTypes: [],
                persistedResponseKeys: ["quizItemReviewReceipt"],
                receiptCount: 1,
                storageWritePolicies: ["external-optimistic-snapshot-replace"],
                responsibleSession: "S12",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "ids-only",
                },
              },
            }),
          );
          return;
          }

          response.writeHead(200, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-teaching-ops-quiz-assessment",
          });
          response.end(
            JSON.stringify({
              receipt: {
                receiptId: "quiz-assessment-record-route-smoke",
                operationId: "quiz-board",
                actionSlot: "primary",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-operation-append",
                storageWritePolicy: "external-append-only-operation-log",
              },
              quizAssessmentReceipt: {
                action: "refresh-quiz-assessment",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                traceId: "trace-teaching-operations-route-smoke-quiz-assessment",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-course-management-snapshot",
                storageWritePolicy: "external-optimistic-snapshot-replace",
              },
              domainPersistenceSummary: {
                status: "persisted",
                required: true,
                operationId: "quiz-board",
                actionSlot: "primary",
                operationReceiptId: "quiz-assessment-record-route-smoke",
                courseId: "teacher-research-methods",
                expectedObjectTypes: ["quiz-board-state"],
                persistedObjectTypes: ["quiz-board-state"],
                missingObjectTypes: [],
                persistedResponseKeys: ["quizAssessmentReceipt"],
                receiptCount: 1,
                storageWritePolicies: ["external-optimistic-snapshot-replace"],
                responsibleSession: "S12",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "ids-only",
                },
              },
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url === "/api/teaching/operations" &&
          typeof parsedBody === "object" &&
          parsedBody !== null &&
          "operationId" in parsedBody &&
          parsedBody.operationId === "course-settings" &&
          !("courseId" in parsedBody)
        ) {
          response.writeHead(400, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-teaching-ops-course-id-required",
          });
          response.end(
            JSON.stringify({
              error: "UAIS teaching operation course binding is required.",
              access: {
                status: "denied",
                reasonCode: "course-id-required",
              },
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url === "/api/teaching/operations" &&
          typeof parsedBody === "object" &&
          parsedBody !== null &&
          "courseId" in parsedBody &&
          parsedBody.courseId === "route-smoke-foreign-course"
        ) {
          response.writeHead(403, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-teaching-ops-course-scope-denied",
          });
          response.end(
            JSON.stringify({
              error: "UAIS teaching operation course ownership is required.",
              access: {
                status: "denied",
                reasonCode: "course-scope-denied",
                resource: { courseId: "route-smoke-foreign-course" },
              },
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url === "/api/teaching/operations" &&
          typeof parsedBody === "object" &&
          parsedBody !== null &&
          "operationId" in parsedBody &&
          parsedBody.operationId === "knowledge-base"
        ) {
          if ("actionSlot" in parsedBody && parsedBody.actionSlot === "secondary") {
            response.writeHead(200, {
              "content-type": "application/json",
              "x-uais-trace-id": "trace-teaching-ops-resource-review",
            });
            response.end(
              JSON.stringify({
                receipt: {
                  receiptId: "resource-review-item-record-route-smoke",
                  operationId: "knowledge-base",
                  actionSlot: "secondary",
                  actorId: "teacher-kang",
                  courseId: "teacher-research-methods",
                  status: "persisted",
                  storagePolicy: "external-redacted-teaching-operation-append",
                  storageWritePolicy: "external-append-only-operation-log",
                },
                resourceReviewItemReceipt: {
                  action: "queue-resource-review-item",
                  actorId: "teacher-kang",
                  courseId: "teacher-research-methods",
                  traceId: "trace-teaching-operations-route-smoke-resource-review",
                  status: "persisted",
                  storagePolicy: "external-redacted-teaching-course-management-snapshot",
                  storageWritePolicy: "external-optimistic-snapshot-replace",
                },
              }),
            );
            return;
          }

          response.writeHead(200, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-teaching-ops-knowledge-index",
          });
          response.end(
            JSON.stringify({
              receipt: {
                receiptId: "knowledge-index-record-route-smoke",
                operationId: "knowledge-base",
                actionSlot: "primary",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-operation-append",
                storageWritePolicy: "external-append-only-operation-log",
              },
              knowledgeIndexSyncReceipt: {
                action: "sync-knowledge-index",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                traceId: "trace-teaching-operations-route-smoke-knowledge-index",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-course-management-snapshot",
                storageWritePolicy: "external-optimistic-snapshot-replace",
              },
              knowledgeIndexProviderSyncReceipt: {
                action: "sync-knowledge-index-provider",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                traceId: "trace-teaching-operations-route-smoke-knowledge-index",
                status: "synced",
                providerStatus: "knowledge-provider-synced",
                providerSyncId: "knowledge-provider-sync-route-smoke",
                indexId: "knowledge-index-teacher-research-methods",
              },
              domainPersistenceSummary: {
                status: "persisted",
                required: true,
                operationId: "knowledge-base",
                actionSlot: "primary",
                operationReceiptId: "knowledge-index-record-route-smoke",
                courseId: "teacher-research-methods",
                expectedObjectTypes: ["knowledge-index"],
                persistedObjectTypes: ["knowledge-index"],
                missingObjectTypes: [],
                persistedResponseKeys: ["knowledgeIndexSyncReceipt"],
                receiptCount: 1,
                storageWritePolicies: ["external-optimistic-snapshot-replace"],
                responsibleSession: "S12",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "ids-only",
                },
              },
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url === "/api/teaching/operations" &&
          typeof parsedBody === "object" &&
          parsedBody !== null &&
          "operationId" in parsedBody &&
          parsedBody.operationId === "content" &&
          "actionSlot" in parsedBody &&
          parsedBody.actionSlot === "primary"
        ) {
          response.writeHead(200, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-teaching-ops-course-content",
          });
          response.end(
            JSON.stringify({
              receipt: {
                receiptId: "course-content-record-route-smoke",
                operationId: "content",
                actionSlot: "primary",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-operation-append",
                storageWritePolicy: "external-append-only-operation-log",
              },
              courseContentPublishReceipt: {
                action: "publish-course-content",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                traceId: "trace-teaching-operations-route-smoke-course-content",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-course-management-snapshot",
                storageWritePolicy: "external-optimistic-snapshot-replace",
              },
              courseContentProviderPublishReceipt: {
                action: "publish-course-content-provider",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                traceId: "trace-teaching-operations-route-smoke-course-content",
                status: "published",
                providerStatus: "content-provider-published",
                providerPublishId: "content-provider-publish-route-smoke",
                contentId: "course-content-teacher-research-methods",
              },
              domainPersistenceSummary: {
                status: "persisted",
                required: true,
                operationId: "content",
                actionSlot: "primary",
                operationReceiptId: "course-content-record-route-smoke",
                courseId: "teacher-research-methods",
                expectedObjectTypes: ["course-content"],
                persistedObjectTypes: ["course-content"],
                missingObjectTypes: [],
                persistedResponseKeys: ["courseContentPublishReceipt"],
                receiptCount: 1,
                storageWritePolicies: ["external-optimistic-snapshot-replace"],
                responsibleSession: "S12",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "ids-only",
                },
              },
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url === "/api/teaching/operations" &&
          typeof parsedBody === "object" &&
          parsedBody !== null &&
          "operationId" in parsedBody &&
          parsedBody.operationId === "content" &&
          "actionSlot" in parsedBody &&
          parsedBody.actionSlot === "secondary"
        ) {
          response.writeHead(200, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-teaching-ops-course-unit-draft",
          });
          response.end(
            JSON.stringify({
              receipt: {
                receiptId: "course-unit-draft-record-route-smoke",
                operationId: "content",
                actionSlot: "secondary",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-operation-append",
                storageWritePolicy: "external-append-only-operation-log",
              },
              courseUnitDraftReceipt: {
                action: "generate-course-unit-draft",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                traceId: "trace-teaching-operations-route-smoke-course-unit-draft",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-course-management-snapshot",
                storageWritePolicy: "external-optimistic-snapshot-replace",
              },
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url === "/api/teaching/operations" &&
          typeof parsedBody === "object" &&
          parsedBody !== null &&
          "operationId" in parsedBody &&
          parsedBody.operationId === "dashboard" &&
          "actionSlot" in parsedBody &&
          parsedBody.actionSlot === "secondary"
        ) {
          response.writeHead(200, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-teaching-ops-dashboard-snapshot",
          });
          response.end(
            JSON.stringify({
              receipt: {
                receiptId: "dashboard-snapshot-record-route-smoke",
                operationId: "dashboard",
                actionSlot: "secondary",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-operation-append",
                storageWritePolicy: "external-append-only-operation-log",
              },
              dashboardSnapshotReceipt: {
                action: "lock-dashboard-snapshot",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                traceId: "trace-teaching-operations-route-smoke-dashboard-snapshot",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-course-management-snapshot",
                storageWritePolicy: "external-optimistic-snapshot-replace",
              },
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url === "/api/teaching/operations" &&
          typeof parsedBody === "object" &&
          parsedBody !== null &&
          "operationId" in parsedBody &&
          parsedBody.operationId === "dashboard" &&
          "actionSlot" in parsedBody &&
          parsedBody.actionSlot === "primary"
        ) {
          response.writeHead(200, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-teaching-ops-dashboard-state",
          });
          response.end(
            JSON.stringify({
              receipt: {
                receiptId: "dashboard-state-record-route-smoke",
                operationId: "dashboard",
                actionSlot: "primary",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-operation-append",
                storageWritePolicy: "external-append-only-operation-log",
              },
              dashboardRefreshReceipt: {
                action: "refresh-dashboard",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                traceId: "trace-teaching-operations-route-smoke-dashboard-state",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-course-management-snapshot",
                storageWritePolicy: "external-optimistic-snapshot-replace",
              },
              domainPersistenceSummary: {
                status: "persisted",
                required: true,
                operationId: "dashboard",
                actionSlot: "primary",
                operationReceiptId: "dashboard-state-record-route-smoke",
                courseId: "teacher-research-methods",
                expectedObjectTypes: ["dashboard-state"],
                persistedObjectTypes: ["dashboard-state"],
                missingObjectTypes: [],
                persistedResponseKeys: ["dashboardRefreshReceipt"],
                receiptCount: 1,
                storageWritePolicies: ["external-optimistic-snapshot-replace"],
                responsibleSession: "S12",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "ids-only",
                },
              },
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url === "/api/teaching/operations" &&
          typeof parsedBody === "object" &&
          parsedBody !== null &&
          "operationId" in parsedBody &&
          parsedBody.operationId === "admins"
        ) {
          if ("actionSlot" in parsedBody && parsedBody.actionSlot === "secondary") {
            response.writeHead(200, {
              "content-type": "application/json",
              "x-uais-trace-id": "trace-teaching-ops-collaboration-invite",
            });
            response.end(
              JSON.stringify({
                receipt: {
                  receiptId: "collaboration-invite-record-route-smoke",
                  operationId: "admins",
                  actionSlot: "secondary",
                  actorId: "teacher-kang",
                  courseId: "teacher-research-methods",
                  status: "persisted",
                  storagePolicy: "external-redacted-teaching-operation-append",
                  storageWritePolicy: "external-append-only-operation-log",
                  artifacts: [
                    {
                      kind: "outbox",
                      outboxId: "collaboration-invite-teacher-kang-route-smoke",
                      channel: "collaboration-invite",
                      deliveryStatus: "sent-to-local-outbox",
                    },
                  ],
                },
                collaborationInviteNotificationReceipt: {
                  action: "queue-collaboration-invite-notification",
                  actorId: "teacher-kang",
                  courseId: "teacher-research-methods",
                  traceId: "trace-teaching-operations-route-smoke-collaboration-invite",
                  status: "persisted",
                  storagePolicy: "external-redacted-teaching-course-management-snapshot",
                  storageWritePolicy: "external-optimistic-snapshot-replace",
                },
                collaborationInviteEmailDeliveryReceipt: {
                  action: "deliver-collaboration-invite-email",
                  actorId: "teacher-kang",
                  courseId: "teacher-research-methods",
                  traceId: "trace-teaching-operations-route-smoke-collaboration-invite",
                  status: "delivered",
                  providerStatus: "smtp-provider-delivered",
                  deliveryId: "email-delivery-collaboration-invite-route-smoke",
                  outboxId: "collaboration-invite-teacher-kang-route-smoke",
                  storagePolicy: "external-redacted-teaching-course-management-snapshot",
                  storageWritePolicy: "external-optimistic-snapshot-replace",
                  responsibleSession: "S12",
                  redaction: {
                    secrets: "omitted",
                    localFiles: "omitted",
                    assets: "ids-only",
                  },
                },
                domainPersistenceSummary: {
                  status: "persisted",
                  required: true,
                  operationId: "admins",
                  actionSlot: "secondary",
                  operationReceiptId: "collaboration-invite-record-route-smoke",
                  courseId: "teacher-research-methods",
                  expectedObjectTypes: ["email-notification"],
                  persistedObjectTypes: ["email-notification"],
                  missingObjectTypes: [],
                  persistedResponseKeys: ["collaborationInviteNotificationReceipt"],
                  receiptCount: 1,
                  storageWritePolicies: ["external-optimistic-snapshot-replace"],
                  responsibleSession: "S12",
                  redaction: {
                    secrets: "omitted",
                    localFiles: "omitted",
                    assets: "ids-only",
                  },
                },
              }),
            );
            return;
          }

          response.writeHead(200, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-teaching-ops-admin-settings",
          });
          response.end(
            JSON.stringify({
              receipt: {
                receiptId: "admin-settings-record-route-smoke",
                operationId: "admins",
                actionSlot: "primary",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-operation-append",
                storageWritePolicy: "external-append-only-operation-log",
              },
              adminSettingsReceipt: {
                action: "save-admin-settings",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                traceId: "trace-teaching-operations-route-smoke-admin-settings",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-course-management-snapshot",
                storageWritePolicy: "external-optimistic-snapshot-replace",
              },
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url === "/api/teaching/operations" &&
          typeof parsedBody === "object" &&
          parsedBody !== null &&
          "operationId" in parsedBody &&
          parsedBody.operationId === "students"
        ) {
          if ("actionSlot" in parsedBody && parsedBody.actionSlot === "secondary") {
            response.writeHead(200, {
              "content-type": "application/json",
              "x-uais-trace-id": "trace-teaching-ops-student-group-suggestion",
            });
            response.end(
              JSON.stringify({
                receipt: {
                  receiptId: "student-group-suggestion-record-route-smoke",
                  operationId: "students",
                  actionSlot: "secondary",
                  actorId: "teacher-kang",
                  courseId: "teacher-research-methods",
                  status: "persisted",
                  storagePolicy: "external-redacted-teaching-operation-append",
                  storageWritePolicy: "external-append-only-operation-log",
                },
                studentGroupSuggestionReceipt: {
                  action: "generate-student-group-suggestions",
                  actorId: "teacher-kang",
                  courseId: "teacher-research-methods",
                  traceId: "trace-teaching-operations-route-smoke-student-group-suggestion",
                  status: "persisted",
                  storagePolicy: "external-redacted-teaching-course-management-snapshot",
                  storageWritePolicy: "external-optimistic-snapshot-replace",
                },
              }),
            );
            return;
          }

          response.writeHead(200, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-teaching-ops-student-roster",
          });
          response.end(
            JSON.stringify({
              receipt: {
                receiptId: "student-roster-record-route-smoke",
                operationId: "students",
                actionSlot: "primary",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-operation-append",
                storageWritePolicy: "external-append-only-operation-log",
              },
              studentRosterSyncReceipt: {
                action: "sync-student-roster",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                traceId: "trace-teaching-operations-route-smoke-student-roster",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-course-management-snapshot",
                storageWritePolicy: "external-optimistic-snapshot-replace",
              },
              studentRosterProviderSyncReceipt: {
                action: "sync-student-roster-provider",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                traceId: "trace-teaching-operations-route-smoke-student-roster",
                status: "synced",
                providerStatus: "sis-provider-synced",
                providerSyncId: "sis-route-smoke-sync-1",
                rosterId: "student-roster-teacher-research-methods",
                responsibleSession: "S12",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "ids-only",
                },
              },
              domainPersistenceSummary: {
                status: "persisted",
                required: true,
                operationId: "students",
                actionSlot: "primary",
                operationReceiptId: "student-roster-record-route-smoke",
                courseId: "teacher-research-methods",
                expectedObjectTypes: ["student-roster"],
                persistedObjectTypes: ["student-roster"],
                missingObjectTypes: [],
                persistedResponseKeys: ["studentRosterSyncReceipt"],
                receiptCount: 1,
                storageWritePolicies: ["external-optimistic-snapshot-replace"],
                responsibleSession: "S12",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "ids-only",
                },
              },
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url === "/api/teaching/operations" &&
          typeof parsedBody === "object" &&
          parsedBody !== null &&
          "operationId" in parsedBody &&
          parsedBody.operationId === "invite-code" &&
          "actionSlot" in parsedBody &&
          parsedBody.actionSlot === "primary"
        ) {
          response.writeHead(200, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-teaching-ops-invite-draft",
          });
          response.end(
            JSON.stringify({
              receipt: {
                receiptId: "invite-draft-record-route-smoke",
                operationId: "invite-code",
                actionSlot: "primary",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-operation-append",
                storageWritePolicy: "external-append-only-operation-log",
                artifacts: [
                  {
                    kind: "invite-code",
                    code: "77441122",
                    status: "generated",
                    joinUrl: "/courses?invite=77441122",
                  },
                ],
              },
              inviteCodeDraftReceipt: {
                action: "generate-class-invite-code-draft",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                classId: "teacher-research-methods-class-1",
                traceId: "trace-teaching-operations-route-smoke-invite-draft",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-course-management-snapshot",
                storageWritePolicy: "external-optimistic-snapshot-replace",
              },
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url === "/api/teaching/operations" &&
          typeof parsedBody === "object" &&
          parsedBody !== null &&
          "operationId" in parsedBody &&
          parsedBody.operationId === "invite-code" &&
          "actionSlot" in parsedBody &&
          parsedBody.actionSlot === "secondary"
        ) {
          response.writeHead(200, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-teaching-ops-invite-publish",
          });
          response.end(
            JSON.stringify({
              receipt: {
                receiptId: "invite-publish-record-route-smoke",
                operationId: "invite-code",
                actionSlot: "secondary",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-operation-append",
                storageWritePolicy: "external-append-only-operation-log",
                artifacts: [
                  {
                    kind: "invite-code",
                    code: "77441122",
                    status: "published",
                    joinUrl: "/courses?invite=77441122",
                  },
                ],
              },
              classInvitePublicationReceipt: {
                action: "publish-class-invite-code",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                classId: "teacher-research-methods-class-1",
                traceId: "trace-teaching-operations-route-smoke-invite-publish",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-course-management-snapshot",
                storageWritePolicy: "external-optimistic-snapshot-replace",
              },
              domainPersistenceSummary: {
                status: "persisted",
                required: true,
                operationId: "invite-code",
                actionSlot: "secondary",
                operationReceiptId: "invite-publish-record-route-smoke",
                courseId: "teacher-research-methods",
                expectedObjectTypes: ["enrollment-access"],
                persistedObjectTypes: ["enrollment-access"],
                missingObjectTypes: [],
                persistedResponseKeys: ["classInvitePublicationReceipt"],
                receiptCount: 1,
                storageWritePolicies: ["external-optimistic-snapshot-replace"],
                responsibleSession: "S12",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "ids-only",
                },
              },
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url === "/api/teaching/operations" &&
          typeof parsedBody === "object" &&
          parsedBody !== null &&
          "operationId" in parsedBody &&
          parsedBody.operationId === "grading"
        ) {
          if ("actionSlot" in parsedBody && parsedBody.actionSlot === "secondary") {
            response.writeHead(200, {
              "content-type": "application/json",
              "x-uais-trace-id": "trace-teaching-ops-grading-feedback",
            });
            response.end(
              JSON.stringify({
                receipt: {
                  receiptId: "grading-feedback-draft-record-route-smoke",
                  operationId: "grading",
                  actionSlot: "secondary",
                  actorId: "teacher-kang",
                  courseId: "teacher-research-methods",
                  status: "persisted",
                  storagePolicy: "external-redacted-teaching-operation-append",
                  storageWritePolicy: "external-append-only-operation-log",
                },
                gradingFeedbackDraftReceipt: {
                  action: "generate-grading-feedback-draft",
                  actorId: "teacher-kang",
                  courseId: "teacher-research-methods",
                  traceId: "trace-teaching-operations-route-smoke-grading-feedback",
                  status: "persisted",
                  storagePolicy: "external-redacted-teaching-course-management-snapshot",
                  storageWritePolicy: "external-optimistic-snapshot-replace",
                },
                gradingFeedbackProviderReceipt: {
                  action: "generate-grading-feedback-provider",
                  actorId: "teacher-kang",
                  courseId: "teacher-research-methods",
                  traceId: "trace-teaching-operations-route-smoke-grading-feedback",
                  status: "generated",
                  providerStatus: "feedback-provider-generated",
                  providerFeedbackId: "feedback-provider-draft-route-smoke",
                  gradingFeedbackDraftId:
                    "grading-feedback-draft-teacher-research-methods",
                },
              }),
            );
            return;
          }

          response.writeHead(200, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-teaching-ops-gradebook-seed",
          });
          response.end(
            JSON.stringify({
              receipt: {
                receiptId: "gradebook-seed-record-route-smoke",
                operationId: "grading",
                actionSlot: "primary",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-operation-append",
                storageWritePolicy: "external-append-only-operation-log",
              },
              gradingQueueReceipt: {
                action: "save-grading-queue",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                traceId: "trace-teaching-operations-route-smoke-gradebook-seed",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-course-management-snapshot",
                storageWritePolicy: "external-optimistic-snapshot-replace",
              },
              domainPersistenceSummary: {
                status: "persisted",
                required: true,
                operationId: "grading",
                actionSlot: "primary",
                operationReceiptId: "gradebook-seed-record-route-smoke",
                courseId: "teacher-research-methods",
                expectedObjectTypes: ["grading-queue", "gradebook-update"],
                persistedObjectTypes: ["grading-queue", "gradebook-update"],
                missingObjectTypes: [],
                persistedResponseKeys: [
                  "gradingQueueReceipt",
                  "gradingQueueReceipt.gradebookUpdate",
                ],
                receiptCount: 2,
                storageWritePolicies: ["external-optimistic-snapshot-replace"],
                responsibleSession: "S12",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "ids-only",
                },
              },
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url ===
            "/api/teaching/gradebook-updates/gradebook-update-teacher-research-methods/release"
        ) {
          response.writeHead(200, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-teaching-operations-route-smoke-gradebook-release",
          });
          response.end(
            JSON.stringify({
              traceId: "trace-teaching-operations-route-smoke-gradebook-release",
              gradebookUpdate: {
                objectId: "gradebook-update-teacher-research-methods",
                objectType: "gradebook-update",
                courseId: "teacher-research-methods",
                updateStatus: "released",
                providerStatus: "gradebook-provider-released",
                providerReleaseId: "gradebook-provider-release-route-smoke",
              },
              notification: {
                objectId: "grade-release-notification-teacher-research-methods",
                objectType: "grade-release-notification",
                courseId: "teacher-research-methods",
                gradebookUpdateId: "gradebook-update-teacher-research-methods",
              },
              receipt: {
                action: "release-gradebook-update",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                gradebookUpdateId: "gradebook-update-teacher-research-methods",
                traceId: "trace-teaching-operations-route-smoke-gradebook-release",
                status: "persisted",
                providerStatus: "gradebook-provider-released",
                providerReleaseId: "gradebook-provider-release-route-smoke",
                storagePolicy: "external-redacted-teaching-operation-append",
                storageWritePolicy: "external-append-only-operation-log",
              },
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url ===
            "/api/teaching/gradebook-updates/gradebook-update-teacher-research-methods/rollback"
        ) {
          response.writeHead(200, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-teaching-operations-route-smoke-gradebook-rollback",
          });
          response.end(
            JSON.stringify({
              traceId: "trace-teaching-operations-route-smoke-gradebook-rollback",
              gradebookUpdate: {
                objectId: "gradebook-update-teacher-research-methods",
                objectType: "gradebook-update",
                courseId: "teacher-research-methods",
                updateStatus: "release-rolled-back",
                providerRollbackStatus: "gradebook-provider-release-rolled-back",
                providerRollbackId: "gradebook-provider-rollback-route-smoke",
              },
              notification: {
                objectId: "grade-release-rollback-notification-teacher-research-methods",
                objectType: "grade-release-rollback-notification",
                courseId: "teacher-research-methods",
                gradebookUpdateId: "gradebook-update-teacher-research-methods",
              },
              receipt: {
                action: "rollback-gradebook-release",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                gradebookUpdateId: "gradebook-update-teacher-research-methods",
                traceId: "trace-teaching-operations-route-smoke-gradebook-rollback",
                status: "persisted",
                providerRollbackStatus: "gradebook-provider-release-rolled-back",
                providerRollbackId: "gradebook-provider-rollback-route-smoke",
                storagePolicy: "external-redacted-teaching-operation-append",
                storageWritePolicy: "external-append-only-operation-log",
              },
            }),
          );
          return;
        }

        if (request.url === "/api/teaching/operations/records/operation-record-route-smoke/rollback") {
          if (!request.headers.cookie) {
            response.writeHead(401, {
              "content-type": "application/json",
              "x-uais-trace-id": "trace-teaching-operations-route-smoke-rollback-denied",
            });
            response.end(
              JSON.stringify({
                error: "UAIS teacher authentication is required.",
                traceId: "trace-teaching-operations-route-smoke-rollback-denied",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "ids-only",
                },
              }),
            );
            return;
          }
          if (String(request.headers.cookie).includes("uais_app_session=student-session")) {
            response.writeHead(403, {
              "content-type": "application/json",
              "x-uais-trace-id": "trace-teaching-operations-route-smoke-rollback-student-denied",
            });
            response.end(
              JSON.stringify({
                error: "UAIS teacher role is required.",
                traceId: "trace-teaching-operations-route-smoke-rollback-student-denied",
                access: {
                  status: "denied",
                  reasonCode: "teacher-role-required",
                  responsibleSession: "S12",
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
          response.writeHead(200, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-teaching-operations-route-smoke-rollback",
          });
          response.end(
            JSON.stringify({
              traceId: "trace-teaching-operations-route-smoke-rollback",
              receipt: {
                action: "rollback-teaching-operation-record",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                targetRecordId: "operation-record-route-smoke",
                traceId: "trace-teaching-operations-route-smoke-rollback",
                rollbackReason: "route-smoke-rollback",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-operation-rollback",
                storageWritePolicy: "external-append-only-rollback-log",
                externalRollback: {
                  teacherId: "teacher-kang",
                  rollbackId: "teaching-operation-rollback-operation-record-route-smoke",
                  targetRecordId: "operation-record-route-smoke",
                  courseId: "teacher-research-methods",
                  status: "persisted",
                  productionDatabaseAdapter: createReadyProductionDatabaseAdapterForTest(),
                  storagePolicy: "external-redacted-teaching-operation-rollback",
                  storageWritePolicy: "external-append-only-rollback-log",
                  responsibleSession: "S12",
                  redaction: {
                    secrets: "omitted",
                    localFiles: "omitted",
                    assets: "ids-only",
                  },
                },
              },
              secret: "must-not-leak",
            }),
          );
          return;
        }

        if (request.url === "/api/teaching/operations/audit/alerts") {
          if (!request.headers.cookie) {
            response.writeHead(401, {
              "content-type": "application/json",
              "x-uais-trace-id": "trace-teaching-ops-alerts-denied",
            });
            response.end(
              JSON.stringify({
                error: "UAIS teacher authentication is required.",
                traceId: "trace-teaching-ops-alerts-denied",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "ids-only",
                },
              }),
            );
            return;
          }
          response.writeHead(200, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-teaching-ops-alerts",
          });
          response.end(
            JSON.stringify({
              traceId: "trace-teaching-ops-alerts",
              actorId: "teacher-kang",
              courseIds: ["teacher-research-methods"],
              status: "attention-required",
              eventType: "teaching-operation-audit-alert-summary",
              storagePolicy: "external-redacted-teaching-operation-audit-alerts",
              alertCount: 1,
              alerts: [
                {
                  alertId:
                    "missing-course-context-audit-admins-send-admin-email-route-smoke-alert",
                  severity: "high",
                  reason: "missing-course-context",
                  auditId: "audit-admins-send-admin-email-route-smoke-alert",
                  traceId: "trace-teaching-operations-route-smoke-alert",
                  actorId: "teacher-kang",
                  operationId: "admins",
                  actionSlot: "secondary",
                  actionId: "send-collaboration-invite",
                },
              ],
              notificationRoute: "/api/teaching/operations/audit/alerts/notifications",
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url === "/api/teaching/operations/audit/alerts/notifications"
        ) {
          if (!request.headers.cookie) {
            const traceId =
              typeof request.headers["x-uais-trace-id"] === "string"
                ? request.headers["x-uais-trace-id"]
                : "trace-teaching-operations-route-smoke-alert-notifications-denied";
            response.writeHead(401, {
              "content-type": "application/json",
              "x-uais-trace-id": traceId,
            });
            response.end(
              JSON.stringify({
                error: "UAIS teacher authentication is required.",
                traceId,
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "ids-only",
                },
              }),
            );
            return;
          }
          response.writeHead(200, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-teaching-ops-alert-notifications",
          });
          response.end(
            JSON.stringify({
              traceId: "trace-teaching-ops-alert-notifications",
              actorId: "teacher-kang",
              courseIds: ["teacher-research-methods"],
              status: "queued",
              eventType: "teaching-operation-audit-alert-notification-dispatch",
              deliveryChannel: "admin-outbox",
              storagePolicy:
                "external-redacted-teaching-operation-audit-alert-notification-outbox",
              storageWritePolicy: "external-append-only-notification-outbox",
              notificationCount: 1,
              notifications: [
                {
                  notificationId:
                    "alert-notification-missing-course-context-audit-admins-send-admin-email-route-smoke-alert",
                  alertId:
                    "missing-course-context-audit-admins-send-admin-email-route-smoke-alert",
                  deliveryStatus: "queued",
                  traceId: "trace-teaching-operations-route-smoke-alert",
                },
              ],
            }),
          );
          return;
        }

        if (
          request.method === "GET" &&
          request.url === "/api/teaching/operations/audit/alerts/notifications"
        ) {
          if (!request.headers.cookie) {
            response.writeHead(401, {
              "content-type": "application/json",
              "x-uais-trace-id": "trace-teaching-ops-alert-notification-readback-denied",
            });
            response.end(
              JSON.stringify({
                error: "UAIS teacher authentication is required.",
                traceId: "trace-teaching-ops-alert-notification-readback-denied",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "ids-only",
                },
              }),
            );
            return;
          }
          response.writeHead(200, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-teaching-ops-alert-notification-readback",
          });
          response.end(
            JSON.stringify({
              traceId: "trace-teaching-ops-alert-notification-readback",
              actorId: "teacher-kang",
              courseIds: ["teacher-research-methods"],
              eventType: "teaching-operation-audit-alert-notification-outbox",
              deliveryChannel: "admin-outbox",
              storagePolicy:
                "external-redacted-teaching-operation-audit-alert-notification-outbox",
              recordCount: 1,
              notifications: [
                {
                  notificationId:
                    "alert-notification-missing-course-context-audit-admins-send-admin-email-route-smoke-alert",
                  deliveryStatus: "queued",
                  traceId: "trace-teaching-operations-route-smoke-alert",
                },
              ],
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          request.url === "/api/teaching/operations" &&
          typeof parsedBody === "object" &&
          parsedBody !== null &&
          request.headers["x-uais-trace-id"] ===
            "trace-teaching-operations-route-smoke-idempotency-conflict"
        ) {
          response.writeHead(409, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-teaching-operations-route-smoke-idempotency-conflict",
          });
          response.end(
            JSON.stringify({
              error: "Teaching operation idempotency key already exists.",
              traceId: "trace-teaching-operations-route-smoke-idempotency-conflict",
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
          request.url === "/api/teaching/operations" &&
          typeof parsedBody === "object" &&
          parsedBody !== null &&
          "operationId" in parsedBody &&
          parsedBody.operationId === "course-settings" &&
          "actionSlot" in parsedBody &&
          parsedBody.actionSlot === "secondary"
        ) {
          response.writeHead(200, {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-teaching-ops-student-preview",
          });
          response.end(
            JSON.stringify({
              receipt: {
                receiptId: "student-preview-session-record-route-smoke",
                operationId: "course-settings",
                actionSlot: "secondary",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-operation-append",
                storageWritePolicy: "external-append-only-operation-log",
              },
              studentPreviewSessionReceipt: {
                action: "generate-student-preview-session",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                traceId: "trace-teaching-operations-route-smoke-student-preview",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-course-management-snapshot",
                storageWritePolicy: "external-optimistic-snapshot-replace",
              },
            }),
          );
          return;
        }

        response.writeHead(200, {
          "content-type": "application/json",
          "x-uais-trace-id": "trace-teaching-ops-live",
        });
        response.end(
          JSON.stringify({
            receipt: {
              receiptId: "operation-record-route-smoke",
              operationId: "course-settings",
              actionSlot: "primary",
              actorId: "teacher-kang",
              courseId: "teacher-research-methods",
              idempotencyKey: "route-smoke-teacher-research-methods-local-production",
              idempotencyStatus:
                request.headers["x-uais-trace-id"] ===
                  "trace-teaching-operations-route-smoke-idempotent-retry" ||
                request.headers["x-uais-trace-id"] ===
                  "trace-teaching-operations-route-smoke-concurrent-idempotent-retry-a" ||
                request.headers["x-uais-trace-id"] ===
                  "trace-teaching-operations-route-smoke-concurrent-idempotent-retry-b"
                  ? "already-persisted"
                  : "created",
              status: "persisted",
              storagePolicy: "external-redacted-teaching-operation-append",
              storageWritePolicy: "external-append-only-operation-log",
              externalAppend: {
                teacherId: "teacher-kang",
                receiptId: "operation-record-route-smoke",
                status: "persisted",
                appendSequence: 1,
                storagePolicy: "external-redacted-teaching-operation-append",
                storageWritePolicy: "external-append-only-operation-log",
                responsibleSession: "S12",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "ids-only",
                },
              },
              audit: {
                traceId: "trace-teaching-ops-live",
                authMode: "signed-teacher-session",
                authSession: {
                  sessionId: "teacher-route-smoke-session",
                  authenticatedAt: "2026-06-23T00:00:00.000Z",
                  expiresAt: "2026-06-23T01:00:00.000Z",
                },
                requestSource: {
                  userAgent: "UAIS teaching operations route smoke",
                  ipAddress: "redacted",
                  originClass: "local-loopback",
                  refererPath: "/teaching",
                },
              },
            },
            courseSettingsReceipt: {
              action: "save-course-settings",
              actorId: "teacher-kang",
              courseId: "teacher-research-methods",
              traceId: "trace-teaching-ops-live",
              status: "persisted",
              storagePolicy: "external-redacted-teaching-course-management-snapshot",
              storageWritePolicy: "external-optimistic-snapshot-replace",
            },
            domainPersistenceSummary: {
              status: "persisted",
              required: true,
              operationId: "course-settings",
              actionSlot: "primary",
              operationReceiptId: "operation-record-route-smoke",
              courseId: "teacher-research-methods",
              expectedObjectTypes: ["course-settings"],
              persistedObjectTypes: ["course-settings"],
              missingObjectTypes: [],
              persistedResponseKeys: ["courseSettingsReceipt"],
              receiptCount: 1,
              storageWritePolicies: ["external-optimistic-snapshot-replace"],
              responsibleSession: "S12",
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "ids-only",
              },
            },
            secret: "must-not-leak",
          }),
        );
      });
    });
    const baseUrl = await listenForTest(server);

    const output = await execFileForTest("node", [
      "scripts/teaching-operations-route-smoke.mjs",
      "--live",
      "--approved",
      "--environment",
      "local-production",
      "--base-url",
      baseUrl,
      "--course-id",
      "teacher-research-methods",
      "--class-id",
      "teacher-research-methods-class-1",
      "--cookie",
      "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
      "--student-cookie",
      "uais_app_session=student-session",
      "--external-storage-base-url",
      baseUrl,
      "--external-storage-access-token",
      "secret-external-storage-token-with-32-chars",
      "--collaboration-invite-email-callback-token",
      "secret-email-callback-token-with-32-chars",
    ]);
    const body = JSON.parse(output);

    expect(requests).toEqual([
      {
        url: "/api/teaching/operations",
        cookie: undefined,
        authorization: undefined,
        body: {
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          sourceAction: "route-smoke-unauthenticated-denial",
          idempotencyKey:
            "route-smoke-unauthenticated-denied-teacher-research-methods-local-production",
          courseSettingsPatch: {
            courseName: "Route Smoke Applied Course Settings",
            semester: "2026 Fall",
            description: "Route smoke verifies persisted course settings patch readback.",
          },
        },
      },
      {
        url: "/api/teaching/operations",
        cookie: "uais_app_session=student-session",
        authorization: undefined,
        body: {
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          sourceAction: "route-smoke-student-role-denial",
          idempotencyKey: "route-smoke-student-denied-teacher-research-methods-local-production",
          courseSettingsPatch: {
            courseName: "Route Smoke Applied Course Settings",
            semester: "2026 Fall",
            description: "Route smoke verifies persisted course settings patch readback.",
          },
        },
      },
      {
        url: "/api/teaching/operations",
        cookie: expect.stringContaining("uais_app_session="),
        authorization: undefined,
        body: {
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          sourceAction: "route-smoke-unsafe-app-session-denial",
          idempotencyKey:
            "route-smoke-unsafe-app-session-teacher-research-methods-local-production",
          courseSettingsPatch: {
            courseName: "Route Smoke Applied Course Settings",
            semester: "2026 Fall",
            description: "Route smoke verifies persisted course settings patch readback.",
          },
        },
      },
      {
        url: "/api/teaching/operations/audit",
        cookie: undefined,
        authorization: undefined,
        body: undefined,
      },
      {
        url: "/api/teaching/operations/audit",
        cookie: "uais_app_session=student-session",
        authorization: undefined,
        body: undefined,
      },
      {
        url: "/api/teaching/operations/audit",
        cookie: expect.stringContaining("uais_app_session="),
        authorization: undefined,
        body: undefined,
      },
      {
        url: "/api/teaching/operations",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: {
          operationId: "course-settings",
          actionSlot: "primary",
          sourceAction: "route-smoke-course-id-required-denial",
          idempotencyKey: "route-smoke-missing-course-id-teacher-research-methods-local-production",
        },
      },
      {
        url: "/api/teaching/operations",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: {
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "route-smoke-foreign-course",
          sourceAction: "route-smoke-course-scope-denial",
          idempotencyKey: "route-smoke-denied-teacher-research-methods-local-production",
          courseSettingsPatch: {
            courseName: "Route Smoke Applied Course Settings",
            semester: "2026 Fall",
            description: "Route smoke verifies persisted course settings patch readback.",
          },
        },
      },
      {
        url: "/api/teaching/operations",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: {
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          sourceAction: "route-smoke",
          idempotencyKey: "route-smoke-teacher-research-methods-local-production",
          courseSettingsPatch: {
            courseName: "Route Smoke Applied Course Settings",
            semester: "2026 Fall",
            description: "Route smoke verifies persisted course settings patch readback.",
          },
        },
      },
      {
        url: "/api/teaching/operations",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: {
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          sourceAction: "route-smoke",
          idempotencyKey: "route-smoke-teacher-research-methods-local-production",
          courseSettingsPatch: {
            courseName: "Route Smoke Applied Course Settings",
            semester: "2026 Fall",
            description: "Route smoke verifies persisted course settings patch readback.",
          },
        },
      },
      {
        url: "/api/teaching/operations",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: {
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          sourceAction: "route-smoke",
          idempotencyKey: "route-smoke-teacher-research-methods-local-production",
          courseSettingsPatch: {
            courseName: "Route Smoke Applied Course Settings",
            semester: "2026 Fall",
            description: "Route smoke verifies persisted course settings patch readback.",
          },
        },
      },
      {
        url: "/api/teaching/operations",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: {
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          sourceAction: "route-smoke",
          idempotencyKey: "route-smoke-teacher-research-methods-local-production",
          courseSettingsPatch: {
            courseName: "Route Smoke Applied Course Settings",
            semester: "2026 Fall",
            description: "Route smoke verifies persisted course settings patch readback.",
          },
        },
      },
      {
        url: "/api/teaching/operations",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: {
          operationId: "course-settings",
          actionSlot: "secondary",
          courseId: "teacher-research-methods",
          sourceAction: "route-smoke",
          idempotencyKey: "route-smoke-teacher-research-methods-local-production",
          courseSettingsPatch: {
            courseName: "Route Smoke Applied Course Settings",
            semester: "2026 Fall",
            description: "Route smoke verifies persisted course settings patch readback.",
          },
        },
      },
      {
        url: "/api/teaching/operations",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: {
          operationId: "course-settings",
          actionSlot: "secondary",
          courseId: "teacher-research-methods",
          sourceAction: "route-smoke-student-preview",
          idempotencyKey: "route-smoke-student-preview-teacher-research-methods-local-production",
        },
      },
      {
        url: "/api/teaching/operations",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: {
          operationId: "students",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          sourceAction: "route-smoke-student-roster",
          idempotencyKey: "route-smoke-student-roster-teacher-research-methods-local-production",
        },
      },
      {
        url: "/api/teaching/operations",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: {
          operationId: "students",
          actionSlot: "secondary",
          courseId: "teacher-research-methods",
          sourceAction: "route-smoke-student-group-suggestion",
          idempotencyKey: "route-smoke-student-group-teacher-research-methods-local-production",
        },
      },
      {
        url: "/api/teaching/operations",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: {
          operationId: "knowledge-base",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          sourceAction: "route-smoke-knowledge-index",
          idempotencyKey: "route-smoke-knowledge-index-teacher-research-methods-local-production",
        },
      },
      {
        url: "/api/teaching/operations",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: {
          operationId: "knowledge-base",
          actionSlot: "secondary",
          courseId: "teacher-research-methods",
          sourceAction: "route-smoke-resource-review",
          idempotencyKey:
            "route-smoke-resource-review-teacher-research-methods-local-production",
        },
      },
      {
        url: "/api/teaching/operations",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: {
          operationId: "content",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          sourceAction: "route-smoke-course-content",
          idempotencyKey: "route-smoke-course-content-teacher-research-methods-local-production",
        },
      },
      {
        url: "/api/teaching/operations",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: {
          operationId: "content",
          actionSlot: "secondary",
          courseId: "teacher-research-methods",
          sourceAction: "route-smoke-course-unit-draft",
          idempotencyKey:
            "route-smoke-course-unit-draft-teacher-research-methods-local-production",
        },
      },
      {
        url: "/api/teaching/operations",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: {
          operationId: "dashboard",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          sourceAction: "route-smoke-dashboard-state",
          idempotencyKey: "route-smoke-dashboard-state-teacher-research-methods-local-production",
        },
      },
      {
        url: "/api/teaching/operations",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: {
          operationId: "dashboard",
          actionSlot: "secondary",
          courseId: "teacher-research-methods",
          sourceAction: "route-smoke-dashboard-snapshot",
          idempotencyKey:
            "route-smoke-dashboard-snapshot-teacher-research-methods-local-production",
        },
      },
      {
        url: "/api/teaching/operations",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: {
          operationId: "quiz-board",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          sourceAction: "route-smoke-quiz-assessment",
          idempotencyKey:
            "route-smoke-quiz-assessment-teacher-research-methods-local-production",
        },
      },
      {
        url: "/api/teaching/operations",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: {
          operationId: "quiz-board",
          actionSlot: "secondary",
          courseId: "teacher-research-methods",
          sourceAction: "route-smoke-quiz-item-review",
          idempotencyKey:
            "route-smoke-quiz-item-review-teacher-research-methods-local-production",
        },
      },
      {
        url: "/api/teaching/operations",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: {
          operationId: "agents",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          sourceAction: "route-smoke-agent-settings",
          idempotencyKey:
            "route-smoke-agent-settings-teacher-research-methods-local-production",
        },
      },
      {
        url: "/api/teaching/operations",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: {
          operationId: "agents",
          actionSlot: "secondary",
          courseId: "teacher-research-methods",
          sourceAction: "route-smoke-agent-permission-preflight",
          idempotencyKey:
            "route-smoke-agent-permission-preflight-teacher-research-methods-local-production",
        },
      },
      {
        url: "/api/teaching/operations",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: {
          operationId: "admins",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          sourceAction: "route-smoke-admin-settings",
          idempotencyKey: "route-smoke-admin-settings-teacher-research-methods-local-production",
        },
      },
      {
        url: "/api/teaching/operations",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: {
          operationId: "admins",
          actionSlot: "secondary",
          courseId: "teacher-research-methods",
          sourceAction: "route-smoke-collaboration-invite",
          idempotencyKey: "route-smoke-admin-invite-teacher-research-methods-local-production",
        },
      },
      {
        url: "/api/teaching/operations",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: {
          operationId: "data-export",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          sourceAction: "route-smoke-export-manifest",
          idempotencyKey:
            "route-smoke-export-manifest-teacher-research-methods-local-production",
        },
      },
      {
        url: "/api/teaching/operations",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: {
          operationId: "data-export",
          actionSlot: "secondary",
          courseId: "teacher-research-methods",
          sourceAction: "route-smoke-export-redaction",
          idempotencyKey:
            "route-smoke-export-redaction-teacher-research-methods-local-production",
        },
      },
      {
        url: "/api/teaching/operations",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: {
          operationId: "grading",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          sourceAction: "route-smoke-gradebook-release",
          idempotencyKey: "route-smoke-gradebook-teacher-research-methods-local-production",
        },
      },
      {
        url: "/api/teaching/operations",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: {
          operationId: "grading",
          actionSlot: "secondary",
          courseId: "teacher-research-methods",
          sourceAction: "route-smoke-grading-feedback",
          idempotencyKey:
            "route-smoke-grading-feedback-teacher-research-methods-local-production",
        },
      },
      {
        url: "/api/teaching/operations/audit",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: undefined,
      },
      {
        url: "/api/teaching/operations/collaboration-invite-deliveries",
        cookie: undefined,
        authorization: undefined,
        body: {
          eventType: "collaboration-invite-email.delivery-status",
          courseId: "teacher-research-methods",
          operationRecordId: "collaboration-invite-record-route-smoke",
          outboxId: "collaboration-invite-teacher-kang-route-smoke",
          deliveryId: "email-delivery-collaboration-invite-route-smoke",
          providerStatus: "bounced",
          occurredAt: "2026-06-23T00:05:45.000Z",
          failureReason: "route-smoke-bounce",
        },
      },
      {
        url: "/api/teaching/operations/collaboration-invite-deliveries",
        cookie: "uais_app_session=student-session",
        authorization: undefined,
        body: {
          eventType: "collaboration-invite-email.delivery-status",
          courseId: "teacher-research-methods",
          operationRecordId: "collaboration-invite-record-route-smoke",
          outboxId: "collaboration-invite-teacher-kang-route-smoke",
          deliveryId: "email-delivery-collaboration-invite-route-smoke",
          providerStatus: "bounced",
          occurredAt: "2026-06-23T00:05:45.000Z",
          failureReason: "route-smoke-bounce",
        },
      },
      {
        url: "/api/teaching/operations/collaboration-invite-deliveries",
        cookie: undefined,
        authorization: "Bearer invalid-email-callback-token-with-32-chars",
        body: {
          eventType: "collaboration-invite-email.delivery-status",
          courseId: "teacher-research-methods",
          operationRecordId: "collaboration-invite-record-route-smoke",
          outboxId: "collaboration-invite-teacher-kang-route-smoke",
          deliveryId: "email-delivery-collaboration-invite-route-smoke",
          providerStatus: "bounced",
          occurredAt: "2026-06-23T00:05:45.000Z",
          failureReason: "route-smoke-bounce",
        },
      },
      {
        url: "/api/teaching/operations/collaboration-invite-deliveries",
        cookie: undefined,
        authorization: "Bearer secret-email-callback-token-with-32-chars",
        body: {
          eventType: "collaboration-invite-email.delivery-status",
          courseId: "teacher-research-methods",
          operationRecordId: "collaboration-invite-record-route-smoke",
          outboxId: "collaboration-invite-teacher-kang-route-smoke",
          deliveryId: "unsafe/../callback-delivery",
          providerStatus: "bounced",
          occurredAt: "2026-06-23T00:05:45.000Z",
          failureReason: "route-smoke-bounce",
        },
      },
      {
        url: "/api/teaching/operations/collaboration-invite-deliveries",
        cookie: undefined,
        authorization: "Bearer secret-email-callback-token-with-32-chars",
        body: {
          eventType: "collaboration-invite-email.delivery-status",
          courseId: "teacher-research-methods",
          operationRecordId: "collaboration-invite-record-route-smoke",
          outboxId: "collaboration-invite-teacher-kang-route-smoke",
          deliveryId: "email-delivery-collaboration-invite-route-smoke",
          providerStatus: "bounced",
          occurredAt: "2026-06-23T00:05:45.000Z",
          failureReason: "route-smoke-bounce",
        },
      },
      {
        url: "/api/teaching/operations/export/export-manifest-teacher-kang-route-smoke",
        cookie: undefined,
        authorization: undefined,
        body: undefined,
      },
      {
        url: "/api/teaching/operations/export/export-manifest-teacher-kang-route-smoke",
        cookie: "uais_app_session=student-session",
        authorization: undefined,
        body: undefined,
      },
      {
        url: "/api/teaching/operations/export/export-manifest-teacher-kang-route-smoke",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: undefined,
      },
      {
        url: "/api/teaching/operations/export/..%2Funsafe-export-manifest-id",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: undefined,
      },
      {
        url: "/teaching-operations/teacher-kang/audit",
        cookie: undefined,
        authorization: "Bearer secret-external-storage-token-with-32-chars",
        body: undefined,
      },
      {
        url: "/teaching-course-management/database",
        cookie: undefined,
        authorization: "Bearer secret-external-storage-token-with-32-chars",
        body: undefined,
      },
      {
        url: "/api/teaching/operations/records/operation-record-route-smoke/rollback",
        cookie: undefined,
        authorization: undefined,
        body: {
          action: "rollback-teaching-operation-record",
          rollbackReason: "route-smoke-rollback",
          courseId: "teacher-research-methods",
        },
      },
      {
        url: "/api/teaching/operations/records/operation-record-route-smoke/rollback",
        cookie: "uais_app_session=student-session",
        authorization: undefined,
        body: {
          action: "rollback-teaching-operation-record",
          rollbackReason: "route-smoke-rollback",
          courseId: "teacher-research-methods",
        },
      },
      {
        url: "/api/teaching/operations/audit",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: undefined,
      },
      {
        url: "/api/teaching/operations/records/operation-record-route-smoke/rollback",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: {
          action: "rollback-teaching-operation-record",
          rollbackReason: "route-smoke-rollback",
          courseId: "teacher-research-methods",
        },
      },
      {
        url: "/api/teaching/operations/audit",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: undefined,
      },
      {
        url: "/teaching-operations/teacher-kang/append",
        cookie: undefined,
        authorization: "Bearer secret-external-storage-token-with-32-chars",
        body: expect.objectContaining({
          action: "append-teaching-operation",
          record: expect.objectContaining({
            recordId: "admins-send-admin-email-route-smoke-alert",
            operationId: "admins",
            actionSlot: "secondary",
            actorId: "teacher-kang",
          }),
          auditEvent: expect.objectContaining({
            auditId: "audit-admins-send-admin-email-route-smoke-alert",
            traceId: "trace-teaching-operations-route-smoke-alert",
            actorId: "teacher-kang",
            operationId: "admins",
            actionSlot: "secondary",
          }),
        }),
      },
      {
        url: "/api/teaching/operations/audit/alerts",
        cookie: undefined,
        authorization: undefined,
        body: undefined,
      },
      {
        url: "/api/teaching/operations/audit/alerts",
        cookie: "uais_app_session=student-session",
        authorization: undefined,
        body: undefined,
      },
      {
        url: "/api/teaching/operations/audit/alerts",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: undefined,
      },
      {
        url: "/api/teaching/operations/audit/alerts/notifications",
        cookie: undefined,
        authorization: undefined,
        body: undefined,
      },
      {
        url: "/api/teaching/operations/audit/alerts/notifications",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: undefined,
      },
      {
        url: "/api/teaching/operations/audit/alerts/notifications",
        cookie: "uais_app_session=student-session",
        authorization: undefined,
        body: undefined,
      },
      {
        url: "/api/teaching/operations/audit/alerts/notifications",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: undefined,
      },
      {
        url: "/api/teaching/operations/audit/alerts/notifications",
        cookie: undefined,
        authorization: undefined,
        body: undefined,
      },
      {
        url: "/api/teaching/operations/audit/alerts/notifications",
        cookie: "uais_app_session=student-session",
        authorization: undefined,
        body: undefined,
      },
      {
        url: "/api/teaching/operations/audit/alerts/notifications",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: undefined,
      },
      {
        url: "/api/teaching/operations/audit/alerts/notifications",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: undefined,
      },
      {
        url: "/api/teaching/operations",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: {
          operationId: "invite-code",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          targetClassId: "teacher-research-methods-class-1",
          sourceAction: "route-smoke-invite-draft",
          idempotencyKey: "route-smoke-invite-draft-teacher-research-methods-local-production",
        },
      },
      {
        url: "/teaching-course-management/database",
        cookie: undefined,
        authorization: "Bearer secret-external-storage-token-with-32-chars",
        body: undefined,
      },
      {
        url: "/api/teaching/operations",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: {
          operationId: "invite-code",
          actionSlot: "secondary",
          courseId: "teacher-research-methods",
          targetClassId: "teacher-research-methods-class-1",
          sourceAction: "route-smoke-invite-publish",
          idempotencyKey: "route-smoke-invite-teacher-research-methods-local-production",
        },
      },
      {
        url: "/teaching-course-management/database",
        cookie: undefined,
        authorization: "Bearer secret-external-storage-token-with-32-chars",
        body: undefined,
      },
      {
        url: "/api/teaching/invite-codes/77441122/join",
        cookie: "uais_app_session=student-session",
        authorization: undefined,
        body: undefined,
      },
      {
        url:
          "/api/teaching/gradebook-updates/gradebook-update-teacher-research-methods/release",
        cookie: undefined,
        authorization: undefined,
        body: undefined,
      },
      {
        url:
          "/api/teaching/gradebook-updates/gradebook-update-teacher-research-methods/rollback",
        cookie: undefined,
        authorization: undefined,
        body: undefined,
      },
      {
        url:
          "/api/teaching/gradebook-updates/gradebook-update-teacher-research-methods/release",
        cookie: "uais_app_session=student-session",
        authorization: undefined,
        body: undefined,
      },
      {
        url:
          "/api/teaching/gradebook-updates/gradebook-update-teacher-research-methods/rollback",
        cookie: "uais_app_session=student-session",
        authorization: undefined,
        body: undefined,
      },
      {
        url: "/teaching-operations/teacher-kang/audit",
        cookie: undefined,
        authorization: "Bearer secret-external-storage-token-with-32-chars",
        body: undefined,
      },
      {
        url: "/api/teaching/gradebook-updates/..%2Funsafe-gradebook-object-id/release",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: undefined,
      },
      {
        url: "/api/teaching/gradebook-updates/..%2Funsafe-gradebook-object-id/rollback",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: undefined,
      },
      {
        url:
          "/api/teaching/gradebook-updates/gradebook-update-teacher-research-methods/release",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: undefined,
      },
      {
        url:
          "/api/teaching/gradebook-updates/gradebook-update-teacher-research-methods/rollback",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: undefined,
      },
      {
        url: "/teaching-operations/teacher-kang/audit",
        cookie: undefined,
        authorization: "Bearer secret-external-storage-token-with-32-chars",
        body: undefined,
      },
      {
        url: "/teaching-operations/teacher-kang/backups",
        cookie: undefined,
        authorization: "Bearer secret-external-storage-token-with-32-chars",
        body: {
          action: "create-teaching-operation-backup",
          requestedBy: "s22-route-smoke",
          requestedAt: "2026-06-23T00:10:00.000Z",
          traceId: "trace-teaching-operations-route-smoke-backup",
        },
      },
      {
        url:
          "/api/teaching/operations/backups/teaching-operations-backup-teacher-kang-20260623-001000/restore",
        cookie: undefined,
        authorization: undefined,
        body: undefined,
      },
      {
        url:
          "/api/teaching/operations/backups/teaching-operations-backup-teacher-kang-20260623-001000/restore",
        cookie: "uais_app_session=student-session",
        authorization: undefined,
        body: undefined,
      },
      {
        url:
          "/api/teaching/operations/backups/teaching-operations-backup-teacher-kang-20260623-001000/restore",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: undefined,
      },
      {
        url: "/api/teaching/operations/backups/..%2Funsafe-backup-id/restore",
        cookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        authorization: undefined,
        body: undefined,
      },
      {
        url: "/teaching-operations/teacher-kang/audit",
        cookie: undefined,
        authorization: "Bearer secret-external-storage-token-with-32-chars",
        body: undefined,
      },
      {
        url:
          "/teaching-operations/teacher-kang/backups/teaching-operations-backup-teacher-kang-20260623-001000/restore-drill",
        cookie: undefined,
        authorization: "Bearer secret-external-storage-token-with-32-chars",
        body: {
          action: "verify-teaching-operation-backup-restore",
          requestedBy: "s22-route-smoke",
          requestedAt: "2026-06-23T00:11:00.000Z",
          traceId: "trace-teaching-operations-route-smoke-restore-drill",
        },
      },
    ]);
    expect(body).toEqual(
      expect.objectContaining({
        target: "teaching-operations-route-smoke",
        mode: "live",
        environment: "local-production",
        network: "enabled",
        status: "passed",
        route: "/api/teaching/operations",
        httpStatus: {
          unauthenticatedPost: 401,
          signedStudentPost: 403,
          unsafeAppSessionPost: 401,
          unauthenticatedAuditReadback: 401,
          signedStudentAuditReadback: 403,
          unsafeAppSessionAuditReadback: 401,
          authorizedPost: 200,
          forbiddenCoursePost: 403,
          idempotentRetryPost: 200,
          concurrentIdempotentRetryPosts: [200, 200],
          idempotencyConflictPost: 409,
          studentPreviewSessionPost: 200,
          studentRosterSyncPost: 200,
          studentGroupSuggestionPost: 200,
          knowledgeIndexSyncPost: 200,
          resourceReviewItemPost: 200,
          courseContentPublishPost: 200,
          courseUnitDraftPost: 200,
          dashboardRefreshPost: 200,
          dashboardSnapshotPost: 200,
          quizAssessmentPost: 200,
          quizItemReviewPost: 200,
          agentSettingsPost: 200,
          agentPermissionPreflightPost: 200,
          adminSettingsPost: 200,
          collaborationInviteNotificationPost: 200,
          unauthenticatedCollaborationInviteEmailBounceCallbackPost: 401,
          signedStudentCollaborationInviteEmailBounceCallbackPost: 401,
          invalidTokenCollaborationInviteEmailBounceCallbackPost: 401,
          unsafeCollaborationInviteEmailBounceCallbackPost: 400,
          collaborationInviteEmailBounceCallbackPost: 200,
          courseExportManifestPost: 200,
          courseExportRedactionValidationPost: 200,
          auditReadback: 200,
          externalAuditReadback: 200,
          externalCourseManagementReadback: 200,
          unauthenticatedRollbackPost: 401,
          signedStudentRollbackPost: 403,
          rollbackDeniedAuditReadback: 200,
          rollbackPost: 200,
          rollbackAuditReadback: 200,
          alertSeedAppend: 200,
          unauthenticatedAlertSummaryReadback: 401,
          signedStudentAlertSummaryReadback: 403,
          alertSummaryReadback: 200,
          unauthenticatedAlertNotificationPost: 401,
          alertNotificationDeniedReadback: 200,
          signedStudentAlertNotificationPost: 403,
          signedStudentAlertNotificationDeniedReadback: 200,
          unauthenticatedAlertNotificationReadback: 401,
          signedStudentAlertNotificationReadback: 403,
          alertNotificationPost: 200,
          alertNotificationReadback: 200,
          unauthenticatedExportManifestDownload: 401,
          signedStudentExportManifestDownload: 403,
          exportManifestDownload: 200,
          unsafeExportManifestDownload: 400,
          externalBackupPost: 200,
          externalRestoreDrillPost: 200,
          inviteDraftPost: 200,
          inviteDraftCourseManagementReadback: 200,
          invitePublishPost: 200,
          invitePublishCourseManagementReadback: 200,
          studentInviteJoinPost: 201,
          gradebookSeedPost: 200,
          gradingFeedbackDraftPost: 200,
          unauthenticatedGradebookReleasePost: 401,
          unauthenticatedGradebookRollbackPost: 401,
          signedStudentGradebookReleasePost: 403,
          signedStudentGradebookRollbackPost: 403,
          gradebookDeniedAuditReadback: 200,
          unsafeGradebookReleaseObjectIdPost: 400,
          unsafeGradebookRollbackObjectIdPost: 400,
          gradebookReleasePost: 200,
          gradebookRollbackPost: 200,
          gradebookAuditReadback: 200,
          unauthenticatedBackupRestorePost: 401,
          signedStudentBackupRestorePost: 403,
          directBackupRestorePost: 409,
          unsafeBackupRestorePost: 400,
          backupRestoreDeniedAuditReadback: 200,
        },
        results: {
          unauthenticatedPostDenied: "passed",
          unauthenticatedPostNoWriteSideEffects: "passed",
          signedStudentPostDenied: "passed",
          signedStudentNoWriteSideEffects: "passed",
          unsafeAppSessionPostDenied: "passed",
          unsafeAppSessionPostTraceHeaderReturned: "passed",
          unsafeAppSessionPostNoWriteSideEffects: "passed",
          signedTeacherCourseIdRequired: "passed",
          signedTeacherCourseIdRequiredNoWriteSideEffects: "passed",
          forbiddenCourseScopeDenied: "passed",
          forbiddenCourseScopeNoWriteSideEffects: "passed",
          authorizedOperationPersisted: "passed",
          durableExternalPersistenceReturned: "passed",
          domainPersistenceSummaryReturned: "passed",
          operationsSchemaMigrationPolicyReturned: "passed",
          appendLedgerSequenceReturned: "passed",
          appendLedgerSequenceReadbackReturned: "passed",
          signedActorReturned: "passed",
          courseBindingReturned: "passed",
          auditTraceReturned: "passed",
          auditAuthSessionReturned: "passed",
          auditRequestSourceProvenanceReturned: "passed",
          unauthenticatedTraceHeaderReturned: "passed",
          signedStudentTraceHeaderReturned: "passed",
          unauthenticatedAuditReadbackDenied: "passed",
          unauthenticatedAuditReadbackTraceHeaderReturned: "passed",
          signedStudentAuditReadbackDenied: "passed",
          signedStudentAuditReadbackTraceHeaderReturned: "passed",
          unsafeAppSessionAuditReadbackDenied: "passed",
          unsafeAppSessionAuditReadbackTraceHeaderReturned: "passed",
          unauthenticatedAlertNotificationEnqueueDenied: "passed",
          unauthenticatedAlertNotificationTraceHeaderReturned: "passed",
          signedStudentAlertNotificationEnqueueDenied: "passed",
          signedStudentAlertNotificationTraceHeaderReturned: "passed",
          unauthenticatedAlertNotificationNoWriteSideEffects: "passed",
          signedStudentAlertNotificationNoWriteSideEffects: "passed",
          authorizedTraceHeaderReturned: "passed",
          auditReadbackReturned: "passed",
          auditAuthSessionReadbackReturned: "passed",
          auditReadbackTraceHeaderReturned: "passed",
          domainProjectionReadbackReturned: "passed",
          externalDomainProjectionReadbackReturned: "passed",
          courseSettingsDomainObjectReturned: "passed",
          courseSettingsPatchReadbackReturned: "passed",
          studentPreviewSessionDomainObjectReturned: "passed",
          studentPreviewSessionAuditSourceReturned: "passed",
          studentRosterSyncDomainObjectReturned: "passed",
          studentRosterDomainPersistenceSummaryReturned: "passed",
          studentRosterProviderSyncReturned: "passed",
          studentRosterProviderSyncAuditSourceReturned: "passed",
          studentGroupSuggestionDomainObjectReturned: "passed",
          studentGroupSuggestionAuditSourceReturned: "passed",
          knowledgeIndexSyncDomainObjectReturned: "passed",
          knowledgeIndexDomainPersistenceSummaryReturned: "passed",
          knowledgeIndexProviderSyncReturned: "passed",
          knowledgeIndexProviderSyncAuditSourceReturned: "passed",
          resourceReviewItemDomainObjectReturned: "passed",
          resourceReviewItemAuditSourceReturned: "passed",
          courseContentPublishDomainObjectReturned: "passed",
          courseContentDomainPersistenceSummaryReturned: "passed",
          courseContentProviderPublishReturned: "passed",
          courseContentProviderPublishAuditSourceReturned: "passed",
          courseUnitDraftDomainObjectReturned: "passed",
          courseUnitDraftAuditSourceReturned: "passed",
          dashboardRefreshDomainObjectReturned: "passed",
          dashboardRefreshDomainPersistenceSummaryReturned: "passed",
          dashboardRefreshAuditSourceReturned: "passed",
          dashboardSnapshotDomainObjectReturned: "passed",
          dashboardSnapshotAuditSourceReturned: "passed",
          quizAssessmentDomainObjectReturned: "passed",
          quizAssessmentDomainPersistenceSummaryReturned: "passed",
          quizItemReviewDomainObjectReturned: "passed",
          quizItemReviewDomainPersistenceSummaryReturned: "passed",
          quizItemReviewAuditSourceReturned: "passed",
          agentSettingsDomainObjectReturned: "passed",
          agentSettingsAuditSourceReturned: "passed",
          agentPermissionPreflightDomainObjectReturned: "passed",
          agentPermissionPreflightAuditSourceReturned: "passed",
          adminSettingsDomainObjectReturned: "passed",
          adminSettingsAuditSourceReturned: "passed",
          collaborationInviteNotificationDomainObjectReturned: "passed",
          collaborationInviteDomainPersistenceSummaryReturned: "passed",
          collaborationInviteEmailDeliveryReturned: "passed",
          collaborationInviteEmailDeliveryAuditSourceReturned: "passed",
          unauthenticatedCollaborationInviteEmailBounceCallbackDenied: "passed",
          unauthenticatedCollaborationInviteEmailBounceCallbackTraceHeaderReturned: "passed",
          unauthenticatedCollaborationInviteEmailBounceCallbackNoWriteSideEffects: "passed",
          signedStudentCollaborationInviteEmailBounceCallbackDenied: "passed",
          signedStudentCollaborationInviteEmailBounceCallbackTraceHeaderReturned: "passed",
          signedStudentCollaborationInviteEmailBounceCallbackNoWriteSideEffects: "passed",
          invalidTokenCollaborationInviteEmailBounceCallbackDenied: "passed",
          invalidTokenCollaborationInviteEmailBounceCallbackTraceHeaderReturned: "passed",
          invalidTokenCollaborationInviteEmailBounceCallbackNoWriteSideEffects: "passed",
          unsafeCollaborationInviteEmailBounceCallbackDenied: "passed",
          unsafeCollaborationInviteEmailBounceCallbackTraceHeaderReturned: "passed",
          unsafeCollaborationInviteEmailBounceCallbackNoWriteSideEffects: "passed",
          collaborationInviteEmailBounceCallbackReturned: "passed",
          collaborationInviteEmailCallbackAuditSourceReturned: "passed",
          courseExportManifestDomainObjectReturned: "passed",
          courseExportProviderReturned: "passed",
          courseExportProviderAuditSourceReturned: "passed",
          courseExportManifestAuditSourceReturned: "passed",
          unauthenticatedExportManifestDownloadDenied: "passed",
          unauthenticatedExportManifestDownloadTraceHeaderReturned: "passed",
          signedStudentExportManifestDownloadDenied: "passed",
          signedStudentExportManifestDownloadTraceHeaderReturned: "passed",
          exportManifestDownloadReadbackReturned: "passed",
          unsafeExportManifestIdDenied: "passed",
          courseExportRedactionValidationDomainObjectReturned: "passed",
          exportRedactionValidationAuditSourceReturned: "passed",
          gradingQueueDomainObjectReturned: "passed",
          gradebookUpdateDomainObjectReturned: "passed",
          gradingDomainPersistenceSummaryReturned: "passed",
          gradingFeedbackDraftDomainObjectReturned: "passed",
          gradingFeedbackProviderReturned: "passed",
          gradingFeedbackProviderAuditSourceReturned: "passed",
          idempotentRetryReturned: "passed",
          idempotentRetryAppendSequenceStableReturned: "passed",
          concurrentIdempotentRetryAppendSequenceStableReturned: "passed",
          idempotencyConflictDenied: "passed",
          unauthenticatedRollbackDenied: "passed",
          unauthenticatedRollbackTraceHeaderReturned: "passed",
          unauthenticatedRollbackNoWriteSideEffects: "passed",
          signedStudentRollbackDenied: "passed",
          signedStudentRollbackTraceHeaderReturned: "passed",
          signedStudentRollbackNoWriteSideEffects: "passed",
          rollbackPersistedReturned: "passed",
          rollbackProductionDatabaseAdapterReturned: "passed",
          rollbackTraceHeaderReturned: "passed",
          rollbackTraceClosureReturned: "passed",
          rollbackReadbackReturned: "passed",
          rollbackReadbackTraceHeaderReturned: "passed",
          unauthenticatedAlertSummaryReadbackDenied: "passed",
          unauthenticatedAlertSummaryReadbackTraceHeaderReturned: "passed",
          signedStudentAlertSummaryReadbackDenied: "passed",
          signedStudentAlertSummaryReadbackTraceHeaderReturned: "passed",
          alertSummaryReadbackReturned: "passed",
          unauthenticatedAlertNotificationReadbackDenied: "passed",
          unauthenticatedAlertNotificationReadbackTraceHeaderReturned: "passed",
          signedStudentAlertNotificationReadbackDenied: "passed",
          signedStudentAlertNotificationReadbackTraceHeaderReturned: "passed",
          alertNotificationQueuedReturned: "passed",
          alertNotificationReadbackReturned: "passed",
          externalBackupCreatedReturned: "passed",
          unauthenticatedBackupRestoreDenied: "passed",
          unauthenticatedBackupRestoreTraceHeaderReturned: "passed",
          unauthenticatedBackupRestoreNoWriteSideEffects: "passed",
          signedStudentBackupRestoreDenied: "passed",
          signedStudentBackupRestoreTraceHeaderReturned: "passed",
          signedStudentBackupRestoreNoWriteSideEffects: "passed",
          directBackupRestoreDisabledReturned: "passed",
          directBackupRestoreTraceClosureReturned: "passed",
          directBackupRestoreNoWriteSideEffects: "passed",
          unsafeBackupRestoreIdDenied: "passed",
          unsafeBackupRestoreNoWriteSideEffects: "passed",
          externalRestoreDrillVerifiedReturned: "passed",
          inviteCodeDraftDomainObjectReturned: "passed",
          inviteCodeDraftAuditSourceReturned: "passed",
          invitePublishClassJoinEntryReturned: "passed",
          invitePublishDomainPersistenceSummaryReturned: "passed",
          inviteCodePublishAuditSourceReturned: "passed",
          studentInviteJoinReturned: "passed",
          unauthenticatedGradebookReleaseDenied: "passed",
          unauthenticatedGradebookReleaseTraceHeaderReturned: "passed",
          unauthenticatedGradebookRollbackDenied: "passed",
          unauthenticatedGradebookRollbackTraceHeaderReturned: "passed",
          signedStudentGradebookReleaseDenied: "passed",
          signedStudentGradebookReleaseTraceHeaderReturned: "passed",
          signedStudentGradebookRollbackDenied: "passed",
          signedStudentGradebookRollbackTraceHeaderReturned: "passed",
          unauthenticatedGradebookReleaseNoWriteSideEffects: "passed",
          unauthenticatedGradebookRollbackNoWriteSideEffects: "passed",
          signedStudentGradebookReleaseNoWriteSideEffects: "passed",
          signedStudentGradebookRollbackNoWriteSideEffects: "passed",
          unsafeGradebookReleaseObjectIdDenied: "passed",
          unsafeGradebookRollbackObjectIdDenied: "passed",
          gradebookReleaseTraceClosureReturned: "passed",
          gradebookReleaseAuditSourceReturned: "passed",
          gradebookReleaseExternalStorageReturned: "passed",
          gradebookProviderReleaseReturned: "passed",
          gradebookRollbackTraceClosureReturned: "passed",
          gradebookRollbackAuditSourceReturned: "passed",
          gradebookRollbackExternalStorageReturned: "passed",
          gradebookProviderRollbackReturned: "passed",
        },
      }),
    );
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain("claims");
    expect(output).not.toContain("secret-external-storage-token-with-32-chars");
    expect(output).not.toContain("secret-email-callback-token-with-32-chars");
    expect(output).not.toContain("must-not-leak");
  });

  it("blocks live smoke when teaching operations responses omit trace headers", async () => {
    const server = createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        if (request.headers.cookie !== "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig") {
          response.writeHead(401, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "auth required" }));
          return;
        }

        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            receipt: {
              operationId: "course-settings",
              actionSlot: "primary",
              actorId: "teacher-kang",
              courseId: "teacher-research-methods",
              status: "persisted",
              storagePolicy: "external-redacted-teaching-operation-append",
              storageWritePolicy: "external-append-only-operation-log",
              audit: {
                traceId: "trace-teaching-ops-live",
                authMode: "signed-teacher-session",
              },
            },
          }),
        );
      });
    });
    const baseUrl = await listenForTest(server);

    await expect(
      execFileForTest("node", [
        "scripts/teaching-operations-route-smoke.mjs",
        "--live",
        "--approved",
        "--environment",
        "local-production",
        "--base-url",
        baseUrl,
        "--course-id",
        "teacher-research-methods",
        "--class-id",
        "teacher-research-methods-class-1",
        "--cookie",
        "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        "--student-cookie",
        "uais_app_session=student-session",
      ]),
    ).rejects.toThrow(/unauthenticatedTraceHeaderReturned/);
  });

  it("fails live smoke when the signed actor does not match the configured teacher id", async () => {
    const server = createServer((request, response) => {
      let rawBody = "";
      request.on("data", (chunk) => {
        rawBody += chunk;
      });
      request.on("end", () => {
        const parsedBody = rawBody ? JSON.parse(rawBody) : undefined;
        const traceId =
          typeof request.headers["x-uais-trace-id"] === "string"
            ? request.headers["x-uais-trace-id"]
            : "trace-teaching-operations-route-smoke";

        if (request.url === "/api/teaching/operations") {
          if (request.headers.cookie !== "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig") {
            response.writeHead(401, {
              "content-type": "application/json",
              "x-uais-trace-id": traceId,
            });
            response.end(JSON.stringify({ error: "auth required", traceId }));
            return;
          }

          if (
            typeof parsedBody === "object" &&
            parsedBody !== null &&
            "sourceAction" in parsedBody &&
            parsedBody.sourceAction === "route-smoke-course-scope-denial"
          ) {
            response.writeHead(403, {
              "content-type": "application/json",
              "x-uais-trace-id": traceId,
            });
            response.end(
              JSON.stringify({
                error: "course scope denied",
                traceId,
                access: {
                  status: "denied",
                  reasonCode: "course-scope-denied",
                },
              }),
            );
            return;
          }

          response.writeHead(200, {
            "content-type": "application/json",
            "x-uais-trace-id": traceId,
          });
          response.end(
            JSON.stringify({
              receipt: {
                receiptId: "operation-record-actor-mismatch",
                operationId: "course-settings",
                actionSlot: "primary",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-operation-append",
                storageWritePolicy: "external-append-only-operation-log",
                externalAppend: {
                  appendSequence: 1,
                },
                audit: {
                  traceId,
                  authMode: "signed-teacher-session",
                  authSession: {
                    sessionId: "teacher-kang-session",
                    authenticatedAt: "2026-06-23T00:00:00.000Z",
                    expiresAt: "2026-06-23T01:00:00.000Z",
                  },
                  requestSource: {
                    userAgent: "UAIS teaching operations route smoke",
                    ipAddress: "redacted",
                    originClass: "local-loopback",
                    refererPath: "/teaching",
                  },
                },
              },
              domainPersistenceSummary: {
                status: "persisted",
                required: true,
                operationId: "course-settings",
                actionSlot: "primary",
                operationReceiptId: "operation-record-actor-mismatch",
                courseId: "teacher-research-methods",
                expectedObjectTypes: ["course-settings"],
                persistedObjectTypes: ["course-settings"],
                missingObjectTypes: [],
                persistedResponseKeys: ["courseSettingsReceipt"],
                receiptCount: 1,
                storageWritePolicies: ["external-optimistic-snapshot-replace"],
                responsibleSession: "S12",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "ids-only",
                },
              },
            }),
          );
          return;
        }

        response.writeHead(200, {
          "content-type": "application/json",
          "x-uais-trace-id": traceId,
        });
        response.end(
          JSON.stringify({
            actorId: "teacher-kang",
            courseIds: ["teacher-research-methods"],
            records: [],
            auditEvents: [],
            domainProjections: [],
            database: {
              auditEvents: [],
            },
          }),
        );
      });
    });
    const baseUrl = await listenForTest(server);

    await expect(
      execFileForTest("node", [
        "scripts/teaching-operations-route-smoke.mjs",
        "--live",
        "--approved",
        "--environment",
        "local-production",
        "--base-url",
        baseUrl,
        "--teacher-id",
        "teacher-lin",
        "--course-id",
        "teacher-research-methods",
        "--class-id",
        "teacher-research-methods-class-1",
        "--cookie",
        "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        "--student-cookie",
        "uais_app_session=student-session",
        "--external-storage-base-url",
        baseUrl,
        "--external-storage-access-token",
        "secret-external-storage-token-with-32-chars",
        "--collaboration-invite-email-callback-token",
        "secret-email-callback-token-with-32-chars",
      ]),
    ).rejects.toThrow(/"signedActorReturned": "failed"/);
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

function writeVercelDeploymentEvidenceForTest(
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
      target: "vercel-production-deployment",
      mode: "live",
      status: "deployed",
      releaseRunId: input.releaseRunId,
      deploymentObservation: {
        status: "observed",
      },
      deploymentFingerprint: createDeploymentFingerprintForTest(input.baseUrl),
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
      status: "reachable",
      releaseRunId: input.releaseRunId,
      deploymentFingerprint: createDeploymentFingerprintForTest(input.baseUrl),
    }),
  );
  return evidencePath;
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
      health: {
        teachingOperationsStorageSchema: createTeachingOperationsStorageSchemaForTest(),
        teachingCourseManagementStorageSchema: createSnapshotStorageSchemaForTest(),
        teachingCourseAssetsStorageSchema: createSnapshotStorageSchemaForTest(),
      },
    }),
  );
  return evidencePath;
}

function createTeachingOperationsStorageSchemaForTest() {
  return {
    status: "ready",
    schemaVersion: "uais-teaching-operations-v1",
    migrationStatus: "up-to-date",
    operationLedger: "jsonl-append-only",
    auditLedger: "jsonl-append-only",
    rollbackLedger: "jsonl-append-only",
    backupStore: "json-atomic-snapshot",
    restoreDrillLog: "jsonl-append-only",
    concurrencyControl: "atomic-append-and-rename",
    productionDatabaseAdapter: createReadyProductionDatabaseAdapterForTest(),
    valueRedacted: true,
  };
}

function createSnapshotStorageSchemaForTest() {
  return {
    status: "ready",
    schemaVersion: "uais-teaching-course-snapshot-v1",
    migrationStatus: "up-to-date",
    snapshotStore: "json-atomic-snapshot",
    auditLog: "jsonl-append-only",
    backupStore: "json-atomic-snapshot",
    restoreDrillLog: "jsonl-append-only",
    revisionControl: "optimistic-revision",
    concurrencyControl: "atomic-rename-with-revision-check",
    productionDatabaseAdapter: createReadyProductionDatabaseAdapterForTest(),
    valueRedacted: true,
  };
}

function createReadyProductionDatabaseAdapterForTest() {
  return {
    status: "ready",
    providerClass: "managed-database",
    migrationStatus: "up-to-date",
    backupPolicy: "point-in-time-restore",
    concurrencyControl: "transactional",
    valueRedacted: true,
  };
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
    value: `sha256:${createHash("sha256")
      .update(baseUrl)
      .digest("hex")
      .slice(0, 16)}`,
  };
}
