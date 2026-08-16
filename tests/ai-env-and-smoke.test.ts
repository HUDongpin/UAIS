import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDeploymentRouteSmokeGate,
  buildDeploymentReadinessGate,
  buildDeploymentEnvManifest,
  buildProviderSmokePlan,
  executeProviderSmoke,
} from "@/lib/ai/providers/smoke-plan";

const requiredEnvNames = [
  "UAIS_LIVE_AI_APPROVAL_TOKEN",
  "UAIS_AI_ACCESS_SIGNING_SECRET",
  "UAIS_TEACHER_AUTH_PROVIDER",
  "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
  "UAIS_TEACHER_AUTH_ISSUER_SECRET",
  "UAIS_TEACHER_AUTH_OIDC_ISSUER",
  "UAIS_TEACHER_AUTH_OIDC_AUDIENCE",
  "UAIS_TEACHER_AUTH_OIDC_JWKS_URL",
  "UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "DEEPSEEK_MODEL",
  "DASHSCOPE_API_KEY",
  "DASHSCOPE_BASE_URL",
  "QWEN_MULTIMODAL_MODEL",
  "QWEN_IMAGE_MODEL",
  "QWEN_TTS_MODEL",
];
const optionalServerOnlyEnvNames = [
  "UAIS_APP_SESSION_SIGNING_SECRET",
  "UAIS_APP_AUTH_PROVIDER",
  "UAIS_APP_AUTH_PROVIDER_URL",
  "UAIS_APP_AUTH_PROVIDER_TOKEN",
  "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
  "UAIS_TEACHER_AI_OWNERSHIP_DIR",
  "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND",
  "UAIS_TEACHING_OPERATIONS_BACKEND",
  "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
  "UAIS_TEACHING_COURSE_ASSETS_BACKEND",
  "UAIS_EXTERNAL_STORAGE_BASE_URL",
  "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
  "UAIS_EXTERNAL_STORAGE_SERVICE_MODE",
  "UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR",
  "UAIS_EXTERNAL_STORAGE_DATA_DIR",
  "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS",
  "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS",
  "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY",
  "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL",
  "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER",
  "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_URL",
  "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN",
  "UAIS_COLLABORATION_INVITE_EMAIL_CALLBACK_TOKEN",
  "UAIS_STUDENT_ROSTER_SYNC_PROVIDER",
  "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_URL",
  "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_TOKEN",
  "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER",
  "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_URL",
  "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_TOKEN",
  "UAIS_GRADEBOOK_RELEASE_PROVIDER",
  "UAIS_GRADEBOOK_RELEASE_PROVIDER_URL",
  "UAIS_GRADEBOOK_RELEASE_PROVIDER_TOKEN",
  "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER",
  "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_URL",
  "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_TOKEN",
  "UAIS_COURSE_EXPORT_PROVIDER",
  "UAIS_COURSE_EXPORT_PROVIDER_URL",
  "UAIS_COURSE_EXPORT_PROVIDER_TOKEN",
  "UAIS_GRADING_FEEDBACK_PROVIDER",
  "UAIS_GRADING_FEEDBACK_PROVIDER_URL",
  "UAIS_GRADING_FEEDBACK_PROVIDER_TOKEN",
];
const ordinaryTeachingProviderEnvFixtureLines = [
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
];

