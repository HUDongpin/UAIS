import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("ordinary teaching production evidence action packet", () => {
  it("summarizes ordinary-teaching live evidence blockers without exposing URLs, cookies, or secrets", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ordinary-teaching-packet-"));
    const ownerChecklist = writeJson(tmpDir, "owner-checklist.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      decisions: [
        {
          id: "ordinary-teaching-production-evidence",
          status: "waiting-for-live-evidence",
          blockedReasons: [
            "teaching-operations-route-smoke-not-live-passed",
            "teaching-operation-detail-browser-smoke-not-live-passed",
            "teaching-course-management-route-smoke-not-live-passed",
          ],
          safeNextActions: [
            "confirm-ordinary-teaching-live-smoke-prerequisites",
            "wait-for-auth-storage-and-vercel-deployment-evidence",
            "run-live-teaching-operations-route-smoke-after-auth-storage-deployment-readiness",
          ],
          forbiddenUntilApproved: [
            "run-live-ordinary-teaching-smokes-before-auth-storage-and-deployment-readiness",
            "call-live-teaching-operations-api-without-issued-teacher-auth-cookie",
            "print-or-log-teacher-auth-cookie-or-backend-secret-values",
          ],
          proofNeeded: [
            "live-teaching-operations-route-smoke",
            "same-release-run-id-bound-to-ordinary-teaching-evidence",
          ],
          sequencing: "external-storage-and-auth-readiness-before-live-ordinary-teaching-smokes",
          leakedCookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        },
      ],
    });
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      queue: [
        {
          id: "ordinary-teaching-production-evidence",
          rank: 5,
          category: "live-evidence",
          status: "waiting-for-live-evidence",
          blockedReasons: [
            "teaching-operations-route-smoke-not-live-passed",
            "teaching-operation-detail-browser-smoke-not-live-passed",
            "teaching-course-management-route-smoke-not-live-passed",
          ],
          releaseGateRequirementIds: [
            "teaching-operations-route-smoke",
            "teaching-operation-detail-browser-smoke",
            "teaching-course-management-route-smoke",
          ],
          enterpriseAuditMissingTargets: [
            "teaching-operations-route-smoke",
            "teaching-operation-detail-browser-smoke",
            "teaching-course-management-route-smoke",
          ],
          nextOwnerQuestion: "Run ordinary-teaching live smokes only after auth, storage, and deployment evidence are ready.",
          sequencing: "external-storage-and-auth-readiness-before-live-ordinary-teaching-smokes",
        },
      ],
    });
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      status: "blocked",
      requirements: [
        routeRequirement("teaching-operations-route-smoke", {
          blockedReason: "teaching-operations-route-smoke-not-live-passed",
          extra: {
            auth: "missing",
            leakedBaseUrl: "https://private-ordinary-teaching.example.test",
            leakedBackendSecret: "secret-ordinary-teaching-backend-token",
          },
        }),
        routeRequirement("teaching-operation-detail-browser-smoke", {
          blockedReason: "teaching-operation-detail-browser-smoke-not-live-passed",
          extra: {
            apiInterceptionPolicy: {
              operationApi: "fixture-backed-contract",
              responseBodiesOmitted: true,
              leakedResponseBody: "secret-response-body",
            },
          },
        }),
        routeRequirement("teaching-course-management-route-smoke", {
          blockedReason: "teaching-course-management-route-smoke-not-live-passed",
          extra: {
            courseManagementBackend: "missing",
            courseAssetsBackend: "missing",
            teachingOperationsBackend: "missing",
            teacherAiOwnershipBackend: "missing",
          },
        }),
      ],
      leakedLocalPath: "/Users/example/private-ordinary-teaching.env",
    });

    const output = execFileSync("node", [
      "scripts/ordinary-teaching-production-evidence-action-packet.mjs",
      "--owner-checklist",
      ownerChecklist,
      "--owner-decision-queue",
      ownerQueue,
      "--release-gate",
      releaseGate,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "ordinary-teaching-production-evidence-action-packet",
        status: "waiting-for-live-evidence",
        releaseGateStatus: "blocked",
        responsibleSession: "S22",
        decisionId: "ordinary-teaching-production-evidence",
        queueRank: 5,
        classification: "auth-storage-deployment-live-smokes-blocked",
        sequencing: "external-storage-and-auth-readiness-before-live-ordinary-teaching-smokes",
        upstreamEvidenceIds: [
          "app-auth-provider-readiness",
          "teacher-auth-provider-readiness",
          "external-storage-service-readiness",
          "vercel-production-deployment",
          "deployment-domain-reachability",
        ],
        requiredEvidence: [
          "app-auth-provider-readiness-production-live-ready",
          "teacher-auth-provider-readiness-production-live-ready",
          "external-storage-service-readiness-production-live-ready",
          "vercel-production-deployment-evidence",
          "deployment-domain-reachability",
          "issued-teacher-auth-cookie-bound-to-ordinary-teaching-smokes",
          "live-teaching-operations-route-smoke",
          "live-teaching-operation-detail-browser-smoke",
          "live-teaching-course-management-route-smoke",
          "same-release-run-id-bound-to-ordinary-teaching-evidence",
          "same-vercel-production-deployment-bound-to-ordinary-teaching-smokes",
        ],
        currentEvidenceSummary: {
          teachingOperationsRouteSmokeStatus: "dry-run-blocked",
          operationDetailBrowserSmokeStatus: "dry-run-blocked",
          teachingCourseManagementRouteSmokeStatus: "dry-run-blocked",
          releaseRunIdStatus: "missing",
          teacherAuthBindingStatus: "missing",
          appAuthBindingStatus: "missing",
          externalStorageBindingStatus: "missing",
          vercelDeploymentBindingStatus: "missing",
          deploymentOriginStatus: "missing",
          operationDetailApiMode: "fixture-backed-contract",
          courseManagementBackend: "missing",
          courseAssetsBackend: "missing",
          teachingOperationsBackend: "missing",
          teacherAiOwnershipBackend: "missing",
        },
        releaseGateRequirementIds: [
          "teaching-operations-route-smoke",
          "teaching-operation-detail-browser-smoke",
          "teaching-course-management-route-smoke",
        ],
        enterpriseAuditMissingTargets: [
          "teaching-operations-route-smoke",
          "teaching-operation-detail-browser-smoke",
          "teaching-course-management-route-smoke",
        ],
        commands: expect.objectContaining({
          teachingOperationsRouteSmoke: "node scripts/teaching-operations-route-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <approved-env-file> --teacher-id <approved-smoke-teacher-id> --course-id <approved-smoke-course-id> --cookie <approved-teacher-auth-cookie> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --external-storage-service-readiness <external-storage-service-readiness-evidence> --teaching-operations-backend external --teaching-course-management-backend external > <teaching-operations-route-smoke-evidence>",
          operationDetailBrowserSmoke: "node scripts/teaching-operation-detail-browser-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <approved-env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --api-mode live-teaching-operations > <teaching-operation-detail-browser-smoke-evidence>",
          teachingCourseManagementRouteSmoke: "node scripts/teaching-course-management-route-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <approved-env-file> --teacher-id <approved-smoke-teacher-id> --other-teacher-id <approved-other-teacher-id> --student-id <approved-student-id> --cookie <approved-teacher-auth-cookie> --other-teacher-cookie <approved-other-teacher-auth-cookie> --student-cookie <approved-student-auth-cookie> --release-run-id <release-run-id> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --external-storage-service-readiness <external-storage-service-readiness-evidence> --teacher-ai-ownership-backend external --course-management-backend external --course-assets-backend external --teaching-operations-backend external > <teaching-course-management-route-smoke-evidence>",
        }),
        safety: {
          sourcePathsOmitted: true,
          deploymentUrlsOmitted: true,
          envValuesOmitted: true,
          cookieValuesOmitted: true,
          backendSecretValuesOmitted: true,
          responseBodiesOmitted: true,
          liveSmokePerformed: false,
          remoteMutationPerformed: false,
          providerSideEffectPerformed: false,
        },
      }),
    );
    expect(body.stopConditions).toEqual(
      expect.arrayContaining([
        "Stop if auth, storage, deployment, or reachability evidence is missing or not release-run-bound.",
        "Stop if issued teacher-auth cookies or approved smoke ids are unavailable.",
        "Stop if local or dry-run smoke evidence is being treated as production live evidence.",
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://private-ordinary-teaching.example.test");
    expect(output).not.toContain("secret-ordinary-teaching-backend-token");
    expect(output).not.toContain("secret-response-body");
    expect(output).not.toContain("uais_teacher_auth_claims=claims");
    expect(output).not.toContain("uais_teacher_auth_signature=sig");
  });

  it("renders a markdown ordinary teaching packet for handoff", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ordinary-teaching-packet-md-"));
    const ownerChecklist = writeJson(tmpDir, "owner-checklist.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      decisions: [
        {
          id: "ordinary-teaching-production-evidence",
          status: "waiting-for-live-evidence",
          blockedReasons: ["teaching-operations-route-smoke-not-live-passed"],
          safeNextActions: ["confirm-ordinary-teaching-live-smoke-prerequisites"],
          forbiddenUntilApproved: ["accept-local-production-smoke-as-production-live-evidence"],
          sequencing: "external-storage-and-auth-readiness-before-live-ordinary-teaching-smokes",
        },
      ],
    });
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      queue: [
        {
          id: "ordinary-teaching-production-evidence",
          rank: 5,
          nextOwnerQuestion: "Run ordinary-teaching live smokes only after auth, storage, and deployment evidence are ready.",
          releaseGateRequirementIds: ["teaching-operations-route-smoke"],
          enterpriseAuditMissingTargets: ["teaching-operations-route-smoke"],
          sequencing: "external-storage-and-auth-readiness-before-live-ordinary-teaching-smokes",
        },
      ],
    });
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      status: "blocked",
      requirements: [
        routeRequirement("teaching-operations-route-smoke", {
          blockedReason: "teaching-operations-route-smoke-not-live-passed",
        }),
      ],
    });

    const output = execFileSync("node", [
      "scripts/ordinary-teaching-production-evidence-action-packet.mjs",
      "--owner-checklist",
      ownerChecklist,
      "--owner-decision-queue",
      ownerQueue,
      "--release-gate",
      releaseGate,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("# UAIS Ordinary Teaching Production Evidence Action Packet");
    expect(output).toContain("Status: `waiting-for-live-evidence`");
    expect(output).toContain("Queue rank: 5");
    expect(output).toContain("`live-teaching-operations-route-smoke`");
    expect(output).toContain("Do not run ordinary-teaching live smokes until auth, storage, deployment, and reachability evidence are release-run-bound.");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });
});