describe("UAIS AI environment and provider smoke plan", () => {
  it("documents required provider variables without real secret values", () => {
    const template = readFileSync(join(process.cwd(), ".env.local.example"), "utf8");

    for (const envName of requiredEnvNames) {
      expect(template).toMatch(new RegExp(`^${envName}=`, "m"));
    }
    for (const envName of optionalServerOnlyEnvNames) {
      expect(template).toMatch(new RegExp(`^${envName}=`, "m"));
    }

    for (const envName of [
      "UAIS_LIVE_AI_APPROVAL_TOKEN",
      "UAIS_AI_ACCESS_SIGNING_SECRET",
      "UAIS_TEACHER_AUTH_PROVIDER",
      "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
      "UAIS_TEACHER_AUTH_ISSUER_SECRET",
      "UAIS_TEACHER_AUTH_OIDC_ISSUER",
      "UAIS_TEACHER_AUTH_OIDC_AUDIENCE",
      "UAIS_TEACHER_AUTH_OIDC_JWKS_URL",
      "UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM",
      "UAIS_APP_SESSION_SIGNING_SECRET",
      "UAIS_APP_AUTH_PROVIDER",
      "UAIS_APP_AUTH_PROVIDER_URL",
      "UAIS_APP_AUTH_PROVIDER_TOKEN",
      "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
      "UAIS_TEACHER_AI_OWNERSHIP_DIR",
      "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND",
      "UAIS_TEACHING_OPERATIONS_BACKEND",
      "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
      "UAIS_TEACHING_COURSE_ASSETS_BACKEND",
      "DEEPSEEK_API_KEY",
      "DASHSCOPE_API_KEY",
      "UAIS_EXTERNAL_STORAGE_SERVICE_MODE",
      "UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR",
      "UAIS_EXTERNAL_STORAGE_DATA_DIR",
      "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS",
      "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS",
      "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY",
      "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL",
      "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER",
      "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_URL",
      "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN",
      "UAIS_COLLABORATION_INVITE_EMAIL_CALLBACK_TOKEN",
      "UAIS_STUDENT_ROSTER_SYNC_PROVIDER",
      "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_URL",
      "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_TOKEN",
      "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER",
      "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_URL",
      "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_TOKEN",
      "UAIS_GRADEBOOK_RELEASE_PROVIDER",
      "UAIS_GRADEBOOK_RELEASE_PROVIDER_URL",
      "UAIS_GRADEBOOK_RELEASE_PROVIDER_TOKEN",
      "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER",
      "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_URL",
      "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_TOKEN",
      "UAIS_COURSE_EXPORT_PROVIDER",
      "UAIS_COURSE_EXPORT_PROVIDER_URL",
      "UAIS_COURSE_EXPORT_PROVIDER_TOKEN",
      "UAIS_GRADING_FEEDBACK_PROVIDER",
      "UAIS_GRADING_FEEDBACK_PROVIDER_URL",
      "UAIS_GRADING_FEEDBACK_PROVIDER_TOKEN",
    ]) {
      const line = template
        .split("\n")
        .find((candidate) => candidate.startsWith(`${envName}=`));
      expect(line).toBe(`${envName}=`);
    }

    expect(template).not.toMatch(/NEXT_PUBLIC_.*(?:API_KEY|TOKEN|SECRET)/);
    expect(template).not.toMatch(/sk-[A-Za-z0-9]/);
  });

  it("builds a deployment env manifest for Vercel without exposing secret values", () => {
    const manifest = buildDeploymentEnvManifest({
      env: {
        UAIS_LIVE_AI_APPROVAL_TOKEN: "secret-live-token",
        UAIS_AI_ACCESS_SIGNING_SECRET: "secret-signed-session",
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: "secret-teacher-auth-session",
        DEEPSEEK_API_KEY: "secret-deepseek",
        DASHSCOPE_API_KEY: "secret-qwen",
        QWEN_TTS_MODEL: "qwen3-tts-vc-realtime-2026-01-15",
      },
    });

    expect(manifest.target).toBe("vercel");
    expect(manifest.responsibleSession).toBe("S19");
    expect(manifest.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "UAIS_LIVE_AI_APPROVAL_TOKEN",
          provider: "uais",
          valueType: "secret",
          status: "present",
          vercelTargets: ["production", "preview"],
          serverOnly: true,
        }),
        expect.objectContaining({
          name: "UAIS_AI_ACCESS_SIGNING_SECRET",
          provider: "uais",
          valueType: "secret",
          status: "present",
          vercelTargets: ["production", "preview"],
          serverOnly: true,
        }),
        expect.objectContaining({
          name: "UAIS_TEACHER_AUTH_PROVIDER",
          provider: "uais",
          valueType: "auth-provider",
          status: "missing",
          vercelTargets: ["production", "preview"],
          serverOnly: true,
        }),
        expect.objectContaining({
          name: "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
          provider: "uais",
          valueType: "secret",
          status: "present",
          vercelTargets: ["production", "preview"],
          serverOnly: true,
        }),
        expect.objectContaining({
          name: "UAIS_TEACHER_AUTH_ISSUER_SECRET",
          provider: "uais",
          valueType: "secret",
          status: "missing",
          vercelTargets: ["production", "preview"],
          serverOnly: true,
        }),
        expect.objectContaining({
          name: "UAIS_TEACHER_AUTH_OIDC_ISSUER",
          provider: "uais",
          valueType: "base-url",
          status: "missing",
          vercelTargets: ["production", "preview"],
          serverOnly: true,
        }),
        expect.objectContaining({
          name: "UAIS_TEACHER_AUTH_OIDC_AUDIENCE",
          provider: "uais",
          valueType: "auth-provider",
          status: "missing",
          vercelTargets: ["production", "preview"],
          serverOnly: true,
        }),
        expect.objectContaining({
          name: "UAIS_TEACHER_AUTH_OIDC_JWKS_URL",
          provider: "uais",
          valueType: "base-url",
          status: "missing",
          vercelTargets: ["production", "preview"],
          serverOnly: true,
        }),
        expect.objectContaining({
          name: "UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM",
          provider: "uais",
          valueType: "auth-provider",
          status: "missing",
          vercelTargets: ["production", "preview"],
          serverOnly: true,
        }),
        expect.objectContaining({
          name: "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
          provider: "uais",
          valueType: "storage-backend",
          status: "missing",
          vercelTargets: ["production", "preview"],
          serverOnly: true,
        }),
        expect.objectContaining({
          name: "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND",
          provider: "uais",
          valueType: "storage-backend",
          status: "missing",
          vercelTargets: ["production", "preview"],
          serverOnly: true,
        }),
        expect.objectContaining({
          name: "UAIS_EXTERNAL_STORAGE_BASE_URL",
          provider: "uais",
          valueType: "base-url",
          status: "missing",
          vercelTargets: ["production", "preview"],
          serverOnly: true,
        }),
        expect.objectContaining({
          name: "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
          provider: "uais",
          valueType: "secret",
          status: "missing",
          vercelTargets: ["production", "preview"],
          serverOnly: true,
        }),
        expect.objectContaining({
          name: "UAIS_EXTERNAL_STORAGE_SERVICE_MODE",
          provider: "uais",
          roles: [],
          valueType: "service-mode",
          status: "missing",
          vercelTargets: ["production", "preview"],
          serverOnly: true,
        }),
        expect.objectContaining({
          name: "UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR",
          provider: "uais",
          roles: [],
          valueType: "storage-path",
          status: "missing",
          vercelTargets: ["production", "preview"],
          serverOnly: true,
        }),
        expect.objectContaining({
          name: "UAIS_EXTERNAL_STORAGE_DATA_DIR",
          provider: "uais",
          roles: [],
          valueType: "storage-path",
          status: "missing",
          vercelTargets: ["production", "preview"],
          serverOnly: true,
        }),
        expect.objectContaining({
          name: "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS",
          provider: "uais",
          roles: [],
          valueType: "database-adapter-proof",
          status: "missing",
          vercelTargets: ["production", "preview"],
          serverOnly: true,
        }),
        expect.objectContaining({
          name: "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS",
          provider: "uais",
          roles: [],
          valueType: "database-adapter-proof",
          status: "missing",
          vercelTargets: ["production", "preview"],
          serverOnly: true,
        }),
        expect.objectContaining({
          name: "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY",
          provider: "uais",
          roles: [],
          valueType: "database-adapter-proof",
          status: "missing",
          vercelTargets: ["production", "preview"],
          serverOnly: true,
        }),
        expect.objectContaining({
          name: "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL",
          provider: "uais",
          roles: [],
          valueType: "database-adapter-proof",
          status: "missing",
          vercelTargets: ["production", "preview"],
          serverOnly: true,
        }),
        expect.objectContaining({
          name: "DEEPSEEK_API_KEY",
          provider: "deepseek",
          roles: ["text-reasoning"],
          valueType: "secret",
          status: "present",
          serverOnly: true,
        }),
        expect.objectContaining({
          name: "DASHSCOPE_API_KEY",
          provider: "qwen",
          roles: ["multimodal", "image-generation", "voice-clone", "ppt-narration"],
          valueType: "secret",
          status: "present",
          serverOnly: true,
        }),
        expect.objectContaining({
          name: "QWEN_TTS_MODEL",
          provider: "qwen",
          roles: ["voice-clone", "ppt-narration"],
          valueType: "model",
          status: "present",
          defaultValue: "qwen3-tts-vc-realtime-2026-01-15",
          serverOnly: true,
        }),
      ]),
    );
    expect(manifest.safety).toEqual({
      valuesRedacted: true,
      nextPublicForbidden: true,
      liveProviderApprovalRequired: true,
    });
    expect(JSON.stringify(manifest)).not.toContain("secret-live-token");
    expect(JSON.stringify(manifest)).not.toContain("secret-signed-session");
    expect(JSON.stringify(manifest)).not.toContain("secret-teacher-auth-session");
    expect(JSON.stringify(manifest)).not.toContain("secret-deepseek");
    expect(JSON.stringify(manifest)).not.toContain("secret-qwen");
  });

  it("builds a production live-AI deployment gate without exposing secret values", () => {
    const blockedGate = buildDeploymentReadinessGate({
      env: {
        DEEPSEEK_API_KEY: "secret-deepseek",
        NEXT_PUBLIC_DASHSCOPE_API_KEY: "secret-qwen-public-misconfig",
      },
    });

    expect(blockedGate.target).toBe("vercel");
    expect(blockedGate.status).toBe("blocked");
    expect(blockedGate.responsibleSession).toBe("S19");
    expect(blockedGate.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s19-live-approval-token",
          responsibleSession: "S19",
          status: "blocked",
          requiredEnv: "UAIS_LIVE_AI_APPROVAL_TOKEN",
        }),
        expect.objectContaining({
          id: "s19-qwen-env",
          responsibleSession: "S19",
          status: "blocked",
          requiredEnv: "DASHSCOPE_API_KEY",
        }),
        expect.objectContaining({
          id: "s19-ai-access-signing-secret",
          responsibleSession: "S19",
          status: "blocked",
          requiredEnv: "UAIS_AI_ACCESS_SIGNING_SECRET",
        }),
        expect.objectContaining({
          id: "s12-teacher-auth-provider",
          responsibleSession: "S12",
          status: "blocked",
          requiredEnv: "UAIS_TEACHER_AUTH_PROVIDER",
          authProviderContract: expect.objectContaining({
            selector: "missing",
            providerKind: "missing",
            adapterStatus: "not-configured",
            productionStatus: "blocked",
            blockedReason: "missing-UAIS_TEACHER_AUTH_PROVIDER",
          }),
        }),
        expect.objectContaining({
          id: "s19-teacher-auth-session-signing-secret",
          responsibleSession: "S19",
          status: "blocked",
          requiredEnv: "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
        }),
        expect.objectContaining({
          id: "s12-teacher-ownership-backend",
          responsibleSession: "S12",
          status: "blocked",
          requiredEnv: "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
        }),
        expect.objectContaining({
          id: "s24-voice-lifecycle-audit-backend",
          responsibleSession: "S24",
          status: "blocked",
          requiredEnv: "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND",
        }),
        expect.objectContaining({
          id: "s19-next-public-secret-scan",
          responsibleSession: "S19",
          status: "blocked",
        }),
      ]),
    );
    expect(blockedGate.blockedReasons).toEqual([
      "missing-UAIS_LIVE_AI_APPROVAL_TOKEN",
      "missing-UAIS_AI_ACCESS_SIGNING_SECRET",
      "missing-UAIS_TEACHER_AUTH_PROVIDER",
      "missing-UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
      "missing-UAIS_TEACHER_AUTH_ISSUER_SECRET",
      "non-durable-UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
      "missing-DASHSCOPE_API_KEY",
      "non-durable-UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND",
      "next-public-secret-env-present",
    ]);
    expect(JSON.stringify(blockedGate)).not.toContain("secret-deepseek");
    expect(JSON.stringify(blockedGate)).not.toContain("secret-qwen-public-misconfig");

    const ambiguousBackendGate = buildDeploymentReadinessGate({
      env: {
        UAIS_LIVE_AI_APPROVAL_TOKEN: "secret-live-token",
        UAIS_AI_ACCESS_SIGNING_SECRET: "secret-signed-session",
        UAIS_TEACHER_AUTH_PROVIDER: "local-signed-cookie",
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: "secret-teacher-auth-session",
        UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "durable",
        UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND: "durable",
        DEEPSEEK_API_KEY: "secret-deepseek",
        DASHSCOPE_API_KEY: "secret-qwen",
      },
    });

    expect(ambiguousBackendGate.status).toBe("blocked");
    expect(ambiguousBackendGate.blockedReasons).toEqual([
      "non-production-UAIS_TEACHER_AUTH_PROVIDER",
      "missing-UAIS_TEACHER_AUTH_ISSUER_SECRET",
      "unsupported-UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
      "unsupported-UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND",
    ]);
    expect(ambiguousBackendGate.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "s19-live-approval-token", status: "ready" }),
        expect.objectContaining({ id: "s19-ai-access-signing-secret", status: "ready" }),
        expect.objectContaining({
          id: "s12-teacher-auth-provider",
          status: "blocked",
          authProviderContract: expect.objectContaining({
            selector: "local-signed-cookie",
            providerKind: "local-signed-cookie",
            productionStatus: "blocked",
            blockedReason: "non-production-UAIS_TEACHER_AUTH_PROVIDER",
          }),
        }),
        expect.objectContaining({
          id: "s19-teacher-auth-session-signing-secret",
          status: "ready",
        }),
        expect.objectContaining({
          id: "s12-teacher-ownership-backend",
          status: "blocked",
          backendContract: expect.objectContaining({
            selector: "durable",
            durability: "unknown",
            adapterStatus: "unsupported",
            productionStatus: "blocked",
          }),
        }),
        expect.objectContaining({
          id: "s24-voice-lifecycle-audit-backend",
          status: "blocked",
          backendContract: expect.objectContaining({
            selector: "durable",
            durability: "unknown",
            adapterStatus: "unsupported",
            productionStatus: "blocked",
          }),
        }),
        expect.objectContaining({ id: "s19-deepseek-env", status: "ready" }),
        expect.objectContaining({ id: "s19-qwen-env", status: "ready" }),
        expect.objectContaining({ id: "s19-next-public-secret-scan", status: "ready" }),
      ]),
    );
    expect(JSON.stringify(ambiguousBackendGate)).not.toContain("secret-live-token");
    expect(JSON.stringify(ambiguousBackendGate)).not.toContain("secret-signed-session");
    expect(JSON.stringify(ambiguousBackendGate)).not.toContain(
      "secret-teacher-auth-session",
    );
    expect(JSON.stringify(ambiguousBackendGate)).not.toContain("secret-deepseek");
    expect(JSON.stringify(ambiguousBackendGate)).not.toContain("secret-qwen");

    const externalBackendGate = buildDeploymentReadinessGate({
      env: {
        UAIS_LIVE_AI_APPROVAL_TOKEN: "secret-live-token",
        UAIS_AI_ACCESS_SIGNING_SECRET: "secret-signed-session",
        UAIS_TEACHER_AUTH_PROVIDER: "trusted-cookie-issuer",
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: "secret-teacher-auth-session",
        UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "external",
        UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND: "external",
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: "secret-external-storage-token-strong-fixture",
        DEEPSEEK_API_KEY: "secret-deepseek",
        DASHSCOPE_API_KEY: "secret-qwen",
      },
    });

    expect(externalBackendGate.status).toBe("blocked");
    expect(externalBackendGate.blockedReasons).toEqual([
      "missing-UAIS_TEACHER_AUTH_ISSUER_SECRET",
    ]);
    expect(externalBackendGate.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s12-teacher-auth-provider",
          status: "blocked",
          authProviderContract: expect.objectContaining({
            selector: "trusted-cookie-issuer",
            providerKind: "trusted-cookie-issuer",
            adapterStatus: "implemented",
            productionStatus: "blocked",
            blockedReason: "missing-UAIS_TEACHER_AUTH_ISSUER_SECRET",
            requiredEnv: expect.arrayContaining([
              {
                name: "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
                status: "present",
              },
              {
                name: "UAIS_TEACHER_AUTH_ISSUER_SECRET",
                status: "missing",
              },
            ]),
          }),
        }),
      ]),
    );
    expect(JSON.stringify(externalBackendGate)).not.toContain("secret-teacher-auth-session");

    const weakTrustedTeacherAuthGate = buildDeploymentReadinessGate({
      env: {
        UAIS_LIVE_AI_APPROVAL_TOKEN: "secret-live-token",
        UAIS_AI_ACCESS_SIGNING_SECRET: "secret-signed-session",
        UAIS_TEACHER_AUTH_PROVIDER: "trusted-cookie-issuer",
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: "short-session-secret",
        UAIS_TEACHER_AUTH_ISSUER_SECRET: "short-issuer-secret",
        UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "external",
        UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND: "external",
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: "secret-external-storage-token-strong-fixture",
        DEEPSEEK_API_KEY: "secret-deepseek",
        DASHSCOPE_API_KEY: "secret-qwen",
      },
    });

    expect(weakTrustedTeacherAuthGate.status).toBe("blocked");
    expect(weakTrustedTeacherAuthGate.blockedReasons).toContain(
      "weak-UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
    );
    expect(weakTrustedTeacherAuthGate.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s12-teacher-auth-provider",
          status: "blocked",
          authProviderContract: expect.objectContaining({
            selector: "trusted-cookie-issuer",
            providerKind: "trusted-cookie-issuer",
            productionStatus: "blocked",
            blockedReason: "weak-UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
            secretStrength: {
              minimumLength: 32,
              valuesRedacted: true,
              checks: [
                {
                  name: "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
                  status: "weak",
                  valueRedacted: true,
                },
                {
                  name: "UAIS_TEACHER_AUTH_ISSUER_SECRET",
                  status: "weak",
                  valueRedacted: true,
                },
              ],
            },
          }),
        }),
      ]),
    );
    expect(JSON.stringify(weakTrustedTeacherAuthGate)).not.toContain("short-session-secret");
    expect(JSON.stringify(weakTrustedTeacherAuthGate)).not.toContain("short-issuer-secret");

    const sharedTrustedTeacherAuthSecretGate = buildDeploymentReadinessGate({
      env: {
        UAIS_LIVE_AI_APPROVAL_TOKEN: "secret-live-token",
        UAIS_AI_ACCESS_SIGNING_SECRET: "secret-signed-session",
        UAIS_TEACHER_AUTH_PROVIDER: "trusted-cookie-issuer",
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET:
          "secret-shared-teacher-auth-fixture-strong-enough",
        UAIS_TEACHER_AUTH_ISSUER_SECRET:
          "secret-shared-teacher-auth-fixture-strong-enough",
        UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "external",
        UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND: "external",
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN:
          "secret-external-storage-token-strong-fixture",
        DEEPSEEK_API_KEY: "secret-deepseek",
        DASHSCOPE_API_KEY: "secret-qwen",
      },
    });

    expect(sharedTrustedTeacherAuthSecretGate.status).toBe("blocked");
    expect(sharedTrustedTeacherAuthSecretGate.blockedReasons).toContain(
      "shared-UAIS_TEACHER_AUTH_SESSION_AND_ISSUER_SECRET",
    );
    expect(sharedTrustedTeacherAuthSecretGate.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s12-teacher-auth-provider",
          status: "blocked",
          authProviderContract: expect.objectContaining({
            selector: "trusted-cookie-issuer",
            providerKind: "trusted-cookie-issuer",
            productionStatus: "blocked",
            blockedReason: "shared-UAIS_TEACHER_AUTH_SESSION_AND_ISSUER_SECRET",
            trustedIssuerSeparation: {
              sessionIssuerSecretSeparation: "missing",
              valueRedacted: true,
            },
          }),
        }),
      ]),
    );
    expect(JSON.stringify(sharedTrustedTeacherAuthSecretGate)).not.toContain(
      "secret-shared-teacher-auth-fixture-strong-enough",
    );

    const connectedExternalBackendGate = buildDeploymentReadinessGate({
      env: {
        UAIS_LIVE_AI_APPROVAL_TOKEN: "secret-live-token",
        UAIS_AI_ACCESS_SIGNING_SECRET: "secret-signed-session",
        UAIS_TEACHER_AUTH_PROVIDER: "trusted-cookie-issuer",
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: "secret-teacher-auth-session-strong-fixture",
        UAIS_TEACHER_AUTH_ISSUER_SECRET: "secret-teacher-auth-issuer-strong-fixture",
        UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "external",
        UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND: "external",
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: "secret-external-storage-token-strong-fixture",
        DEEPSEEK_API_KEY: "secret-deepseek",
        DASHSCOPE_API_KEY: "secret-qwen",
      },
    });

    expect(connectedExternalBackendGate.status).toBe("ready");
    expect(connectedExternalBackendGate.blockedReasons).toEqual([]);
    expect(connectedExternalBackendGate.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s12-teacher-auth-provider",
          status: "ready",
          authProviderContract: expect.objectContaining({
            selector: "trusted-cookie-issuer",
            providerKind: "trusted-cookie-issuer",
            adapterStatus: "implemented",
            productionStatus: "ready",
            requiredEnv: [
              {
                name: "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
                status: "present",
              },
              {
                name: "UAIS_TEACHER_AUTH_ISSUER_SECRET",
                status: "present",
              },
            ],
          }),
        }),
        expect.objectContaining({
          id: "s12-teacher-ownership-backend",
          status: "ready",
          backendContract: expect.objectContaining({
            selector: "external",
            backendKind: "external",
            durability: "durable",
            adapterStatus: "implemented",
            productionStatus: "ready",
            requiredEnv: [
              {
                name: "UAIS_EXTERNAL_STORAGE_BASE_URL",
                status: "present",
              },
              {
                name: "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
                status: "present",
              },
            ],
          }),
        }),
        expect.objectContaining({
          id: "s24-voice-lifecycle-audit-backend",
          status: "ready",
          backendContract: expect.objectContaining({
            selector: "external",
            backendKind: "external",
            durability: "durable",
            adapterStatus: "implemented",
            productionStatus: "ready",
          }),
        }),
      ]),
    );
    expect(JSON.stringify(externalBackendGate)).not.toContain("secret-external-storage-token");
    expect(JSON.stringify(externalBackendGate)).not.toContain("storage.example.test");

    const weakExternalStorageTokenGate = buildDeploymentReadinessGate({
      env: {
        UAIS_LIVE_AI_APPROVAL_TOKEN: "secret-live-token",
        UAIS_AI_ACCESS_SIGNING_SECRET: "secret-signed-session",
        UAIS_TEACHER_AUTH_PROVIDER: "trusted-cookie-issuer",
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: "secret-teacher-auth-session-strong-fixture",
        UAIS_TEACHER_AUTH_ISSUER_SECRET: "secret-teacher-auth-issuer-strong-fixture",
        UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "external",
        UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND: "external",
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: "tiny-storage-token",
        DEEPSEEK_API_KEY: "secret-deepseek",
        DASHSCOPE_API_KEY: "secret-qwen",
      },
    });

    expect(weakExternalStorageTokenGate.status).toBe("blocked");
    expect(weakExternalStorageTokenGate.blockedReasons).toEqual([
      "weak-external-storage-token-UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
      "weak-external-storage-token-UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND",
    ]);
    expect(weakExternalStorageTokenGate.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s12-teacher-ownership-backend",
          status: "blocked",
          backendContract: expect.objectContaining({
            selector: "external",
            backendKind: "external",
            productionStatus: "blocked",
            blockedReason: "weak-external-storage-token-UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
            secretStrength: {
              minimumLength: 32,
              valuesRedacted: true,
              checks: [
                {
                  name: "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
                  status: "weak",
                  valueRedacted: true,
                },
              ],
            },
          }),
        }),
        expect.objectContaining({
          id: "s24-voice-lifecycle-audit-backend",
          status: "blocked",
          backendContract: expect.objectContaining({
            selector: "external",
            backendKind: "external",
            productionStatus: "blocked",
            blockedReason: "weak-external-storage-token-UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND",
            secretStrength: {
              minimumLength: 32,
              valuesRedacted: true,
              checks: [
                {
                  name: "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
                  status: "weak",
                  valueRedacted: true,
                },
              ],
            },
          }),
        }),
      ]),
    );
    expect(JSON.stringify(weakExternalStorageTokenGate)).not.toContain("tiny-storage-token");
    expect(JSON.stringify(weakExternalStorageTokenGate)).not.toContain("storage.example.test");

    const blockedOidcTeacherAuthGate = buildDeploymentReadinessGate({
      env: {
        UAIS_LIVE_AI_APPROVAL_TOKEN: "secret-live-token",
        UAIS_AI_ACCESS_SIGNING_SECRET: "secret-signed-session",
        UAIS_TEACHER_AUTH_PROVIDER: "oidc-jwks",
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: "secret-teacher-auth-session-strong-fixture",
        UAIS_TEACHER_AUTH_OIDC_ISSUER: "https://identity.example.test",
        UAIS_TEACHER_AUTH_OIDC_AUDIENCE: "uais-teacher-workflow",
        UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM: "email",
        UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "external",
        UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND: "external",
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: "secret-external-storage-token-strong-fixture",
        DEEPSEEK_API_KEY: "secret-deepseek",
        DASHSCOPE_API_KEY: "secret-qwen",
      },
    });

    expect(blockedOidcTeacherAuthGate.status).toBe("blocked");
    expect(blockedOidcTeacherAuthGate.blockedReasons).toContain(
      "missing-UAIS_TEACHER_AUTH_OIDC_JWKS_URL",
    );
    expect(blockedOidcTeacherAuthGate.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s12-teacher-auth-provider",
          status: "blocked",
          authProviderContract: expect.objectContaining({
            selector: "oidc-jwks",
            providerKind: "oidc-jwks",
            adapterStatus: "implemented",
            productionStatus: "blocked",
            blockedReason: "missing-UAIS_TEACHER_AUTH_OIDC_JWKS_URL",
            requiredEnv: expect.arrayContaining([
              {
                name: "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
                status: "present",
              },
              {
                name: "UAIS_TEACHER_AUTH_OIDC_ISSUER",
                status: "present",
              },
              {
                name: "UAIS_TEACHER_AUTH_OIDC_AUDIENCE",
                status: "present",
              },
              {
                name: "UAIS_TEACHER_AUTH_OIDC_JWKS_URL",
                status: "missing",
              },
              {
                name: "UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM",
                status: "present",
              },
            ]),
          }),
        }),
      ]),
    );

    const weakOidcTeacherAuthGate = buildDeploymentReadinessGate({
      env: {
        UAIS_LIVE_AI_APPROVAL_TOKEN: "secret-live-token",
        UAIS_AI_ACCESS_SIGNING_SECRET: "secret-signed-session",
        UAIS_TEACHER_AUTH_PROVIDER: "oidc-jwks",
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: "short-oidc-session-secret",
        UAIS_TEACHER_AUTH_OIDC_ISSUER: "https://identity.example.test",
        UAIS_TEACHER_AUTH_OIDC_AUDIENCE: "uais-teacher-workflow",
        UAIS_TEACHER_AUTH_OIDC_JWKS_URL: "https://identity.example.test/.well-known/jwks.json",
        UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM: "email",
        UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "external",
        UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND: "external",
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: "secret-external-storage-token-strong-fixture",
        DEEPSEEK_API_KEY: "secret-deepseek",
        DASHSCOPE_API_KEY: "secret-qwen",
      },
    });

    expect(weakOidcTeacherAuthGate.status).toBe("blocked");
    expect(weakOidcTeacherAuthGate.blockedReasons).toContain(
      "weak-UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
    );
    expect(weakOidcTeacherAuthGate.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s12-teacher-auth-provider",
          status: "blocked",
          authProviderContract: expect.objectContaining({
            selector: "oidc-jwks",
            providerKind: "oidc-jwks",
            productionStatus: "blocked",
            blockedReason: "weak-UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
            endpointSecurity: {
              issuer: "remote-https",
              jwks: "remote-https",
            },
            secretStrength: {
              minimumLength: 32,
              valuesRedacted: true,
              checks: [
                {
                  name: "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
                  status: "weak",
                  valueRedacted: true,
                },
              ],
            },
          }),
        }),
      ]),
    );
    expect(JSON.stringify(weakOidcTeacherAuthGate)).not.toContain("short-oidc-session-secret");
    expect(JSON.stringify(weakOidcTeacherAuthGate)).not.toContain("identity.example.test");

    const connectedOidcTeacherAuthGate = buildDeploymentReadinessGate({
      env: {
        UAIS_LIVE_AI_APPROVAL_TOKEN: "secret-live-token",
        UAIS_AI_ACCESS_SIGNING_SECRET: "secret-signed-session",
        UAIS_TEACHER_AUTH_PROVIDER: "oidc-jwks",
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: "secret-teacher-auth-session-strong-fixture",
        UAIS_TEACHER_AUTH_OIDC_ISSUER: "https://identity.example.test",
        UAIS_TEACHER_AUTH_OIDC_AUDIENCE: "uais-teacher-workflow",
        UAIS_TEACHER_AUTH_OIDC_JWKS_URL: "https://identity.example.test/.well-known/jwks.json",
        UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM: "email",
        UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "external",
        UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND: "external",
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: "secret-external-storage-token-strong-fixture",
        DEEPSEEK_API_KEY: "secret-deepseek",
        DASHSCOPE_API_KEY: "secret-qwen",
      },
    });

    expect(connectedOidcTeacherAuthGate.status).toBe("ready");
    expect(connectedOidcTeacherAuthGate.blockedReasons).toEqual([]);
    expect(connectedOidcTeacherAuthGate.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s12-teacher-auth-provider",
          status: "ready",
          authProviderContract: expect.objectContaining({
            selector: "oidc-jwks",
            providerKind: "oidc-jwks",
            adapterStatus: "implemented",
            productionStatus: "ready",
            requiredEnv: expect.arrayContaining([
              {
                name: "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
                status: "present",
              },
              {
                name: "UAIS_TEACHER_AUTH_OIDC_ISSUER",
                status: "present",
              },
              {
                name: "UAIS_TEACHER_AUTH_OIDC_AUDIENCE",
                status: "present",
              },
              {
                name: "UAIS_TEACHER_AUTH_OIDC_JWKS_URL",
                status: "present",
              },
              {
                name: "UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM",
                status: "present",
              },
            ]),
          }),
        }),
      ]),
    );
    expect(JSON.stringify(connectedOidcTeacherAuthGate)).not.toContain(
      "identity.example.test",
    );
    expect(JSON.stringify(connectedOidcTeacherAuthGate)).not.toContain(
      "uais-teacher-workflow",
    );

    const localOidcTeacherAuthGate = buildDeploymentReadinessGate({
      env: {
        UAIS_LIVE_AI_APPROVAL_TOKEN: "secret-live-token",
        UAIS_AI_ACCESS_SIGNING_SECRET: "secret-signed-session",
        UAIS_TEACHER_AUTH_PROVIDER: "oidc-jwks",
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: "secret-teacher-auth-session-strong-fixture",
        UAIS_TEACHER_AUTH_OIDC_ISSUER: "http://localhost:8787",
        UAIS_TEACHER_AUTH_OIDC_AUDIENCE: "uais-teacher-workflow",
        UAIS_TEACHER_AUTH_OIDC_JWKS_URL: "http://localhost:8787/.well-known/jwks.json",
        UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM: "email",
        UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "external",
        UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND: "external",
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: "secret-external-storage-token-strong-fixture",
        DEEPSEEK_API_KEY: "secret-deepseek",
        DASHSCOPE_API_KEY: "secret-qwen",
      },
    });

    expect(localOidcTeacherAuthGate.status).toBe("blocked");
    expect(localOidcTeacherAuthGate.blockedReasons).toContain(
      "non-production-UAIS_TEACHER_AUTH_OIDC_ENDPOINTS",
    );
    expect(localOidcTeacherAuthGate.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s12-teacher-auth-provider",
          status: "blocked",
          authProviderContract: expect.objectContaining({
            selector: "oidc-jwks",
            providerKind: "oidc-jwks",
            productionStatus: "blocked",
            blockedReason: "non-production-UAIS_TEACHER_AUTH_OIDC_ENDPOINTS",
            endpointSecurity: {
              issuer: "local-loopback",
              jwks: "local-loopback",
            },
          }),
        }),
      ]),
    );
    expect(JSON.stringify(localOidcTeacherAuthGate)).not.toContain("localhost");
    expect(JSON.stringify(localOidcTeacherAuthGate)).not.toContain("8787");
  });

  it("builds a dry-run smoke plan that reports readiness without exposing secrets", () => {
    const plan = buildProviderSmokePlan({
      env: {
        DEEPSEEK_API_KEY: "secret-deepseek",
        DASHSCOPE_API_KEY: undefined,
      },
    });

    expect(plan.mode).toBe("dry-run");
    expect(plan.network).toBe("disabled");
    expect(plan.checks).toEqual([
      {
        provider: "deepseek",
        requiredEnv: "DEEPSEEK_API_KEY",
        status: "present",
        roles: ["text-reasoning"],
        action: "verify-text-reasoning-contract",
      },
      {
        provider: "qwen",
        requiredEnv: "DASHSCOPE_API_KEY",
        status: "missing",
        roles: ["multimodal", "image-generation", "voice-clone", "ppt-narration"],
        action: "verify-multimodal-voice-ppt-contract",
      },
    ]);
    expect(plan.safety).toEqual({
      secretsRedacted: true,
      dryRunUsesNetwork: false,
      liveRequiresApproval: true,
    });
    expect(JSON.stringify(plan)).not.toContain("secret-deepseek");
    expect(JSON.stringify(plan)).not.toContain("secret-qwen");
  });

  it("includes protected route smoke checks for voice asset governance APIs", () => {
    const plan = buildProviderSmokePlan({
      env: {
        DEEPSEEK_API_KEY: "secret-deepseek",
        DASHSCOPE_API_KEY: "secret-qwen",
      },
    });

    expect(plan.routeChecks).toEqual(
      expect.arrayContaining([
        {
          id: "s22-retention-readiness-route",
          route: "/api/ai/voice-assets/retention-readiness",
          method: "GET",
          action: "verify-admin-retention-readiness-route",
          auth: "signed-admin-ai-access",
          expectedStatus: 200,
          responsibleSessions: ["S22", "S12", "S24"],
        },
        {
          id: "s22-voice-lifecycle-audit-route",
          route: "/api/ai/voice-clone/lifecycle-audit",
          method: "GET",
          action: "verify-admin-voice-lifecycle-audit-route",
          auth: "signed-admin-ai-access",
          expectedStatus: 200,
          responsibleSessions: ["S22", "S12", "S24"],
        },
        {
          id: "s22-ai-readiness-route",
          route: "/api/ai/readiness",
          method: "GET",
          action: "verify-admin-ai-readiness-route",
          auth: "signed-admin-ai-access",
          expectedStatus: 200,
          responsibleSessions: ["S22", "S12", "S19"],
        },
        {
          id: "s22-ai-smoke-plan-route",
          route: "/api/ai/smoke-plan",
          method: "GET",
          action: "verify-admin-ai-smoke-plan-route",
          auth: "signed-admin-ai-access",
          expectedStatus: 200,
          responsibleSessions: ["S22", "S12", "S19"],
        },
        {
          id: "s22-teacher-auth-issuer-route",
          route: "/api/ai/teacher-auth/issue",
          method: "POST",
          action: "verify-admin-teacher-auth-issuer-route",
          auth: "signed-admin-ai-access",
          expectedStatus: 200,
          responsibleSessions: ["S22", "S12", "S19"],
          requestBodyShape: "teacher-auth-session-issue",
          responseHeaderChecks: [
            "teacherAuthClaimsSetCookie",
            "teacherAuthSignatureSetCookie",
            "httpOnlySameSiteSecureMaxAge",
            "priorityHigh",
            "issuerProofBoundedMaxAge",
          ],
        },
        {
          id: "s22-teacher-ai-session-route",
          route: "/api/ai/session",
          method: "POST",
          action: "verify-issued-teacher-ai-session-route",
          auth: "issued-teacher-auth-cookie",
          expectedStatus: 200,
          responsibleSessions: ["S22", "S12", "S19"],
          requestBodyShape: "teacher-ai-session-issue",
          responseShapeChecks: [
            "accessSession",
            "accessPlan",
            "authProviderContract",
            "s12TeacherAiSessionBoundary",
            "signedContractDirectCallDenied",
          ],
        },
        {
          id: "s22-teacher-ownership-route",
          route: "/api/ai/teacher-ownership",
          method: "GET",
          action: "verify-issued-teacher-ownership-route",
          auth: "issued-teacher-auth-cookie",
          expectedStatus: 200,
          responsibleSessions: ["S22", "S12", "S24", "S19"],
          responseShapeChecks: [
            "ownership",
            "consistency",
            "s12TeacherOwnershipSummary",
          ],
        },
        {
          id: "s22-teacher-ppt-workflow-route",
          route: "/api/ai/teacher-ppt-workflow",
          method: "GET",
          action: "verify-signed-teacher-ppt-workflow-route",
          auth: "issued-teacher-auth-cookie",
          expectedStatus: 200,
          responsibleSessions: ["S22", "S12", "S24", "S19"],
          responseShapeChecks: [
            "workflow",
            "workflowReadyForDownloads",
            "workflowDownloadContract",
            "workflowAudioDownloadPattern",
            "workflowExportDownloadUrl",
            "agentHandoffPlan",
            "agentHandoffPlanFramework",
            "s22ReleaseSmokeAgent",
          ],
        },
      ]),
    );
    expect(JSON.stringify(plan.routeChecks)).not.toContain("secret-deepseek");
    expect(JSON.stringify(plan.routeChecks)).not.toContain("secret-qwen");
    expect(JSON.stringify(plan.routeChecks)).not.toContain("/Users/");
  });

  it("builds a deployment route smoke gate with redacted S19/S22 prerequisites", () => {
    const blockedGate = buildDeploymentRouteSmokeGate({
      env: {
        UAIS_AI_ACCESS_SIGNING_SECRET: "secret-ai-access-signing",
        DASHSCOPE_API_KEY: "secret-qwen",
      },
    });

    expect(blockedGate).toEqual(
      expect.objectContaining({
        target: "deployment-route-smoke",
        status: "blocked",
        responsibleSession: "S22",
        blockedReasons: [
          "missing-UAIS_DEPLOYMENT_BASE_URL",
          "missing-UAIS_TEACHER_AUTH_PROVIDER",
          "missing-UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
          "missing-UAIS_TEACHER_AUTH_ISSUER_SECRET",
        ],
      }),
    );
    expect(blockedGate.prerequisites).toEqual([
      {
        id: "s22-deployment-base-url",
        responsibleSession: "S22",
        requiredEnv: "UAIS_DEPLOYMENT_BASE_URL",
        status: "missing",
      },
      {
        id: "s19-ai-access-signing-secret",
        responsibleSession: "S19",
        requiredEnv: "UAIS_AI_ACCESS_SIGNING_SECRET",
        status: "present",
      },
      {
        id: "s12-teacher-auth-provider",
        responsibleSession: "S12",
        requiredEnv: "UAIS_TEACHER_AUTH_PROVIDER",
        status: "missing",
      },
      {
        id: "s19-teacher-auth-session-signing-secret",
        responsibleSession: "S19",
        requiredEnv: "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
        status: "missing",
      },
      {
        id: "s12-teacher-auth-issuer-secret",
        responsibleSession: "S12",
        requiredEnv: "UAIS_TEACHER_AUTH_ISSUER_SECRET",
        status: "missing",
      },
    ]);
    expect(blockedGate.routeChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s22-teacher-auth-issuer-route",
          route: "/api/ai/teacher-auth/issue",
          auth: "signed-admin-ai-access",
          requestBodyShape: "teacher-auth-session-issue",
          responseHeaderChecks: [
            "teacherAuthClaimsSetCookie",
            "teacherAuthSignatureSetCookie",
            "httpOnlySameSiteSecureMaxAge",
            "priorityHigh",
            "issuerProofBoundedMaxAge",
          ],
        }),
        expect.objectContaining({
          id: "s22-teacher-ownership-route",
          route: "/api/ai/teacher-ownership",
          auth: "issued-teacher-auth-cookie",
          responsibleSessions: ["S22", "S12", "S24", "S19"],
          responseShapeChecks: [
            "ownership",
            "consistency",
            "s12TeacherOwnershipSummary",
          ],
        }),
        expect.objectContaining({
          id: "s22-teacher-ai-session-route",
          route: "/api/ai/session",
          auth: "issued-teacher-auth-cookie",
          requestBodyShape: "teacher-ai-session-issue",
          responseShapeChecks: [
            "accessSession",
            "accessPlan",
            "authProviderContract",
            "s12TeacherAiSessionBoundary",
            "signedContractDirectCallDenied",
          ],
        }),
        expect.objectContaining({
          id: "s22-teacher-ppt-workflow-route",
          route: "/api/ai/teacher-ppt-workflow",
          auth: "issued-teacher-auth-cookie",
          responseShapeChecks: [
            "workflow",
            "workflowReadyForDownloads",
            "workflowDownloadContract",
            "workflowAudioDownloadPattern",
            "workflowExportDownloadUrl",
            "agentHandoffPlan",
            "agentHandoffPlanFramework",
            "s22ReleaseSmokeAgent",
          ],
        }),
      ]),
    );
    expect(blockedGate.safety).toEqual({
      secretsRedacted: true,
      valuesRedacted: true,
      signedAdminAccess: true,
      issuedTeacherAuthCookie: true,
      oidcBearerTokenOmitted: true,
      responseBodiesOmitted: true,
      liveRequiresApproval: true,
    });
    expect(JSON.stringify(blockedGate)).not.toContain("secret-ai-access-signing");
    expect(JSON.stringify(blockedGate)).not.toContain("secret-qwen");
    expect(JSON.stringify(blockedGate)).not.toContain("/Users/");

    const readyGate = buildDeploymentRouteSmokeGate({
      baseUrl: "https://preview.uais.top",
      env: {
        UAIS_AI_ACCESS_SIGNING_SECRET: "secret-ai-access-signing",
        UAIS_TEACHER_AUTH_PROVIDER: "trusted-cookie-issuer",
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: "secret-teacher-auth-session-strong-fixture",
        UAIS_TEACHER_AUTH_ISSUER_SECRET: "secret-teacher-auth-issuer-strong-fixture",
      },
    });

    expect(readyGate.status).toBe("ready");
    expect(readyGate.blockedReasons).toEqual([]);
    expect(readyGate.deploymentFingerprint).toEqual({
      status: "present",
      value: expect.stringMatching(/^sha256:[a-f0-9]{16}$/),
    });

    const oidcRouteSmokeGate = buildDeploymentRouteSmokeGate({
      baseUrl: "https://deployment.example.test",
      env: {
        UAIS_AI_ACCESS_SIGNING_SECRET: "secret-oidc-route-gate-signing",
        UAIS_TEACHER_AUTH_PROVIDER: "oidc-jwks",
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: "secret-oidc-route-gate-session-strong-fixture",
        UAIS_TEACHER_AUTH_OIDC_ISSUER: "https://identity.example.test",
        UAIS_TEACHER_AUTH_OIDC_AUDIENCE: "uais-teacher-workflow",
        UAIS_TEACHER_AUTH_OIDC_JWKS_URL:
          "https://identity.example.test/.well-known/jwks.json",
        UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM: "email",
        UAIS_TEACHER_AUTH_OIDC_SMOKE_BEARER_TOKEN: "secret-oidc-route-gate-token",
        UAIS_TEACHER_AUTH_OIDC_SMOKE_TEACHER_ID: "teacher-kang@example.test",
      },
    });

    expect(oidcRouteSmokeGate.status).toBe("ready");
    expect(oidcRouteSmokeGate.blockedReasons).toEqual([]);
    expect(oidcRouteSmokeGate.authProviderMode).toBe("oidc-jwks");
    expect(oidcRouteSmokeGate.prerequisites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s22-teacher-auth-oidc-smoke-token",
          requiredEnv: "UAIS_TEACHER_AUTH_OIDC_SMOKE_BEARER_TOKEN",
          status: "present",
        }),
        expect.objectContaining({
          id: "s22-teacher-auth-oidc-smoke-teacher-id",
          requiredEnv: "UAIS_TEACHER_AUTH_OIDC_SMOKE_TEACHER_ID",
          status: "present",
        }),
      ]),
    );
    expect(oidcRouteSmokeGate.routeChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s22-teacher-auth-issuer-route",
          auth: "oidc-jwks-bearer-token",
        }),
      ]),
    );
    expect(JSON.stringify(oidcRouteSmokeGate)).not.toContain("secret-oidc-route-gate");
    expect(JSON.stringify(oidcRouteSmokeGate)).not.toContain("identity.example.test");
    expect(JSON.stringify(oidcRouteSmokeGate)).not.toContain("uais-teacher-workflow");
  });

  it("requires explicit approval before planning a live provider smoke check", () => {
    expect(() =>
      buildProviderSmokePlan({
        mode: "live",
        env: {
          DEEPSEEK_API_KEY: "secret-deepseek",
          DASHSCOPE_API_KEY: "secret-qwen",
        },
      }),
    ).toThrow("explicit owner approval");
  });

  it("executes live provider smoke calls with redacted HTTP status only", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    let qwenResponse: Response | undefined;
    const results = await executeProviderSmoke({
      env: {
        DEEPSEEK_API_KEY: "secret-deepseek",
        DASHSCOPE_API_KEY: "secret-qwen",
      },
      liveApproved: true,
      fetch: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        if (String(url).includes("dashscope")) {
          qwenResponse = new Response(
            [
              `data: ${JSON.stringify({ choices: [{ delta: { content: "OK" } }] })}`,
              "data: [DONE]",
            ].join("\n\n"),
            { headers: { "Content-Type": "text/event-stream" } },
          );
          return qwenResponse;
        }
        return Response.json({ choices: [{ message: { content: "ok" } }] });
      },
    });

    expect(results).toEqual([
      {
        provider: "deepseek",
        status: "ok",
        httpStatus: 200,
        model: "deepseek-v4-flash",
      },
      {
        provider: "qwen",
        status: "ok",
        httpStatus: 200,
        model: "qwen3.5-omni-plus",
      },
    ]);
    expect(requests[0].url).toBe("https://api.deepseek.com/chat/completions");
    expect(requests[1].url).toBe(
      "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    );
    const deepseekRequestBody = JSON.parse(String(requests[0].init.body));
    const qwenRequestBody = JSON.parse(String(requests[1].init.body));
    expect(deepseekRequestBody.stream).toBe(false);
    expect(qwenRequestBody.stream).toBe(true);
    expect(qwenRequestBody.stream_options).toEqual({ include_usage: true });
    expect(qwenResponse?.bodyUsed).toBe(true);
    expect(JSON.stringify(results)).not.toContain("secret");
  });

  it("skips live provider smoke calls when credentials are missing", async () => {
    const results = await executeProviderSmoke({
      env: {},
      liveApproved: true,
      fetch: async () => {
        throw new Error("fetch should not be called");
      },
    });

    expect(results).toEqual([
      {
        provider: "deepseek",
        status: "skipped",
        reason: "missing-required-env",
      },
      {
        provider: "qwen",
        status: "skipped",
        reason: "missing-required-env",
      },
    ]);
  });

  it("runs the provider smoke CLI in dry-run mode without leaking env-file secrets", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ai-smoke-"));
    const envFile = join(tmpDir, "ai-provider-smoke.test.env");
    writeFileSync(
      envFile,
      [
        "DEEPSEEK_API_KEY=secret-deepseek-cli",
        "DASHSCOPE_API_KEY=secret-qwen-cli",
        "DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/ai-provider-smoke.mjs",
      "--dry-run",
      "--env-file",
      envFile,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.mode).toBe("dry-run");
    expect(body.network).toBe("disabled");
    expect(body.checks).toEqual([
      expect.objectContaining({
        provider: "deepseek",
        requiredEnv: "DEEPSEEK_API_KEY",
        status: "present",
      }),
      expect.objectContaining({
        provider: "qwen",
        requiredEnv: "DASHSCOPE_API_KEY",
        status: "present",
      }),
    ]);
    expect(output).not.toContain("secret-deepseek-cli");
    expect(output).not.toContain("secret-qwen-cli");
  });

  it("runs the provider smoke CLI in deployment-env mode without leaking env-file secrets", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ai-deploy-env-"));
    const envFile = join(tmpDir, "deployment-env.test.env");
    writeFileSync(
      envFile,
      [
        "UAIS_LIVE_AI_APPROVAL_TOKEN=secret-live-token-cli",
        "UAIS_AI_ACCESS_SIGNING_SECRET=secret-signed-session-cli",
        "UAIS_APP_SESSION_SIGNING_SECRET=secret-app-session-signing-token-32",
        "UAIS_APP_AUTH_PROVIDER=trusted-account-provider",
        "UAIS_APP_AUTH_PROVIDER_URL=https://app-auth-provider.example.test/session",
        "UAIS_APP_AUTH_PROVIDER_TOKEN=secret-app-auth-provider-token-32",
        "UAIS_TEACHER_AUTH_PROVIDER=trusted-cookie-issuer",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-teacher-auth-session-cli",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET=secret-teacher-auth-issuer-cli",
        "UAIS_TEACHER_AUTH_OIDC_ISSUER=https://identity.example.test",
        "UAIS_TEACHER_AUTH_OIDC_AUDIENCE=uais-teacher-workflow",
        "UAIS_TEACHER_AUTH_OIDC_JWKS_URL=https://identity.example.test/.well-known/jwks.json",
        "UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM=email",
        "UAIS_TEACHER_AI_OWNERSHIP_BACKEND=durable",
        "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND=durable",
        "UAIS_TEACHING_OPERATIONS_BACKEND=external",
        "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND=external",
        "UAIS_TEACHING_COURSE_ASSETS_BACKEND=external",
        "UAIS_EXTERNAL_STORAGE_BASE_URL=https://storage.example.test/uais",
        "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=secret-external-storage-cli",
        "UAIS_EXTERNAL_STORAGE_SERVICE_MODE=production",
        "UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR=/data/uais-external-storage",
        "UAIS_EXTERNAL_STORAGE_DATA_DIR=/data/uais-external-storage",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS=managed-database",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS=up-to-date",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY=point-in-time-restore",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL=transactional",
        "DEEPSEEK_API_KEY=secret-deepseek-cli",
        "DASHSCOPE_API_KEY=secret-qwen-cli",
        "QWEN_TTS_MODEL=qwen3-tts-vc-realtime-2026-01-15",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/ai-provider-smoke.mjs",
      "--deployment-env",
      "--env-file",
      envFile,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.target).toBe("vercel");
    expect(body.responsibleSession).toBe("S19");
    expect(body.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "UAIS_LIVE_AI_APPROVAL_TOKEN",
          valueType: "secret",
          status: "present",
        }),
        expect.objectContaining({
          name: "UAIS_TEACHER_AUTH_PROVIDER",
          provider: "uais",
          valueType: "auth-provider",
          status: "present",
        }),
        expect.objectContaining({
          name: "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
          valueType: "secret",
          status: "present",
        }),
        expect.objectContaining({
          name: "UAIS_AI_ACCESS_SIGNING_SECRET",
          valueType: "secret",
          status: "present",
        }),
        expect.objectContaining({
          name: "DASHSCOPE_API_KEY",
          provider: "qwen",
          status: "present",
        }),
        expect.objectContaining({
          name: "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
          provider: "uais",
          valueType: "storage-backend",
          status: "present",
        }),
        expect.objectContaining({
          name: "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND",
          provider: "uais",
          valueType: "storage-backend",
          status: "present",
        }),
        expect.objectContaining({
          name: "UAIS_EXTERNAL_STORAGE_BASE_URL",
          provider: "uais",
          valueType: "base-url",
          status: "present",
        }),
        expect.objectContaining({
          name: "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
          provider: "uais",
          valueType: "secret",
          status: "present",
        }),
      ]),
    );
    expect(output).not.toContain("secret-live-token-cli");
    expect(output).not.toContain("secret-signed-session-cli");
    expect(output).not.toContain("secret-teacher-auth-session-cli");
    expect(output).not.toContain("secret-teacher-auth-issuer-cli");
    expect(output).not.toContain("secret-external-storage-cli");
    expect(output).not.toContain("storage.example.test");
    expect(output).not.toContain("secret-deepseek-cli");
    expect(output).not.toContain("secret-qwen-cli");
  });

  it("runs the protected route smoke CLI with signed admin headers without leaking secrets", async () => {
    const requests: Array<{
      url: string | undefined;
      claimsHeader: string | undefined;
      signatureHeader: string | undefined;
      issuerClaimsHeader: string | undefined;
      issuerSignatureHeader: string | undefined;
      cookieHeader: string | undefined;
      actorIdHeader: string | undefined;
      actorRoleHeader: string | undefined;
      body: Record<string, unknown> | undefined;
    }> = [];
    const server = createServer(async (request, response) => {
      const claimsHeader = headerToString(request.headers["x-uais-access-claims"]);
      const signatureHeader = headerToString(request.headers["x-uais-access-signature"]);
      const issuerClaimsHeader = headerToString(
        request.headers["x-uais-teacher-auth-issuer-claims"],
      );
      const issuerSignatureHeader = headerToString(
        request.headers["x-uais-teacher-auth-issuer-signature"],
      );
      const cookieHeader = headerToString(request.headers.cookie);
      const actorIdHeader = headerToString(request.headers["x-uais-actor-id"]);
      const actorRoleHeader = headerToString(request.headers["x-uais-actor-role"]);
      const bodyText =
        request.method === "POST" ? await readBodyForTest(request) : "";
      const requestBody = bodyText
        ? JSON.parse(bodyText) as Record<string, unknown>
        : undefined;
      requests.push({
        url: request.url,
        claimsHeader,
        signatureHeader,
        issuerClaimsHeader,
        issuerSignatureHeader,
        cookieHeader,
        actorIdHeader,
        actorRoleHeader,
        body: requestBody,
      });
      const hasSignedAiAccess = Boolean(claimsHeader && signatureHeader);
      const authorized =
        request.url === "/api/ai/teacher-ppt-workflow" ||
        request.url === "/api/ai/session" ||
        request.url === "/api/ai/teacher-ownership"
          ? Boolean(cookieHeader?.includes("uais_teacher_auth_claims="))
          : request.url === "/api/ai/teacher-auth/issue"
            ? Boolean(
                claimsHeader &&
                  signatureHeader &&
                  issuerClaimsHeader &&
                  issuerSignatureHeader,
              )
          : hasSignedAiAccess;
      const signedSessionRequired =
        (isSignedSessionRequiredProbeRoute(request.url) && !hasSignedAiAccess) ||
        (request.url === "/api/ai/teacher-auth/issue" &&
          issuerClaimsHeader &&
          issuerSignatureHeader &&
          !claimsHeader &&
          !signatureHeader);
      const responseHeaders: Record<string, string | string[]> = {
        "content-type": "application/json",
      };
      if (authorized && request.url === "/api/ai/teacher-auth/issue") {
        responseHeaders["set-cookie"] = [
          "uais_teacher_auth_claims=redacted-claims; Path=/; HttpOnly; SameSite=Lax; Max-Age=300; Secure; Priority=High",
          "uais_teacher_auth_signature=redacted-signature; Path=/; HttpOnly; SameSite=Lax; Max-Age=300; Secure; Priority=High",
        ];
      }
      if (isTeacherCookieRouteForTest(request.url) && !authorized) {
        response.writeHead(401, responseHeaders);
        response.end(JSON.stringify(createAuthenticatedSessionRequiredBodyForTest()));
        return;
      }
      response.writeHead(authorized ? 200 : 403, responseHeaders);
      response.end(
        JSON.stringify(
          signedSessionRequired
            ? createSignedSessionRequiredBodyForTest()
            : request.url === "/api/ai/teacher-auth/issue"
            ? {
                teacherAuthSession: {
                  responsibleSession: "S12",
                  authProvider: "trusted-cookie-issuer",
                  authSource: "trusted-cookie-issuer",
                  authSessionRef: "server-side-auth-session",
                  cookieNames: ["uais_teacher_auth_claims", "uais_teacher_auth_signature"],
                  redaction: {
                    secrets: "omitted",
                    cookies: "headers-only",
                    sessionIds: "omitted",
                  },
                },
                authProviderContract: {
                  selector: "trusted-cookie-issuer",
                  providerKind: "trusted-cookie-issuer",
                  productionStatus: "ready",
                  redaction: {
                    values: "omitted",
                    cookies: "omitted",
                  },
                },
                progress: [
                  {
                    type: "s12-trusted-teacher-auth-issuer",
                    status: "issued",
                    responsibleSession: "S12",
                  },
                ],
                leakSentinel: "server-secret-should-not-leak",
              }
          : request.url === "/api/ai/session"
            ? {
                accessSession: {
                  headers: {
                    "x-uais-access-claims": "redacted-access-claims",
                    "x-uais-access-signature": "redacted-access-signature",
                  },
                  expiresAt: "2099-01-01T00:05:00.000Z",
                  leakSentinel: "server-secret-should-not-leak",
                },
                accessPlan: {
                  responsibleSession: "S12",
                  action: "ppt-narration-submit",
                  redaction: {
                    secrets: "omitted",
                    localFiles: "omitted",
                    assets: "ids-only",
                  },
                },
                authProviderContract: {
                  selector: "trusted-cookie-issuer",
                  providerKind: "trusted-cookie-issuer",
                  productionStatus: "ready",
                  redaction: {
                    values: "omitted",
                    cookies: "omitted",
                  },
                },
                progress: [
                  {
                    type: "s12-teacher-ai-session-boundary",
                    status: "issued",
                    responsibleSession: "S12",
                  },
                ],
              }
            : request.url === "/api/ai/teacher-ppt-workflow"
              ? {
                  workflow: {
                    status: "ready-for-downloads",
                    nextAction: "review-and-download-ppt-narration",
                    downloads: {
                      audioManifestId: "audio-manifest-research-methods-unit-3",
                      exportDownloadUrl:
                        "/api/ai/ppt-narration/export/audio-manifest-research-methods-unit-3",
                      audioDownloadPattern:
                        "/api/ai/ppt-narration/audio/audio-manifest-research-methods-unit-3/{audioId}",
                    },
                  },
                  agentHandoffPlan: {
                    framework: "openmaic-style-teacher-ppt-narration",
                    status: "ready-for-teacher-review",
                    handoffs: [
                      {
                        agentId: "s22-release-smoke-agent",
                        responsibleSession: "S22",
                        status: "pending",
                      },
                    ],
                    leakSentinel: "server-secret-should-not-leak",
                  },
                }
            : request.url === "/api/ai/teacher-ownership"
              ? {
                  ownership: {
                    teacherId: "s22-route-smoke-teacher",
                    storagePolicy: "server-side-redacted-teacher-ai-ownership-summary",
                  },
                  consistency: {
                    status: "ready",
                    responsibleSession: "S12/S24",
                  },
                  progress: [
                    {
                      type: "s12-teacher-ownership-auth-boundary",
                      status: "ready",
                      responsibleSession: "S12",
                    },
                  ],
                }
            : { ok: true, secret: "server-secret-should-not-leak" },
        ),
      );
    });
    const baseUrl = await listenForTest(server);
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-route-smoke-"));
    const envFile = join(tmpDir, "route-smoke.test.env");
    writeFileSync(
      envFile,
      [
        "UAIS_AI_ACCESS_SIGNING_SECRET=secret-route-smoke-cli",
        "UAIS_TEACHER_AUTH_PROVIDER=trusted-cookie-issuer",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-teacher-route-smoke-cli",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET=secret-teacher-issuer-route-smoke-cli",
        "DEEPSEEK_API_KEY=secret-deepseek-route-cli",
        "DASHSCOPE_API_KEY=secret-qwen-route-cli",
      ].join("\n"),
    );

    try {
      const output = await execFileForTest("node", [
        "scripts/ai-route-smoke.mjs",
        "--live",
        "--approved",
        "--environment",
        "local-production",
        "--base-url",
        baseUrl,
        "--env-file",
        envFile,
      ]);
      const body = JSON.parse(output);

      expect(body.mode).toBe("live");
      expect(body.environment).toBe("local-production");
      expect(body.network).toBe("enabled");
      expect(body.responsibleSession).toBe("S22");
      expect(
        requests.find((request) => request.url === "/api/ai/teacher-auth/issue")?.body,
      ).toEqual(expect.objectContaining({ teacherId: "teacher-kang" }));
      expect(
        requests.find((request) => request.url === "/api/ai/session")?.body?.resource,
      ).toEqual(expect.objectContaining({ teacherId: "s22-route-smoke-teacher" }));
      expect(body.results).toEqual([
        expect.objectContaining({
          id: "s22-retention-readiness-route",
          route: "/api/ai/voice-assets/retention-readiness",
          status: "ok",
          httpStatus: 200,
          responsibleSessions: ["S22", "S12", "S24"],
        }),
        expect.objectContaining({
          id: "s22-voice-lifecycle-audit-route",
          route: "/api/ai/voice-clone/lifecycle-audit",
          status: "ok",
          httpStatus: 200,
          responsibleSessions: ["S22", "S12", "S24"],
        }),
        expect.objectContaining({
          id: "s22-ai-readiness-route",
          route: "/api/ai/readiness",
          status: "ok",
          httpStatus: 200,
          responsibleSessions: ["S22", "S12", "S19"],
        }),
        expect.objectContaining({
          id: "s22-ai-smoke-plan-route",
          route: "/api/ai/smoke-plan",
          status: "ok",
          httpStatus: 200,
          responsibleSessions: ["S22", "S12", "S19"],
        }),
        expect.objectContaining({
          id: "s22-teacher-auth-issuer-route",
          route: "/api/ai/teacher-auth/issue",
          status: "ok",
          httpStatus: 200,
          responsibleSessions: ["S22", "S12", "S19"],
          requestBodyShape: "teacher-auth-session-issue",
          responseHeaderChecks: [
            "teacherAuthClaimsSetCookie",
            "teacherAuthSignatureSetCookie",
            "httpOnlySameSiteSecureMaxAge",
            "priorityHigh",
            "issuerProofBoundedMaxAge",
          ],
          responseShapeChecks: [
            "teacherAuthSession",
            "authProviderContract",
            "s12TeacherAuthIssuerBoundary",
            "signedContractDirectCallDenied",
          ],
          responseHeaders: {
            checked: true,
            status: "ok",
            requiredHeaders: {
              teacherAuthClaimsSetCookie: "present",
              teacherAuthSignatureSetCookie: "present",
              httpOnlySameSiteSecureMaxAge: "present",
              priorityHigh: "present",
              issuerProofBoundedMaxAge: "present",
            },
          },
          responseShape: {
            checked: true,
            status: "ok",
            requiredFields: {
              teacherAuthSession: "present",
              authProviderContract: "present",
              s12TeacherAuthIssuerBoundary: "present",
              signedContractDirectCallDenied: "present",
            },
          },
          directCallBoundary: expect.objectContaining({
            checked: true,
            status: "ok",
            route: "/api/ai/teacher-auth/issue",
            method: "POST",
            expectedStatus: 403,
            httpStatus: 403,
            reasonCode: "signed-session-required",
            probes: [
              expect.objectContaining({
                route: "/api/ai/teacher-auth/issue",
                method: "POST",
                expectedStatus: 403,
                httpStatus: 403,
                reasonCode: "signed-session-required",
              }),
            ],
            legacyScopedHeaderPolicy: {
              actorHeaders: "legacy-scoped-ai-access",
              expectedResult: "signed-session-required",
              valuesRedacted: true,
            },
            legacyScopedHeaderProbes: [
              expect.objectContaining({
                route: "/api/ai/teacher-auth/issue",
                method: "POST",
                expectedStatus: 403,
                httpStatus: 403,
                reasonCode: "signed-session-required",
              }),
            ],
            valuesRedacted: true,
          }),
        }),
        expect.objectContaining({
          id: "s22-teacher-ownership-route",
          route: "/api/ai/teacher-ownership",
          auth: "issued-teacher-auth-cookie",
          status: "ok",
          httpStatus: 200,
          responsibleSessions: ["S22", "S12", "S24", "S19"],
          responseShapeChecks: [
            "ownership",
            "consistency",
            "s12TeacherOwnershipSummary",
          ],
          responseShape: {
            checked: true,
            status: "ok",
            requiredFields: {
              ownership: "present",
              consistency: "present",
              s12TeacherOwnershipSummary: "present",
            },
          },
        }),
        expect.objectContaining({
          id: "s22-teacher-ai-session-route",
          route: "/api/ai/session",
          auth: "issued-teacher-auth-cookie",
          status: "ok",
          httpStatus: 200,
          responsibleSessions: ["S22", "S12", "S19"],
          requestBodyShape: "teacher-ai-session-issue",
          responseShapeChecks: [
            "accessSession",
            "accessPlan",
            "authProviderContract",
            "s12TeacherAiSessionBoundary",
            "signedContractDirectCallDenied",
          ],
          responseShape: {
            checked: true,
            status: "ok",
            requiredFields: {
              accessSession: "present",
              accessPlan: "present",
              authProviderContract: "present",
              s12TeacherAiSessionBoundary: "present",
              signedContractDirectCallDenied: "present",
            },
          },
          directCallBoundary: expect.objectContaining({
            checked: true,
            status: "ok",
            route: "/api/ai/ppt-narration",
            method: "POST",
            expectedStatus: 403,
            httpStatus: 403,
            reasonCode: "signed-session-required",
            probes: [
              expect.objectContaining({
                route: "/api/ai/ppt-narration",
                method: "POST",
                expectedStatus: 403,
                httpStatus: 403,
                reasonCode: "signed-session-required",
              }),
              expect.objectContaining({
                route: "/api/ai/chat",
                method: "POST",
                expectedStatus: 403,
                httpStatus: 403,
                reasonCode: "signed-session-required",
              }),
              expect.objectContaining({
                route: "/api/ai/voice-sample",
                method: "POST",
                expectedStatus: 403,
                httpStatus: 403,
                reasonCode: "signed-session-required",
              }),
              expect.objectContaining({
                route: "/api/ai/voice-clone/preflight",
                method: "POST",
                expectedStatus: 403,
                httpStatus: 403,
                reasonCode: "signed-session-required",
              }),
              expect.objectContaining({
                route: "/api/ai/voice-clone/status",
                method: "POST",
                expectedStatus: 403,
                httpStatus: 403,
                reasonCode: "signed-session-required",
              }),
              expect.objectContaining({
                route: "/api/ai/voice-clone/revoke",
                method: "POST",
                expectedStatus: 403,
                httpStatus: 403,
                reasonCode: "signed-session-required",
              }),
              expect.objectContaining({
                route: "/api/ai/ppt-narration/export/{audioManifestId}",
                method: "GET",
                expectedStatus: 403,
                httpStatus: 403,
                reasonCode: "signed-session-required",
              }),
              expect.objectContaining({
                route: "/api/ai/ppt-narration/audio/{audioManifestId}/{audioId}",
                method: "GET",
                expectedStatus: 403,
                httpStatus: 403,
                reasonCode: "signed-session-required",
              }),
            ],
            legacyScopedHeaderPolicy: {
              actorHeaders: "legacy-scoped-ai-access",
              expectedResult: "signed-session-required",
              valuesRedacted: true,
            },
            legacyScopedHeaderProbes: [
              expect.objectContaining({
                route: "/api/ai/ppt-narration",
                method: "POST",
                expectedStatus: 403,
                httpStatus: 403,
                reasonCode: "signed-session-required",
              }),
              expect.objectContaining({
                route: "/api/ai/chat",
                method: "POST",
                expectedStatus: 403,
                httpStatus: 403,
                reasonCode: "signed-session-required",
              }),
              expect.objectContaining({
                route: "/api/ai/voice-sample",
                method: "POST",
                expectedStatus: 403,
                httpStatus: 403,
                reasonCode: "signed-session-required",
              }),
              expect.objectContaining({
                route: "/api/ai/voice-clone/preflight",
                method: "POST",
                expectedStatus: 403,
                httpStatus: 403,
                reasonCode: "signed-session-required",
              }),
              expect.objectContaining({
                route: "/api/ai/voice-clone/status",
                method: "POST",
                expectedStatus: 403,
                httpStatus: 403,
                reasonCode: "signed-session-required",
              }),
              expect.objectContaining({
                route: "/api/ai/voice-clone/revoke",
                method: "POST",
                expectedStatus: 403,
                httpStatus: 403,
                reasonCode: "signed-session-required",
              }),
              expect.objectContaining({
                route: "/api/ai/ppt-narration/export/{audioManifestId}",
                method: "GET",
                expectedStatus: 403,
                httpStatus: 403,
                reasonCode: "signed-session-required",
              }),
              expect.objectContaining({
                route: "/api/ai/ppt-narration/audio/{audioManifestId}/{audioId}",
                method: "GET",
                expectedStatus: 403,
                httpStatus: 403,
                reasonCode: "signed-session-required",
              }),
            ],
            adminRoutePolicy: {
              routes: "signed-admin-ai-access-required",
              expectedResult: "signed-session-required",
              valuesRedacted: true,
            },
            adminRouteProbes: [
              expect.objectContaining({
                route: "/api/ai/voice-assets/retention-readiness",
                method: "GET",
                expectedStatus: 403,
                httpStatus: 403,
                reasonCode: "signed-session-required",
              }),
              expect.objectContaining({
                route: "/api/ai/voice-clone/lifecycle-audit",
                method: "GET",
                expectedStatus: 403,
                httpStatus: 403,
                reasonCode: "signed-session-required",
              }),
              expect.objectContaining({
                route: "/api/ai/readiness",
                method: "GET",
                expectedStatus: 403,
                httpStatus: 403,
                reasonCode: "signed-session-required",
              }),
              expect.objectContaining({
                route: "/api/ai/smoke-plan",
                method: "GET",
                expectedStatus: 403,
                httpStatus: 403,
                reasonCode: "signed-session-required",
              }),
            ],
            legacyScopedHeaderAdminRouteProbes: [
              expect.objectContaining({
                route: "/api/ai/voice-assets/retention-readiness",
                method: "GET",
                expectedStatus: 403,
                httpStatus: 403,
                reasonCode: "signed-session-required",
              }),
              expect.objectContaining({
                route: "/api/ai/voice-clone/lifecycle-audit",
                method: "GET",
                expectedStatus: 403,
                httpStatus: 403,
                reasonCode: "signed-session-required",
              }),
              expect.objectContaining({
                route: "/api/ai/readiness",
                method: "GET",
                expectedStatus: 403,
                httpStatus: 403,
                reasonCode: "signed-session-required",
              }),
              expect.objectContaining({
                route: "/api/ai/smoke-plan",
                method: "GET",
                expectedStatus: 403,
                httpStatus: 403,
                reasonCode: "signed-session-required",
              }),
            ],
            teacherCookieRoutePolicy: {
              routes: "signed-teacher-cookie-required",
              expectedResult: "authenticated-session-required",
              valuesRedacted: true,
            },
            teacherCookieRouteProbes: [
              expect.objectContaining({
                route: "/api/ai/teacher-ownership",
                method: "GET",
                expectedStatus: 401,
                httpStatus: 401,
                reasonCode: "authenticated-session-required",
              }),
              expect.objectContaining({
                route: "/api/ai/teacher-ppt-workflow",
                method: "GET",
                expectedStatus: 401,
                httpStatus: 401,
                reasonCode: "authenticated-session-required",
              }),
            ],
            legacyScopedHeaderTeacherCookieRouteProbes: [
              expect.objectContaining({
                route: "/api/ai/teacher-ownership",
                method: "GET",
                expectedStatus: 401,
                httpStatus: 401,
                reasonCode: "authenticated-session-required",
              }),
              expect.objectContaining({
                route: "/api/ai/teacher-ppt-workflow",
                method: "GET",
                expectedStatus: 401,
                httpStatus: 401,
                reasonCode: "authenticated-session-required",
              }),
            ],
            valuesRedacted: true,
          }),
        }),
        expect.objectContaining({
          id: "s22-teacher-ppt-workflow-route",
          route: "/api/ai/teacher-ppt-workflow",
          auth: "issued-teacher-auth-cookie",
          status: "ok",
          httpStatus: 200,
          responsibleSessions: ["S22", "S12", "S24", "S19"],
          responseShapeChecks: [
            "workflow",
            "workflowReadyForDownloads",
            "workflowDownloadContract",
            "workflowAudioDownloadPattern",
            "workflowExportDownloadUrl",
            "agentHandoffPlan",
            "agentHandoffPlanFramework",
            "s22ReleaseSmokeAgent",
          ],
          responseShape: {
            checked: true,
            status: "ok",
            requiredFields: {
              workflow: "present",
              workflowReadyForDownloads: "present",
              workflowDownloadContract: "present",
              workflowAudioDownloadPattern: "present",
              workflowExportDownloadUrl: "present",
              agentHandoffPlan: "present",
              agentHandoffPlanFramework: "present",
              s22ReleaseSmokeAgent: "present",
            },
          },
        }),
      ]);
      expect(requests.map((request) => request.url)).toEqual([
        "/api/ai/voice-assets/retention-readiness",
        "/api/ai/voice-clone/lifecycle-audit",
        "/api/ai/readiness",
        "/api/ai/smoke-plan",
        "/api/ai/teacher-auth/issue",
        "/api/ai/teacher-auth/issue",
        "/api/ai/teacher-auth/issue",
        "/api/ai/teacher-ownership",
        "/api/ai/session",
        "/api/ai/ppt-narration",
        "/api/ai/chat",
        "/api/ai/voice-sample",
        "/api/ai/voice-clone/preflight",
        "/api/ai/voice-clone/status",
        "/api/ai/voice-clone/revoke",
        "/api/ai/ppt-narration/export/audio-manifest-research-methods-unit-3",
        "/api/ai/ppt-narration/audio/audio-manifest-research-methods-unit-3/direct-call-smoke-audio",
        "/api/ai/ppt-narration",
        "/api/ai/chat",
        "/api/ai/voice-sample",
        "/api/ai/voice-clone/preflight",
        "/api/ai/voice-clone/status",
        "/api/ai/voice-clone/revoke",
        "/api/ai/ppt-narration/export/audio-manifest-research-methods-unit-3",
        "/api/ai/ppt-narration/audio/audio-manifest-research-methods-unit-3/direct-call-smoke-audio",
        "/api/ai/teacher-ownership",
        "/api/ai/teacher-ppt-workflow",
        "/api/ai/teacher-ownership",
        "/api/ai/teacher-ppt-workflow",
        "/api/ai/voice-assets/retention-readiness",
        "/api/ai/voice-clone/lifecycle-audit",
        "/api/ai/readiness",
        "/api/ai/smoke-plan",
        "/api/ai/voice-assets/retention-readiness",
        "/api/ai/voice-clone/lifecycle-audit",
        "/api/ai/readiness",
        "/api/ai/smoke-plan",
        "/api/ai/teacher-ppt-workflow",
      ]);
      for (const request of requests.slice(0, 5)) {
        expect(request.signatureHeader).toEqual(expect.any(String));
        const claims = JSON.parse(
          Buffer.from(request.claimsHeader ?? "", "base64url").toString("utf8"),
        );
        expect(claims.actor).toEqual({
          actorId: "s22-route-smoke-admin",
          role: "admin",
        });
      }
      expect(requests[4].issuerClaimsHeader).toEqual(expect.any(String));
      expect(requests[4].issuerSignatureHeader).toEqual(expect.any(String));
      for (const request of [requests[5], requests[6]]) {
        expect(request.claimsHeader).toBeUndefined();
        expect(request.signatureHeader).toBeUndefined();
        expect(request.cookieHeader).toBeUndefined();
        expect(request.issuerClaimsHeader).toEqual(expect.any(String));
        expect(request.issuerSignatureHeader).toEqual(expect.any(String));
      }
      expect(requests[6].actorIdHeader).toBe("s22-route-smoke-legacy-admin");
      expect(requests[6].actorRoleHeader).toBe("admin");
      for (const request of [requests[7], requests[8]]) {
        expect(request.claimsHeader).toBeUndefined();
        expect(request.signatureHeader).toBeUndefined();
        expect(request.cookieHeader).toBe(
          "uais_teacher_auth_claims=redacted-claims; uais_teacher_auth_signature=redacted-signature",
        );
      }
      expect(requests[37].claimsHeader).toBe("redacted-access-claims");
      expect(requests[37].signatureHeader).toBe("redacted-access-signature");
      expect(requests[37].cookieHeader).toBe(
        "uais_teacher_auth_claims=redacted-claims; uais_teacher_auth_signature=redacted-signature",
      );
      for (const request of requests.slice(9, 17)) {
        expect(request.claimsHeader).toBeUndefined();
        expect(request.signatureHeader).toBeUndefined();
        expect(request.cookieHeader).toBeUndefined();
      }
      for (const request of requests.slice(17, 25)) {
        expect(request.claimsHeader).toBeUndefined();
        expect(request.signatureHeader).toBeUndefined();
        expect(request.cookieHeader).toBeUndefined();
        expect(request.actorIdHeader).toBe("s22-route-smoke-legacy-teacher");
        expect(request.actorRoleHeader).toBe("teacher");
      }
      for (const request of requests.slice(25, 27)) {
        expect(request.claimsHeader).toBeUndefined();
        expect(request.signatureHeader).toBeUndefined();
        expect(request.cookieHeader).toBeUndefined();
        expect(request.actorIdHeader).toBeUndefined();
        expect(request.actorRoleHeader).toBeUndefined();
      }
      for (const request of requests.slice(27, 29)) {
        expect(request.claimsHeader).toBeUndefined();
        expect(request.signatureHeader).toBeUndefined();
        expect(request.cookieHeader).toBeUndefined();
        expect(request.actorIdHeader).toBe("s22-route-smoke-legacy-teacher");
        expect(request.actorRoleHeader).toBe("teacher");
      }
      for (const request of requests.slice(29, 33)) {
        expect(request.claimsHeader).toBeUndefined();
        expect(request.signatureHeader).toBeUndefined();
        expect(request.cookieHeader).toBeUndefined();
        expect(request.actorIdHeader).toBeUndefined();
        expect(request.actorRoleHeader).toBeUndefined();
      }
      for (const request of requests.slice(33, 37)) {
        expect(request.claimsHeader).toBeUndefined();
        expect(request.signatureHeader).toBeUndefined();
        expect(request.cookieHeader).toBeUndefined();
        expect(request.actorIdHeader).toBe("s22-route-smoke-legacy-admin");
        expect(request.actorRoleHeader).toBe("admin");
      }
      expect(output).not.toContain("secret-route-smoke-cli");
      expect(output).not.toContain("secret-teacher-route-smoke-cli");
      expect(output).not.toContain("secret-teacher-issuer-route-smoke-cli");
      expect(output).not.toContain("secret-deepseek-route-cli");
      expect(output).not.toContain("secret-qwen-route-cli");
      expect(output).not.toContain("server-secret-should-not-leak");
      expect(output).not.toContain("ready-for-teacher-review");
      expect(output).not.toContain("openmaic-style-teacher-ppt-narration");
      expect(output).not.toContain("redacted-access-claims");
      expect(output).not.toContain("redacted-access-signature");
      expect(output).not.toContain("uais_teacher_auth_claims");
      expect(output).not.toContain("uais_teacher_auth_signature");
    } finally {
      await closeServerForTest(server);
    }
  });

  it("fails protected route smoke when legacy scoped headers can still call contract AI APIs directly", async () => {
    const server = createServer(async (request, response) => {
      const claimsHeader = headerToString(request.headers["x-uais-access-claims"]);
      const signatureHeader = headerToString(request.headers["x-uais-access-signature"]);
      const issuerClaimsHeader = headerToString(
        request.headers["x-uais-teacher-auth-issuer-claims"],
      );
      const issuerSignatureHeader = headerToString(
        request.headers["x-uais-teacher-auth-issuer-signature"],
      );
      const cookieHeader = headerToString(request.headers.cookie);
      const actorIdHeader = headerToString(request.headers["x-uais-actor-id"]);
      const actorRoleHeader = headerToString(request.headers["x-uais-actor-role"]);
      const isDirectCallProbe = isSignedSessionRequiredProbeRoute(request.url);
      const hasSignedAiAccess = Boolean(claimsHeader && signatureHeader);
      const hasLegacyScopedHeaders = Boolean(actorIdHeader && actorRoleHeader);
      const legacyVoiceSampleAllowed =
        request.url === "/api/ai/voice-sample" && hasLegacyScopedHeaders;
      const authorized =
        request.url === "/api/ai/teacher-ppt-workflow" ||
        request.url === "/api/ai/session" ||
        request.url === "/api/ai/teacher-ownership"
          ? Boolean(cookieHeader?.includes("uais_teacher_auth_claims="))
          : request.url === "/api/ai/teacher-auth/issue"
            ? Boolean(
                claimsHeader &&
                  signatureHeader &&
                  issuerClaimsHeader &&
                  issuerSignatureHeader,
              )
            : hasSignedAiAccess || legacyVoiceSampleAllowed;
      const signedSessionRequired =
        isDirectCallProbe && !hasSignedAiAccess && !legacyVoiceSampleAllowed;
      const responseHeaders: Record<string, string | string[]> = {
        "content-type": "application/json",
      };
      if (authorized && request.url === "/api/ai/teacher-auth/issue") {
        responseHeaders["set-cookie"] = [
          "uais_teacher_auth_claims=redacted-claims; Path=/; HttpOnly; SameSite=Lax; Max-Age=300; Secure; Priority=High",
          "uais_teacher_auth_signature=redacted-signature; Path=/; HttpOnly; SameSite=Lax; Max-Age=300; Secure; Priority=High",
        ];
      }
      if (isTeacherCookieRouteForTest(request.url) && !authorized) {
        response.writeHead(401, responseHeaders);
        response.end(JSON.stringify(createAuthenticatedSessionRequiredBodyForTest()));
        return;
      }

      response.writeHead(authorized ? 200 : 403, responseHeaders);
      response.end(
        JSON.stringify(
          signedSessionRequired
            ? createSignedSessionRequiredBodyForTest()
            : request.url === "/api/ai/teacher-auth/issue"
              ? createTeacherAuthIssuerRouteBodyForTest()
              : request.url === "/api/ai/session"
                ? createTeacherAiSessionRouteBodyForTest()
                : request.url === "/api/ai/teacher-ppt-workflow"
                  ? createTeacherPptWorkflowRouteBodyForTest(
                      "audio-manifest-research-methods-unit-3",
                    )
                  : request.url === "/api/ai/teacher-ownership"
                    ? {
                        ownership: {
                          teacherId: "s22-route-smoke-teacher",
                          storagePolicy: "server-side-redacted-teacher-ai-ownership-summary",
                        },
                        consistency: {
                          status: "ready",
                          responsibleSession: "S12/S24",
                        },
                        progress: [
                          {
                            type: "s12-teacher-ownership-auth-boundary",
                            status: "ready",
                            responsibleSession: "S12",
                          },
                        ],
                      }
                    : { ok: true },
        ),
      );
    });
    const baseUrl = await listenForTest(server);
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-route-smoke-legacy-leak-"));
    const envFile = join(tmpDir, "route-smoke.test.env");
    writeFileSync(
      envFile,
      [
        "UAIS_AI_ACCESS_SIGNING_SECRET=secret-route-smoke-cli",
        "UAIS_TEACHER_AUTH_PROVIDER=trusted-cookie-issuer",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-teacher-route-smoke-cli",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET=secret-teacher-issuer-route-smoke-cli",
        "DEEPSEEK_API_KEY=secret-deepseek-route-cli",
        "DASHSCOPE_API_KEY=secret-qwen-route-cli",
      ].join("\n"),
    );

    try {
      const result = await execFileResultForTest("node", [
        "scripts/ai-route-smoke.mjs",
        "--live",
        "--approved",
        "--environment",
        "local-production",
        "--base-url",
        baseUrl,
        "--env-file",
        envFile,
      ]);
      const body = JSON.parse(result.stdout);
      const teacherAiSessionResult = body.results.find(
        (result: { id?: string }) => result.id === "s22-teacher-ai-session-route",
      );

      expect(result.exitCode).toBe(1);
      expect(body.status).toBe("failed");
      expect(teacherAiSessionResult).toEqual(
        expect.objectContaining({
          status: "failed",
          directCallBoundary: expect.objectContaining({
            status: "failed",
            legacyScopedHeaderProbes: expect.arrayContaining([
              expect.objectContaining({
                route: "/api/ai/voice-sample",
                method: "POST",
                status: "failed",
                expectedStatus: 403,
                httpStatus: 200,
              }),
            ]),
          }),
        }),
      );
      expect(result.stdout).not.toContain("secret-route-smoke-cli");
      expect(result.stdout).not.toContain(tmpDir);
      expect(result.stdout).not.toContain("/Users/");
    } finally {
      await closeServerForTest(server);
    }
  });

  it("derives the teacher AI session request resource from the issued teacher ownership route", async () => {
    const requests: Array<{
      url: string | undefined;
      body: Record<string, unknown> | undefined;
      cookieHeader: string | undefined;
    }> = [];
    const server = createServer(async (request, response) => {
      const cookieHeader = headerToString(request.headers.cookie);
      const claimsHeader = headerToString(request.headers["x-uais-access-claims"]);
      const signatureHeader = headerToString(request.headers["x-uais-access-signature"]);
      const issuerClaimsHeader = headerToString(
        request.headers["x-uais-teacher-auth-issuer-claims"],
      );
      const issuerSignatureHeader = headerToString(
        request.headers["x-uais-teacher-auth-issuer-signature"],
      );
      const bodyText = request.method === "POST" ? await readBodyForTest(request) : "";
      const requestBody = bodyText
        ? JSON.parse(bodyText) as Record<string, unknown>
        : undefined;
      requests.push({ url: request.url, body: requestBody, cookieHeader });
      const hasSignedAiAccess = Boolean(claimsHeader && signatureHeader);
      const signedSessionRequired =
        (isSignedSessionRequiredProbeRoute(request.url) && !hasSignedAiAccess) ||
        (request.url === "/api/ai/teacher-auth/issue" &&
          issuerClaimsHeader &&
          issuerSignatureHeader &&
          !claimsHeader &&
          !signatureHeader);

      const responseHeaders: Record<string, string | string[]> = {
        "content-type": "application/json",
      };
      if (request.url === "/api/ai/teacher-auth/issue" && !signedSessionRequired) {
        responseHeaders["set-cookie"] = [
          "uais_teacher_auth_claims=derived-claims; Path=/; HttpOnly; SameSite=Lax; Max-Age=300; Secure; Priority=High",
          "uais_teacher_auth_signature=derived-signature; Path=/; HttpOnly; SameSite=Lax; Max-Age=300; Secure; Priority=High",
        ];
      }

      if (request.url === "/api/ai/session") {
        const resource = requestBody?.resource as Record<string, unknown> | undefined;
        const derived =
          resource?.teacherId === "teacher-derived" &&
          resource?.courseId === "course-derived" &&
          resource?.sampleAssetId === "sample-derived" &&
          resource?.pptAssetId === "ppt-derived" &&
          resource?.voiceRefId === "voice-derived" &&
          resource?.audioManifestId === "manifest-derived";
        response.writeHead(derived ? 200 : 403, responseHeaders);
        response.end(JSON.stringify(derived ? createTeacherAiSessionRouteBodyForTest() : {}));
        return;
      }

      if (signedSessionRequired) {
        response.writeHead(403, responseHeaders);
        response.end(JSON.stringify(createSignedSessionRequiredBodyForTest()));
        return;
      }
      if (
        isTeacherCookieRouteForTest(request.url) &&
        !cookieHeader?.includes("uais_teacher_auth_claims=")
      ) {
        response.writeHead(401, responseHeaders);
        response.end(JSON.stringify(createAuthenticatedSessionRequiredBodyForTest()));
        return;
      }

      response.writeHead(200, responseHeaders);
      response.end(
        JSON.stringify(
          request.url === "/api/ai/teacher-auth/issue"
            ? createTeacherAuthIssuerRouteBodyForTest()
            : request.url === "/api/ai/teacher-ownership"
              ? {
                  ownership: {
                    teacherId: "teacher-derived",
                    courseIds: ["course-derived"],
                    sampleAssets: [
                      { sampleAssetId: "sample-derived", courseId: "course-derived" },
                    ],
                    pptAssets: [
                      { pptAssetId: "ppt-derived", courseId: "course-derived" },
                    ],
                    clonedVoiceRefs: [
                      {
                        voiceRefId: "voice-derived",
                        sampleAssetId: "sample-derived",
                      },
                    ],
                    audioManifests: [
                      {
                        audioManifestId: "manifest-derived",
                        courseId: "course-derived",
                        pptAssetId: "ppt-derived",
                        voiceRefId: "voice-derived",
                      },
                    ],
                  },
                  consistency: {
                    status: "ready",
                  },
                  progress: [
                    {
                      type: "s12-teacher-ownership-auth-boundary",
                      status: "ready",
                      responsibleSession: "S12",
                    },
                  ],
                }
              : request.url === "/api/ai/teacher-ppt-workflow"
                ? createTeacherPptWorkflowRouteBodyForTest("manifest-derived")
                : { ok: true, secret: "derived-route-secret-should-not-leak" },
        ),
      );
    });
    const baseUrl = await listenForTest(server);
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-route-smoke-derived-ownership-"));
    const envFile = join(tmpDir, "route-smoke-derived.test.env");
    writeFileSync(
      envFile,
      [
        "UAIS_AI_ACCESS_SIGNING_SECRET=secret-derived-route-smoke-cli",
        "UAIS_TEACHER_AUTH_PROVIDER=trusted-cookie-issuer",
        "UAIS_TEACHER_AUTH_ROUTE_SMOKE_TEACHER_ID=teacher-derived",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-derived-teacher-route-smoke-cli",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET=secret-derived-teacher-issuer-route-smoke-cli",
      ].join("\n"),
    );

    try {
      const result = await execFileResultForTest("node", [
        "scripts/ai-route-smoke.mjs",
        "--live",
        "--approved",
        "--environment",
        "local-production",
        "--base-url",
        baseUrl,
        "--env-file",
        envFile,
      ]);
      const output = result.stdout;
      const body = JSON.parse(output);

      expect(result.exitCode).toBe(0);
      expect(body.status).toBe("passed");
      expect(requests.map((request) => request.url)).toEqual([
        "/api/ai/voice-assets/retention-readiness",
        "/api/ai/voice-clone/lifecycle-audit",
        "/api/ai/readiness",
        "/api/ai/smoke-plan",
        "/api/ai/teacher-auth/issue",
        "/api/ai/teacher-auth/issue",
        "/api/ai/teacher-auth/issue",
        "/api/ai/teacher-ownership",
        "/api/ai/session",
        "/api/ai/ppt-narration",
        "/api/ai/chat",
        "/api/ai/voice-sample",
        "/api/ai/voice-clone/preflight",
        "/api/ai/voice-clone/status",
        "/api/ai/voice-clone/revoke",
        "/api/ai/ppt-narration/export/manifest-derived",
        "/api/ai/ppt-narration/audio/manifest-derived/direct-call-smoke-audio",
        "/api/ai/ppt-narration",
        "/api/ai/chat",
        "/api/ai/voice-sample",
        "/api/ai/voice-clone/preflight",
        "/api/ai/voice-clone/status",
        "/api/ai/voice-clone/revoke",
        "/api/ai/ppt-narration/export/manifest-derived",
        "/api/ai/ppt-narration/audio/manifest-derived/direct-call-smoke-audio",
        "/api/ai/teacher-ownership",
        "/api/ai/teacher-ppt-workflow",
        "/api/ai/teacher-ownership",
        "/api/ai/teacher-ppt-workflow",
        "/api/ai/voice-assets/retention-readiness",
        "/api/ai/voice-clone/lifecycle-audit",
        "/api/ai/readiness",
        "/api/ai/smoke-plan",
        "/api/ai/voice-assets/retention-readiness",
        "/api/ai/voice-clone/lifecycle-audit",
        "/api/ai/readiness",
        "/api/ai/smoke-plan",
        "/api/ai/teacher-ppt-workflow",
      ]);
      expect(
        requests.find((request) => request.url === "/api/ai/session")?.body?.resource,
      ).toEqual({
        teacherId: "teacher-derived",
        courseId: "course-derived",
        sampleAssetId: "sample-derived",
        pptAssetId: "ppt-derived",
        voiceRefId: "voice-derived",
        audioManifestId: "manifest-derived",
      });
      expect(body.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "s22-teacher-ownership-route",
            status: "ok",
            responseShape: expect.objectContaining({ status: "ok" }),
          }),
          expect.objectContaining({
            id: "s22-teacher-ai-session-route",
            status: "ok",
            responseShape: expect.objectContaining({ status: "ok" }),
          }),
        ]),
      );
      expect(output).not.toContain("teacher-derived");
      expect(output).not.toContain("course-derived");
      expect(output).not.toContain("sample-derived");
      expect(output).not.toContain("ppt-derived");
      expect(output).not.toContain("voice-derived");
      expect(output).not.toContain("manifest-derived");
      expect(output).not.toContain("secret-derived-route-smoke-cli");
      expect(output).not.toContain("secret-derived-teacher-route-smoke-cli");
      expect(output).not.toContain("secret-derived-teacher-issuer-route-smoke-cli");
      expect(output).not.toContain("derived-route-secret-should-not-leak");
      expect(output).not.toContain(tmpDir);
      expect(output).not.toContain("/Users/");
    } finally {
      await closeServerForTest(server);
    }
  });

  it("derives the teacher AI session resource from a complete ownership chain when partial records come first", async () => {
    const requests: Array<{
      url: string | undefined;
      body: Record<string, unknown> | undefined;
    }> = [];
    const server = createServer(async (request, response) => {
      const cookieHeader = headerToString(request.headers.cookie);
      const claimsHeader = headerToString(request.headers["x-uais-access-claims"]);
      const signatureHeader = headerToString(request.headers["x-uais-access-signature"]);
      const issuerClaimsHeader = headerToString(
        request.headers["x-uais-teacher-auth-issuer-claims"],
      );
      const issuerSignatureHeader = headerToString(
        request.headers["x-uais-teacher-auth-issuer-signature"],
      );
      const bodyText = request.method === "POST" ? await readBodyForTest(request) : "";
      const requestBody = bodyText
        ? JSON.parse(bodyText) as Record<string, unknown>
        : undefined;
      requests.push({ url: request.url, body: requestBody });
      const hasSignedAiAccess = Boolean(claimsHeader && signatureHeader);
      const signedSessionRequired =
        (isSignedSessionRequiredProbeRoute(request.url) && !hasSignedAiAccess) ||
        (request.url === "/api/ai/teacher-auth/issue" &&
          issuerClaimsHeader &&
          issuerSignatureHeader &&
          !claimsHeader &&
          !signatureHeader);

      const responseHeaders: Record<string, string | string[]> = {
        "content-type": "application/json",
      };
      if (request.url === "/api/ai/teacher-auth/issue" && !signedSessionRequired) {
        responseHeaders["set-cookie"] = [
          "uais_teacher_auth_claims=partial-first-claims; Path=/; HttpOnly; SameSite=Lax; Max-Age=300; Secure; Priority=High",
          "uais_teacher_auth_signature=partial-first-signature; Path=/; HttpOnly; SameSite=Lax; Max-Age=300; Secure; Priority=High",
        ];
      }

      if (request.url === "/api/ai/session") {
        const resource = requestBody?.resource as Record<string, unknown> | undefined;
        const derived =
          resource?.teacherId === "teacher-partial-first" &&
          resource?.courseId === "course-complete" &&
          resource?.sampleAssetId === "sample-complete" &&
          resource?.pptAssetId === "ppt-complete" &&
          resource?.voiceRefId === "voice-complete" &&
          resource?.audioManifestId === "manifest-complete";
        response.writeHead(derived ? 200 : 403, responseHeaders);
        response.end(JSON.stringify(derived ? createTeacherAiSessionRouteBodyForTest() : {}));
        return;
      }

      if (signedSessionRequired) {
        response.writeHead(403, responseHeaders);
        response.end(JSON.stringify(createSignedSessionRequiredBodyForTest()));
        return;
      }
      if (
        isTeacherCookieRouteForTest(request.url) &&
        !cookieHeader?.includes("uais_teacher_auth_claims=")
      ) {
        response.writeHead(401, responseHeaders);
        response.end(JSON.stringify(createAuthenticatedSessionRequiredBodyForTest()));
        return;
      }

      response.writeHead(200, responseHeaders);
      response.end(
        JSON.stringify(
          request.url === "/api/ai/teacher-auth/issue"
            ? createTeacherAuthIssuerRouteBodyForTest()
            : request.url === "/api/ai/teacher-ownership"
              ? {
                  ownership: {
                    teacherId: "teacher-partial-first",
                    courseIds: ["course-partial", "course-complete"],
                    sampleAssets: [
                      { sampleAssetId: "sample-partial", courseId: "course-partial" },
                      { sampleAssetId: "sample-complete", courseId: "course-complete" },
                    ],
                    pptAssets: [
                      { pptAssetId: "ppt-partial", courseId: "course-partial" },
                      { pptAssetId: "ppt-complete", courseId: "course-complete" },
                    ],
                    clonedVoiceRefs: [
                      {
                        voiceRefId: "voice-complete",
                        sampleAssetId: "sample-complete",
                      },
                    ],
                    audioManifests: [
                      {
                        audioManifestId: "manifest-complete",
                        courseId: "course-complete",
                        pptAssetId: "ppt-complete",
                        voiceRefId: "voice-complete",
                      },
                    ],
                  },
                  consistency: {
                    status: "ready",
                  },
                  progress: [
                    {
                      type: "s12-teacher-ownership-auth-boundary",
                      status: "ready",
                      responsibleSession: "S12",
                    },
                  ],
                }
              : request.url === "/api/ai/teacher-ppt-workflow"
                ? createTeacherPptWorkflowRouteBodyForTest("manifest-complete")
                : { ok: true, secret: "partial-first-route-secret-should-not-leak" },
        ),
      );
    });
    const baseUrl = await listenForTest(server);
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-route-smoke-partial-first-"));
    const envFile = join(tmpDir, "route-smoke-partial-first.test.env");
    writeFileSync(
      envFile,
      [
        "UAIS_AI_ACCESS_SIGNING_SECRET=secret-partial-first-route-smoke-cli",
        "UAIS_TEACHER_AUTH_PROVIDER=trusted-cookie-issuer",
        "UAIS_TEACHER_AUTH_ROUTE_SMOKE_TEACHER_ID=teacher-partial-first",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-partial-first-teacher-route-smoke-cli",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET=secret-partial-first-teacher-issuer-route-smoke-cli",
      ].join("\n"),
    );

    try {
      const result = await execFileResultForTest("node", [
        "scripts/ai-route-smoke.mjs",
        "--live",
        "--approved",
        "--environment",
        "local-production",
        "--base-url",
        baseUrl,
        "--env-file",
        envFile,
      ]);
      const output = result.stdout;
      const body = JSON.parse(output);

      expect(result.exitCode).toBe(0);
      expect(body.status).toBe("passed");
      expect(
        requests.find((request) => request.url === "/api/ai/session")?.body?.resource,
      ).toEqual({
        teacherId: "teacher-partial-first",
        courseId: "course-complete",
        sampleAssetId: "sample-complete",
        pptAssetId: "ppt-complete",
        voiceRefId: "voice-complete",
        audioManifestId: "manifest-complete",
      });
      expect(output).not.toContain("teacher-partial-first");
      expect(output).not.toContain("course-partial");
      expect(output).not.toContain("course-complete");
      expect(output).not.toContain("sample-partial");
      expect(output).not.toContain("sample-complete");
      expect(output).not.toContain("ppt-partial");
      expect(output).not.toContain("ppt-complete");
      expect(output).not.toContain("voice-complete");
      expect(output).not.toContain("manifest-complete");
      expect(output).not.toContain("secret-partial-first-route-smoke-cli");
      expect(output).not.toContain("secret-partial-first-teacher-route-smoke-cli");
      expect(output).not.toContain("secret-partial-first-teacher-issuer-route-smoke-cli");
      expect(output).not.toContain("partial-first-route-secret-should-not-leak");
      expect(output).not.toContain(tmpDir);
      expect(output).not.toContain("/Users/");
    } finally {
      await closeServerForTest(server);
    }
  });

  it("retries transient protected route request failures before evaluating route smoke evidence", async () => {
    const attempts = new Map<string, number>();
    const server = createServer((request, response) => {
      const route = request.url ?? "/";
      const attempt = (attempts.get(route) ?? 0) + 1;
      attempts.set(route, attempt);
      if (route === "/api/ai/voice-assets/retention-readiness" && attempt === 1) {
        request.socket.destroy();
        return;
      }

      const claimsHeader = headerToString(request.headers["x-uais-access-claims"]);
      const signatureHeader = headerToString(request.headers["x-uais-access-signature"]);
      const issuerClaimsHeader = headerToString(
        request.headers["x-uais-teacher-auth-issuer-claims"],
      );
      const issuerSignatureHeader = headerToString(
        request.headers["x-uais-teacher-auth-issuer-signature"],
      );
      const cookieHeader = headerToString(request.headers.cookie);
      const authorized =
        route === "/api/ai/teacher-ppt-workflow" ||
        route === "/api/ai/session" ||
        route === "/api/ai/teacher-ownership"
          ? Boolean(cookieHeader?.includes("uais_teacher_auth_claims="))
          : route === "/api/ai/teacher-auth/issue"
            ? Boolean(
                claimsHeader &&
                  signatureHeader &&
                  issuerClaimsHeader &&
                  issuerSignatureHeader,
              )
            : Boolean(claimsHeader && signatureHeader);
      const responseHeaders: Record<string, string | string[]> = {
        "content-type": "application/json",
      };
      if (authorized && route === "/api/ai/teacher-auth/issue") {
        responseHeaders["set-cookie"] = [
          "uais_teacher_auth_claims=retry-redacted-claims; Path=/; HttpOnly; SameSite=Lax; Max-Age=300; Secure; Priority=High",
          "uais_teacher_auth_signature=retry-redacted-signature; Path=/; HttpOnly; SameSite=Lax; Max-Age=300; Secure; Priority=High",
        ];
      }
      if (isTeacherCookieRouteForTest(route) && !authorized) {
        response.writeHead(401, responseHeaders);
        response.end(JSON.stringify(createAuthenticatedSessionRequiredBodyForTest()));
        return;
      }
      response.writeHead(authorized ? 200 : 403, responseHeaders);
      const signedSessionRequired =
        isSignedSessionRequiredProbeRoute(route) ||
        (route === "/api/ai/teacher-auth/issue" &&
          issuerClaimsHeader &&
          issuerSignatureHeader &&
          !claimsHeader &&
          !signatureHeader);
      response.end(
        JSON.stringify(
          signedSessionRequired
            ? createSignedSessionRequiredBodyForTest()
          : route === "/api/ai/teacher-auth/issue"
            ? {
                teacherAuthSession: {
                  responsibleSession: "S12",
                  authProvider: "trusted-cookie-issuer",
                  authSource: "trusted-cookie-issuer",
                },
                authProviderContract: {
                  selector: "trusted-cookie-issuer",
                  providerKind: "trusted-cookie-issuer",
                  productionStatus: "ready",
                },
                progress: [
                  {
                    type: "s12-trusted-teacher-auth-issuer",
                    status: "issued",
                    responsibleSession: "S12",
                  },
                ],
              }
            : route === "/api/ai/session"
              ? {
                  accessSession: {
                    headers: {
                      "x-uais-access-claims": "redacted-access-claims",
                      "x-uais-access-signature": "redacted-access-signature",
                    },
                  },
                  accessPlan: {
                    responsibleSession: "S12",
                    action: "ppt-narration-submit",
                  },
                  authProviderContract: {
                    selector: "trusted-cookie-issuer",
                    providerKind: "trusted-cookie-issuer",
                    productionStatus: "ready",
                  },
                  progress: [
                    {
                      type: "s12-teacher-ai-session-boundary",
                      status: "issued",
                      responsibleSession: "S12",
                    },
                  ],
                }
              : route === "/api/ai/teacher-ownership"
                ? {
                    ownership: {
                      teacherId: "s22-route-smoke-teacher",
                    },
                    consistency: {
                      status: "ready",
                    },
                    progress: [
                      {
                        type: "s12-teacher-ownership-auth-boundary",
                        status: "ready",
                        responsibleSession: "S12",
                      },
                    ],
                  }
                : route === "/api/ai/teacher-ppt-workflow"
                  ? {
                      workflow: {
                        status: "ready-for-downloads",
                        nextAction: "review-and-download-ppt-narration",
                        downloads: {
                          audioManifestId: "audio-manifest-retry-route-smoke",
                          exportDownloadUrl:
                            "/api/ai/ppt-narration/export/audio-manifest-retry-route-smoke",
                          audioDownloadPattern:
                            "/api/ai/ppt-narration/audio/audio-manifest-retry-route-smoke/{audioId}",
                        },
                      },
                      agentHandoffPlan: {
                        framework: "openmaic-style-teacher-ppt-narration",
                        handoffs: [
                          {
                            agentId: "s22-release-smoke-agent",
                            responsibleSession: "S22",
                          },
                        ],
                      },
                    }
                  : { ok: true, secret: "retry-route-secret-should-not-leak" },
        ),
      );
    });
    const baseUrl = await listenForTest(server);
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-route-smoke-retry-"));
    const envFile = join(tmpDir, "route-smoke-retry.test.env");
    writeFileSync(
      envFile,
      [
        "UAIS_AI_ACCESS_SIGNING_SECRET=secret-route-smoke-retry-cli",
        "UAIS_TEACHER_AUTH_PROVIDER=trusted-cookie-issuer",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-teacher-route-smoke-retry-cli",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET=secret-teacher-issuer-route-smoke-retry-cli",
      ].join("\n"),
    );

    try {
      const result = await execFileResultForTest("node", [
        "scripts/ai-route-smoke.mjs",
        "--live",
        "--approved",
        "--environment",
        "local-production",
        "--base-url",
        baseUrl,
        "--env-file",
        envFile,
      ]);
      const output = result.stdout;
      const body = JSON.parse(output);

      expect(result.exitCode).toBe(0);
      expect(body.status).toBe("passed");
      expect(body.networkRetryPolicy).toEqual({
        maxAttempts: 3,
        perAttemptTimeoutMs: 10_000,
        retryOn: ["request-error"],
        valuesRedacted: true,
      });
      expect(body.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "s22-retention-readiness-route",
            status: "ok",
            networkAttempts: {
              attempted: 2,
              maxAttempts: 3,
              retried: true,
              valueRedacted: true,
            },
          }),
          expect.objectContaining({
            id: "s22-voice-lifecycle-audit-route",
            status: "ok",
            networkAttempts: {
              attempted: 1,
              maxAttempts: 3,
              retried: false,
              valueRedacted: true,
            },
          }),
        ]),
      );
      expect(attempts.get("/api/ai/voice-assets/retention-readiness")).toBe(4);
      expect(output).not.toContain("secret-route-smoke-retry-cli");
      expect(output).not.toContain("secret-teacher-route-smoke-retry-cli");
      expect(output).not.toContain("secret-teacher-issuer-route-smoke-retry-cli");
      expect(output).not.toContain("retry-route-secret-should-not-leak");
      expect(output).not.toContain(tmpDir);
      expect(output).not.toContain("/Users/");
    } finally {
      await closeServerForTest(server);
    }
  });

  it("runs the protected route smoke CLI with an OIDC JWKS bearer token without leaking it", async () => {
    const oidcSmokeToken = "secret-oidc-route-smoke-token";
    const requests: Array<{
      url: string | undefined;
      body: string;
      authorizationHeader: string | undefined;
      claimsHeader: string | undefined;
      signatureHeader: string | undefined;
      issuerClaimsHeader: string | undefined;
      issuerSignatureHeader: string | undefined;
      cookieHeader: string | undefined;
    }> = [];
    const server = createServer(async (request, response) => {
      const body = await readBodyForTest(request);
      const authorizationHeader = headerToString(request.headers.authorization);
      const claimsHeader = headerToString(request.headers["x-uais-access-claims"]);
      const signatureHeader = headerToString(request.headers["x-uais-access-signature"]);
      const issuerClaimsHeader = headerToString(
        request.headers["x-uais-teacher-auth-issuer-claims"],
      );
      const issuerSignatureHeader = headerToString(
        request.headers["x-uais-teacher-auth-issuer-signature"],
      );
      const cookieHeader = headerToString(request.headers.cookie);
      requests.push({
        url: request.url,
        body,
        authorizationHeader,
        claimsHeader,
        signatureHeader,
        issuerClaimsHeader,
        issuerSignatureHeader,
        cookieHeader,
      });
      const hasSignedAiAccess = Boolean(claimsHeader && signatureHeader);
      const authorized =
        request.url === "/api/ai/teacher-ppt-workflow" ||
        request.url === "/api/ai/session" ||
        request.url === "/api/ai/teacher-ownership"
          ? Boolean(cookieHeader?.includes("uais_teacher_auth_claims="))
          : request.url === "/api/ai/teacher-auth/issue"
            ? authorizationHeader === `Bearer ${oidcSmokeToken}`
          : hasSignedAiAccess;
      const responseHeaders: Record<string, string | string[]> = {
        "content-type": "application/json",
      };
      if (authorized && request.url === "/api/ai/teacher-auth/issue") {
        responseHeaders["set-cookie"] = [
          "uais_teacher_auth_claims=oidc-redacted-claims; Path=/; HttpOnly; SameSite=Lax; Max-Age=300; Secure; Priority=High",
          "uais_teacher_auth_signature=oidc-redacted-signature; Path=/; HttpOnly; SameSite=Lax; Max-Age=300; Secure; Priority=High",
        ];
      }
      if (isTeacherCookieRouteForTest(request.url) && !authorized) {
        response.writeHead(401, responseHeaders);
        response.end(JSON.stringify(createAuthenticatedSessionRequiredBodyForTest()));
        return;
      }
      response.writeHead(authorized ? 200 : 403, responseHeaders);
      response.end(
        JSON.stringify(
          isSignedSessionRequiredProbeRoute(request.url) && !hasSignedAiAccess
            ? createSignedSessionRequiredBodyForTest()
          : request.url === "/api/ai/teacher-auth/issue"
            ? {
                teacherAuthSession: {
                  responsibleSession: "S12",
                  authProvider: "oidc-jwks",
                  authSource: "oidc-jwks",
                  authSessionRef: "server-side-auth-session",
                  cookieNames: ["uais_teacher_auth_claims", "uais_teacher_auth_signature"],
                  redaction: {
                    secrets: "omitted",
                    cookies: "headers-only",
                    sessionIds: "omitted",
                  },
                },
                authProviderContract: {
                  selector: "oidc-jwks",
                  providerKind: "oidc-jwks",
                  productionStatus: "ready",
                  redaction: {
                    values: "omitted",
                    cookies: "omitted",
                  },
                },
                progress: [
                  {
                    type: "s12-trusted-teacher-auth-issuer",
                    status: "issued",
                    responsibleSession: "S12",
                  },
                ],
              }
            : request.url === "/api/ai/session"
            ? {
                accessSession: {
                  headers: {
                    "x-uais-access-claims": "redacted-access-claims",
                    "x-uais-access-signature": "redacted-access-signature",
                  },
                  expiresAt: "2099-01-01T00:05:00.000Z",
                },
                accessPlan: {
                  responsibleSession: "S12",
                  action: "ppt-narration-submit",
                  redaction: {
                    secrets: "omitted",
                    localFiles: "omitted",
                    assets: "ids-only",
                  },
                },
                authProviderContract: {
                  selector: "oidc-jwks",
                  providerKind: "oidc-jwks",
                  productionStatus: "ready",
                  redaction: {
                    values: "omitted",
                    cookies: "omitted",
                  },
                },
                progress: [
                  {
                    type: "s12-teacher-ai-session-boundary",
                    status: "issued",
                    responsibleSession: "S12",
                  },
                ],
              }
            : request.url === "/api/ai/teacher-ppt-workflow"
              ? {
                  workflow: {
                    status: "ready-for-downloads",
                    nextAction: "review-and-download-ppt-narration",
                    downloads: {
                      audioManifestId: "audio-manifest-research-methods-unit-3",
                      exportDownloadUrl:
                        "/api/ai/ppt-narration/export/audio-manifest-research-methods-unit-3",
                      audioDownloadPattern:
                        "/api/ai/ppt-narration/audio/audio-manifest-research-methods-unit-3/{audioId}",
                    },
                  },
                  agentHandoffPlan: {
                    framework: "openmaic-style-teacher-ppt-narration",
                    status: "ready-for-teacher-review",
                    handoffs: [
                      {
                        agentId: "s22-release-smoke-agent",
                        responsibleSession: "S22",
                        status: "pending",
                      },
                    ],
                  },
                }
              : request.url === "/api/ai/teacher-ownership"
                ? {
                    ownership: {
                      teacherId: "teacher-kang@example.test",
                      storagePolicy: "server-side-redacted-teacher-ai-ownership-summary",
                    },
                    consistency: {
                      status: "ready",
                      responsibleSession: "S12/S24",
                    },
                    progress: [
                      {
                        type: "s12-teacher-ownership-auth-boundary",
                        status: "ready",
                        responsibleSession: "S12",
                      },
                    ],
                  }
                : { ok: true },
        ),
      );
    });
    const baseUrl = await listenForTest(server);
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-route-smoke-oidc-"));
    const envFile = join(tmpDir, "route-smoke-oidc.test.env");
    writeFileSync(
      envFile,
      [
        "UAIS_AI_ACCESS_SIGNING_SECRET=secret-route-smoke-oidc-cli",
        "UAIS_TEACHER_AUTH_PROVIDER=oidc-jwks",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-teacher-route-smoke-oidc-cli",
        "UAIS_TEACHER_AUTH_OIDC_ISSUER=https://identity.example.test",
        "UAIS_TEACHER_AUTH_OIDC_AUDIENCE=uais-teacher-workflow",
        "UAIS_TEACHER_AUTH_OIDC_JWKS_URL=https://identity.example.test/.well-known/jwks.json",
        "UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM=email",
        `UAIS_TEACHER_AUTH_OIDC_SMOKE_BEARER_TOKEN=${oidcSmokeToken}`,
        "UAIS_TEACHER_AUTH_OIDC_SMOKE_TEACHER_ID=teacher-kang@example.test",
      ].join("\n"),
    );

    try {
      const result = await execFileResultForTest("node", [
        "scripts/ai-route-smoke.mjs",
        "--live",
        "--approved",
        "--environment",
        "local-production",
        "--base-url",
        baseUrl,
        "--env-file",
        envFile,
      ]);
      expect(result.exitCode).toBe(0);
      const output = result.stdout;
      const body = JSON.parse(output);

      expect(body.mode).toBe("live");
      expect(body.environment).toBe("local-production");
      expect(body.status).toBe("passed");
      expect(body.authProviderMode).toBe("oidc-jwks");
      expect(body.prerequisites).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "s22-teacher-auth-oidc-smoke-token",
            requiredEnv: "UAIS_TEACHER_AUTH_OIDC_SMOKE_BEARER_TOKEN",
            status: "present",
          }),
          expect.objectContaining({
            id: "s22-teacher-auth-oidc-smoke-teacher-id",
            requiredEnv: "UAIS_TEACHER_AUTH_OIDC_SMOKE_TEACHER_ID",
            status: "present",
          }),
        ]),
      );
      expect(body.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "s22-teacher-auth-issuer-route",
            auth: "oidc-jwks-bearer-token",
            status: "ok",
            responseHeaders: {
              checked: true,
              status: "ok",
              requiredHeaders: expect.objectContaining({
                teacherAuthClaimsSetCookie: "present",
                teacherAuthSignatureSetCookie: "present",
                httpOnlySameSiteSecureMaxAge: "present",
                priorityHigh: "present",
                issuerProofBoundedMaxAge: "present",
              }),
            },
            responseShapeChecks: [
              "teacherAuthSession",
              "authProviderContract",
              "s12TeacherAuthIssuerBoundary",
            ],
            responseShape: {
              checked: true,
              status: "ok",
              requiredFields: {
                teacherAuthSession: "present",
                authProviderContract: "present",
                s12TeacherAuthIssuerBoundary: "present",
              },
            },
          }),
          expect.objectContaining({
            id: "s22-teacher-ai-session-route",
            auth: "issued-teacher-auth-cookie",
            status: "ok",
          }),
          expect.objectContaining({
            id: "s22-teacher-ownership-route",
            auth: "issued-teacher-auth-cookie",
            status: "ok",
          }),
          expect.objectContaining({
            id: "s22-teacher-ppt-workflow-route",
            auth: "issued-teacher-auth-cookie",
            status: "ok",
          }),
        ]),
      );
      expect(requests.map((request) => request.url)).toEqual([
        "/api/ai/voice-assets/retention-readiness",
        "/api/ai/voice-clone/lifecycle-audit",
        "/api/ai/readiness",
        "/api/ai/smoke-plan",
        "/api/ai/teacher-auth/issue",
        "/api/ai/teacher-ownership",
        "/api/ai/session",
        "/api/ai/ppt-narration",
        "/api/ai/chat",
        "/api/ai/voice-sample",
        "/api/ai/voice-clone/preflight",
        "/api/ai/voice-clone/status",
        "/api/ai/voice-clone/revoke",
        "/api/ai/ppt-narration/export/audio-manifest-research-methods-unit-3",
        "/api/ai/ppt-narration/audio/audio-manifest-research-methods-unit-3/direct-call-smoke-audio",
        "/api/ai/ppt-narration",
        "/api/ai/chat",
        "/api/ai/voice-sample",
        "/api/ai/voice-clone/preflight",
        "/api/ai/voice-clone/status",
        "/api/ai/voice-clone/revoke",
        "/api/ai/ppt-narration/export/audio-manifest-research-methods-unit-3",
        "/api/ai/ppt-narration/audio/audio-manifest-research-methods-unit-3/direct-call-smoke-audio",
        "/api/ai/teacher-ownership",
        "/api/ai/teacher-ppt-workflow",
        "/api/ai/teacher-ownership",
        "/api/ai/teacher-ppt-workflow",
        "/api/ai/voice-assets/retention-readiness",
        "/api/ai/voice-clone/lifecycle-audit",
        "/api/ai/readiness",
        "/api/ai/smoke-plan",
        "/api/ai/voice-assets/retention-readiness",
        "/api/ai/voice-clone/lifecycle-audit",
        "/api/ai/readiness",
        "/api/ai/smoke-plan",
        "/api/ai/teacher-ppt-workflow",
      ]);
      for (const request of requests.slice(0, 4)) {
        expect(request.claimsHeader).toEqual(expect.any(String));
      }
      expect(requests[4].authorizationHeader).toBe(`Bearer ${oidcSmokeToken}`);
      expect(requests[4].claimsHeader).toBeUndefined();
      expect(requests[4].signatureHeader).toBeUndefined();
      expect(requests[4].issuerClaimsHeader).toBeUndefined();
      expect(requests[4].issuerSignatureHeader).toBeUndefined();
      expect(JSON.parse(requests[4].body)).toEqual({
        teacherId: "teacher-kang@example.test",
        ttlSeconds: 300,
      });
      for (const request of [requests[5], requests[6]]) {
        expect(request.cookieHeader).toBe(
          "uais_teacher_auth_claims=oidc-redacted-claims; uais_teacher_auth_signature=oidc-redacted-signature",
        );
        expect(request.authorizationHeader).toBeUndefined();
        expect(request.claimsHeader).toBeUndefined();
        expect(request.signatureHeader).toBeUndefined();
      }
      expect(requests[35].cookieHeader).toBe(
        "uais_teacher_auth_claims=oidc-redacted-claims; uais_teacher_auth_signature=oidc-redacted-signature",
      );
      expect(requests[35].authorizationHeader).toBeUndefined();
      expect(requests[35].claimsHeader).toBe("redacted-access-claims");
      expect(requests[35].signatureHeader).toBe("redacted-access-signature");
      for (const request of requests.slice(7, 15)) {
        expect(request.cookieHeader).toBeUndefined();
        expect(request.authorizationHeader).toBeUndefined();
        expect(request.claimsHeader).toBeUndefined();
        expect(request.signatureHeader).toBeUndefined();
      }
      for (const request of requests.slice(15, 23)) {
        expect(request.cookieHeader).toBeUndefined();
        expect(request.authorizationHeader).toBeUndefined();
        expect(request.claimsHeader).toBeUndefined();
        expect(request.signatureHeader).toBeUndefined();
      }
      for (const request of requests.slice(27, 31)) {
        expect(request.cookieHeader).toBeUndefined();
        expect(request.authorizationHeader).toBeUndefined();
        expect(request.claimsHeader).toBeUndefined();
        expect(request.signatureHeader).toBeUndefined();
      }
      for (const request of requests.slice(31, 35)) {
        expect(request.cookieHeader).toBeUndefined();
        expect(request.authorizationHeader).toBeUndefined();
        expect(request.claimsHeader).toBeUndefined();
        expect(request.signatureHeader).toBeUndefined();
      }
      expect(output).not.toContain(oidcSmokeToken);
      expect(output).not.toContain("secret-route-smoke-oidc-cli");
      expect(output).not.toContain("secret-teacher-route-smoke-oidc-cli");
      expect(output).not.toContain("identity.example.test");
      expect(output).not.toContain("uais-teacher-workflow");
      expect(output).not.toContain(tmpDir);
      expect(output).not.toContain("/Users/");
    } finally {
      await closeServerForTest(server);
    }
  });

  it("fails protected route smoke when the teacher workflow omits the download contract", async () => {
    const server = createServer((request, response) => {
      const claimsHeader = headerToString(request.headers["x-uais-access-claims"]);
      const signatureHeader = headerToString(request.headers["x-uais-access-signature"]);
      const issuerClaimsHeader = headerToString(
        request.headers["x-uais-teacher-auth-issuer-claims"],
      );
      const issuerSignatureHeader = headerToString(
        request.headers["x-uais-teacher-auth-issuer-signature"],
      );
      const cookieHeader = headerToString(request.headers.cookie);
      const authorized =
        request.url === "/api/ai/teacher-ppt-workflow" ||
        request.url === "/api/ai/session" ||
        request.url === "/api/ai/teacher-ownership"
          ? Boolean(cookieHeader?.includes("uais_teacher_auth_claims="))
          : request.url === "/api/ai/teacher-auth/issue"
            ? Boolean(
                claimsHeader &&
                  signatureHeader &&
                  issuerClaimsHeader &&
                  issuerSignatureHeader,
              )
          : Boolean(claimsHeader && signatureHeader);
      const responseHeaders: Record<string, string | string[]> = {
        "content-type": "application/json",
      };
      if (authorized && request.url === "/api/ai/teacher-auth/issue") {
        responseHeaders["set-cookie"] = [
          "uais_teacher_auth_claims=redacted-claims; Path=/; HttpOnly; SameSite=Lax; Max-Age=300; Secure; Priority=High",
          "uais_teacher_auth_signature=redacted-signature; Path=/; HttpOnly; SameSite=Lax; Max-Age=300; Secure; Priority=High",
        ];
      }
      if (isTeacherCookieRouteForTest(request.url) && !authorized) {
        response.writeHead(401, responseHeaders);
        response.end(JSON.stringify(createAuthenticatedSessionRequiredBodyForTest()));
        return;
      }
      response.writeHead(authorized ? 200 : 403, responseHeaders);
      response.end(
        JSON.stringify(
          request.url === "/api/ai/session"
            ? {
                accessSession: { headers: {} },
                accessPlan: { responsibleSession: "S12" },
                authProviderContract: { selector: "trusted-cookie-issuer" },
                progress: [
                  {
                    type: "s12-teacher-ai-session-boundary",
                    status: "issued",
                    responsibleSession: "S12",
                  },
                ],
              }
            : request.url === "/api/ai/teacher-ownership"
              ? {
                  ownership: { teacherId: "s22-route-smoke-teacher" },
                  consistency: { status: "ready" },
                  progress: [
                    {
                      type: "s12-teacher-ownership-auth-boundary",
                      status: "ready",
                      responsibleSession: "S12",
                    },
                  ],
                }
            : request.url === "/api/ai/teacher-ppt-workflow"
              ? {
                  workflow: {
                    status: "ready-for-downloads",
                    nextAction: "review-and-download-ppt-narration",
                  },
                  agentHandoffPlan: {
                    framework: "openmaic-style-teacher-ppt-narration",
                    handoffs: [
                      {
                        agentId: "s22-release-smoke-agent",
                        responsibleSession: "S22",
                      },
                    ],
                  },
                }
            : { ok: true },
        ),
      );
    });
    const baseUrl = await listenForTest(server);
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-route-smoke-download-contract-"));
    const envFile = join(tmpDir, "route-smoke-download-contract.test.env");
    writeFileSync(
      envFile,
      [
        "UAIS_AI_ACCESS_SIGNING_SECRET=secret-route-smoke-download-contract-cli",
        "UAIS_TEACHER_AUTH_PROVIDER=trusted-cookie-issuer",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-teacher-route-download-contract-cli",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET=secret-teacher-issuer-download-contract-cli",
      ].join("\n"),
    );

    try {
      const result = await execFileResultForTest("node", [
        "scripts/ai-route-smoke.mjs",
        "--live",
        "--approved",
        "--environment",
        "local-production",
        "--base-url",
        baseUrl,
        "--env-file",
        envFile,
      ]);
      const output = result.stdout;
      const body = JSON.parse(output);

      expect(result.exitCode).toBe(1);
      expect(body.status).toBe("failed");
      expect(body.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "s22-teacher-ppt-workflow-route",
            status: "failed",
            responseShape: {
              checked: true,
              status: "failed",
              requiredFields: expect.objectContaining({
                workflow: "present",
                workflowReadyForDownloads: "present",
                workflowDownloadContract: "missing",
                workflowAudioDownloadPattern: "missing",
                workflowExportDownloadUrl: "missing",
                agentHandoffPlan: "present",
                agentHandoffPlanFramework: "present",
                s22ReleaseSmokeAgent: "present",
              }),
            },
          }),
        ]),
      );
      expect(output).not.toContain("secret-route-smoke-download-contract-cli");
      expect(output).not.toContain("secret-teacher-route-download-contract-cli");
      expect(output).not.toContain("secret-teacher-issuer-download-contract-cli");
      expect(output).not.toContain(tmpDir);
      expect(output).not.toContain("/Users/");
    } finally {
      await closeServerForTest(server);
    }
  });

  it("fails protected route smoke when teacher auth cookies exceed the issuer proof TTL", async () => {
    const server = createServer((request, response) => {
      const authorized =
        request.url === "/api/ai/teacher-ppt-workflow" ||
        request.url === "/api/ai/session" ||
        request.url === "/api/ai/teacher-ownership"
          ? Boolean(headerToString(request.headers.cookie)?.includes("uais_teacher_auth_claims="))
          : request.url === "/api/ai/teacher-auth/issue"
            ? Boolean(
                request.headers["x-uais-access-claims"] &&
                  request.headers["x-uais-access-signature"] &&
                  request.headers["x-uais-teacher-auth-issuer-claims"] &&
                  request.headers["x-uais-teacher-auth-issuer-signature"],
              )
          : Boolean(
              request.headers["x-uais-access-claims"] &&
                request.headers["x-uais-access-signature"],
            );
      const responseHeaders: Record<string, string | string[]> = {
        "content-type": "application/json",
      };
      if (authorized && request.url === "/api/ai/teacher-auth/issue") {
        responseHeaders["set-cookie"] = [
          "uais_teacher_auth_claims=redacted-claims; Path=/; HttpOnly; SameSite=Lax; Max-Age=900; Secure; Priority=High",
          "uais_teacher_auth_signature=redacted-signature; Path=/; HttpOnly; SameSite=Lax; Max-Age=900; Secure; Priority=High",
        ];
      }
      if (isTeacherCookieRouteForTest(request.url) && !authorized) {
        response.writeHead(401, responseHeaders);
        response.end(JSON.stringify(createAuthenticatedSessionRequiredBodyForTest()));
        return;
      }
      response.writeHead(authorized ? 200 : 403, responseHeaders);
      response.end(
        JSON.stringify(
          request.url === "/api/ai/session"
            ? {
                accessSession: {
                  headers: {
                    "x-uais-access-claims": "redacted-access-claims",
                    "x-uais-access-signature": "redacted-access-signature",
                  },
                },
                accessPlan: { responsibleSession: "S12" },
                progress: [
                  {
                    type: "s12-teacher-ai-session-boundary",
                    status: "issued",
                    responsibleSession: "S12",
                  },
                ],
              }
            : request.url === "/api/ai/teacher-ownership"
              ? {
                  ownership: { teacherId: "s22-route-smoke-teacher" },
                  consistency: { status: "ready" },
                  progress: [
                    {
                      type: "s12-teacher-ownership-auth-boundary",
                      status: "ready",
                      responsibleSession: "S12",
                    },
                  ],
                }
            : request.url === "/api/ai/teacher-ppt-workflow"
              ? {
                  workflow: { status: "ready-for-downloads" },
                  agentHandoffPlan: {
                    framework: "openmaic-style-teacher-ppt-narration",
                    handoffs: [
                      {
                        agentId: "s22-release-smoke-agent",
                        responsibleSession: "S22",
                      },
                    ],
                  },
                }
            : { ok: true },
        ),
      );
    });
    const baseUrl = await listenForTest(server);
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-route-smoke-ttl-"));
    const envFile = join(tmpDir, "route-smoke-ttl.test.env");
    writeFileSync(
      envFile,
      [
        "UAIS_AI_ACCESS_SIGNING_SECRET=secret-route-smoke-ttl-cli",
        "UAIS_TEACHER_AUTH_PROVIDER=trusted-cookie-issuer",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-teacher-route-smoke-ttl-cli",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET=secret-teacher-issuer-route-smoke-ttl-cli",
      ].join("\n"),
    );

    try {
      const result = await execFileResultForTest("node", [
        "scripts/ai-route-smoke.mjs",
        "--live",
        "--approved",
        "--environment",
        "local-production",
        "--base-url",
        baseUrl,
        "--env-file",
        envFile,
      ]);
      expect(result.exitCode).not.toBe(0);
      const output = result.stdout;
      expect(output).not.toBe("");
      const body = JSON.parse(output);

      expect(body.status).toBe("failed");
      expect(body.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "s22-teacher-auth-issuer-route",
            status: "failed",
            responseHeaders: {
              checked: true,
              status: "failed",
              requiredHeaders: expect.objectContaining({
                issuerProofBoundedMaxAge: "missing",
              }),
            },
          }),
        ]),
      );
      expect(output).not.toContain("secret-route-smoke-ttl-cli");
      expect(output).not.toContain("secret-teacher-route-smoke-ttl-cli");
      expect(output).not.toContain("secret-teacher-issuer-route-smoke-ttl-cli");
      expect(output).not.toContain(tmpDir);
      expect(output).not.toContain("/Users/");
    } finally {
      await closeServerForTest(server);
    }
  });

  it("runs the protected route smoke CLI in dry-run mode with redacted blocker status", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-route-smoke-dry-"));
    const envFile = join(tmpDir, "route-smoke-dry.test.env");
    writeFileSync(
      envFile,
      [
        "UAIS_AI_ACCESS_SIGNING_SECRET=secret-route-smoke-dry-cli",
        "DASHSCOPE_API_KEY=secret-qwen-route-dry-cli",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/ai-route-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.target).toBe("deployment-route-smoke");
    expect(body.mode).toBe("dry-run");
    expect(body.environment).toBe("production");
    expect(body.network).toBe("disabled");
    expect(body.status).toBe("blocked");
    expect(body.blockedReasons).toEqual([
      "missing-UAIS_DEPLOYMENT_BASE_URL",
      "missing-UAIS_TEACHER_AUTH_PROVIDER",
      "missing-UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
      "missing-UAIS_TEACHER_AUTH_ISSUER_SECRET",
      "vercel-production-deployment-evidence-missing",
    ]);
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s22-deployment-base-url",
          requiredEnv: "UAIS_DEPLOYMENT_BASE_URL",
          status: "missing",
        }),
        expect.objectContaining({
          id: "s19-ai-access-signing-secret",
          requiredEnv: "UAIS_AI_ACCESS_SIGNING_SECRET",
          status: "present",
        }),
        expect.objectContaining({
          id: "s12-teacher-auth-provider",
          requiredEnv: "UAIS_TEACHER_AUTH_PROVIDER",
          status: "missing",
        }),
        expect.objectContaining({
          id: "s19-teacher-auth-session-signing-secret",
          requiredEnv: "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
          status: "missing",
        }),
        expect.objectContaining({
          id: "s22-vercel-production-deployment-evidence",
          requiredEvidence: "vercel-production-deployment",
          status: "missing",
          valueRedacted: true,
        }),
        expect.objectContaining({
          id: "s12-teacher-auth-issuer-secret",
          requiredEnv: "UAIS_TEACHER_AUTH_ISSUER_SECRET",
          status: "missing",
        }),
      ]),
    );
    expect(body.safety).toEqual({
      secretsRedacted: true,
      valuesRedacted: true,
      signedAdminAccess: true,
      issuedTeacherAuthCookie: true,
      oidcBearerTokenOmitted: true,
      responseBodiesOmitted: true,
      liveRequiresApproval: true,
      cookieValuesOmitted: true,
      remoteMutationRequiresApproval: true,
    });
    expect(output).not.toContain("secret-route-smoke-dry-cli");
    expect(output).not.toContain("secret-qwen-route-dry-cli");
    expect(output).not.toContain("/Users/");
  });

  it("plans a database-account-cookie route smoke without the trusted issuer secret", () => {
    // The prerequisite split used to be two-way, oidc versus issuer, so a
    // first-party deployment landed on the issuer branch and was reported as
    // blocked on a secret that selector never reads and no service anywhere
    // holds. What it actually needs is the session signing secret it verifies
    // with - already shared - plus the one credential this smoke cannot mint.
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-route-smoke-database-"));
    const envFile = join(tmpDir, "route-smoke-database.test.env");
    writeFileSync(
      envFile,
      [
        "UAIS_DEPLOYMENT_BASE_URL=https://uais.example.test",
        "UAIS_AI_ACCESS_SIGNING_SECRET=secret-route-smoke-database-ai-access",
        "UAIS_TEACHER_AUTH_PROVIDER=database-account-cookie",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-route-smoke-database-session",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/ai-route-smoke.mjs",
      "--dry-run",
      "--environment",
      "local-production",
      "--env-file",
      envFile,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.authProviderMode).toBe("database-account-cookie");
    expect(
      body.prerequisites.map((prerequisite: { requiredEnv?: string }) => prerequisite.requiredEnv),
    ).not.toContain("UAIS_TEACHER_AUTH_ISSUER_SECRET");
    expect(body.blockedReasons).not.toContain("missing-UAIS_TEACHER_AUTH_ISSUER_SECRET");
    // The operator-minted cookie is named for the same reason the OIDC branch
    // names its bearer token: a plan that stays silent about it reports "ready"
    // and then the live run throws.
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s22-teacher-auth-route-smoke-session-cookie",
          requiredEnv: "UAIS_TEACHER_AUTH_ROUTE_SMOKE_SESSION_COOKIE",
          status: "missing",
        }),
      ]),
    );
    expect(body.blockedReasons).toEqual([
      "missing-UAIS_TEACHER_AUTH_ROUTE_SMOKE_SESSION_COOKIE",
    ]);
    expect(output).not.toContain("secret-route-smoke-database-ai-access");
    expect(output).not.toContain("secret-route-smoke-database-session");
    expect(output).not.toContain("/Users/");
  });

  it("prints Node v24-safe help usage for protected route smoke env-file arguments", () => {
    const output = execFileSync("node", [
      "scripts/ai-route-smoke.mjs",
      "--help",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("Usage: node -- scripts/ai-route-smoke.mjs");
    expect(output).not.toContain("Usage: node scripts/ai-route-smoke.mjs");
  });

  it("prints a redacted deployment fingerprint for protected route smoke", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-route-smoke-fingerprint-"));
    const envFile = join(tmpDir, "route-smoke-fingerprint.test.env");
    const baseUrl = "https://deployment.example.test";
    const vercelDeploymentEvidence = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl,
      releaseRunId: "release-route-fingerprint",
    });
    writeFileSync(
      envFile,
      [
        `UAIS_DEPLOYMENT_BASE_URL=${baseUrl}`,
        "UAIS_AI_ACCESS_SIGNING_SECRET=secret-route-smoke-fingerprint-cli",
        "UAIS_TEACHER_AUTH_PROVIDER=trusted-cookie-issuer",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-teacher-auth-fingerprint-cli",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET=secret-teacher-auth-issuer-fingerprint-cli",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/ai-route-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
      "--vercel-production-deployment",
      vercelDeploymentEvidence,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("ready");
    expect(body.deploymentFingerprint).toEqual({
      status: "present",
      value: expect.stringMatching(/^sha256:[a-f0-9]{16}$/),
    });
    expect(body.deploymentOrigin).toEqual({
      status: "present",
      originClass: "remote-https",
      valueRedacted: true,
    });
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain("secret-route-smoke-fingerprint-cli");
    expect(output).not.toContain("secret-teacher-auth-fingerprint-cli");
    expect(output).not.toContain("secret-teacher-auth-issuer-fingerprint-cli");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("prints a redacted deployment origin class for local protected route smoke without leaking the URL", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-route-smoke-origin-local-"));
    const envFile = join(tmpDir, "route-smoke-origin-local.test.env");
    writeFileSync(
      envFile,
      [
        "UAIS_DEPLOYMENT_BASE_URL=http://localhost:8789",
        "UAIS_AI_ACCESS_SIGNING_SECRET=secret-route-smoke-origin-cli",
        "UAIS_TEACHER_AUTH_PROVIDER=trusted-cookie-issuer",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-teacher-auth-origin-cli",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET=secret-teacher-auth-issuer-origin-cli",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/ai-route-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.deploymentOrigin).toEqual({
      status: "present",
      originClass: "local-loopback",
      valueRedacted: true,
    });
    expect(output).not.toContain("localhost");
    expect(output).not.toContain("8789");
    expect(output).not.toContain("secret-route-smoke-origin-cli");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("prints a redacted deployment origin class for teacher workflow page smoke", () => {
    const output = execFileSync("node", [
      "scripts/teacher-workflow-deployment-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--base-url",
      "https://deployment.example.test",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.target).toBe("teacher-workflow-deployment-smoke");
    expect(body.deploymentOrigin).toEqual({
      status: "present",
      originClass: "remote-https",
      valueRedacted: true,
    });
    expect(output).not.toContain("deployment.example.test");
  });

  it("prints a redacted local deployment origin class for teacher workflow page smoke", () => {
    const output = execFileSync("node", [
      "scripts/teacher-workflow-deployment-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--base-url",
      "http://localhost:8790",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.deploymentOrigin).toEqual({
      status: "present",
      originClass: "local-loopback",
      valueRedacted: true,
    });
    expect(output).not.toContain("localhost");
    expect(output).not.toContain("8790");
  });

  it("blocks production OIDC route smoke when issuer or JWKS endpoints are not remote HTTPS", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-route-smoke-oidc-endpoint-security-"));
    const envFile = join(tmpDir, "route-smoke-oidc-endpoint-security.test.env");
    const baseUrl = "https://deployment.example.test";
    const vercelDeploymentEvidence = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl,
      releaseRunId: "release-route-oidc-endpoint-security",
    });
    writeFileSync(
      envFile,
      [
        `UAIS_DEPLOYMENT_BASE_URL=${baseUrl}`,
        "UAIS_AI_ACCESS_SIGNING_SECRET=secret-route-smoke-oidc-endpoint-cli",
        "UAIS_TEACHER_AUTH_PROVIDER=oidc-jwks",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-teacher-auth-oidc-endpoint-cli",
        "UAIS_TEACHER_AUTH_OIDC_ISSUER=http://localhost:8787",
        "UAIS_TEACHER_AUTH_OIDC_AUDIENCE=uais-teacher-workflow",
        "UAIS_TEACHER_AUTH_OIDC_JWKS_URL=http://localhost:8787/.well-known/jwks.json",
        "UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM=email",
        "UAIS_TEACHER_AUTH_OIDC_SMOKE_BEARER_TOKEN=secret-oidc-route-endpoint-token",
        "UAIS_TEACHER_AUTH_OIDC_SMOKE_TEACHER_ID=teacher-kang@example.test",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/ai-route-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
      "--vercel-production-deployment",
      vercelDeploymentEvidence,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "deployment-route-smoke",
        mode: "dry-run",
        environment: "production",
        authProviderMode: "oidc-jwks",
        network: "disabled",
        status: "blocked",
        blockedReasons: ["production-oidc-endpoints-not-remote-https"],
        deploymentOrigin: {
          status: "present",
          originClass: "remote-https",
          valueRedacted: true,
        },
        oidcEndpointSecurity: {
          issuer: "local-loopback",
          jwks: "local-loopback",
          valueRedacted: true,
        },
      }),
    );
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain("localhost");
    expect(output).not.toContain("8787");
    expect(output).not.toContain("secret-route-smoke-oidc-endpoint-cli");
    expect(output).not.toContain("secret-teacher-auth-oidc-endpoint-cli");
    expect(output).not.toContain("secret-oidc-route-endpoint-token");
    expect(output).not.toContain("teacher-kang@example.test");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("rejects protected route smoke live mode without explicit approval", () => {
    expect(() =>
      execFileSync("node", [
        "scripts/ai-route-smoke.mjs",
        "--live",
        "--base-url",
        "http://127.0.0.1:65535",
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).toThrow("explicit owner approval");
  });

  it("blocks production protected route live smoke for non-remote-HTTPS deployment origins before network requests", async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(`${request.method ?? "UNKNOWN"} ${request.url ?? "/"}`);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "unexpected-network-call" }));
    });
    const baseUrl = await listenForTest(server);
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-route-smoke-production-block-"));
    const envFile = join(tmpDir, "route-smoke-production-block.test.env");
    const vercelDeploymentEvidence = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl,
      releaseRunId: "release-route-production-origin-block",
    });
    writeFileSync(
      envFile,
      [
        "UAIS_AI_ACCESS_SIGNING_SECRET=secret-route-smoke-production-block-cli",
        "UAIS_TEACHER_AUTH_PROVIDER=trusted-cookie-issuer",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-teacher-route-production-block-cli",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET=secret-teacher-issuer-production-block-cli",
      ].join("\n"),
    );

    try {
      const result = await execFileResultForTest("node", [
        "scripts/ai-route-smoke.mjs",
        "--live",
        "--approved",
        "--environment",
        "production",
        "--base-url",
        baseUrl,
        "--env-file",
        envFile,
        "--release-run-id",
        "release-route-production-origin-block",
        "--vercel-production-deployment",
        vercelDeploymentEvidence,
      ]);
      expect(result.exitCode).toBe(1);
      const body = JSON.parse(result.stdout);

      expect(requests).toEqual([]);
      expect(body).toEqual(
        expect.objectContaining({
          target: "deployment-route-smoke",
          mode: "live",
          environment: "production",
          network: "enabled",
          status: "blocked",
          blockedReasons: [
            "production-deployment-origin-not-remote-https",
            "teacher-auth-provider-readiness-evidence-missing",
          ],
          deploymentOrigin: {
            status: "present",
            originClass: "local-loopback",
            valueRedacted: true,
          },
        }),
      );
      expect(body.prerequisites).toEqual(
        expect.arrayContaining([
          {
            id: "s22-teacher-auth-provider-readiness-evidence",
            responsibleSession: "S22",
            requiredEvidence: "teacher-auth-provider-readiness",
            status: "missing",
            valueRedacted: true,
          },
        ]),
      );
      expect(result.stdout).not.toContain(baseUrl);
      expect(result.stdout).not.toContain("missing-undefined");
      expect(result.stdout).not.toContain("secret-route-smoke-production-block-cli");
      expect(result.stdout).not.toContain("secret-teacher-route-production-block-cli");
      expect(result.stdout).not.toContain("secret-teacher-issuer-production-block-cli");
      expect(result.stdout).not.toContain("/Users/");
      expect(result.stderr).toBe("");
    } finally {
      await closeServerForTest(server);
    }
  });

  it("plans production teacher-auth issuer-only route smoke without teacher-auth readiness evidence", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-route-smoke-issuer-only-"));
    const envFile = join(tmpDir, "route-smoke-issuer-only.test.env");
    const baseUrl = "https://issuer-only-route.example.test";
    const releaseRunId = "release-route-issuer-only";
    const vercelDeploymentEvidence = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl,
      releaseRunId,
    });
    writeFileSync(
      envFile,
      [
        `UAIS_DEPLOYMENT_BASE_URL=${baseUrl}`,
        "UAIS_AI_ACCESS_SIGNING_SECRET=secret-route-smoke-issuer-only-cli",
        "UAIS_TEACHER_AUTH_PROVIDER=trusted-cookie-issuer",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-teacher-route-issuer-only-cli",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET=secret-teacher-issuer-route-only-cli",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/ai-route-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--teacher-auth-issuer-only",
      "--env-file",
      envFile,
      "--release-run-id",
      releaseRunId,
      "--vercel-production-deployment",
      vercelDeploymentEvidence,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "teacher-auth-issuer-route-smoke",
        mode: "dry-run",
        environment: "production",
        network: "disabled",
        status: "ready",
        authProviderMode: "trusted-cookie-issuer",
        releaseRunId,
        vercelProductionDeploymentEvidence: {
          target: "vercel-production-deployment",
          status: "matched",
          deploymentObservationStatus: "observed",
          releaseRunIdStatus: "matched",
          valueRedacted: true,
        },
      }),
    );
    expect(body).not.toHaveProperty("teacherAuthProviderReadinessEvidence");
    expect(body.routeChecks).toEqual([
      expect.objectContaining({
        id: "s22-teacher-auth-issuer-route",
        route: "/api/ai/teacher-auth/issue",
      }),
    ]);
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain("secret-route-smoke-issuer-only-cli");
    expect(output).not.toContain("secret-teacher-route-issuer-only-cli");
    expect(output).not.toContain("secret-teacher-issuer-route-only-cli");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("accepts production alias route smoke when domain reachability evidence matches the base URL", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-route-smoke-domain-alias-"));
    const envFile = join(tmpDir, "route-smoke-domain-alias.test.env");
    const aliasBaseUrl = "https://www.uais.example.test";
    const releaseRunId = "release-route-domain-alias";
    const vercelDeploymentEvidence = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl: "https://deployment-id.vercel.app",
      releaseRunId,
    });
    const deploymentDomainReachability = writeDeploymentDomainReachabilityEvidenceForTest(
      tmpDir,
      {
        baseUrl: aliasBaseUrl,
        releaseRunId,
      },
    );
    writeFileSync(
      envFile,
      [
        `UAIS_DEPLOYMENT_BASE_URL=${aliasBaseUrl}`,
        "UAIS_AI_ACCESS_SIGNING_SECRET=secret-route-smoke-domain-alias-cli",
        "UAIS_TEACHER_AUTH_PROVIDER=trusted-cookie-issuer",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-teacher-route-domain-alias-cli",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET=secret-teacher-issuer-domain-alias-cli",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/ai-route-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--teacher-auth-issuer-only",
      "--env-file",
      envFile,
      "--release-run-id",
      releaseRunId,
      "--vercel-production-deployment",
      vercelDeploymentEvidence,
      "--deployment-domain-reachability",
      deploymentDomainReachability,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "teacher-auth-issuer-route-smoke",
        mode: "dry-run",
        environment: "production",
        status: "ready",
        releaseRunId,
        vercelProductionDeploymentEvidence: {
          target: "vercel-production-deployment",
          status: "matched-via-domain-reachability",
          deploymentObservationStatus: "observed",
          releaseRunIdStatus: "matched",
          deploymentDomainReachabilityStatus: "matched",
          valueRedacted: true,
        },
        deploymentDomainReachabilityEvidence: {
          target: "deployment-domain-reachability",
          status: "matched",
          releaseRunIdStatus: "matched",
          deploymentFingerprintStatus: "matched",
          valueRedacted: true,
        },
      }),
    );
    expect(body.blockedReasons).toEqual([]);
    expect(output).not.toContain(aliasBaseUrl);
    expect(output).not.toContain("deployment-id.vercel.app");
    expect(output).not.toContain("secret-route-smoke-domain-alias-cli");
    expect(output).not.toContain("secret-teacher-route-domain-alias-cli");
    expect(output).not.toContain("secret-teacher-issuer-domain-alias-cli");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("rejects production protected route live smoke without a release-run id before network requests", async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(`${request.method ?? "UNKNOWN"} ${request.url ?? "/"}`);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "unexpected-network-call" }));
    });
    const baseUrl = await listenForTest(server);
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-route-smoke-missing-run-id-"));
    const envFile = join(tmpDir, "route-smoke-missing-run-id.test.env");
    const vercelDeploymentEvidence = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl,
      releaseRunId: "release-route-existing-deployment",
    });
    const teacherAuthReadinessEvidence = writeTeacherAuthProviderReadinessEvidenceForTest(
      tmpDir,
      {
        authProviderMode: "trusted-cookie-issuer",
        releaseRunId: "release-route-existing-deployment",
      },
    );
    writeFileSync(
      envFile,
      [
        "UAIS_AI_ACCESS_SIGNING_SECRET=secret-route-smoke-missing-run-id-cli",
        "UAIS_TEACHER_AUTH_PROVIDER=trusted-cookie-issuer",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-teacher-route-missing-run-id-cli",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET=secret-teacher-issuer-missing-run-id-cli",
      ].join("\n"),
    );

    try {
      const result = await execFileResultForTest("node", [
        "scripts/ai-route-smoke.mjs",
        "--live",
        "--approved",
        "--environment",
        "production",
        "--base-url",
        baseUrl,
        "--env-file",
        envFile,
        "--vercel-production-deployment",
        vercelDeploymentEvidence,
        "--teacher-auth-provider-readiness",
        teacherAuthReadinessEvidence,
      ]);

      expect(result.exitCode).toBe(1);
      expect(requests).toEqual([]);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Protected route smoke checks require --release-run-id");
      expect(result.stderr).not.toContain(baseUrl);
      expect(result.stderr).not.toContain(tmpDir);
      expect(result.stderr).not.toContain("secret-route-smoke-missing-run-id-cli");
      expect(result.stderr).not.toContain("secret-teacher-route-missing-run-id-cli");
      expect(result.stderr).not.toContain("secret-teacher-issuer-missing-run-id-cli");
      expect(result.stderr).not.toContain("/Users/");
    } finally {
      await closeServerForTest(server);
    }
  });

  it("blocks protected route smoke when Vercel production deployment evidence is for a different deployment", async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(`${request.method ?? "UNKNOWN"} ${request.url ?? "/"}`);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "unexpected-network-call" }));
    });
    const baseUrl = await listenForTest(server);
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-route-smoke-vercel-evidence-"));
    const envFile = join(tmpDir, "route-smoke-vercel-evidence.test.env");
    const releaseRunId = "release-route-evidence-binding";
    const mismatchedEvidence = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl: "https://different-route-production.example.test",
      releaseRunId,
    });
    writeFileSync(
      envFile,
      [
        "UAIS_AI_ACCESS_SIGNING_SECRET=secret-route-smoke-vercel-evidence-cli",
        "UAIS_TEACHER_AUTH_PROVIDER=trusted-cookie-issuer",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-teacher-route-vercel-evidence-cli",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET=secret-teacher-issuer-vercel-evidence-cli",
      ].join("\n"),
    );

    try {
      const result = await execFileResultForTest("node", [
        "scripts/ai-route-smoke.mjs",
        "--live",
        "--approved",
        "--environment",
        "local-production",
        "--base-url",
        baseUrl,
        "--env-file",
        envFile,
        "--release-run-id",
        releaseRunId,
        "--vercel-production-deployment",
        mismatchedEvidence,
      ]);
      const body = JSON.parse(result.stdout);

      expect(result.exitCode).toBe(1);
      expect(requests).toEqual([]);
      expect(body).toEqual(
        expect.objectContaining({
          target: "deployment-route-smoke",
          mode: "live",
          environment: "local-production",
          network: "enabled",
          status: "blocked",
          blockedReasons: ["vercel-production-deployment-fingerprint-mismatch"],
          vercelProductionDeploymentEvidence: {
            target: "vercel-production-deployment",
            status: "mismatched",
            deploymentObservationStatus: "observed",
            releaseRunIdStatus: "matched",
            valueRedacted: true,
          },
        }),
      );
      expect(body.prerequisites).toEqual(
        expect.arrayContaining([
          {
            id: "s22-vercel-production-deployment-evidence",
            responsibleSession: "S22",
            requiredEvidence: "vercel-production-deployment",
            status: "mismatched",
            valueRedacted: true,
          },
        ]),
      );
      expect(result.stdout).not.toContain(baseUrl);
      expect(result.stdout).not.toContain("different-route-production.example.test");
      expect(result.stdout).not.toContain("secret-route-smoke-vercel-evidence-cli");
      expect(result.stdout).not.toContain("secret-teacher-route-vercel-evidence-cli");
      expect(result.stdout).not.toContain("secret-teacher-issuer-vercel-evidence-cli");
      expect(result.stdout).not.toContain(tmpDir);
      expect(result.stdout).not.toContain("/Users/");
      expect(result.stderr).toBe("");
    } finally {
      await closeServerForTest(server);
    }
  });

  it("requires Vercel production deployment evidence for production protected route smoke plans", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-route-smoke-missing-vercel-"));
    const envFile = join(tmpDir, "route-smoke-missing-vercel.test.env");
    const releaseRunId = "release-route-missing-vercel-binding";
    const teacherAuthReadinessEvidence = writeTeacherAuthProviderReadinessEvidenceForTest(
      tmpDir,
      {
        authProviderMode: "trusted-cookie-issuer",
        releaseRunId,
      },
    );
    writeFileSync(
      envFile,
      [
        "UAIS_DEPLOYMENT_BASE_URL=https://route-smoke.example.test",
        "UAIS_AI_ACCESS_SIGNING_SECRET=secret-route-smoke-missing-vercel-cli",
        "UAIS_TEACHER_AUTH_PROVIDER=trusted-cookie-issuer",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-teacher-route-missing-vercel-cli",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET=secret-teacher-issuer-missing-vercel-cli",
      ].join("\n"),
    );

    const result = await execFileResultForTest("node", [
      "scripts/ai-route-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
      "--release-run-id",
      releaseRunId,
      "--teacher-auth-provider-readiness",
      teacherAuthReadinessEvidence,
    ]);
    const body = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(body).toEqual(
      expect.objectContaining({
        target: "deployment-route-smoke",
        mode: "dry-run",
        environment: "production",
        network: "disabled",
        status: "blocked",
        blockedReasons: ["vercel-production-deployment-evidence-missing"],
        vercelProductionDeploymentEvidence: {
          target: "missing",
          status: "missing",
          deploymentObservationStatus: "missing",
          releaseRunIdStatus: "missing",
          valueRedacted: true,
        },
      }),
    );
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        {
          id: "s22-vercel-production-deployment-evidence",
          responsibleSession: "S22",
          requiredEvidence: "vercel-production-deployment",
          status: "missing",
          valueRedacted: true,
        },
      ]),
    );
    expect(result.stdout).not.toContain("route-smoke.example.test");
    expect(result.stdout).not.toContain("secret-route-smoke-missing-vercel-cli");
    expect(result.stdout).not.toContain("secret-teacher-route-missing-vercel-cli");
    expect(result.stdout).not.toContain("secret-teacher-issuer-missing-vercel-cli");
    expect(result.stdout).not.toContain(tmpDir);
    expect(result.stdout).not.toContain("/Users/");
    expect(result.stderr).toBe("");
  });

  it("prints release-run binding status for protected route smoke evidence", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-route-smoke-release-run-binding-"));
    const envFile = join(tmpDir, "route-smoke-release-run-binding.test.env");
    const baseUrl = "https://route-smoke-release.example.test";
    const releaseRunId = "release-route-smoke-current-run";
    const vercelDeploymentEvidence = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl,
      releaseRunId,
    });
    const teacherAuthReadinessEvidence = writeTeacherAuthProviderReadinessEvidenceForTest(
      tmpDir,
      {
        authProviderMode: "trusted-cookie-issuer",
        releaseRunId,
      },
    );
    writeFileSync(
      envFile,
      [
        `UAIS_DEPLOYMENT_BASE_URL=${baseUrl}`,
        "UAIS_AI_ACCESS_SIGNING_SECRET=secret-route-smoke-release-run-cli",
        "UAIS_TEACHER_AUTH_PROVIDER=trusted-cookie-issuer",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-teacher-route-release-run-cli",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET=secret-teacher-issuer-release-run-cli",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/ai-route-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
      "--release-run-id",
      releaseRunId,
      "--vercel-production-deployment",
      vercelDeploymentEvidence,
      "--teacher-auth-provider-readiness",
      teacherAuthReadinessEvidence,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("ready");
    expect(body.vercelProductionDeploymentEvidence).toEqual(
      expect.objectContaining({
        target: "vercel-production-deployment",
        status: "matched",
        deploymentObservationStatus: "observed",
        releaseRunIdStatus: "matched",
        valueRedacted: true,
      }),
    );
    expect(body.teacherAuthProviderReadinessEvidence).toEqual(
      expect.objectContaining({
        target: "teacher-auth-provider-readiness",
        status: "matched",
        authProviderMode: "trusted-cookie-issuer",
        releaseRunIdStatus: "matched",
        valueRedacted: true,
      }),
    );
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain("secret-route-smoke-release-run-cli");
    expect(output).not.toContain("secret-teacher-route-release-run-cli");
    expect(output).not.toContain("secret-teacher-issuer-release-run-cli");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("blocks protected route smoke before network requests when teacher auth readiness selected a different provider", async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(`${request.method ?? "UNKNOWN"} ${request.url ?? "/"}`);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "unexpected-network-call" }));
    });
    const baseUrl = await listenForTest(server);
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-route-smoke-auth-readiness-"));
    const envFile = join(tmpDir, "route-smoke-auth-readiness.test.env");
    const releaseRunId = "release-route-auth-readiness-binding";
    const vercelDeploymentEvidence = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl,
      releaseRunId,
    });
    const teacherAuthReadinessEvidence = writeTeacherAuthProviderReadinessEvidenceForTest(
      tmpDir,
      {
        authProviderMode: "oidc-jwks",
        releaseRunId,
      },
    );
    writeFileSync(
      envFile,
      [
        "UAIS_AI_ACCESS_SIGNING_SECRET=secret-route-smoke-auth-readiness-cli",
        "UAIS_TEACHER_AUTH_PROVIDER=trusted-cookie-issuer",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-teacher-route-auth-readiness-cli",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET=secret-teacher-issuer-auth-readiness-cli",
      ].join("\n"),
    );

    try {
      const result = await execFileResultForTest("node", [
        "scripts/ai-route-smoke.mjs",
        "--live",
        "--approved",
        "--environment",
        "local-production",
        "--base-url",
        baseUrl,
        "--env-file",
        envFile,
        "--release-run-id",
        releaseRunId,
        "--vercel-production-deployment",
        vercelDeploymentEvidence,
        "--teacher-auth-provider-readiness",
        teacherAuthReadinessEvidence,
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("");
      expect(requests).toEqual([]);
      const body = JSON.parse(result.stdout);
      expect(body).toEqual(
        expect.objectContaining({
          target: "deployment-route-smoke",
          mode: "live",
          environment: "local-production",
          network: "enabled",
          status: "blocked",
          blockedReasons: ["teacher-auth-provider-readiness-selector-mismatch"],
          teacherAuthProviderReadinessEvidence: {
            target: "teacher-auth-provider-readiness",
            status: "mismatched",
            authProviderMode: "oidc-jwks",
            releaseRunIdStatus: "matched",
            valueRedacted: true,
          },
        }),
      );
      expect(body.prerequisites).toEqual(
        expect.arrayContaining([
          {
            id: "s22-teacher-auth-provider-readiness-evidence",
            responsibleSession: "S22",
            requiredEvidence: "teacher-auth-provider-readiness",
            status: "mismatched",
            valueRedacted: true,
          },
        ]),
      );
      expect(result.stdout).not.toContain(baseUrl);
      expect(result.stdout).not.toContain("secret-route-smoke-auth-readiness-cli");
      expect(result.stdout).not.toContain("secret-teacher-route-auth-readiness-cli");
      expect(result.stdout).not.toContain("secret-teacher-issuer-auth-readiness-cli");
      expect(result.stdout).not.toContain(tmpDir);
      expect(result.stdout).not.toContain("/Users/");
    } finally {
      await closeServerForTest(server);
    }
  });

  it("runs the external storage smoke CLI in dry-run mode without leaking storage values", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-external-storage-dry-"));
    const envFile = join(tmpDir, "external-storage-dry.test.env");
    writeFileSync(
      envFile,
      [
        "UAIS_EXTERNAL_STORAGE_BASE_URL=https://storage.example.test/uais",
        "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=secret-external-storage-cli",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/external-storage-smoke.mjs",
      "--dry-run",
      "--env-file",
      envFile,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

      expect(body).toEqual(
        expect.objectContaining({
          target: "external-storage-smoke",
          mode: "dry-run",
          environment: "unspecified",
          network: "disabled",
          status: "blocked",
          storageEndpoint: {
            status: "present",
            networkClass: "remote",
            endpointClass: "remote-https",
            valueRedacted: true,
          },
          storageServiceFingerprint: {
            status: "present",
            value: expect.stringMatching(/^sha256:[a-f0-9]{16}$/),
            source: "origin",
            valueRedacted: true,
          },
        responsibleSession: "S22",
        blockedReasons: ["missing-teacher-id"],
      }),
    );
    expect(body.prerequisites).toEqual([
      {
        id: "s19-external-storage-base-url",
        responsibleSession: "S19",
        requiredEnv: "UAIS_EXTERNAL_STORAGE_BASE_URL",
        status: "present",
      },
      {
        id: "s19-external-storage-access-token",
        responsibleSession: "S19",
        requiredEnv: "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
        status: "present",
      },
      {
        id: "s22-external-storage-smoke-teacher-id",
        responsibleSession: "S22",
        requiredArg: "--teacher-id",
        status: "missing",
      },
    ]);
    expect(body.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "s22-external-storage-health",
        endpointTemplate: "/healthz",
        method: "GET",
        responsibleSessions: ["S22", "S12", "S24", "S19"],
        responseShapeChecks: [
          "status",
          "target",
          "apiContractVersion",
          "cacheControlNoStore",
          "durableBackingStore",
          "teachingOperationsStorageSchema",
          "teachingOperationsStorageSchema.status",
          "teachingOperationsStorageSchema.schemaVersion",
          "teachingOperationsStorageSchema.migrationStatus",
          "teachingOperationsStorageSchema.operationLedger",
          "teachingOperationsStorageSchema.auditLedger",
          "teachingOperationsStorageSchema.rollbackLedger",
          "teachingOperationsStorageSchema.backupStore",
          "teachingOperationsStorageSchema.restoreDrillLog",
          "teachingOperationsStorageSchema.concurrencyControl",
          "teachingOperationsStorageSchema.valueRedacted",
          "teachingCourseManagementStorageSchema",
          "teachingCourseManagementStorageSchema.status",
          "teachingCourseManagementStorageSchema.schemaVersion",
          "teachingCourseManagementStorageSchema.migrationStatus",
          "teachingCourseManagementStorageSchema.snapshotStore",
          "teachingCourseManagementStorageSchema.auditLog",
          "teachingCourseManagementStorageSchema.backupStore",
          "teachingCourseManagementStorageSchema.restoreDrillLog",
          "teachingCourseManagementStorageSchema.revisionControl",
          "teachingCourseManagementStorageSchema.concurrencyControl",
          "teachingCourseManagementStorageSchema.valueRedacted",
          "teachingCourseAssetsStorageSchema",
          "teachingCourseAssetsStorageSchema.status",
          "teachingCourseAssetsStorageSchema.schemaVersion",
          "teachingCourseAssetsStorageSchema.migrationStatus",
          "teachingCourseAssetsStorageSchema.snapshotStore",
          "teachingCourseAssetsStorageSchema.auditLog",
          "teachingCourseAssetsStorageSchema.backupStore",
          "teachingCourseAssetsStorageSchema.restoreDrillLog",
          "teachingCourseAssetsStorageSchema.revisionControl",
          "teachingCourseAssetsStorageSchema.concurrencyControl",
          "teachingCourseAssetsStorageSchema.valueRedacted",
          "productionServiceIdentity",
          "redaction",
        ],
      }),
      expect.objectContaining({
        id: "s12-external-teacher-ownership-merge",
        endpointTemplate: "/teacher-ai-ownership/{teacherId}/merge",
        method: "POST",
        responsibleSessions: ["S22", "S12", "S19"],
        responseShapeChecks: ["status", "storageWritePolicy", "redaction"],
      }),
      expect.objectContaining({
        id: "s12-external-teacher-ownership-read",
        endpointTemplate: "/teacher-ai-ownership/{teacherId}",
        method: "GET",
        responsibleSessions: ["S22", "S12", "S19"],
        responseShapeChecks: [
          "teacherId",
          "courseIds",
          "assetCollections",
          "smokeGrantMerged",
          "runScopedSmokeGrant",
          "privateFieldsOmitted",
        ],
      }),
      expect.objectContaining({
        id: "s12-external-course-management-backup-restore-drill",
        endpointTemplate:
          "/teaching-course-management/backups + /teaching-course-management/backups/{backupId}/restore-drill",
        method: "POST",
        responsibleSessions: ["S22", "S12", "S19"],
        responseShapeChecks: [
          "backupStatus",
          "restoreDrillStatus",
          "backupStorageWritePolicy",
          "restoreDrillStorageWritePolicy",
          "redaction",
        ],
      }),
      expect.objectContaining({
        id: "s12-external-course-assets-backup-restore-drill",
        endpointTemplate:
          "/teaching-course-assets/backups + /teaching-course-assets/backups/{backupId}/restore-drill",
        method: "POST",
        responsibleSessions: ["S22", "S12", "S19"],
        responseShapeChecks: [
          "backupStatus",
          "restoreDrillStatus",
          "backupStorageWritePolicy",
          "restoreDrillStorageWritePolicy",
          "redaction",
        ],
      }),
      expect.objectContaining({
        id: "s12-external-teaching-operations-backup-restore-drill",
        endpointTemplate:
          "/teaching-operations/{teacherId}/backups + /teaching-operations/{teacherId}/backups/{backupId}/restore-drill",
        method: "POST",
        responsibleSessions: ["S22", "S12", "S19"],
        responseShapeChecks: [
          "backupStatus",
          "restoreDrillStatus",
          "backupStorageWritePolicy",
          "restoreDrillStorageWritePolicy",
          "redaction",
        ],
      }),
      expect.objectContaining({
        id: "s24-external-lifecycle-audit-append",
        endpointTemplate: "/qwen-voice-lifecycle-audit",
        method: "POST",
        responsibleSessions: ["S22", "S24", "S19"],
        responseShapeChecks: ["status", "provider", "redaction"],
      }),
      expect.objectContaining({
        id: "s24-external-lifecycle-audit-read",
        endpointTemplate: "/qwen-voice-lifecycle-audit",
        method: "GET",
        responsibleSessions: ["S22", "S24", "S19"],
        responseShapeChecks: [
          "provider",
          "eventType",
          "eventsArray",
          "smokeAuditEventPresent",
          "runScopedSmokeAuditEvent",
          "redaction",
        ],
      }),
    ]));
    expect(body.safety).toEqual({
      secretsRedacted: true,
      valuesRedacted: true,
      approvedWriteThenRead: true,
      destructiveWrites: false,
      writePayloadsRedacted: true,
      responseBodiesOmitted: true,
      liveRequiresApproval: true,
      cookieValuesOmitted: true,
      remoteMutationRequiresApproval: true,
    });
    expect(output).not.toContain("secret-external-storage-cli");
    expect(output).not.toContain("storage.example.test");
    expect(output).not.toContain("/Users/");
  });

  it("runs the external storage smoke CLI in approved local-reference live write/read mode without leaking bodies", async () => {
    const requests: Array<{
      method: string | undefined;
      url: string | undefined;
      authorization: string | undefined;
    }> = [];
    const writes = {
      ownershipMerged: false,
      lifecycleAuditAppended: false,
      audioManifestId: "",
      lifecycleAuditEventId: "",
    };
    const teachingOperationRecords: unknown[] = [];
    const teachingOperationAuditEvents: unknown[] = [];
    const teachingOperationDomainProjections: unknown[] = [];
    const courseManagementBackupId = "teaching-course-management-backup-20260625-120000";
    const courseAssetsBackupId = "teaching-course-assets-backup-20260625-120500";
    const teachingOperationsBackupId =
      "teaching-operations-backup-teacher-kang-20260625-121000";
    const server = createServer(async (request, response) => {
      const authorization = headerToString(request.headers.authorization);
      requests.push({
        method: request.method,
        url: request.url,
        authorization,
      });
      const authorized =
        request.url === "/healthz" ||
        authorization === "Bearer secret-external-storage-cli";
      response.setHeader("content-type", "application/json");
      response.setHeader("cache-control", "no-store");
      if (request.url === "/healthz") {
        response.statusCode = 200;
        response.end(
          JSON.stringify({
            status: "ok",
            target: "uais-external-storage-reference-service",
            apiContractVersion: "uais-external-storage-v1",
            productionServiceIdentity: {
              status: "not-production",
              serviceMode: "reference",
              serviceTarget: "uais-external-storage-reference-service",
              valueRedacted: true,
            },
            durableBackingStore: {
              status: "ready",
              storageMode: "file-backed",
              probe: "write-read-delete",
              ownershipWritePolicy: "external-atomic-merge",
              lifecycleAuditWritePolicy: "append-only-redacted-lifecycle-audit",
              valueRedacted: true,
            },
            teachingOperationsStorageSchema: {
              status: "ready",
              schemaVersion: "uais-teaching-operations-v1",
              migrationStatus: "up-to-date",
              operationLedger: "jsonl-append-only",
              auditLedger: "jsonl-append-only",
              rollbackLedger: "jsonl-append-only",
              backupStore: "json-atomic-snapshot",
              restoreDrillLog: "jsonl-append-only",
              concurrencyControl: "atomic-append-and-rename",
              valueRedacted: true,
            },
            ...createReadyOrdinaryCourseStorageSchemasForTest(),
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
            leakSentinel: "server-secret-should-not-leak",
          }),
        );
        return;
      }
      if (!authorized) {
        response.statusCode = 401;
        response.end(
          JSON.stringify({
            error: "External storage authorization is required.",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        );
        return;
      }
      if (request.method === "POST" && request.url === "/teacher-ai-ownership/teacher-kang/merge") {
        const body = await readBodyForTest(request);
        writes.ownershipMerged = body.includes("merge-teacher-ai-ownership");
        const parsed = JSON.parse(body);
        writes.audioManifestId = parsed.ownership.audioManifests[0].audioManifestId;
        response.end(
          JSON.stringify({
            status: "merged",
            storagePolicy: "external-redacted-teacher-ai-ownership-merge",
            storageWritePolicy: "external-atomic-merge",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
            leakSentinel: "server-secret-should-not-leak",
          }),
        );
        return;
      }
      if (request.method === "GET" && request.url === "/teacher-ai-ownership/teacher-kang") {
        response.end(
          JSON.stringify({
            teacherId: "teacher-kang",
            courseIds: ["research-methods"],
            sampleAssets: [
              {
                sampleAssetId: "asset-voice-10s",
                courseId: "research-methods",
                sourcePath: "/Users/dongpinhu/Library/Containers/private.m4a",
              },
            ],
            pptAssets: [
              { pptAssetId: "research-methods-unit-3", courseId: "research-methods" },
            ],
            clonedVoiceRefs: [
              {
                voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
                sampleAssetId: "asset-voice-10s",
                privateProviderVoiceId: "voice-qwen-private-should-not-leak",
              },
            ],
            audioManifests: [
              {
                audioManifestId: "audio-manifest-research-methods-unit-3",
                courseId: "research-methods",
                pptAssetId: "research-methods-unit-3",
                voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
                audioBase64: "data:audio/wav;base64,server-secret-should-not-leak",
              },
              ...(writes.ownershipMerged
                ? [
                    {
                      audioManifestId: writes.audioManifestId,
                      courseId: "uais-external-storage-smoke-course",
                      pptAssetId: "uais-external-storage-smoke-ppt",
                      voiceRefId: "uais-external-storage-smoke-voice-ref",
                    },
                  ]
                : []),
            ],
            leakSentinel: "server-secret-should-not-leak",
          }),
        );
        return;
      }
      if (request.method === "POST" && request.url === "/teaching-course-management/backups") {
        await readBodyForTest(request);
        response.end(
          JSON.stringify({
            backupId: courseManagementBackupId,
            status: "persisted",
            eventType: "teaching-course-management-backup.created",
            sourceRecordCounts: {
              courses: 0,
              classes: 0,
              memberships: 0,
              auditEvents: 0,
            },
            storagePolicy: "external-redacted-teaching-course-management-backup",
            storageWritePolicy: "external-atomic-backup-snapshot",
            responsibleSession: "S12",
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
        request.url === `/teaching-course-management/backups/${courseManagementBackupId}/restore-drill`
      ) {
        await readBodyForTest(request);
        response.end(
          JSON.stringify({
            backupId: courseManagementBackupId,
            drillId: `teaching-course-management-restore-drill-${courseManagementBackupId}`,
            status: "verified",
            eventType: "teaching-course-management-backup.restore-drill-verified",
            restoredRecordCounts: {
              courses: 0,
              classes: 0,
              memberships: 0,
              auditEvents: 0,
            },
            storagePolicy: "external-redacted-teaching-course-management-restore-drill",
            storageWritePolicy: "external-append-only-restore-drill-log",
            responsibleSession: "S12",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        );
        return;
      }
      if (request.method === "POST" && request.url === "/teaching-course-assets/backups") {
        await readBodyForTest(request);
        response.end(
          JSON.stringify({
            backupId: courseAssetsBackupId,
            status: "persisted",
            eventType: "teaching-course-assets-backup.created",
            sourceRecordCounts: {
              assets: 0,
              auditEvents: 0,
            },
            storagePolicy: "external-redacted-teaching-course-assets-backup",
            storageWritePolicy: "external-atomic-backup-snapshot",
            responsibleSession: "S12",
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
        request.url === `/teaching-course-assets/backups/${courseAssetsBackupId}/restore-drill`
      ) {
        await readBodyForTest(request);
        response.end(
          JSON.stringify({
            backupId: courseAssetsBackupId,
            drillId: `teaching-course-assets-restore-drill-${courseAssetsBackupId}`,
            status: "verified",
            eventType: "teaching-course-assets-backup.restore-drill-verified",
            restoredRecordCounts: {
              assets: 0,
              auditEvents: 0,
            },
            storagePolicy: "external-redacted-teaching-course-assets-restore-drill",
            storageWritePolicy: "external-append-only-restore-drill-log",
            responsibleSession: "S12",
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
        request.url === "/teaching-operations/teacher-kang/backups"
      ) {
        await readBodyForTest(request);
        response.end(
          JSON.stringify({
            backupId: teachingOperationsBackupId,
            status: "persisted",
            eventType: "teaching-operation-backup.created",
            sourceRecordCounts: {
              operations: 0,
              auditEvents: 0,
              rollbacks: 0,
              alertNotifications: 0,
            },
            storagePolicy: "external-redacted-teaching-operation-backup",
            storageWritePolicy: "external-atomic-backup-snapshot",
            responsibleSession: "S12",
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
          `/teaching-operations/teacher-kang/backups/${teachingOperationsBackupId}/restore-drill`
      ) {
        await readBodyForTest(request);
        response.end(
          JSON.stringify({
            backupId: teachingOperationsBackupId,
            drillId: `teaching-operations-restore-drill-${teachingOperationsBackupId}`,
            status: "verified",
            eventType: "teaching-operation-backup.restore-drill-verified",
            restoredRecordCounts: {
              operations: 0,
              auditEvents: 0,
              rollbacks: 0,
              alertNotifications: 0,
            },
            storagePolicy: "external-redacted-teaching-operation-restore-drill",
            storageWritePolicy: "external-append-only-restore-drill-log",
            responsibleSession: "S12",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        );
        return;
      }
      if (request.method === "POST" && request.url === "/teaching-operations/teacher-kang/append") {
        const parsed = JSON.parse(await readBodyForTest(request));
        const appendSequence = teachingOperationRecords.length + 1;
        const record = {
          ...parsed.record,
          appendSequence,
        };
        teachingOperationRecords.push(record);
        if (parsed.auditEvent) {
          teachingOperationAuditEvents.push(parsed.auditEvent);
        }
        if (Array.isArray(parsed.record?.domainProjections)) {
          teachingOperationDomainProjections.push(...parsed.record.domainProjections);
        }
        response.end(
          JSON.stringify({
            teacherId: "teacher-kang",
            receiptId: parsed.record.recordId,
            status: "persisted",
            idempotencyStatus: "created",
            appendSequence,
            storagePolicy: "external-redacted-teaching-operation-append",
            storageWritePolicy: "external-append-only-operation-log",
            responsibleSession: "S12",
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
        response.end(
          JSON.stringify({
            teacherId: "teacher-kang",
            eventType: "teaching-operation-audit",
            storagePolicy: "external-redacted-teaching-operation-audit-log",
            storageWritePolicy: "external-append-only-audit-log",
            recordCount: teachingOperationAuditEvents.length,
            events: teachingOperationAuditEvents,
            auditEvents: teachingOperationAuditEvents,
            records: teachingOperationRecords,
            rollbackRecords: [],
            domainProjections: teachingOperationDomainProjections,
            operationRecordCount: teachingOperationRecords.length,
            rollbackRecordCount: 0,
            domainProjectionCount: teachingOperationDomainProjections.length,
            responsibleSession: "S12",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        );
        return;
      }
      if (request.method === "POST" && request.url === "/qwen-voice-lifecycle-audit") {
        const body = await readBodyForTest(request);
        const parsed = JSON.parse(body);
        writes.lifecycleAuditEventId = parsed.eventId;
        writes.lifecycleAuditAppended = body.includes(writes.lifecycleAuditEventId);
        response.end(
          JSON.stringify({
            provider: "qwen",
            status: "recorded",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
            leakSentinel: "server-secret-should-not-leak",
          }),
        );
        return;
      }
      response.end(
        JSON.stringify({
          provider: "qwen",
          providerRole: "voice-clone",
          eventType: "qwen-voice-lifecycle",
          storagePolicy: "append-only-redacted-lifecycle-audit",
          recordCount: 1,
          events: [
            {
              eventId: "qwen-voice-lifecycle-qwen-voice-ref-teacher-kang-asset-voice-10s-20260617",
            },
            ...(writes.lifecycleAuditAppended
              ? [
                  {
                    eventId: writes.lifecycleAuditEventId,
                  },
                ]
              : []),
          ],
          responsibleSession: "S12/S24",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
          leakSentinel: "server-secret-should-not-leak",
        }),
      );
    });
    const baseUrl = await listenForTest(server);
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-external-storage-live-"));
    const envFile = join(tmpDir, "external-storage-live.test.env");
    writeFileSync(
      envFile,
      ["UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=secret-external-storage-cli"].join("\n"),
    );

    try {
      const output = await execFileForTest("node", [
        "scripts/external-storage-smoke.mjs",
        "--live",
        "--approved",
        "--base-url",
        baseUrl,
        "--teacher-id",
        "teacher-kang",
        "--environment",
        "local-reference",
        "--env-file",
        envFile,
      ]);
      const body = JSON.parse(output);

      expect(body.mode).toBe("live");
      expect(body.environment).toBe("local-reference");
      expect(body.network).toBe("enabled");
      expect(body.storageEndpoint).toEqual({
        status: "present",
        networkClass: "local-loopback",
        endpointClass: "local-loopback",
        valueRedacted: true,
      });
      expect(body.storageServiceFingerprint).toEqual({
        status: "present",
        value: expect.stringMatching(/^sha256:[a-f0-9]{16}$/),
        source: "origin",
        valueRedacted: true,
      });
      expect(body.status).toBe("passed");
      expect(body.results).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: "s22-external-storage-health",
          status: "ok",
          httpStatus: 200,
          responseShape: {
            checked: true,
            status: "ok",
            requiredFields: expect.objectContaining({
              status: "present",
              target: "present",
              apiContractVersion: "present",
              cacheControlNoStore: "present",
              durableBackingStore: "present",
              teachingOperationsStorageSchema: "present",
              "teachingOperationsStorageSchema.status": "present",
              "teachingOperationsStorageSchema.schemaVersion": "present",
              "teachingOperationsStorageSchema.migrationStatus": "present",
              "teachingOperationsStorageSchema.backupStore": "present",
              "teachingOperationsStorageSchema.restoreDrillLog": "present",
              "teachingOperationsStorageSchema.concurrencyControl": "present",
              ...expectedSnapshotStorageShapeChecks("teachingCourseManagementStorageSchema"),
              ...expectedSnapshotStorageShapeChecks("teachingCourseAssetsStorageSchema"),
              productionServiceIdentity: "present",
              redaction: "present",
            }),
          },
        }),
        expect.objectContaining({
          id: "s12-external-teacher-ownership-merge",
          status: "ok",
          httpStatus: 200,
          responseShape: {
            checked: true,
            status: "ok",
            requiredFields: {
              status: "present",
              storageWritePolicy: "present",
              redaction: "present",
            },
          },
        }),
        expect.objectContaining({
          id: "s12-external-teacher-ownership-read",
          status: "ok",
          httpStatus: 200,
          responseShape: {
            checked: true,
            status: "ok",
            requiredFields: {
              teacherId: "present",
              courseIds: "present",
              assetCollections: "present",
              smokeGrantMerged: "present",
              runScopedSmokeGrant: "present",
              privateFieldsOmitted: "present",
            },
          },
        }),
        expect.objectContaining({
          id: "s12-external-course-management-backup-restore-drill",
          status: "ok",
          responseShape: {
            checked: true,
            status: "ok",
            requiredFields: expect.objectContaining({
              backupStatus: "present",
              restoreDrillStatus: "present",
              backupStorageWritePolicy: "present",
              restoreDrillStorageWritePolicy: "present",
            }),
          },
        }),
        expect.objectContaining({
          id: "s12-external-course-assets-backup-restore-drill",
          status: "ok",
          responseShape: {
            checked: true,
            status: "ok",
            requiredFields: expect.objectContaining({
              backupStatus: "present",
              restoreDrillStatus: "present",
              backupStorageWritePolicy: "present",
              restoreDrillStorageWritePolicy: "present",
            }),
          },
        }),
        expect.objectContaining({
          id: "s12-external-teaching-operations-backup-restore-drill",
          status: "ok",
          responseShape: {
            checked: true,
            status: "ok",
            requiredFields: expect.objectContaining({
              backupStatus: "present",
              restoreDrillStatus: "present",
              backupStorageWritePolicy: "present",
              restoreDrillStorageWritePolicy: "present",
            }),
          },
        }),
        expect.objectContaining({
          id: "s12-external-teaching-operations-concurrent-append-readback",
          status: "ok",
          httpStatus: {
            appends: [200, 200],
            auditReadback: 200,
            valueRedacted: true,
          },
          responseShape: {
            checked: true,
            status: "ok",
            requiredFields: {
              bothAppendsPersisted: "present",
              appendSequencesReturned: "present",
              appendSequencesDistinct: "present",
              auditReadbackReturned: "present",
              operationRecordsPresent: "present",
              auditEventsPresent: "present",
              domainProjectionsPresent: "present",
              redaction: "present",
            },
          },
        }),
        expect.objectContaining({
          id: "s12-external-teaching-operations-unauthenticated-append-denied",
          status: "ok",
          httpStatus: {
            append: 401,
            auditReadback: 200,
            valueRedacted: true,
          },
          responseShape: {
            checked: true,
            status: "ok",
            requiredFields: {
              appendDenied: "present",
              appendResponseRedacted: "present",
              auditReadbackReturned: "present",
              operationRecordAbsent: "present",
              auditEventAbsent: "present",
            },
          },
        }),
        expect.objectContaining({
          id: "s12-external-teaching-operations-invalid-token-append-denied",
          status: "ok",
          httpStatus: {
            append: 401,
            auditReadback: 200,
            valueRedacted: true,
          },
          responseShape: {
            checked: true,
            status: "ok",
            requiredFields: {
              appendDenied: "present",
              appendResponseRedacted: "present",
              auditReadbackReturned: "present",
              operationRecordAbsent: "present",
              auditEventAbsent: "present",
            },
          },
        }),
        expect.objectContaining({
          id: "s24-external-lifecycle-audit-append",
          status: "ok",
          httpStatus: 200,
          responseShape: {
            checked: true,
            status: "ok",
            requiredFields: {
              status: "present",
              provider: "present",
              redaction: "present",
            },
          },
        }),
        expect.objectContaining({
          id: "s24-external-lifecycle-audit-read",
          status: "ok",
          httpStatus: 200,
          responseShape: {
            checked: true,
            status: "ok",
            requiredFields: {
              provider: "present",
              eventType: "present",
              eventsArray: "present",
              smokeAuditEventPresent: "present",
              runScopedSmokeAuditEvent: "present",
              redaction: "present",
            },
          },
        }),
      ]));
      expect(requests).toEqual([
        {
          method: "GET",
          url: "/healthz",
          authorization: undefined,
        },
        {
          method: "POST",
          url: "/teacher-ai-ownership/teacher-kang/merge",
          authorization: "Bearer secret-external-storage-cli",
        },
        {
          method: "GET",
          url: "/teacher-ai-ownership/teacher-kang",
          authorization: "Bearer secret-external-storage-cli",
        },
        {
          method: "POST",
          url: "/teaching-course-management/backups",
          authorization: "Bearer secret-external-storage-cli",
        },
        {
          method: "POST",
          url: `/teaching-course-management/backups/${courseManagementBackupId}/restore-drill`,
          authorization: "Bearer secret-external-storage-cli",
        },
        {
          method: "POST",
          url: "/teaching-course-assets/backups",
          authorization: "Bearer secret-external-storage-cli",
        },
        {
          method: "POST",
          url: `/teaching-course-assets/backups/${courseAssetsBackupId}/restore-drill`,
          authorization: "Bearer secret-external-storage-cli",
        },
        {
          method: "POST",
          url: "/teaching-operations/teacher-kang/backups",
          authorization: "Bearer secret-external-storage-cli",
        },
        {
          method: "POST",
          url: `/teaching-operations/teacher-kang/backups/${teachingOperationsBackupId}/restore-drill`,
          authorization: "Bearer secret-external-storage-cli",
        },
        {
          method: "POST",
          url: "/teaching-operations/teacher-kang/append",
          authorization: "Bearer secret-external-storage-cli",
        },
        {
          method: "POST",
          url: "/teaching-operations/teacher-kang/append",
          authorization: "Bearer secret-external-storage-cli",
        },
        {
          method: "GET",
          url: "/teaching-operations/teacher-kang/audit",
          authorization: "Bearer secret-external-storage-cli",
        },
        {
          method: "POST",
          url: "/teaching-operations/teacher-kang/append",
          authorization: undefined,
        },
        {
          method: "GET",
          url: "/teaching-operations/teacher-kang/audit",
          authorization: "Bearer secret-external-storage-cli",
        },
        {
          method: "POST",
          url: "/teaching-operations/teacher-kang/append",
          authorization: "Bearer invalid-external-storage-smoke-token",
        },
        {
          method: "GET",
          url: "/teaching-operations/teacher-kang/audit",
          authorization: "Bearer secret-external-storage-cli",
        },
        {
          method: "POST",
          url: "/qwen-voice-lifecycle-audit",
          authorization: "Bearer secret-external-storage-cli",
        },
        {
          method: "GET",
          url: "/qwen-voice-lifecycle-audit",
          authorization: "Bearer secret-external-storage-cli",
        },
      ]);
      expect(writes.audioManifestId).toMatch(/^uais-external-storage-smoke-audio-manifest-[a-f0-9]{12}$/);
      expect(writes.lifecycleAuditEventId).toMatch(/^uais-external-storage-smoke-audit-[a-f0-9]{12}$/);
      expect(output).not.toContain("secret-external-storage-cli");
      expect(output).not.toContain(baseUrl);
      expect(output).not.toContain("teacher-kang");
      expect(output).not.toContain(writes.audioManifestId);
      expect(output).not.toContain(writes.lifecycleAuditEventId);
      expect(output).not.toContain("voice-qwen-private");
      expect(output).not.toContain("server-secret-should-not-leak");
      expect(output).not.toContain("/Users/");
      expect(output).not.toContain("data:audio");
    } finally {
      await closeServerForTest(server);
    }
  });

  it("blocks production external storage live smoke for non-remote-HTTPS endpoints before network writes", async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(`${request.method ?? "UNKNOWN"} ${request.url ?? "/"}`);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "unexpected-network-call" }));
    });
    const baseUrl = await listenForTest(server);
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-external-storage-production-block-"));
    const envFile = join(tmpDir, "external-storage-production-block.test.env");
    const releaseRunId = "release-storage-production-block";
    const readinessEvidence = writeExternalStorageServiceReadinessEvidenceForTest(tmpDir, {
      baseUrl,
      releaseRunId,
    });
    writeFileSync(
      envFile,
      ["UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=secret-external-storage-cli"].join("\n"),
    );

    try {
      const result = await execFileResultForTest("node", [
        "scripts/external-storage-smoke.mjs",
        "--live",
        "--approved",
        "--base-url",
        baseUrl,
        "--teacher-id",
        "teacher-kang",
        "--environment",
        "production",
        "--env-file",
        envFile,
        "--release-run-id",
        releaseRunId,
        "--external-storage-service-readiness",
        readinessEvidence,
      ]);
      const body = JSON.parse(result.stdout);

      expect(result.exitCode).toBe(1);
      expect(requests).toEqual([]);
      expect(body).toEqual(
        expect.objectContaining({
          target: "external-storage-smoke",
          mode: "live",
          environment: "production",
          network: "enabled",
          status: "blocked",
          blockedReasons: ["production-external-storage-endpoint-not-remote-https"],
          storageEndpoint: {
            status: "present",
            networkClass: "local-loopback",
            endpointClass: "local-loopback",
            valueRedacted: true,
          },
        }),
      );
      expect(result.stdout).not.toContain(baseUrl);
      expect(result.stdout).not.toContain("secret-external-storage-cli");
      expect(result.stdout).not.toContain("teacher-kang");
      expect(result.stdout).not.toContain("/Users/");
      expect(result.stderr).toBe("");
    } finally {
      await closeServerForTest(server);
    }
  });

  it("requires storage service readiness evidence for production external storage live smoke plans", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-external-storage-readiness-missing-"));
    const envFile = join(tmpDir, "external-storage-readiness-missing.test.env");
    const releaseRunId = "release-storage-readiness-missing";
    writeFileSync(
      envFile,
      ["UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=secret-external-storage-cli"].join("\n"),
    );

    const result = await execFileResultForTest("node", [
      "scripts/external-storage-smoke.mjs",
      "--live",
      "--approved",
      "--base-url",
      "https://storage.example.test/uais",
      "--teacher-id",
      "teacher-kang",
      "--environment",
      "production",
      "--env-file",
      envFile,
      "--release-run-id",
      releaseRunId,
    ]);
    const body = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(1);
    expect(body).toEqual(
      expect.objectContaining({
        target: "external-storage-smoke",
        mode: "live",
        environment: "production",
        network: "enabled",
        status: "blocked",
        blockedReasons: ["external-storage-service-readiness-evidence-missing"],
        storageEndpoint: {
          status: "present",
          networkClass: "remote",
          endpointClass: "remote-https",
          valueRedacted: true,
        },
        externalStorageServiceReadinessEvidence: {
          target: "missing",
          status: "missing",
          valueRedacted: true,
          releaseRunIdStatus: "missing",
        },
      }),
    );
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        {
          id: "s22-external-storage-service-readiness-evidence",
          responsibleSession: "S22",
          requiredEvidence: "external-storage-service-readiness",
          status: "missing",
          valueRedacted: true,
        },
      ]),
    );
    expect(body.results).toBeUndefined();
    expect(result.stdout).not.toContain("https://storage.example.test");
    expect(result.stdout).not.toContain("secret-external-storage-cli");
    expect(result.stdout).not.toContain("teacher-kang");
    expect(result.stdout).not.toContain(tmpDir);
    expect(result.stdout).not.toContain("/Users/");
    expect(result.stderr).toBe("");
  });

  it("rejects production external storage live smoke without a release-run id before network writes", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-external-storage-missing-run-id-"));
    const envFile = join(tmpDir, "external-storage-missing-run-id.test.env");
    const baseUrl = "https://storage.example.invalid/uais";
    const readinessEvidence = writeExternalStorageServiceReadinessEvidenceForTest(tmpDir, {
      baseUrl,
      releaseRunId: "release-storage-readiness-existing-run",
    });
    writeFileSync(
      envFile,
      ["UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=secret-external-storage-cli"].join("\n"),
    );

    const result = await execFileResultForTest("node", [
      "scripts/external-storage-smoke.mjs",
      "--live",
      "--approved",
      "--base-url",
      baseUrl,
      "--teacher-id",
      "teacher-kang",
      "--environment",
      "production",
      "--env-file",
      envFile,
      "--external-storage-service-readiness",
      readinessEvidence,
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "External storage smoke checks require --release-run-id",
    );
    expect(result.stderr).not.toContain("secret-external-storage-cli");
    expect(result.stderr).not.toContain("storage.example.invalid");
    expect(result.stderr).not.toContain("teacher-kang");
    expect(result.stderr).not.toContain(tmpDir);
    expect(result.stderr).not.toContain("/Users/");
  });

  it("blocks external storage smoke when service readiness evidence is for a different service", async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(`${request.method ?? "UNKNOWN"} ${request.url ?? "/"}`);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "unexpected-network-call" }));
    });
    const baseUrl = await listenForTest(server);
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-external-storage-readiness-binding-"));
    const envFile = join(tmpDir, "external-storage-readiness-binding.test.env");
    const releaseRunId = "release-storage-readiness-binding";
    const mismatchedReadiness = writeExternalStorageServiceReadinessEvidenceForTest(tmpDir, {
      baseUrl: "https://different-storage-service.example.test",
      releaseRunId,
    });
    writeFileSync(
      envFile,
      ["UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=secret-external-storage-cli"].join("\n"),
    );

    try {
      const result = await execFileResultForTest("node", [
        "scripts/external-storage-smoke.mjs",
        "--live",
        "--approved",
        "--base-url",
        baseUrl,
        "--teacher-id",
        "teacher-kang",
        "--environment",
        "local-reference",
        "--env-file",
        envFile,
        "--release-run-id",
        releaseRunId,
        "--external-storage-service-readiness",
        mismatchedReadiness,
      ]);
      const body = JSON.parse(result.stdout);

      expect(result.exitCode).toBe(1);
      expect(requests).toEqual([]);
      expect(body).toEqual(
        expect.objectContaining({
          target: "external-storage-smoke",
          mode: "live",
          environment: "local-reference",
          network: "enabled",
          status: "blocked",
          blockedReasons: ["external-storage-service-readiness-fingerprint-mismatch"],
          externalStorageServiceReadinessEvidence: {
            target: "external-storage-service-readiness",
            status: "mismatched",
            valueRedacted: true,
            releaseRunIdStatus: "missing",
          },
        }),
      );
      expect(body.prerequisites).toEqual(
        expect.arrayContaining([
          {
            id: "s22-external-storage-service-readiness-evidence",
            responsibleSession: "S22",
            requiredEvidence: "external-storage-service-readiness",
            status: "mismatched",
            valueRedacted: true,
          },
        ]),
      );
      expect(result.stdout).not.toContain(baseUrl);
      expect(result.stdout).not.toContain("different-storage-service.example.test");
      expect(result.stdout).not.toContain("secret-external-storage-cli");
      expect(result.stdout).not.toContain("teacher-kang");
      expect(result.stdout).not.toContain(tmpDir);
      expect(result.stdout).not.toContain("/Users/");
      expect(result.stderr).toBe("");
    } finally {
      await closeServerForTest(server);
    }
  });

  it("rejects unknown external storage smoke options without echoing the provided argument", () => {
    const tokenLikeArgument = "secret-external-storage-unknown-option";

    try {
      execFileSync("node", ["scripts/external-storage-smoke.mjs", tokenLikeArgument], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (error) {
      const stderr =
        error instanceof Error && "stderr" in error && typeof error.stderr === "string"
          ? error.stderr
          : error instanceof Error && "stderr" in error && Buffer.isBuffer(error.stderr)
          ? error.stderr.toString("utf8")
          : String(error);
      expect(stderr).toContain("Unknown option");
      expect(stderr).not.toContain(tokenLikeArgument);
      return;
    }

    throw new Error("Expected external storage smoke CLI to reject unknown options.");
  });

  it("plans Vercel env sync from a local env file without leaking values", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-sync-"));
    const envFile = join(tmpDir, "vercel-env-sync.test.env");
    writeFileSync(
      envFile,
      [
        "UAIS_LIVE_AI_APPROVAL_TOKEN=secret-live-token-cli",
        "UAIS_AI_ACCESS_SIGNING_SECRET=secret-signed-session-cli",
        "UAIS_APP_SESSION_SIGNING_SECRET=secret-app-session-signing-token-32",
        "UAIS_APP_AUTH_PROVIDER=trusted-account-provider",
        "UAIS_APP_AUTH_PROVIDER_URL=https://app-auth-provider.example.test/session",
        "UAIS_APP_AUTH_PROVIDER_TOKEN=secret-app-auth-provider-token-32",
        "UAIS_TEACHER_AUTH_PROVIDER=trusted-cookie-issuer",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-teacher-auth-session-cli",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET=secret-teacher-auth-issuer-cli",
        "UAIS_TEACHER_AUTH_OIDC_ISSUER=https://identity.example.test",
        "UAIS_TEACHER_AUTH_OIDC_AUDIENCE=uais-teacher-workflow",
        "UAIS_TEACHER_AUTH_OIDC_JWKS_URL=https://identity.example.test/.well-known/jwks.json",
        "UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM=email",
        "UAIS_TEACHER_AI_OWNERSHIP_BACKEND=durable",
        "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND=durable",
        "UAIS_TEACHING_OPERATIONS_BACKEND=external",
        "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND=external",
        "UAIS_TEACHING_COURSE_ASSETS_BACKEND=external",
        "UAIS_EXTERNAL_STORAGE_BASE_URL=https://storage.example.test/uais",
        "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=secret-external-storage-cli",
        "UAIS_EXTERNAL_STORAGE_SERVICE_MODE=production",
        "UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR=/data/uais-external-storage",
        "UAIS_EXTERNAL_STORAGE_DATA_DIR=/data/uais-external-storage",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS=managed-database",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS=up-to-date",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY=point-in-time-restore",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL=transactional",
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
        "DEEPSEEK_API_KEY=secret-deepseek-cli",
        "DEEPSEEK_BASE_URL=https://api.deepseek.com",
        "DEEPSEEK_MODEL=deepseek-v4-flash",
        "DASHSCOPE_API_KEY=secret-qwen-cli",
        "DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com",
        "QWEN_MULTIMODAL_MODEL=qwen3.5-omni-plus",
        "QWEN_IMAGE_MODEL=qwen-image-2.0",
        "QWEN_TTS_MODEL=qwen3-tts-vc-realtime-2026-01-15",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/vercel-env-sync.mjs",
      "--dry-run",
      "--project",
      "uais",
      "--env-file",
      envFile,
      "--release-run-id",
      "uais-release-2026-06-18T000000Z",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.target).toBe("vercel-env-sync");
    expect(body.mode).toBe("dry-run");
    expect(body.project).toBe("uais");
    expect(body.responsibleSession).toBe("S19");
    expect(body.releaseRunId).toBe("uais-release-2026-06-18T000000Z");
    expect(body.targets).toEqual(["production", "preview"]);
    expect(body.externalStorageEndpoint).toEqual({
      status: "present",
      endpointClass: "remote-https",
      valueRedacted: true,
    });
    expect(body.externalStorageServiceFingerprint).toEqual({
      status: "present",
      value: "sha256:a707585d86fc8dad",
      source: "origin",
      valueRedacted: true,
    });
    expect(body.entries).toHaveLength(58);
    expect(
      body.entries.some((entry: { defaultValue?: string }) => entry.defaultValue),
    ).toBe(false);
    expect(body.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "UAIS_LIVE_AI_APPROVAL_TOKEN",
          status: "present",
          valueType: "secret",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_TEACHER_AUTH_PROVIDER",
          provider: "uais",
          status: "present",
          valueType: "auth-provider",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
          status: "present",
          valueType: "secret",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_TEACHER_AUTH_ISSUER_SECRET",
          status: "present",
          valueType: "secret",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_TEACHER_AUTH_OIDC_ISSUER",
          provider: "uais",
          status: "present",
          valueType: "base-url",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_TEACHER_AUTH_OIDC_AUDIENCE",
          provider: "uais",
          status: "present",
          valueType: "auth-provider",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_TEACHER_AUTH_OIDC_JWKS_URL",
          provider: "uais",
          status: "present",
          valueType: "base-url",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM",
          provider: "uais",
          status: "present",
          valueType: "auth-provider",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_AI_ACCESS_SIGNING_SECRET",
          status: "present",
          valueType: "secret",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_APP_SESSION_SIGNING_SECRET",
          provider: "uais",
          status: "present",
          valueType: "secret",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_APP_AUTH_PROVIDER",
          provider: "uais",
          status: "present",
          valueType: "auth-provider",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_APP_AUTH_PROVIDER_URL",
          provider: "uais",
          status: "present",
          valueType: "base-url",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_APP_AUTH_PROVIDER_TOKEN",
          provider: "uais",
          status: "present",
          valueType: "secret",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "DASHSCOPE_API_KEY",
          provider: "qwen",
          status: "present",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
          provider: "uais",
          status: "present",
          valueType: "storage-backend",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND",
          provider: "uais",
          status: "present",
          valueType: "storage-backend",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_TEACHING_OPERATIONS_BACKEND",
          provider: "uais",
          status: "present",
          valueType: "storage-backend",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
          provider: "uais",
          status: "present",
          valueType: "storage-backend",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_TEACHING_COURSE_ASSETS_BACKEND",
          provider: "uais",
          status: "present",
          valueType: "storage-backend",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_EXTERNAL_STORAGE_BASE_URL",
          provider: "uais",
          status: "present",
          valueType: "base-url",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
          provider: "uais",
          status: "present",
          valueType: "secret",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_EXTERNAL_STORAGE_SERVICE_MODE",
          provider: "uais",
          roles: [],
          status: "present",
          valueType: "service-mode",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR",
          provider: "uais",
          roles: [],
          status: "present",
          valueType: "storage-path",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER",
          provider: "uais",
          status: "present",
          valueType: "auth-provider",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_URL",
          provider: "uais",
          status: "present",
          valueType: "base-url",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN",
          provider: "uais",
          status: "present",
          valueType: "secret",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_COLLABORATION_INVITE_EMAIL_CALLBACK_TOKEN",
          provider: "uais",
          status: "present",
          valueType: "secret",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_STUDENT_ROSTER_SYNC_PROVIDER",
          provider: "uais",
          status: "present",
          valueType: "auth-provider",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_URL",
          provider: "uais",
          status: "present",
          valueType: "base-url",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_TOKEN",
          provider: "uais",
          status: "present",
          valueType: "secret",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER",
          provider: "uais",
          status: "present",
          valueType: "auth-provider",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_URL",
          provider: "uais",
          status: "present",
          valueType: "base-url",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_TOKEN",
          provider: "uais",
          status: "present",
          valueType: "secret",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_GRADEBOOK_RELEASE_PROVIDER",
          provider: "uais",
          status: "present",
          valueType: "auth-provider",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_GRADEBOOK_RELEASE_PROVIDER_URL",
          provider: "uais",
          status: "present",
          valueType: "base-url",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_GRADEBOOK_RELEASE_PROVIDER_TOKEN",
          provider: "uais",
          status: "present",
          valueType: "secret",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER",
          provider: "uais",
          status: "present",
          valueType: "auth-provider",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_URL",
          provider: "uais",
          status: "present",
          valueType: "base-url",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_TOKEN",
          provider: "uais",
          status: "present",
          valueType: "secret",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_COURSE_EXPORT_PROVIDER",
          provider: "uais",
          status: "present",
          valueType: "auth-provider",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_COURSE_EXPORT_PROVIDER_URL",
          provider: "uais",
          status: "present",
          valueType: "base-url",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_COURSE_EXPORT_PROVIDER_TOKEN",
          provider: "uais",
          status: "present",
          valueType: "secret",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_GRADING_FEEDBACK_PROVIDER",
          provider: "uais",
          status: "present",
          valueType: "auth-provider",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_GRADING_FEEDBACK_PROVIDER_URL",
          provider: "uais",
          status: "present",
          valueType: "base-url",
          actions: ["set-production", "set-preview"],
        }),
        expect.objectContaining({
          name: "UAIS_GRADING_FEEDBACK_PROVIDER_TOKEN",
          provider: "uais",
          status: "present",
          valueType: "secret",
          actions: ["set-production", "set-preview"],
        }),
      ]),
    );
    expect(body.safety).toEqual({
      valuesRedacted: true,
      applyRequiresApproval: true,
      applyRequiresLinkedProject: true,
      applyRequiresProjectReadiness: true,
      localOnlySmokeEnvNotSynced: true,
    });
    expect(output).not.toContain("secret-live-token-cli");
    expect(output).not.toContain("secret-signed-session-cli");
    expect(output).not.toContain("secret-teacher-auth-session-cli");
    expect(output).not.toContain("secret-teacher-auth-issuer-cli");
    expect(output).not.toContain("secret-app-session-signing-token-32");
    expect(output).not.toContain("app-auth-provider.example.test");
    expect(output).not.toContain("secret-app-auth-provider-token-32");
    expect(output).not.toContain("secret-external-storage-cli");
    expect(output).not.toContain("identity.example.test");
    expect(output).not.toContain("uais-teacher-workflow");
    expect(output).not.toContain("storage.example.test");
    expect(output).not.toContain("email-provider.example.test");
    expect(output).not.toContain("secret-email-provider-token-with-32-chars");
    expect(output).not.toContain("secret-email-callback-token-with-32-chars");
    expect(output).not.toContain("sis-provider.example.test");
    expect(output).not.toContain("secret-student-roster-provider-token-32");
    expect(output).not.toContain("knowledge-provider.example.test");
    expect(output).not.toContain("secret-knowledge-provider-token-32");
    expect(output).not.toContain("gradebook-provider.example.test");
    expect(output).not.toContain("secret-gradebook-provider-token-32");
    expect(output).not.toContain("content-provider.example.test");
    expect(output).not.toContain("secret-course-content-provider-token-32");
    expect(output).not.toContain("export-provider.example.test");
    expect(output).not.toContain("secret-export-provider-token-with-32-chars");
    expect(output).not.toContain("feedback-provider.example.test");
    expect(output).not.toContain("secret-feedback-provider-token-with-32-chars");
    expect(output).not.toContain("api.deepseek.com");
    expect(output).not.toContain("dashscope.aliyuncs.com");
    expect(output).not.toContain("secret-deepseek-cli");
    expect(output).not.toContain("secret-qwen-cli");
  });

  it("marks Vercel env sync dry-run as blocked when production apply prerequisites are missing", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-sync-blocked-status-"));
    const envFile = join(tmpDir, "vercel-env-sync-blocked.test.env");
    writeFileSync(
      envFile,
      [
        "UAIS_LIVE_AI_APPROVAL_TOKEN=secret-live-token-cli",
        "DEEPSEEK_API_KEY=secret-deepseek-cli",
        "DASHSCOPE_API_KEY=secret-qwen-cli",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/vercel-env-sync.mjs",
      "--dry-run",
      "--project",
      "uais",
      "--env-file",
      envFile,
      "--release-run-id",
      "uais-release-2026-06-20T000000Z",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.localSourceSummary).toEqual({
      status: "blocked",
      valuesRedacted: true,
      deploymentEntries: {
        total: 58,
        present: 3,
        missing: 55,
        missingNames: expect.arrayContaining([
          "UAIS_AI_ACCESS_SIGNING_SECRET",
          "UAIS_APP_SESSION_SIGNING_SECRET",
          "UAIS_APP_AUTH_PROVIDER",
          "UAIS_APP_AUTH_PROVIDER_URL",
          "UAIS_APP_AUTH_PROVIDER_TOKEN",
          "UAIS_CORE_DATABASE_URL",
          "UAIS_TEACHER_AUTH_PROVIDER",
          "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
          "UAIS_TEACHING_OPERATIONS_BACKEND",
          "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
          "UAIS_TEACHING_COURSE_ASSETS_BACKEND",
          "UAIS_EXTERNAL_STORAGE_BASE_URL",
          "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
          "UAIS_EXTERNAL_STORAGE_SERVICE_MODE",
          "UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR",
          "UAIS_EXTERNAL_STORAGE_DATA_DIR",
          "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS",
          "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS",
          "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY",
          "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL",
          "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER",
          "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN",
          "UAIS_STUDENT_ROSTER_SYNC_PROVIDER",
          "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_TOKEN",
          "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER",
          "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_TOKEN",
          "UAIS_GRADEBOOK_RELEASE_PROVIDER",
          "UAIS_GRADEBOOK_RELEASE_PROVIDER_TOKEN",
          "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER",
          "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_TOKEN",
          "UAIS_COURSE_EXPORT_PROVIDER",
          "UAIS_COURSE_EXPORT_PROVIDER_TOKEN",
          "UAIS_GRADING_FEEDBACK_PROVIDER",
          "UAIS_GRADING_FEEDBACK_PROVIDER_TOKEN",
        ]),
      },
      selectedAuthProvider: {
        mode: "missing",
        requiredPresent: 0,
        requiredMissing: 2,
        missingRequiredNames: [
          "UAIS_TEACHER_AUTH_PROVIDER",
          "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
        ],
      },
      // Only the four secrets every production-capable configuration signs or
      // verifies with. This environment selects no app auth provider, no
      // durable backend and no enterprise integration, so none of those
      // tokens is graded: an unselected integration's missing token is not a
      // release blocker, and reporting it as one buried the four that are.
      productionSecretStrength: {
        minimumLength: 32,
        sufficient: 0,
        weak: 1,
        missing: 3,
        weakNames: ["UAIS_LIVE_AI_APPROVAL_TOKEN"],
        missingNames: [
          "UAIS_AI_ACCESS_SIGNING_SECRET",
          "UAIS_APP_SESSION_SIGNING_SECRET",
          "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
        ],
      },
      externalStorage: {
        endpointClass: "missing",
        fingerprintStatus: "missing",
      },
      externalStorageDatabaseAdapterProof: {
        status: "blocked",
        providerClass: "missing",
        migrationStatus: "missing",
        backupPolicy: "missing",
        concurrencyControl: "missing",
        valuesRedacted: true,
      },
      localOnlyEntries: {
        total: 2,
        present: 0,
        ignored: 2,
      },
    });
    expect(body).toEqual(
      expect.objectContaining({
        target: "vercel-env-sync",
        mode: "dry-run",
        status: "blocked",
        blockedReasons: [
          "vercel-env-apply-auth-provider-not-proven",
          "vercel-env-apply-required-auth-env-missing",
          "vercel-env-apply-app-auth-provider-not-proven",
          "vercel-env-apply-app-auth-provider-env-missing",
          "vercel-env-apply-secret-strength-not-sufficient",
          // This environment names no durable store at all - no backend
          // selector, no database URL, no storage endpoint - which is one
          // blocker, not three findings about an external service it never
          // chose.
          "vercel-env-apply-durable-storage-not-configured",
        ],
      }),
    );
    expect(output).not.toContain("secret-live-token-cli");
    expect(output).not.toContain("secret-deepseek-cli");
    expect(output).not.toContain("secret-qwen-cli");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("plans a teacher-auth-only Vercel env sync without requiring storage or provider secrets", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-sync-teacher-auth-"));
    const envFile = join(tmpDir, "vercel-env-sync-teacher-auth.test.env");
    writeFileSync(
      envFile,
      [
        "UAIS_LIVE_AI_APPROVAL_TOKEN=live-approval-0123456789abcdef012345",
        "UAIS_AI_ACCESS_SIGNING_SECRET=0123456789abcdef0123456789abcdef",
        "UAIS_APP_SESSION_SIGNING_SECRET=app-session-0123456789abcdef012345",
        "UAIS_APP_AUTH_PROVIDER=trusted-account-provider",
        "UAIS_APP_AUTH_PROVIDER_URL=https://app-auth-provider.example.test/session",
        "UAIS_APP_AUTH_PROVIDER_TOKEN=app-provider-0123456789abcdef012345",
        "UAIS_TEACHER_AUTH_PROVIDER=trusted-cookie-issuer",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=abcdef0123456789abcdef0123456789",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET=fedcba9876543210fedcba9876543210",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/vercel-env-sync.mjs",
      "--dry-run",
      "--scope",
      "teacher-auth",
      "--project",
      "uais",
      "--env-file",
      envFile,
      "--release-run-id",
      "uais-release-teacher-auth-scope",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "vercel-env-sync",
        mode: "dry-run",
        deploymentScope: "teacher-auth",
        status: "ready",
        blockedReasons: [],
        authProviderMode: "trusted-cookie-issuer",
        targets: ["production", "preview"],
      }),
    );
    expect(body.entries.map((entry: { name: string }) => entry.name)).toEqual([
      "UAIS_LIVE_AI_APPROVAL_TOKEN",
      "UAIS_AI_ACCESS_SIGNING_SECRET",
      "UAIS_TEACHER_AUTH_PROVIDER",
      "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
      "UAIS_TEACHER_AUTH_ISSUER_SECRET",
    ]);
    expect(body.localSourceSummary).toEqual(
      expect.objectContaining({
        deploymentScope: "teacher-auth",
        deploymentEntries: expect.objectContaining({
          total: 5,
          present: 5,
          missing: 0,
          missingNames: [],
        }),
        externalStorage: {
          endpointClass: "not-required-for-scope",
          fingerprintStatus: "not-required-for-scope",
        },
      }),
    );
    expect(body.secretStrength.checks.map((check: { name: string }) => check.name)).toEqual([
      "UAIS_LIVE_AI_APPROVAL_TOKEN",
      "UAIS_AI_ACCESS_SIGNING_SECRET",
      "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
      "UAIS_TEACHER_AUTH_ISSUER_SECRET",
    ]);
    expect(output).not.toContain("0123456789abcdef");
    expect(output).not.toContain("abcdef0123456789");
    expect(output).not.toContain("fedcba9876543210");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("plans an external-storage-only Vercel env sync without requiring teacher auth or provider secrets", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-sync-external-storage-"));
    const envFile = join(tmpDir, "vercel-env-sync-external-storage.test.env");
    writeFileSync(
      envFile,
      [
        "UAIS_LIVE_AI_APPROVAL_TOKEN=auth-token-present-but-not-selected",
        "UAIS_TEACHER_AUTH_PROVIDER=trusted-cookie-issuer",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=auth-session-present-but-not-selected",
        "UAIS_TEACHER_AI_OWNERSHIP_BACKEND=external",
        "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND=external",
        "UAIS_TEACHING_OPERATIONS_BACKEND=external",
        "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND=external",
        "UAIS_TEACHING_COURSE_ASSETS_BACKEND=external",
        "UAIS_EXTERNAL_STORAGE_BASE_URL=https://storage.example.test/uais",
        "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=external-storage-token-0123456789abcdef",
        "UAIS_EXTERNAL_STORAGE_SERVICE_MODE=production",
        "UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR=/data/uais-external-storage",
        "UAIS_EXTERNAL_STORAGE_DATA_DIR=/data/uais-external-storage",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS=managed-database",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS=up-to-date",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY=point-in-time-restore",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL=transactional",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/vercel-env-sync.mjs",
      "--dry-run",
      "--scope",
      "external-storage",
      "--project",
      "uais",
      "--env-file",
      envFile,
      "--release-run-id",
      "uais-release-external-storage-scope",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "vercel-env-sync",
        mode: "dry-run",
        deploymentScope: "external-storage",
        status: "ready",
        blockedReasons: [],
        targets: ["production", "preview"],
      }),
    );
    expect(body.entries.map((entry: { name: string }) => entry.name)).toEqual([
      "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
      "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND",
      "UAIS_TEACHING_OPERATIONS_BACKEND",
      "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
      "UAIS_TEACHING_COURSE_ASSETS_BACKEND",
      "UAIS_EXTERNAL_STORAGE_BASE_URL",
      "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
      "UAIS_EXTERNAL_STORAGE_SERVICE_MODE",
      "UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR",
      "UAIS_EXTERNAL_STORAGE_DATA_DIR",
      "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS",
      "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS",
      "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY",
      "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL",
    ]);
    expect(body.localSourceSummary).toEqual(
      expect.objectContaining({
        deploymentScope: "external-storage",
        deploymentEntries: expect.objectContaining({
          total: 14,
          present: 14,
          missing: 0,
          missingNames: [],
        }),
        externalStorage: {
          endpointClass: "remote-https",
          fingerprintStatus: "present",
        },
        externalStorageDatabaseAdapterProof: {
          status: "ready",
          providerClass: "managed-database",
          migrationStatus: "up-to-date",
          backupPolicy: "point-in-time-restore",
          concurrencyControl: "transactional",
          valuesRedacted: true,
        },
      }),
    );
    expect(body.secretStrength.checks.map((check: { name: string }) => check.name)).toEqual([
      "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
    ]);
    expect(output).not.toContain("auth-token-present-but-not-selected");
    expect(output).not.toContain("auth-session-present-but-not-selected");
    expect(output).not.toContain("external-storage-token-0123456789abcdef");
    expect(output).not.toContain("storage.example.test");
    expect(output).not.toContain("/data/uais-external-storage");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("blocks external-storage Vercel env sync when managed database adapter proof values are invalid", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-sync-adapter-proof-"));
    const envFile = join(tmpDir, "vercel-env-sync-adapter-proof.test.env");
    writeFileSync(
      envFile,
      [
        "UAIS_TEACHER_AI_OWNERSHIP_BACKEND=external",
        "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND=external",
        "UAIS_TEACHING_OPERATIONS_BACKEND=external",
        "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND=external",
        "UAIS_TEACHING_COURSE_ASSETS_BACKEND=external",
        "UAIS_EXTERNAL_STORAGE_BASE_URL=https://storage.example.test/uais",
        "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=external-storage-token-0123456789abcdef",
        "UAIS_EXTERNAL_STORAGE_SERVICE_MODE=production",
        "UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR=/data/uais-external-storage",
        "UAIS_EXTERNAL_STORAGE_DATA_DIR=/data/uais-external-storage",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS=file-backed",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS=pending",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY=daily-snapshot",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL=atomic-rename",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/vercel-env-sync.mjs",
      "--dry-run",
      "--scope",
      "external-storage",
      "--project",
      "uais",
      "--env-file",
      envFile,
      "--release-run-id",
      "uais-release-external-storage-adapter-proof",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "vercel-env-sync",
        mode: "dry-run",
        deploymentScope: "external-storage",
        status: "blocked",
        blockedReasons: [
          "vercel-env-apply-external-storage-database-adapter-proof-not-ready",
        ],
      }),
    );
    expect(body.localSourceSummary).toEqual(
      expect.objectContaining({
        deploymentScope: "external-storage",
        deploymentEntries: expect.objectContaining({
          total: 14,
          present: 14,
          missing: 0,
          missingNames: [],
        }),
        externalStorage: {
          endpointClass: "remote-https",
          fingerprintStatus: "present",
        },
        externalStorageDatabaseAdapterProof: {
          status: "blocked",
          providerClass: "missing",
          migrationStatus: "missing",
          backupPolicy: "missing",
          concurrencyControl: "missing",
          valuesRedacted: true,
        },
      }),
    );
    expect(output).not.toContain("file-backed");
    expect(output).not.toContain("pending");
    expect(output).not.toContain("daily-snapshot");
    expect(output).not.toContain("atomic-rename");
    expect(output).not.toContain("storage.example.test");
    expect(output).not.toContain("/data/uais-external-storage");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("preserves trusted-cookie route-chain proof even when production teacher auth env is not selected", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-auth-route-chain-proof-"));
    const envFile = join(tmpDir, "teacher-auth-missing-selector.test.env");
    const vercelEnvSyncFile = join(tmpDir, "vercel-env-sync.json");
    const routeChainFile = join(tmpDir, "trusted-route-chain.json");
    writeFileSync(envFile, "UAIS_LIVE_AI_APPROVAL_TOKEN=secret-live-token-cli\n");
    writeFileSync(
      vercelEnvSyncFile,
      JSON.stringify({
        target: "vercel-env-sync",
        mode: "dry-run",
        status: "blocked",
        authProviderMode: "missing",
        releaseRunId: "uais-release-2026-06-20T000000Z",
        applyPreflight: "missing",
        blockedReasons: ["vercel-env-apply-auth-provider-not-proven"],
      }),
    );
    writeFileSync(
      routeChainFile,
      JSON.stringify({
        target: "trusted-teacher-auth-route-chain-contract",
        status: "proved-locally",
        evidence: {
          routeChain: ["/api/ai/teacher-auth/issue", "/api/ai/session"],
          authProvider: "trusted-cookie-issuer",
          issuerProofValidation: {
            maxLifetimeSeconds: 300,
            rejectsFutureIssuedAt: true,
            rejectsExpiresBeforeIssuedAt: true,
            rejectsOverlongLifetime: true,
            valuesRedacted: true,
          },
          issuerCookieHardening: {
            httpOnly: "required",
            sameSite: "lax",
            secureInProduction: true,
            path: "/",
            maxAge: "bounded-by-session-ttl",
            priority: "High",
            valuesRedacted: true,
          },
          sessionCookiePair: [
            "uais_teacher_auth_claims",
            "uais_teacher_auth_signature",
          ],
          downstreamAiSession: "scoped-teacher-ai-session-issued",
          workflowAction: "ppt-narration-submit",
        },
        releaseImpact: {
          localTrustedCookieRouteWiring: "proved",
        },
        safety: {
          secretsRedacted: true,
          cookieValuesOmitted: true,
          sessionIdsOmitted: true,
          commandOutputOmitted: true,
          localPrivatePathsOmitted: true,
          productionMutationPerformed: false,
        },
      }),
    );

    let stdout = "";
    expect(() => {
      try {
        execFileSync("node", [
          "scripts/teacher-auth-provider-readiness.mjs",
          "--live",
          "--approved",
          "--environment",
          "production",
          "--env-file",
          envFile,
          "--release-run-id",
          "uais-release-2026-06-20T000000Z",
          "--vercel-env-sync",
          vercelEnvSyncFile,
          "--trusted-teacher-auth-route-chain",
          routeChainFile,
        ], {
          cwd: process.cwd(),
          encoding: "utf8",
          stdio: "pipe",
        });
      } catch (error) {
        stdout = String((error as { stdout?: unknown }).stdout ?? "");
        throw error;
      }
    }).toThrow();
    const body = JSON.parse(stdout);

    expect(body.status).toBe("blocked");
    expect(body.authProviderMode).toBe("missing");
    expect(body.trustedTeacherAuthRouteChainEvidence).toEqual(
      expect.objectContaining({
        target: "trusted-teacher-auth-route-chain-contract",
        status: "proved",
        authProvider: "trusted-cookie-issuer",
        routeChain: "proved",
        redactionSafety: "proved",
      }),
    );
    expect(body.blockedReasons).toContain("teacher-auth-provider-selector-not-proven");
    expect(body.blockedReasons).not.toContain(
      "trusted-teacher-auth-route-chain-not-proven",
    );
    expect(stdout).not.toContain("secret-live-token-cli");
    expect(stdout).not.toContain(tmpDir);
    expect(stdout).not.toContain("/Users/");
  });

  it("records local external storage endpoint security in Vercel env sync evidence without leaking values", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-sync-storage-local-"));
    const envFile = join(tmpDir, "vercel-env-sync-storage-local.test.env");
    writeFileSync(
      envFile,
      [
        "UAIS_EXTERNAL_STORAGE_BASE_URL=http://localhost:8788/uais",
        "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=secret-external-storage-cli",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/vercel-env-sync.mjs",
      "--dry-run",
      "--project",
      "uais",
      "--env-file",
      envFile,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.externalStorageEndpoint).toEqual({
      status: "present",
      endpointClass: "local-loopback",
      valueRedacted: true,
    });
    expect(output).not.toContain("localhost");
    expect(output).not.toContain("8788");
    expect(output).not.toContain("secret-external-storage-cli");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("records provided ready project-readiness evidence in Vercel env sync dry-run", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-sync-readiness-"));
    const readinessFile = join(tmpDir, "vercel-project-readiness.json");
    writeFileSync(
      readinessFile,
      JSON.stringify({
        target: "vercel-project-readiness",
        mode: "local",
        status: "ready",
        checks: [
          { id: "s22-vercel-cli", status: "present" },
          { id: "s22-vercel-auth", status: "present" },
          { id: "s22-vercel-team-scope", status: "present" },
          { id: "s22-vercel-project-candidate", status: "present" },
          { id: "s22-vercel-project-link", status: "present" },
          { id: "s22-vercelignore-upload-hygiene", status: "present" },
        ],
        blockedReasons: [],
      }),
    );

    const output = execFileSync("node", [
      "scripts/vercel-env-sync.mjs",
      "--dry-run",
      "--vercel-project-readiness",
      readinessFile,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "vercel-env-sync",
        mode: "dry-run",
        projectReadinessEvidenceStatus: "ready",
      }),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("records redacted production secret strength in Vercel env sync evidence without leaking values", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-sync-secret-strength-"));
    const envFile = join(tmpDir, "vercel-env-sync-secret-strength.test.env");
    writeFileSync(
      envFile,
      [
        "UAIS_AI_ACCESS_SIGNING_SECRET=tiny-ai-secret",
        "UAIS_TEACHER_AUTH_PROVIDER=trusted-cookie-issuer",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=0123456789abcdef0123456789abcdef",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET=tiny-issuer-secret",
        // The endpoint is what makes this an external-storage posture, and the
        // access token is only graded once that backend has been selected.
        "UAIS_EXTERNAL_STORAGE_BASE_URL=https://storage.example.test/uais",
        "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=0123456789abcdef0123456789abcdef",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/vercel-env-sync.mjs",
      "--dry-run",
      "--project",
      "uais",
      "--env-file",
      envFile,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.secretStrength).toEqual({
      minimumLength: 32,
      valuesRedacted: true,
      checks: expect.arrayContaining([
        {
          name: "UAIS_AI_ACCESS_SIGNING_SECRET",
          status: "weak",
          valueRedacted: true,
        },
        {
          name: "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
          status: "sufficient",
          valueRedacted: true,
        },
        {
          name: "UAIS_TEACHER_AUTH_ISSUER_SECRET",
          status: "weak",
          valueRedacted: true,
        },
        {
          name: "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
          status: "sufficient",
          valueRedacted: true,
        },
      ]),
    });
    expect(output).not.toContain("tiny-ai-secret");
    expect(output).not.toContain("tiny-issuer-secret");
    expect(output).not.toContain("0123456789abcdef");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  // The September launch configuration: first-party accounts on the core
  // database for learners, and a teacher session minted at login. Neither
  // selector reads an external endpoint or a second secret, and the plan must
  // not demand one - it used to require the trusted provider's URL and token,
  // an external storage service and seven enterprise triplets from every
  // deployment, so this configuration collected roughly thirty findings for
  // services it does not run.
  it("plans the database-backed launch configuration without an external account or storage service", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-sync-database-"));
    const envFile = join(tmpDir, "vercel-env-sync-database.test.env");
    writeFileSync(
      envFile,
      [
        "UAIS_LIVE_AI_APPROVAL_TOKEN=secret-database-live-approval-token-strong",
        "UAIS_AI_ACCESS_SIGNING_SECRET=secret-database-ai-access-signing-strong",
        "UAIS_APP_SESSION_SIGNING_SECRET=secret-database-app-session-signing-str",
        "UAIS_APP_AUTH_PROVIDER=database-accounts",
        "UAIS_CORE_DATABASE_URL=postgres://uais:secret-database-dsn@db.example.test/uais",
        "UAIS_TEACHER_AUTH_PROVIDER=database-account-cookie",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-database-teacher-session-str",
        "DEEPSEEK_API_KEY=secret-database-deepseek",
        "DASHSCOPE_API_KEY=secret-database-dashscope",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/vercel-env-sync.mjs",
      "--dry-run",
      "--project",
      "uais",
      "--env-file",
      envFile,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.authProviderMode).toBe("database-account-cookie");
    expect(body.appAuthProviderMode).toBe("database-accounts");
    expect(body.storageBackendMode).toBe("core-database");
    expect(body.status).toBe("ready");
    expect(body.blockedReasons).toEqual([]);
    // Exactly the four secrets a first-party deployment signs or verifies with.
    expect(body.secretStrength.checks.map((check: { name: string }) => check.name)).toEqual([
      "UAIS_LIVE_AI_APPROVAL_TOKEN",
      "UAIS_AI_ACCESS_SIGNING_SECRET",
      "UAIS_APP_SESSION_SIGNING_SECRET",
      "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
    ]);
    expect(output).not.toContain("secret-database-dsn");
    expect(output).not.toContain("db.example.test");
    expect(output).not.toContain(tmpDir);
  });

  it("refuses to grade a postgres selector with no core database as durable", () => {
    // The selector alone is not a durable posture: the store it selects reads
    // the core database url and answers 503 without one. Grading this
    // "core-database" waved an apply through with no durable store at all -
    // checkStorageBackend in chatroom-production-readiness.mjs, which this
    // mirrors, has always blocked the same case.
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-sync-selector-"));
    const envFile = join(tmpDir, "vercel-env-sync-selector.test.env");
    writeFileSync(
      envFile,
      [
        "UAIS_LIVE_AI_APPROVAL_TOKEN=secret-selector-live-approval-token-strong",
        "UAIS_AI_ACCESS_SIGNING_SECRET=secret-selector-ai-access-signing-strong",
        "UAIS_APP_SESSION_SIGNING_SECRET=secret-selector-app-session-signing-str",
        "UAIS_APP_AUTH_PROVIDER=database-accounts",
        "UAIS_TEACHER_AUTH_PROVIDER=database-account-cookie",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-selector-teacher-session-st",
        "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND=postgres",
        "DEEPSEEK_API_KEY=secret-selector-deepseek",
        "DASHSCOPE_API_KEY=secret-selector-dashscope",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/vercel-env-sync.mjs",
      "--dry-run",
      "--project",
      "uais",
      "--env-file",
      envFile,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.storageBackendMode).toBe("local-json");
    expect(body.status).toBe("blocked");
    expect(body.blockedReasons).toContain(
      "vercel-env-apply-durable-storage-not-configured",
    );
    expect(output).not.toContain(tmpDir);
  });

  // The flag is set on production today, and nothing in the chain refused it.
  it("refuses to plan an apply that carries the production demo-auth escape hatch", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-sync-demo-flag-"));
    const envFile = join(tmpDir, "vercel-env-sync-demo-flag.test.env");
    writeFileSync(
      envFile,
      [
        "UAIS_LIVE_AI_APPROVAL_TOKEN=secret-demo-flag-live-approval-token-strong",
        "UAIS_AI_ACCESS_SIGNING_SECRET=secret-demo-flag-ai-access-signing-strong",
        "UAIS_APP_SESSION_SIGNING_SECRET=secret-demo-flag-app-session-signing-str",
        "UAIS_APP_AUTH_PROVIDER=database-accounts",
        "UAIS_CORE_DATABASE_URL=postgres://uais:secret-demo-flag-dsn@db.example.test/uais",
        "UAIS_TEACHER_AUTH_PROVIDER=database-account-cookie",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-demo-flag-teacher-session-s",
        "UAIS_APP_ALLOW_PRODUCTION_DEMO_AUTH=1",
        "DEEPSEEK_API_KEY=secret-demo-flag-deepseek",
        "DASHSCOPE_API_KEY=secret-demo-flag-dashscope",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/vercel-env-sync.mjs",
      "--dry-run",
      "--project",
      "uais",
      "--env-file",
      envFile,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.blockedReasons).toContain(
      "vercel-env-apply-production-demo-auth-flag-set",
    );
    expect(body.productionDemoAuthFlag).toEqual({
      status: "set",
      requiredForProduction: "unset",
      valueRedacted: true,
    });
  });


  it("records the selected OIDC auth provider mode in Vercel env sync evidence without requiring the trusted issuer secret", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-sync-oidc-"));
    const envFile = join(tmpDir, "vercel-env-sync-oidc.test.env");
    writeFileSync(
      envFile,
      [
        "UAIS_LIVE_AI_APPROVAL_TOKEN=secret-live-token-cli",
        "UAIS_AI_ACCESS_SIGNING_SECRET=secret-signed-session-cli",
        "UAIS_TEACHER_AUTH_PROVIDER=oidc-jwks",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-teacher-auth-session-cli",
        "UAIS_TEACHER_AUTH_OIDC_ISSUER=https://identity.example.test",
        "UAIS_TEACHER_AUTH_OIDC_AUDIENCE=uais-teacher-workflow",
        "UAIS_TEACHER_AUTH_OIDC_JWKS_URL=https://identity.example.test/.well-known/jwks.json",
        "UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM=email",
        "UAIS_TEACHER_AI_OWNERSHIP_BACKEND=external",
        "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND=external",
        "UAIS_EXTERNAL_STORAGE_BASE_URL=https://storage.example.test/uais",
        "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=secret-external-storage-cli",
        "DEEPSEEK_API_KEY=secret-deepseek-cli",
        "DASHSCOPE_API_KEY=secret-qwen-cli",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/vercel-env-sync.mjs",
      "--dry-run",
      "--project",
      "uais",
      "--env-file",
      envFile,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.authProviderMode).toBe("oidc-jwks");
    expect(body.oidcEndpointSecurity).toEqual({
      issuer: "remote-https",
      jwks: "remote-https",
    });
    expect(body.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "UAIS_TEACHER_AUTH_ISSUER_SECRET",
          status: "missing",
          requiredForSelectedAuthProvider: false,
        }),
        expect.objectContaining({
          name: "UAIS_TEACHER_AUTH_OIDC_ISSUER",
          status: "present",
          requiredForSelectedAuthProvider: true,
        }),
        expect.objectContaining({
          name: "UAIS_TEACHER_AUTH_OIDC_AUDIENCE",
          status: "present",
          requiredForSelectedAuthProvider: true,
        }),
        expect.objectContaining({
          name: "UAIS_TEACHER_AUTH_OIDC_JWKS_URL",
          status: "present",
          requiredForSelectedAuthProvider: true,
        }),
        expect.objectContaining({
          name: "UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM",
          status: "present",
          requiredForSelectedAuthProvider: true,
        }),
      ]),
    );
    expect(output).not.toContain("secret-teacher-auth-session-cli");
    expect(output).not.toContain("secret-external-storage-cli");
    expect(output).not.toContain("identity.example.test");
    expect(output).not.toContain("uais-teacher-workflow");
  });

  it("records local OIDC endpoint security in Vercel env sync evidence without leaking values", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-sync-oidc-local-"));
    const envFile = join(tmpDir, "vercel-env-sync-oidc-local.test.env");
    writeFileSync(
      envFile,
      [
        "UAIS_TEACHER_AUTH_PROVIDER=oidc-jwks",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-teacher-auth-session-cli",
        "UAIS_TEACHER_AUTH_OIDC_ISSUER=http://localhost:8787",
        "UAIS_TEACHER_AUTH_OIDC_AUDIENCE=uais-teacher-workflow",
        "UAIS_TEACHER_AUTH_OIDC_JWKS_URL=http://localhost:8787/.well-known/jwks.json",
        "UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM=email",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/vercel-env-sync.mjs",
      "--dry-run",
      "--project",
      "uais",
      "--env-file",
      envFile,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.authProviderMode).toBe("oidc-jwks");
    expect(body.oidcEndpointSecurity).toEqual({
      issuer: "local-loopback",
      jwks: "local-loopback",
    });
    expect(output).not.toContain("localhost");
    expect(output).not.toContain("8787");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("marks OIDC smoke env as local-only and ineligible for Vercel sync", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-sync-local-only-"));
    const envFile = join(tmpDir, "vercel-env-sync-local-only.test.env");
    writeFileSync(
      envFile,
      [
        "UAIS_TEACHER_AUTH_PROVIDER=oidc-jwks",
        "UAIS_TEACHER_AUTH_OIDC_SMOKE_BEARER_TOKEN=secret-oidc-smoke-token-cli",
        "UAIS_TEACHER_AUTH_OIDC_SMOKE_TEACHER_ID=teacher-kang@example.test",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/vercel-env-sync.mjs",
      "--dry-run",
      "--project",
      "uais",
      "--env-file",
      envFile,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.entries).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "UAIS_TEACHER_AUTH_OIDC_SMOKE_BEARER_TOKEN",
        }),
        expect.objectContaining({
          name: "UAIS_TEACHER_AUTH_OIDC_SMOKE_TEACHER_ID",
        }),
      ]),
    );
    expect(body.localOnlyEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "UAIS_TEACHER_AUTH_OIDC_SMOKE_BEARER_TOKEN",
          status: "present",
          localOnly: true,
          deploymentAction: "ignored",
          reason: "approved-live-route-smoke-only",
        }),
        expect.objectContaining({
          name: "UAIS_TEACHER_AUTH_OIDC_SMOKE_TEACHER_ID",
          status: "present",
          localOnly: true,
          deploymentAction: "ignored",
          reason: "approved-live-route-smoke-only",
        }),
      ]),
    );
    expect(body.safety.localOnlySmokeEnvNotSynced).toBe(true);
    expect(output).not.toContain("secret-oidc-smoke-token-cli");
    expect(output).not.toContain("teacher-kang@example.test");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("rejects Vercel env sync apply mode without explicit approval", () => {
    expect(() =>
      execFileSync("node", [
        "scripts/vercel-env-sync.mjs",
        "--apply",
        "--project",
        "uais",
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).toThrow("explicit owner approval");
  });

  it("accepts a redacted approved Vercel project id as project-candidate evidence", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-project-id-readiness-"));
    const fakeLog = join(tmpDir, "fake-vercel.log");
    const fakeBinDir = join(tmpDir, "node_modules", ".bin");
    mkdirSync(fakeBinDir, { recursive: true });
    writeFileSync(
      join(tmpDir, ".vercelignore"),
      [
        ".env",
        ".env.*",
        "!.env.local.example",
        "All API Keys.docx",
        "OpenMAIC-main.zip",
        ".tmp/",
        "output/",
        "coordination/",
        ".git/",
        ".vercel/",
        "node_modules/",
        ".next/",
        "tsconfig.tsbuildinfo",
      ].join("\n"),
    );
    const fakeVercel = join(fakeBinDir, "vercel");
    writeFileSync(
      fakeVercel,
      [
        "#!/bin/sh",
        "printf '%s %s %s\\n' \"$1\" \"$2\" \"$3\" >> \"$UAIS_FAKE_VERCEL_LOG\"",
        "if [ \"$1\" = \"--version\" ]; then printf '99.0.0\\n'; exit 0; fi",
        "if [ \"$1\" = \"whoami\" ]; then printf 'redacted-user\\n'; exit 0; fi",
        "if [ \"$1\" = \"teams\" ]; then printf '{\"teams\":[{\"current\":true}]}\\n'; exit 0; fi",
        "if [ \"$1\" = \"project\" ]; then printf '{\"projects\":[{\"name\":\"should-not-be-used\"}]}\\n'; exit 0; fi",
        "exit 1",
      ].join("\n"),
    );
    chmodSync(fakeVercel, 0o755);

    const output = execFileSync(process.execPath, [
      join(process.cwd(), "scripts/vercel-project-readiness.mjs"),
      "--project-dir",
      tmpDir,
      "--project-id",
      "prj_secret_project_id_should_not_leak",
    ], {
      cwd: tmpDir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: "",
        UAIS_FAKE_VERCEL_LOG: fakeLog,
      },
    });
    const body = JSON.parse(output);
    const log = readFileSync(fakeLog, "utf8");

    expect(body.target).toBe("vercel-project-readiness");
    expect(body.status).toBe("blocked");
    expect(body.blockedReasons).toEqual(["vercel-project-not-linked"]);
    expect(body.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s22-vercel-project-candidate",
          status: "present",
          evidence: "approved-redacted-project-id-provided",
          candidateSelection: "project-id",
        }),
        expect.objectContaining({
          id: "s22-vercel-project-link",
          status: "missing",
        }),
      ]),
    );
    expect(body.safety.projectIdsOmitted).toBe(true);
    expect(log).not.toContain("project ls");
    expect(output).not.toContain("prj_secret_project_id_should_not_leak");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("rejects Vercel env sync apply mode when project readiness is blocked", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-apply-blocked-readiness-"));
    const envFile = join(tmpDir, "vercel-env-apply.test.env");
    const readinessFile = join(tmpDir, "vercel-project-readiness.json");
    const fakeLog = join(tmpDir, "fake-vercel.log");
    const fakeBinDir = join(tmpDir, "node_modules", ".bin");
    mkdirSync(join(tmpDir, ".vercel"), { recursive: true });
    mkdirSync(fakeBinDir, { recursive: true });
    writeFileSync(join(tmpDir, ".vercel", "project.json"), "{}\n");
    writeFileSync(envFile, "UAIS_AI_ACCESS_SIGNING_SECRET=secret-vercel-blocked-readiness\n");
    writeFileSync(
      readinessFile,
      JSON.stringify({
        target: "vercel-project-readiness",
        status: "blocked",
        checks: [
          { id: "s22-vercel-cli", status: "present" },
          { id: "s22-vercel-auth", status: "present" },
          { id: "s22-vercel-team-scope", status: "present" },
          { id: "s22-vercel-project-candidate", status: "missing" },
          { id: "s22-vercel-project-link", status: "present" },
          { id: "s22-vercelignore-upload-hygiene", status: "present" },
        ],
        blockedReasons: ["vercel-project-candidate-missing"],
      }),
    );
    const fakeVercel = join(fakeBinDir, "vercel");
    writeFileSync(
      fakeVercel,
      [
        "#!/bin/sh",
        "printf 'unexpected-call\\n' >> \"$UAIS_FAKE_VERCEL_LOG\"",
      ].join("\n"),
    );
    chmodSync(fakeVercel, 0o755);

    expect(() =>
      execFileSync(process.execPath, [
        join(process.cwd(), "scripts/vercel-env-sync.mjs"),
        "--apply",
        "--approved",
        "--project",
        "uais",
        "--env-file",
        envFile,
        "--vercel-project-readiness",
        readinessFile,
        "--release-run-id",
        "uais-release-2026-06-18T000000Z",
      ], {
        cwd: tmpDir,
        encoding: "utf8",
        stdio: "pipe",
        env: {
          ...process.env,
          PATH: "",
          UAIS_FAKE_VERCEL_LOG: fakeLog,
        },
      }),
    ).toThrow("ready Vercel project-readiness evidence");
    expect(() => readFileSync(fakeLog, "utf8")).toThrow();
  });

  it("rejects Vercel env sync apply mode before mutation when production env preflight is unsafe", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-apply-unsafe-preflight-"));
    const envFile = join(tmpDir, "vercel-env-apply.test.env");
    const readinessFile = join(tmpDir, "vercel-project-readiness.json");
    const fakeLog = join(tmpDir, "fake-vercel.log");
    const fakeBinDir = join(tmpDir, "node_modules", ".bin");
    mkdirSync(join(tmpDir, ".vercel"), { recursive: true });
    mkdirSync(fakeBinDir, { recursive: true });
    writeFileSync(join(tmpDir, ".vercel", "project.json"), "{}\n");
    writeFileSync(
      envFile,
      [
        "UAIS_LIVE_AI_APPROVAL_TOKEN=live-approval-0123456789abcdef012345",
        "UAIS_AI_ACCESS_SIGNING_SECRET=0123456789abcdef0123456789abcdef",
        "UAIS_APP_SESSION_SIGNING_SECRET=app-session-0123456789abcdef012345",
        "UAIS_APP_AUTH_PROVIDER=trusted-account-provider",
        "UAIS_APP_AUTH_PROVIDER_URL=https://app-auth-provider.example.test/session",
        "UAIS_APP_AUTH_PROVIDER_TOKEN=app-provider-0123456789abcdef012345",
        "UAIS_TEACHER_AUTH_PROVIDER=trusted-cookie-issuer",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=abcdef0123456789abcdef0123456789",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET=fedcba9876543210fedcba9876543210",
        "UAIS_EXTERNAL_STORAGE_BASE_URL=http://localhost:8788/uais",
        "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=00112233445566778899aabbccddeeff",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS=managed-database",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS=up-to-date",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY=point-in-time-restore",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL=transactional",
        ...ordinaryTeachingProviderEnvFixtureLines,
      ].join("\n"),
    );
    writeFileSync(
      readinessFile,
      JSON.stringify({
        target: "vercel-project-readiness",
        status: "ready",
        checks: [
          { id: "s22-vercel-cli", status: "present" },
          { id: "s22-vercel-auth", status: "present" },
          { id: "s22-vercel-team-scope", status: "present" },
          { id: "s22-vercel-project-candidate", status: "present" },
          { id: "s22-vercel-project-link", status: "present" },
          { id: "s22-vercelignore-upload-hygiene", status: "present" },
        ],
        blockedReasons: [],
      }),
    );
    const fakeVercel = join(fakeBinDir, "vercel");
    writeFileSync(
      fakeVercel,
      [
        "#!/bin/sh",
        "printf 'unexpected-mutation %s %s %s\\n' \"$1\" \"$2\" \"$3\" >> \"$UAIS_FAKE_VERCEL_LOG\"",
        "exit 0",
      ].join("\n"),
    );
    chmodSync(fakeVercel, 0o755);

    let stdout = "";
    expect(() => {
      try {
        execFileSync(process.execPath, [
          join(process.cwd(), "scripts/vercel-env-sync.mjs"),
          "--apply",
          "--approved",
          "--project",
          "uais",
          "--env-file",
          envFile,
          "--vercel-project-readiness",
          readinessFile,
          "--release-run-id",
          "uais-release-2026-06-18T000000Z",
        ], {
          cwd: tmpDir,
          encoding: "utf8",
          stdio: "pipe",
          env: {
            ...process.env,
            PATH: "",
            UAIS_FAKE_VERCEL_LOG: fakeLog,
          },
        });
      } catch (error) {
        stdout = String((error as { stdout?: unknown }).stdout ?? "");
        throw error;
      }
    }).toThrow();

    const body = JSON.parse(stdout);
    expect(body).toEqual(
      expect.objectContaining({
        target: "vercel-env-sync",
        mode: "apply",
        project: "uais",
        releaseRunId: "uais-release-2026-06-18T000000Z",
        projectReadinessEvidenceStatus: "ready",
        applyPreflight: {
          status: "blocked",
          blockedReasons: ["vercel-env-apply-external-storage-not-remote-https"],
          valuesRedacted: true,
          cliNotInvoked: true,
        },
      }),
    );
    expect(body).not.toHaveProperty("applySummary");
    expect(() => readFileSync(fakeLog, "utf8")).toThrow();
    expect(stdout).not.toContain("0123456789abcdef");
    expect(stdout).not.toContain("abcdef0123456789");
    expect(stdout).not.toContain("fedcba9876543210");
    expect(stdout).not.toContain("localhost");
    expect(stdout).not.toContain("8788");
    expect(stdout).not.toContain(tmpDir);
    expect(stdout).not.toContain("/Users/");
  });

  it("rejects Vercel env sync apply mode without a release-run id before mutation", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-apply-missing-run-id-"));
    const envFile = join(tmpDir, "vercel-env-apply.test.env");
    const readinessFile = join(tmpDir, "vercel-project-readiness.json");
    const fakeLog = join(tmpDir, "fake-vercel.log");
    const fakeBinDir = join(tmpDir, "node_modules", ".bin");
    mkdirSync(join(tmpDir, ".vercel"), { recursive: true });
    mkdirSync(fakeBinDir, { recursive: true });
    writeFileSync(join(tmpDir, ".vercel", "project.json"), "{}\n");
    writeFileSync(
      envFile,
      [
        "UAIS_AI_ACCESS_SIGNING_SECRET=secret-vercel-missing-run-id-strong",
        "UAIS_TEACHER_AUTH_PROVIDER=trusted-cookie-issuer",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-vercel-missing-run-session-strong",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET=secret-vercel-missing-run-issuer-strong",
        "UAIS_EXTERNAL_STORAGE_BASE_URL=https://storage.example.test/uais",
        "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=secret-vercel-missing-run-storage-strong",
      ].join("\n"),
    );
    writeFileSync(
      readinessFile,
      JSON.stringify({
        target: "vercel-project-readiness",
        status: "ready",
        checks: [
          { id: "s22-vercel-cli", status: "present" },
          { id: "s22-vercel-auth", status: "present" },
          { id: "s22-vercel-team-scope", status: "present" },
          { id: "s22-vercel-project-candidate", status: "present" },
          { id: "s22-vercel-project-link", status: "present" },
          { id: "s22-vercelignore-upload-hygiene", status: "present" },
        ],
        blockedReasons: [],
      }),
    );
    const fakeVercel = join(fakeBinDir, "vercel");
    writeFileSync(
      fakeVercel,
      [
        "#!/bin/sh",
        "printf 'unexpected-mutation %s %s %s\\n' \"$1\" \"$2\" \"$3\" >> \"$UAIS_FAKE_VERCEL_LOG\"",
        "exit 0",
      ].join("\n"),
    );
    chmodSync(fakeVercel, 0o755);

    let stderr = "";
    expect(() => {
      try {
        execFileSync(process.execPath, [
          join(process.cwd(), "scripts/vercel-env-sync.mjs"),
          "--apply",
          "--approved",
          "--project",
          "uais",
          "--env-file",
          envFile,
          "--vercel-project-readiness",
          readinessFile,
        ], {
          cwd: tmpDir,
          encoding: "utf8",
          stdio: "pipe",
          env: {
            ...process.env,
            PATH: "",
            UAIS_FAKE_VERCEL_LOG: fakeLog,
          },
        });
      } catch (error) {
        stderr = String((error as { stderr?: unknown }).stderr ?? "");
        throw error;
      }
    }).toThrow("--release-run-id");

    expect(stderr).toContain("Vercel env sync apply requires --release-run-id");
    expect(() => readFileSync(fakeLog, "utf8")).toThrow();
    expect(stderr).not.toContain("secret-vercel-missing-run");
    expect(stderr).not.toContain("storage.example.test");
    expect(stderr).not.toContain(tmpDir);
    expect(stderr).not.toContain("/Users/");
  });

  it("rejects Vercel env sync apply mode when CLI exits without a success confirmation", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-apply-cli-no-confirm-"));
    const envFile = join(tmpDir, "vercel-env-apply.test.env");
    const readinessFile = join(tmpDir, "vercel-project-readiness.json");
    const fakeLog = join(tmpDir, "fake-vercel.log");
    const fakeBinDir = join(tmpDir, "node_modules", ".bin");
    mkdirSync(join(tmpDir, ".vercel"), { recursive: true });
    mkdirSync(fakeBinDir, { recursive: true });
    writeFileSync(join(tmpDir, ".vercel", "project.json"), "{}\n");
    writeFileSync(
      envFile,
      [
        "UAIS_LIVE_AI_APPROVAL_TOKEN=secret-vercel-no-confirm-live-token-strong",
        "UAIS_AI_ACCESS_SIGNING_SECRET=secret-vercel-no-confirm-signing-strong",
        "UAIS_APP_SESSION_SIGNING_SECRET=secret-vercel-no-confirm-app-session-strong",
        "UAIS_APP_AUTH_PROVIDER=trusted-account-provider",
        "UAIS_APP_AUTH_PROVIDER_URL=https://app-auth-provider.example.test/session",
        "UAIS_APP_AUTH_PROVIDER_TOKEN=secret-vercel-no-confirm-app-provider-strong",
        "UAIS_TEACHER_AUTH_PROVIDER=trusted-cookie-issuer",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-vercel-no-confirm-session-strong",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET=secret-vercel-no-confirm-issuer-strong",
        "UAIS_EXTERNAL_STORAGE_BASE_URL=https://storage.example.test/uais",
        "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=secret-vercel-no-confirm-storage-strong",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS=managed-database",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS=up-to-date",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY=point-in-time-restore",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL=transactional",
        ...ordinaryTeachingProviderEnvFixtureLines,
      ].join("\n"),
    );
    writeFileSync(
      readinessFile,
      JSON.stringify({
        target: "vercel-project-readiness",
        status: "ready",
        checks: [
          { id: "s22-vercel-cli", status: "present" },
          { id: "s22-vercel-auth", status: "present" },
          { id: "s22-vercel-team-scope", status: "present" },
          { id: "s22-vercel-project-candidate", status: "present" },
          { id: "s22-vercel-project-link", status: "present" },
          { id: "s22-vercelignore-upload-hygiene", status: "present" },
        ],
        blockedReasons: [],
      }),
    );
    const fakeVercel = join(fakeBinDir, "vercel");
    writeFileSync(
      fakeVercel,
      [
        "#!/bin/sh",
        "printf '%s %s %s\\n' \"$1\" \"$2\" \"$3\" >> \"$UAIS_FAKE_VERCEL_LOG\"",
        "/bin/cat >/dev/null",
        "printf 'Vercel CLI 99.0.0\\n' >&2",
        "printf 'Retrieving project...\\n' >&2",
        "exit 0",
      ].join("\n"),
    );
    chmodSync(fakeVercel, 0o755);

    let stderr = "";
    expect(() => {
      try {
        execFileSync(process.execPath, [
          join(process.cwd(), "scripts/vercel-env-sync.mjs"),
          "--apply",
          "--approved",
          "--project",
          "uais",
          "--env-file",
          envFile,
          "--vercel-project-readiness",
          readinessFile,
          "--release-run-id",
          "uais-release-2026-06-18T000000Z",
        ], {
          cwd: tmpDir,
          encoding: "utf8",
          stdio: "pipe",
          env: {
            ...process.env,
            PATH: "",
            UAIS_FAKE_VERCEL_LOG: fakeLog,
          },
        });
      } catch (error) {
        stderr = String((error as { stderr?: unknown }).stderr ?? "");
        throw error;
      }
    }).toThrow("did not confirm success");

    const log = readFileSync(fakeLog, "utf8");
    expect(log).toContain("env add UAIS_LIVE_AI_APPROVAL_TOKEN");
    expect(stderr).toContain("Vercel env add did not confirm success");
    expect(stderr).not.toContain("secret-vercel-no-confirm");
    expect(stderr).not.toContain("storage.example.test");
    expect(stderr).not.toContain(tmpDir);
    expect(stderr).not.toContain("/Users/");
  });

  it("applies Vercel env sync through a project-local CLI without leaking values", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-apply-local-cli-"));
    const envFile = join(tmpDir, "vercel-env-apply.test.env");
    const readinessFile = join(tmpDir, "vercel-project-readiness.json");
    const fakeLog = join(tmpDir, "fake-vercel.log");
    const fakeBinDir = join(tmpDir, "node_modules", ".bin");
    mkdirSync(join(tmpDir, ".vercel"), { recursive: true });
    mkdirSync(fakeBinDir, { recursive: true });
    writeFileSync(join(tmpDir, ".vercel", "project.json"), "{}\n");
    writeFileSync(
      envFile,
      [
        "UAIS_LIVE_AI_APPROVAL_TOKEN=secret-vercel-apply-live-token-strong",
        "UAIS_AI_ACCESS_SIGNING_SECRET=secret-vercel-apply-local-cli-strong",
        "UAIS_APP_SESSION_SIGNING_SECRET=secret-vercel-apply-app-session-strong",
        "UAIS_APP_AUTH_PROVIDER=trusted-account-provider",
        "UAIS_APP_AUTH_PROVIDER_URL=https://app-auth-provider.example.test/session",
        "UAIS_APP_AUTH_PROVIDER_TOKEN=secret-vercel-apply-app-provider-strong",
        "UAIS_TEACHER_AUTH_PROVIDER=trusted-cookie-issuer",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-vercel-apply-session-cli-strong",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET=secret-vercel-apply-issuer-cli-strong",
        "UAIS_TEACHING_OPERATIONS_BACKEND=external",
        "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND=external",
        "UAIS_TEACHING_COURSE_ASSETS_BACKEND=external",
        "UAIS_EXTERNAL_STORAGE_BASE_URL=https://storage.example.test/uais",
        "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=secret-vercel-apply-storage-cli-strong",
        "UAIS_EXTERNAL_STORAGE_SERVICE_MODE=production",
        "UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR=/data/uais-external-storage",
        "UAIS_EXTERNAL_STORAGE_DATA_DIR=/data/uais-external-storage",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS=managed-database",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS=up-to-date",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY=point-in-time-restore",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL=transactional",
        ...ordinaryTeachingProviderEnvFixtureLines,
      ].join("\n"),
    );
    writeFileSync(
      readinessFile,
      JSON.stringify({
        target: "vercel-project-readiness",
        status: "ready",
        checks: [
          { id: "s22-vercel-cli", status: "present" },
          { id: "s22-vercel-auth", status: "present" },
          { id: "s22-vercel-team-scope", status: "present" },
          { id: "s22-vercel-project-candidate", status: "present" },
          { id: "s22-vercel-project-link", status: "present" },
          { id: "s22-vercelignore-upload-hygiene", status: "present" },
        ],
        blockedReasons: [],
      }),
    );
    const fakeVercel = join(fakeBinDir, "vercel");
    writeFileSync(
      fakeVercel,
      [
        "#!/bin/sh",
        "printf '%s %s %s\\n' \"$1\" \"$2\" \"$3\" >> \"$UAIS_FAKE_VERCEL_LOG\"",
        "printf 'stdin=' >> \"$UAIS_FAKE_VERCEL_LOG\"",
        "/bin/cat >> \"$UAIS_FAKE_VERCEL_LOG\"",
        "printf '\\n' >> \"$UAIS_FAKE_VERCEL_LOG\"",
        "printf 'Added Environment Variable %s to Project uais\\n' \"$3\"",
      ].join("\n"),
    );
    chmodSync(fakeVercel, 0o755);

    const output = execFileSync(process.execPath, [
      join(process.cwd(), "scripts/vercel-env-sync.mjs"),
      "--apply",
      "--approved",
      "--project",
      "uais",
      "--env-file",
      envFile,
      "--vercel-project-readiness",
      readinessFile,
      "--release-run-id",
      "uais-release-2026-06-18T000000Z",
    ], {
      cwd: tmpDir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: "",
        UAIS_FAKE_VERCEL_LOG: fakeLog,
      },
    });
    const body = JSON.parse(output);
    const log = readFileSync(fakeLog, "utf8");

    expect(body.mode).toBe("apply");
    expect(body.project).toBe("uais");
    expect(body.releaseRunId).toBe("uais-release-2026-06-18T000000Z");
    expect(body.projectReadinessEvidenceStatus).toBe("ready");
    expect(body.applyPreflight).toEqual({
      status: "passed",
      blockedReasons: [],
      valuesRedacted: true,
      cliSafeToInvoke: true,
    });
    expect(body.applySummary).toEqual({
      status: "applied",
      appliedEntries: 43,
      appliedActions: 86,
      appliedByTarget: {
        production: 43,
        preview: 43,
      },
      localOnlyEntriesSkipped: 2,
      valuesRedacted: true,
      cliOutputOmitted: true,
    });
    expect(log).toContain("env add UAIS_LIVE_AI_APPROVAL_TOKEN");
    expect(log).toContain("env add UAIS_AI_ACCESS_SIGNING_SECRET");
    expect(log).toContain("env add UAIS_TEACHING_OPERATIONS_BACKEND");
    expect(log).toContain("env add UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND");
    expect(log).toContain("env add UAIS_TEACHING_COURSE_ASSETS_BACKEND");
    expect(log).toContain("env add UAIS_EXTERNAL_STORAGE_SERVICE_MODE");
    expect(log).toContain("env add UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR");
    expect(log).toContain("env add UAIS_EXTERNAL_STORAGE_DATA_DIR");
    expect(log).toContain("env add UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS");
    expect(log).toContain("env add UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS");
    expect(log).toContain("env add UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY");
    expect(log).toContain("env add UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL");
    expect(log).toContain("stdin=secret-vercel-apply-live-token-strong");
    expect(log).toContain("stdin=secret-vercel-apply-local-cli-strong");
    expect(output).not.toContain("secret-vercel-apply-live-token-strong");
    expect(output).not.toContain("secret-vercel-apply-local-cli-strong");
    expect(output).not.toContain("secret-vercel-apply-session-cli-strong");
    expect(output).not.toContain("secret-vercel-apply-issuer-cli-strong");
    expect(output).not.toContain("secret-vercel-apply-storage-cli-strong");
    expect(output).not.toContain("storage.example.test");
    expect(output).not.toContain("/data/uais-external-storage");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("applies scoped Vercel env sync through REST upsert without leaking values", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-apply-rest-"));
    const envFile = join(tmpDir, "vercel-env-apply-rest.test.env");
    const readinessFile = join(tmpDir, "vercel-project-readiness.json");
    const requests: Array<{
      url: string | undefined;
      authorization: string | undefined;
      body: Record<string, unknown>;
    }> = [];
    const server = createServer(async (request, response) => {
      const bodyText = await readBodyForTest(request);
      requests.push({
        url: request.url,
        authorization: headerToString(request.headers.authorization),
        body: JSON.parse(bodyText) as Record<string, unknown>,
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "env_test" }));
    });
    const baseUrl = await listenForTest(server);

    try {
      mkdirSync(join(tmpDir, ".vercel"), { recursive: true });
      writeFileSync(
        join(tmpDir, ".vercel", "project.json"),
        JSON.stringify({
          projectId: "prj_test_project",
          orgId: "team_test_org",
        }),
      );
      writeFileSync(
        envFile,
        [
          "UAIS_LIVE_AI_APPROVAL_TOKEN=secret-vercel-rest-live-token-strong",
          "UAIS_AI_ACCESS_SIGNING_SECRET=secret-vercel-rest-signing-strong",
          "UAIS_TEACHER_AUTH_PROVIDER=trusted-cookie-issuer",
          "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-vercel-rest-session-strong",
          "UAIS_TEACHER_AUTH_ISSUER_SECRET=secret-vercel-rest-issuer-strong",
        ].join("\n"),
      );
      writeFileSync(
        readinessFile,
        JSON.stringify({
          target: "vercel-project-readiness",
          status: "ready",
          checks: [
            { id: "s22-vercel-cli", status: "present" },
            { id: "s22-vercel-auth", status: "present" },
            { id: "s22-vercel-team-scope", status: "present" },
            { id: "s22-vercel-project-candidate", status: "present" },
            { id: "s22-vercel-project-link", status: "present" },
            { id: "s22-vercelignore-upload-hygiene", status: "present" },
          ],
          blockedReasons: [],
        }),
      );

      const output = await new Promise<string>((resolve, reject) => {
        execFile(
          process.execPath,
          [
            join(process.cwd(), "scripts/vercel-env-sync.mjs"),
            "--apply",
            "--approved",
            "--apply-method",
            "rest",
            "--scope",
            "teacher-auth",
            "--project",
            "uais",
            "--env-file",
            envFile,
            "--vercel-project-readiness",
            readinessFile,
            "--release-run-id",
            "uais-release-2026-06-20-teacher-auth-scope",
            "--vercel-api-base-url",
            baseUrl,
          ],
          {
            cwd: tmpDir,
            encoding: "utf8",
            env: {
              ...process.env,
              VERCEL_TOKEN: "secret-vercel-rest-api-token",
            },
          },
          (error, stdout, stderr) => {
            if (error) {
              reject(Object.assign(error, { stdout, stderr }));
              return;
            }
            resolve(stdout);
          },
        );
      });
      const body = JSON.parse(output);

      expect(body.mode).toBe("apply");
      expect(body.deploymentScope).toBe("teacher-auth");
      expect(body.project).toBe("uais");
      expect(body.releaseRunId).toBe("uais-release-2026-06-20-teacher-auth-scope");
      expect(body.applyPreflight).toEqual({
        status: "passed",
        blockedReasons: [],
        valuesRedacted: true,
        cliSafeToInvoke: true,
      });
      expect(body.applySummary).toEqual({
        status: "applied",
        appliedEntries: 5,
        appliedActions: 10,
        appliedByTarget: {
          production: 5,
          preview: 5,
        },
        localOnlyEntriesSkipped: 2,
        valuesRedacted: true,
        apiOutputOmitted: true,
      });

      expect(requests).toHaveLength(10);
      expect(requests.every((request) => request.authorization === "Bearer secret-vercel-rest-api-token")).toBe(true);
      expect(requests.every((request) => request.url?.startsWith("/v10/projects/prj_test_project/env?"))).toBe(true);
      expect(requests.every((request) => request.url?.includes("upsert=true"))).toBe(true);
      expect(requests.every((request) => request.url?.includes("teamId=team_test_org"))).toBe(true);
      expect(
        requests.map((request) => request.body).filter((requestBody) => requestBody.key === "UAIS_TEACHER_AUTH_PROVIDER"),
      ).toEqual([
        {
          type: "sensitive",
          key: "UAIS_TEACHER_AUTH_PROVIDER",
          value: "trusted-cookie-issuer",
          target: ["production"],
        },
        {
          type: "sensitive",
          key: "UAIS_TEACHER_AUTH_PROVIDER",
          value: "trusted-cookie-issuer",
          target: ["preview"],
        },
      ]);
      expect(new Set(requests.map((request) => request.body.type))).toEqual(new Set(["sensitive"]));
      expect(
        requests
          .map((request) => request.body)
          .filter((requestBody) => requestBody.key === "UAIS_TEACHER_AUTH_ISSUER_SECRET")
          .map((requestBody) => requestBody.type),
      ).toEqual(["sensitive", "sensitive"]);
      expect(output).not.toContain("secret-vercel-rest");
      expect(output).not.toContain("prj_test_project");
      expect(output).not.toContain("team_test_org");
      expect(output).not.toContain(tmpDir);
      expect(output).not.toContain("/Users/");
    } finally {
      await closeServerForTest(server);
    }
  });

  it("applies external-storage scoped Vercel env sync through REST without touching teacher auth variables", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-apply-rest-storage-"));
    const envFile = join(tmpDir, "vercel-env-apply-rest-storage.test.env");
    const readinessFile = join(tmpDir, "vercel-project-readiness.json");
    const requests: Array<{
      url: string | undefined;
      authorization: string | undefined;
      body: Record<string, unknown>;
    }> = [];
    const server = createServer(async (request, response) => {
      const bodyText = await readBodyForTest(request);
      requests.push({
        url: request.url,
        authorization: headerToString(request.headers.authorization),
        body: JSON.parse(bodyText) as Record<string, unknown>,
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "env_test" }));
    });
    const baseUrl = await listenForTest(server);

    try {
      mkdirSync(join(tmpDir, ".vercel"), { recursive: true });
      writeFileSync(
        join(tmpDir, ".vercel", "project.json"),
        JSON.stringify({
          projectId: "prj_test_project",
          orgId: "team_test_org",
        }),
      );
      writeFileSync(
        envFile,
        [
          "UAIS_LIVE_AI_APPROVAL_TOKEN=secret-auth-present-but-not-selected",
          "UAIS_AI_ACCESS_SIGNING_SECRET=secret-signing-present-but-not-selected",
          "UAIS_TEACHER_AUTH_PROVIDER=trusted-cookie-issuer",
          "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-session-present-but-not-selected",
          "UAIS_TEACHER_AUTH_ISSUER_SECRET=secret-issuer-present-but-not-selected",
          "UAIS_TEACHER_AI_OWNERSHIP_BACKEND=external",
          "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND=external",
          "UAIS_TEACHING_OPERATIONS_BACKEND=external",
          "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND=external",
          "UAIS_TEACHING_COURSE_ASSETS_BACKEND=external",
          "UAIS_EXTERNAL_STORAGE_BASE_URL=https://storage.example.test/uais",
          "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=secret-storage-rest-token-strong",
          "UAIS_EXTERNAL_STORAGE_SERVICE_MODE=production",
          "UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR=/data/uais-external-storage",
          "UAIS_EXTERNAL_STORAGE_DATA_DIR=/data/uais-external-storage",
          "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS=managed-database",
          "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS=up-to-date",
          "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY=point-in-time-restore",
          "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL=transactional",
        ].join("\n"),
      );
      writeFileSync(
        readinessFile,
        JSON.stringify({
          target: "vercel-project-readiness",
          status: "ready",
          checks: [
            { id: "s22-vercel-cli", status: "present" },
            { id: "s22-vercel-auth", status: "present" },
            { id: "s22-vercel-team-scope", status: "present" },
            { id: "s22-vercel-project-candidate", status: "present" },
            { id: "s22-vercel-project-link", status: "present" },
            { id: "s22-vercelignore-upload-hygiene", status: "present" },
          ],
          blockedReasons: [],
        }),
      );

      const output = await new Promise<string>((resolve, reject) => {
        execFile(
          process.execPath,
          [
            join(process.cwd(), "scripts/vercel-env-sync.mjs"),
            "--apply",
            "--approved",
            "--apply-method",
            "rest",
            "--scope",
            "external-storage",
            "--project",
            "uais",
            "--env-file",
            envFile,
            "--vercel-project-readiness",
            readinessFile,
            "--release-run-id",
            "uais-release-2026-06-21-external-storage-scope",
            "--vercel-api-base-url",
            baseUrl,
          ],
          {
            cwd: tmpDir,
            encoding: "utf8",
            env: {
              ...process.env,
              VERCEL_TOKEN: "secret-vercel-rest-api-token",
            },
          },
          (error, stdout, stderr) => {
            if (error) {
              reject(Object.assign(error, { stdout, stderr }));
              return;
            }
            resolve(stdout);
          },
        );
      });
      const body = JSON.parse(output);
      const requestKeys = requests.map((request) => request.body.key);

      expect(body.mode).toBe("apply");
      expect(body.deploymentScope).toBe("external-storage");
      expect(body.project).toBe("uais");
      expect(body.releaseRunId).toBe("uais-release-2026-06-21-external-storage-scope");
      expect(body.applySummary).toEqual({
        status: "applied",
        appliedEntries: 14,
        appliedActions: 28,
        appliedByTarget: {
          production: 14,
          preview: 14,
        },
        localOnlyEntriesSkipped: 2,
        valuesRedacted: true,
        apiOutputOmitted: true,
      });
      expect(requests).toHaveLength(28);
      expect(requests.every((request) => request.authorization === "Bearer secret-vercel-rest-api-token")).toBe(true);
      expect(new Set(requestKeys)).toEqual(
        new Set([
          "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
          "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND",
          "UAIS_TEACHING_OPERATIONS_BACKEND",
          "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
          "UAIS_TEACHING_COURSE_ASSETS_BACKEND",
          "UAIS_EXTERNAL_STORAGE_BASE_URL",
          "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
          "UAIS_EXTERNAL_STORAGE_SERVICE_MODE",
          "UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR",
          "UAIS_EXTERNAL_STORAGE_DATA_DIR",
          "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS",
          "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS",
          "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY",
          "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL",
        ]),
      );
      expect(requestKeys).not.toContain("UAIS_LIVE_AI_APPROVAL_TOKEN");
      expect(requestKeys).not.toContain("UAIS_TEACHER_AUTH_PROVIDER");
      expect(requestKeys).not.toContain("UAIS_TEACHER_AUTH_ISSUER_SECRET");
      expect(new Set(requests.map((request) => request.body.type))).toEqual(new Set(["sensitive"]));
      expect(
        requests
          .map((request) => request.body)
          .filter((requestBody) => requestBody.key === "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN")
          .map((requestBody) => requestBody.type),
      ).toEqual(["sensitive", "sensitive"]);
      expect(output).not.toContain("secret-auth-present-but-not-selected");
      expect(output).not.toContain("secret-storage-rest-token-strong");
      expect(output).not.toContain("storage.example.test");
      expect(output).not.toContain("/data/uais-external-storage");
      expect(output).not.toContain("prj_test_project");
      expect(output).not.toContain("team_test_org");
      expect(output).not.toContain(tmpDir);
      expect(output).not.toContain("/Users/");
    } finally {
      await closeServerForTest(server);
    }
  });

  it("reports redacted Vercel REST env upsert status details without leaking values", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-apply-rest-failure-"));
    const envFile = join(tmpDir, "vercel-env-apply-rest-failure.test.env");
    const readinessFile = join(tmpDir, "vercel-project-readiness.json");
    const server = createServer(async (request, response) => {
      await readBodyForTest(request);
      response.writeHead(400, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error: {
            code: "invalid_type",
            message: "Rejected request that included secret-storage-rest-failure-token-strong",
          },
        }),
      );
    });
    const baseUrl = await listenForTest(server);

    try {
      mkdirSync(join(tmpDir, ".vercel"), { recursive: true });
      writeFileSync(
        join(tmpDir, ".vercel", "project.json"),
        JSON.stringify({
          projectId: "prj_test_project",
          orgId: "team_test_org",
        }),
      );
      writeFileSync(
        envFile,
        [
          "UAIS_TEACHER_AI_OWNERSHIP_BACKEND=external",
          "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND=external",
          "UAIS_EXTERNAL_STORAGE_BASE_URL=https://storage.example.test/uais",
          "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=secret-storage-rest-failure-token-strong",
          "UAIS_EXTERNAL_STORAGE_SERVICE_MODE=production",
          "UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR=/data/uais-external-storage",
          "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS=managed-database",
          "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS=up-to-date",
          "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY=point-in-time-restore",
          "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL=transactional",
        ].join("\n"),
      );
      writeFileSync(
        readinessFile,
        JSON.stringify({
          target: "vercel-project-readiness",
          status: "ready",
          checks: [
            { id: "s22-vercel-cli", status: "present" },
            { id: "s22-vercel-auth", status: "present" },
            { id: "s22-vercel-team-scope", status: "present" },
            { id: "s22-vercel-project-candidate", status: "present" },
            { id: "s22-vercel-project-link", status: "present" },
            { id: "s22-vercelignore-upload-hygiene", status: "present" },
          ],
          blockedReasons: [],
        }),
      );

      let stderr = "";
      await expect(
        new Promise<string>((resolve, reject) => {
          execFile(
            process.execPath,
            [
              join(process.cwd(), "scripts/vercel-env-sync.mjs"),
              "--apply",
              "--approved",
              "--apply-method",
              "rest",
              "--scope",
              "external-storage",
              "--project",
              "uais",
              "--env-file",
              envFile,
              "--vercel-project-readiness",
              readinessFile,
              "--release-run-id",
              "uais-release-2026-06-21-external-storage-failure",
              "--vercel-api-base-url",
              baseUrl,
            ],
            {
              cwd: tmpDir,
              encoding: "utf8",
              env: {
                ...process.env,
                VERCEL_TOKEN: "secret-vercel-rest-api-token",
              },
            },
            (error, stdout, errorOutput) => {
              stderr = errorOutput;
              if (error) {
                reject(Object.assign(error, { stdout, stderr: errorOutput }));
                return;
              }
              resolve(stdout);
            },
          );
        }),
      ).rejects.toThrow("Vercel env REST upsert failed for UAIS_TEACHER_AI_OWNERSHIP_BACKEND in production with status 400 and error code invalid_type.");

      expect(stderr).not.toContain("secret-storage-rest-failure-token-strong");
      expect(stderr).not.toContain("Rejected request");
      expect(stderr).not.toContain("storage.example.test");
      expect(stderr).not.toContain(tmpDir);
      expect(stderr).not.toContain("/Users/");
    } finally {
      await closeServerForTest(server);
    }
  });

  it("rejects live provider smoke CLI runs without approval", () => {
    expect(() =>
      execFileSync("node", ["scripts/ai-provider-smoke.mjs", "--live"], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).toThrow("explicit owner approval");
  });

  it("runs the live provider smoke CLI with the Qwen Omni streaming contract", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const server = createServer(async (request, response) => {
      requests.push({
        url: request.url ?? "",
        body: JSON.parse(await readBodyForTest(request)) as Record<string, unknown>,
      });

      if (request.url?.includes("/compatible-mode/v1/chat/completions")) {
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        response.end(
          [
            `data: ${JSON.stringify({ choices: [{ delta: { content: "OK" } }] })}`,
            "data: [DONE]",
          ].join("\n\n"),
        );
        return;
      }

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: "OK" } }] }));
    });
    const baseUrl = await listenForTest(server);
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ai-provider-live-smoke-"));
    const envFile = join(tmpDir, "ai-provider-live-smoke.test.env");
    writeFileSync(
      envFile,
      [
        "DEEPSEEK_API_KEY=secret-deepseek-live-cli",
        `DEEPSEEK_BASE_URL=${baseUrl}`,
        "DASHSCOPE_API_KEY=secret-qwen-live-cli",
        `DASHSCOPE_BASE_URL=${baseUrl}`,
        "QWEN_MULTIMODAL_MODEL=qwen3.5-omni-plus",
      ].join("\n"),
    );

    try {
      const output = await execFileForTest("node", [
        "scripts/ai-provider-smoke.mjs",
        "--live",
        "--approved",
        "--env-file",
        envFile,
      ]);
      const body = JSON.parse(output);
      const qwenRequest = requests.find((request) =>
        request.url.includes("/compatible-mode/v1/chat/completions"),
      );

      expect(body.results).toEqual([
        expect.objectContaining({ provider: "deepseek", status: "ok", httpStatus: 200 }),
        expect.objectContaining({ provider: "qwen", status: "ok", httpStatus: 200 }),
      ]);
      expect(qwenRequest?.body).toMatchObject({
        model: "qwen3.5-omni-plus",
        stream: true,
        stream_options: { include_usage: true },
      });
      expect(output).not.toContain("secret-deepseek-live-cli");
      expect(output).not.toContain("secret-qwen-live-cli");
    } finally {
      await closeServerForTest(server);
    }
  });

  it("runs the provider smoke CLI in approved live mode with skipped redacted results when env is absent", () => {
    const output = execFileSync("node", [
      "scripts/ai-provider-smoke.mjs",
      "--live",
      "--approved",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.mode).toBe("live");
    expect(body.network).toBe("enabled");
    expect(body.results).toEqual([
      {
        provider: "deepseek",
        status: "skipped",
        reason: "missing-required-env",
      },
      {
        provider: "qwen",
        status: "skipped",
        reason: "missing-required-env",
      },
    ]);
  });
});

async function listenForTest(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port.");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function closeServerForTest(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function headerToString(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function createTeacherAuthIssuerRouteBodyForTest() {
  return {
    teacherAuthSession: {
      responsibleSession: "S12",
      authProvider: "trusted-cookie-issuer",
      authSource: "trusted-cookie-issuer",
      authSessionRef: "server-side-auth-session",
    },
    authProviderContract: {
      selector: "trusted-cookie-issuer",
      providerKind: "trusted-cookie-issuer",
      productionStatus: "ready",
    },
    progress: [
      {
        type: "s12-trusted-teacher-auth-issuer",
        status: "issued",
        responsibleSession: "S12",
      },
    ],
  };
}

function createTeacherAiSessionRouteBodyForTest() {
  return {
    accessSession: {
      headers: {
        "x-uais-access-claims": "redacted-access-claims",
        "x-uais-access-signature": "redacted-access-signature",
      },
    },
    accessPlan: {
      responsibleSession: "S12",
      action: "ppt-narration-submit",
    },
    authProviderContract: {
      selector: "trusted-cookie-issuer",
      providerKind: "trusted-cookie-issuer",
      productionStatus: "ready",
    },
    progress: [
      {
        type: "s12-teacher-ai-session-boundary",
        status: "issued",
        responsibleSession: "S12",
      },
    ],
  };
}