function routeRequirement(id: string, options: { blockedReason: string; extra?: Record<string, unknown> }) {
  return {
    id,
    status: "blocked",
    evidenceStatus: "dry-run-blocked",
    blockedReason: options.blockedReason,
    evidenceEnvironment: "production",
    releaseRunIdStatus: "missing",
    teacherAuthProviderReadinessBinding: {
      status: "missing",
      releaseRunIdStatus: "missing",
      valueRedacted: true,
    },
    appAuthProviderReadinessBinding: {
      status: "missing",
      releaseRunIdStatus: "missing",
      valueRedacted: true,
    },
    externalStorageServiceReadinessEvidence: {
      status: "missing",
      releaseRunIdStatus: "missing",
      valueRedacted: true,
    },
    vercelProductionDeploymentBinding: {
      status: "missing",
      releaseRunIdStatus: "missing",
      valueRedacted: true,
    },
    deploymentOrigin: {
      status: "missing",
      originClass: "missing",
      valueRedacted: true,
    },
    safety: {
      valuesRedacted: "proved",
      cookieValuesOmitted: "proved",
      responseBodiesOmitted: "proved",
      liveRequiresApproval: "proved",
      remoteMutationRequiresApproval: "proved",
    },
    ...options.extra,
  };
}

function writeJson(tmpDir: string, filename: string, body: unknown) {
  const filePath = join(tmpDir, filename);
  writeFileSync(filePath, JSON.stringify(body, null, 2));
  return filePath;
}