function createSignedSessionRequiredBodyForTest() {
  return {
    error: "UAIS AI access denied.",
    access: {
      status: "denied",
      responsibleSession: "S12",
      authMode: "signed-session",
      action: "ppt-narration-submit",
      reasonCode: "signed-session-required",
      redaction: {
        secrets: "omitted",
        headers: "omitted",
      },
    },
  };
}

function createAuthenticatedSessionRequiredBodyForTest() {
  return {
    error: "UAIS teacher authentication is required.",
    access: {
      status: "denied",
      responsibleSession: "S12",
      authMode: "signed-teacher-cookie",
      reasonCode: "authenticated-session-required",
      redaction: {
        secrets: "omitted",
        cookies: "omitted",
      },
    },
  };
}

function isSignedSessionRequiredProbeRoute(route: string | undefined) {
  return (
    route === "/api/ai/ppt-narration" ||
    route === "/api/ai/chat" ||
    route === "/api/ai/voice-sample" ||
    route === "/api/ai/voice-clone/preflight" ||
    route === "/api/ai/voice-clone/status" ||
    route === "/api/ai/voice-clone/revoke" ||
    route === "/api/ai/voice-assets/retention-readiness" ||
    route === "/api/ai/voice-clone/lifecycle-audit" ||
    route === "/api/ai/readiness" ||
    route === "/api/ai/smoke-plan" ||
    /^\/api\/ai\/ppt-narration\/export\/[A-Za-z0-9_-]+$/.test(route ?? "") ||
    /^\/api\/ai\/ppt-narration\/audio\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(route ?? "")
  );
}

function isTeacherCookieRouteForTest(route: string | undefined) {
  return (
    route === "/api/ai/teacher-ownership" ||
    route === "/api/ai/teacher-ppt-workflow"
  );
}

function createTeacherPptWorkflowRouteBodyForTest(audioManifestId: string) {
  return {
    workflow: {
      status: "ready-for-downloads",
      nextAction: "review-and-download-ppt-narration",
      downloads: {
        audioManifestId,
        exportDownloadUrl: `/api/ai/ppt-narration/export/${audioManifestId}`,
        audioDownloadPattern: `/api/ai/ppt-narration/audio/${audioManifestId}/{audioId}`,
      },
    },
    agentHandoffPlan: {
      framework: "openmaic-style-teacher-ppt-narration",
      handoffs: [
        {
          agentId: "s22-release-smoke-agent",
          responsibleSession: "S22",
        },
      ],
    },
  };
}

function writeVercelDeploymentEvidenceForTest(
  tmpDir: string,
  {
    baseUrl,
    releaseRunId,
  }: {
    baseUrl: string;
    releaseRunId: string;
  },
) {
  const evidencePath = join(tmpDir, "vercel-production-deployment.json");
  writeFileSync(
    evidencePath,
    JSON.stringify({
      target: "vercel-production-deployment",
      mode: "live",
      environment: "production",
      status: "deployed",
      releaseRunId,
      deploymentFingerprint: {
        status: "present",
        value: `sha256:${createHash("sha256").update(baseUrl.replace(/\/+$/, "")).digest("hex").slice(0, 16)}`,
      },
      deploymentObservation: {
        status: "observed",
      },
    }),
  );
  return evidencePath;
}

function writeDeploymentDomainReachabilityEvidenceForTest(
  tmpDir: string,
  {
    baseUrl,
    releaseRunId,
  }: {
    baseUrl: string;
    releaseRunId: string;
  },
) {
  const evidencePath = join(tmpDir, "deployment-domain-reachability.json");
  writeFileSync(
    evidencePath,
    JSON.stringify({
      target: "deployment-domain-reachability",
      mode: "live",
      environment: "production",
      status: "reachable",
      releaseRunId,
      deploymentFingerprint: {
        status: "present",
        value: `sha256:${createHash("sha256").update(new URL(baseUrl).origin).digest("hex").slice(0, 16)}`,
        valueRedacted: true,
      },
      domainOrigin: {
        status: "present",
        originClass: "remote-https",
        valueRedacted: true,
      },
      httpObservation: {
        status: "observed",
        valueRedacted: true,
      },
    }),
  );
  return evidencePath;
}

function writeExternalStorageServiceReadinessEvidenceForTest(
  tmpDir: string,
  {
    baseUrl,
    releaseRunId,
  }: {
    baseUrl: string;
    releaseRunId: string;
  },
) {
  const evidencePath = join(tmpDir, "external-storage-service-readiness.json");
  writeFileSync(
    evidencePath,
    JSON.stringify({
      target: "external-storage-service-readiness",
      mode: "live",
      environment: "production",
      status: "ready",
      releaseRunId,
      storageServiceFingerprint: {
        status: "present",
        value: `sha256:${createHash("sha256").update(new URL(baseUrl).origin).digest("hex").slice(0, 16)}`,
        source: "origin",
        valueRedacted: true,
      },
      health: {
        status: "ok",
        productionServiceIdentity: "proved",
        apiContractVersion: "matched",
        durableBackingStore: "ready",
        redaction: "present",
      },
      productionLaunchContractEvidence: {
        target: "external-storage-service-production-launcher",
        status: "ready",
        valueRedacted: true,
        serviceMode: "production",
        runtime: "proved",
        envContract: "proved",
        dataDirPersistence: "proved",
        containerArtifact: "proved",
        redactionSafety: "proved",
      },
    }),
  );
  return evidencePath;
}

function writeTeacherAuthProviderReadinessEvidenceForTest(
  tmpDir: string,
  {
    authProviderMode,
    releaseRunId,
  }: {
    authProviderMode: "trusted-cookie-issuer" | "oidc-jwks";
    releaseRunId: string;
  },
) {
  const evidencePath = join(tmpDir, "teacher-auth-provider-readiness.json");
  writeFileSync(
    evidencePath,
    JSON.stringify({
      target: "teacher-auth-provider-readiness",
      mode: "live",
      environment: "production",
      status: "ready",
      releaseRunId,
      authProviderMode,
      sessionCookieContract: {
        signingSecretStrength: "sufficient",
        httpOnly: "required",
        sameSite: "lax",
        secureInProduction: true,
        maxAgeBounded: true,
        cookiePair: [
          {
            name: "uais_teacher_auth_claims",
            purpose: "signed-session-claims",
            httpOnly: true,
            sameSite: "Lax",
            secure: "required-in-production",
            path: "/",
            maxAge: "bounded-by-session-ttl",
            priority: "High",
            valueRedacted: true,
          },
          {
            name: "uais_teacher_auth_signature",
            purpose: "hmac-sha256-signature",
            httpOnly: true,
            sameSite: "Lax",
            secure: "required-in-production",
            path: "/",
            maxAge: "bounded-by-session-ttl",
            priority: "High",
            valueRedacted: true,
          },
        ],
        valueRedacted: true,
      },
      safety: {
        valuesRedacted: true,
        secretsOmitted: true,
        providerUrlsOmitted: true,
        responseBodiesOmitted: true,
        localPrivatePathsOmitted: true,
        liveRequiresApproval: true,
        noCookieIssued: true,
      },
    }),
  );
  return evidencePath;
}

async function readBodyForTest(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function createReadyOrdinaryCourseStorageSchemasForTest() {
  return {
    teachingCourseManagementStorageSchema: createReadySnapshotStorageSchemaForTest(
      "uais-teaching-course-management-v1",
    ),
    teachingCourseAssetsStorageSchema: createReadySnapshotStorageSchemaForTest(
      "uais-teaching-course-assets-v1",
    ),
  };
}

function createReadySnapshotStorageSchemaForTest(schemaVersion: string) {
  return {
    status: "ready",
    schemaVersion,
    migrationStatus: "up-to-date",
    snapshotStore: "json-atomic-snapshot",
    auditLog: "jsonl-append-only",
    backupStore: "json-atomic-snapshot",
    restoreDrillLog: "jsonl-append-only",
    revisionControl: "optimistic-revision",
    concurrencyControl: "atomic-rename-with-revision-check",
    valueRedacted: true,
  };
}

function expectedSnapshotStorageShapeChecks(prefix: string) {
  return {
    [prefix]: "present",
    [`${prefix}.status`]: "present",
    [`${prefix}.schemaVersion`]: "present",
    [`${prefix}.migrationStatus`]: "present",
    [`${prefix}.snapshotStore`]: "present",
    [`${prefix}.auditLog`]: "present",
    [`${prefix}.backupStore`]: "present",
    [`${prefix}.restoreDrillLog`]: "present",
    [`${prefix}.revisionControl`]: "present",
    [`${prefix}.concurrencyControl`]: "present",
    [`${prefix}.valueRedacted`]: "present",
  };
}

async function execFileForTest(command: string, args: string[]) {
  const { stdout } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
  return stdout;
}

async function execFileResultForTest(command: string, args: string[]) {
  return await new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((resolve) => {
    execFile(
      command,
      args,
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        resolve({
          exitCode: error && typeof error.code === "number" ? error.code : error ? 1 : 0,
          stdout,
          stderr,
        });
      },
    );
  });
}
