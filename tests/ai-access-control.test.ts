import { describe, expect, it } from "vitest";
import {
  assertProductionUaisAiAdminAccess,
  authorizeUaisAiAccess,
  createUaisAiAccessSessionForTrustedActor,
  createUaisAiAccessSessionHeaders,
} from "@/lib/server/ai-access-control";
import {
  createUaisAiAccessSessionFromAuthenticatedTeacher,
} from "@/lib/server/ai-session-issuer";
import {
  createUaisTeacherAiResourceGrants,
  createUaisTeacherAiWorkflowAccessPlan,
  type UaisTeacherAiResourceOwnership,
} from "@/lib/server/ai-resource-grants";
import {
  createUaisTeacherAiOwnershipMergeAdapter,
  createUaisTeacherAiOwnershipAdapter,
  createLocalUaisTeacherAiOwnershipAdapter,
  createUaisTeacherAiOwnershipConsistencyReport,
  mergeUaisTeacherAiOwnershipRecord,
  readUaisTeacherAiOwnershipRecord,
  storeUaisTeacherAiOwnershipRecord,
} from "@/lib/server/teacher-ai-ownership-store";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const signingSecret = "test-s12-signing-secret";
const now = new Date("2026-06-16T12:00:00.000Z");

function signedTeacherHeaders(overrides: Partial<Parameters<typeof createUaisAiAccessSessionHeaders>[0]["claims"]> = {}) {
  return createUaisAiAccessSessionHeaders({
    secret: signingSecret,
    claims: {
      actor: {
        actorId: "teacher-kang",
        role: "teacher",
      },
      scopes: {
        teacherIds: ["teacher-kang"],
        courseIds: ["research-methods"],
        sampleAssetIds: ["asset-voice-10s"],
        pptAssetIds: ["research-methods-unit-3"],
        voiceRefIds: ["qwen-voice-ref-teacher-kang-asset-voice-10s"],
        audioManifestIds: ["audio-manifest-research-methods-unit-3"],
      },
      expiresAt: "2026-06-16T12:10:00.000Z",
      ...overrides,
    },
  });
}

function legacyTeacherHeaders() {
  return {
    "x-uais-actor-id": "teacher-kang",
    "x-uais-actor-role": "teacher",
    "x-uais-course-ids": "research-methods",
  };
}

describe("UAIS AI signed access session claims", () => {
  it("issues short-lived signed access headers from a trusted teacher session", () => {
    const issued = createUaisAiAccessSessionForTrustedActor({
      secret: signingSecret,
      now,
      ttlSeconds: 600,
      actor: {
        actorId: "teacher-kang",
        role: "teacher",
      },
      scopes: {
        teacherIds: ["teacher-kang", " teacher-kang "],
        courseIds: ["research-methods"],
        sampleAssetIds: ["asset-voice-10s"],
        pptAssetIds: ["research-methods-unit-3"],
        voiceRefIds: ["qwen-voice-ref-teacher-kang-asset-voice-10s"],
        audioManifestIds: ["audio-manifest-research-methods-unit-3"],
      },
    });

    expect(issued).toEqual(
      expect.objectContaining({
        responsibleSession: "S12",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
        claims: {
          actor: {
            actorId: "teacher-kang",
            role: "teacher",
          },
          issuedAt: "2026-06-16T12:00:00.000Z",
          expiresAt: "2026-06-16T12:10:00.000Z",
          scopes: {
            teacherIds: ["teacher-kang"],
            courseIds: ["research-methods"],
            sampleAssetIds: ["asset-voice-10s"],
            pptAssetIds: ["research-methods-unit-3"],
            voiceRefIds: ["qwen-voice-ref-teacher-kang-asset-voice-10s"],
            audioManifestIds: ["audio-manifest-research-methods-unit-3"],
          },
        },
      }),
    );
    expect(JSON.stringify(issued)).not.toContain(signingSecret);

    const decision = authorizeUaisAiAccess({
      request: new Request("http://localhost/api/ai/ppt-narration", {
        headers: issued.headers,
      }),
      action: "ppt-narration-submit",
      resource: {
        teacherId: "teacher-kang",
        courseId: "research-methods",
        sampleAssetId: "asset-voice-10s",
        pptAssetId: "research-methods-unit-3",
        voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
      },
      env: {
        NODE_ENV: "production",
        UAIS_AI_ACCESS_SIGNING_SECRET: signingSecret,
      },
      now: new Date("2026-06-16T12:09:59.000Z"),
    });

    expect(decision).toEqual(
      expect.objectContaining({
        status: "authorized",
        reasonCode: "authorized",
        responsibleSession: "S12",
        authMode: "signed-session",
      }),
    );
  });

  it("rejects trusted-session issuance without a server signing secret", () => {
    expect(() =>
      createUaisAiAccessSessionForTrustedActor({
        secret: "",
        now,
        actor: {
          actorId: "teacher-kang",
          role: "teacher",
        },
      }),
    ).toThrow("UAIS AI access signing secret is required.");
  });

  it("rejects trusted-session issuance with unsafe actor ids before signing", () => {
    expect(() =>
      createUaisAiAccessSessionForTrustedActor({
        secret: signingSecret,
        now,
        actor: {
          actorId: "/Users/example/teacher-kang",
          role: "teacher",
        },
      }),
    ).toThrow("UAIS AI trusted actor context is invalid.");
  });

  it("rejects trusted-session issuance with unsafe scope ids before signing", () => {
    expect(() =>
      createUaisAiAccessSessionForTrustedActor({
        secret: signingSecret,
        now,
        actor: {
          actorId: "teacher-kang",
          role: "teacher",
        },
        scopes: {
          courseIds: ["research-methods", "/Users/example/research-methods"],
        },
      }),
    ).toThrow("UAIS AI trusted actor scopes are invalid.");
  });

  it("authorizes scoped teacher resources from signed session claims without legacy actor headers", () => {
    const decision = authorizeUaisAiAccess({
      request: new Request("http://localhost/api/ai/ppt-narration", {
        headers: signedTeacherHeaders(),
      }),
      action: "ppt-narration-submit",
      resource: {
        teacherId: "teacher-kang",
        courseId: "research-methods",
        sampleAssetId: "asset-voice-10s",
        pptAssetId: "research-methods-unit-3",
        voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
      },
      env: { UAIS_AI_ACCESS_SIGNING_SECRET: signingSecret },
      now,
    });

    expect(decision).toEqual(
      expect.objectContaining({
        status: "authorized",
        reasonCode: "authorized",
        responsibleSession: "S12",
        authMode: "signed-session",
        actor: {
          actorId: "teacher-kang",
          role: "teacher",
        },
      }),
    );
    expect(JSON.stringify(decision)).not.toContain(signingSecret);
  });

  it("rejects tampered signed session claims before trusting scopes", () => {
    const headers = signedTeacherHeaders();
    const tamperedClaims = `${headers["x-uais-access-claims"].slice(0, -2)}aa`;
    const decision = authorizeUaisAiAccess({
      request: new Request("http://localhost/api/ai/ppt-narration", {
        headers: {
          ...headers,
          "x-uais-access-claims": tamperedClaims,
        },
      }),
      action: "ppt-narration-submit",
      resource: {
        teacherId: "teacher-kang",
        courseId: "research-methods",
      },
      env: { UAIS_AI_ACCESS_SIGNING_SECRET: signingSecret },
      now,
    });

    expect(decision).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "signed-session-invalid",
        responsibleSession: "S12",
        authMode: "signed-session",
      }),
    );
    expect(JSON.stringify(decision)).not.toContain(signingSecret);
  });

  it("rejects signed session claims with unsafe actor ids before authorization", () => {
    const headers = createUaisAiAccessSessionHeaders({
      secret: signingSecret,
      claims: {
        actor: {
          actorId: "/Users/example/teacher-kang",
          role: "teacher",
        },
        expiresAt: "2026-06-16T12:10:00.000Z",
      },
    });

    const decision = authorizeUaisAiAccess({
      request: new Request("http://localhost/api/ai/ppt-narration", {
        headers,
      }),
      action: "ppt-narration-submit",
      env: { UAIS_AI_ACCESS_SIGNING_SECRET: signingSecret },
      now,
    });

    expect(decision).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "signed-session-invalid",
        responsibleSession: "S12",
        authMode: "signed-session",
      }),
    );
    expect(JSON.stringify(decision)).not.toContain("/Users/example/teacher-kang");
    expect(JSON.stringify(decision)).not.toContain(signingSecret);
  });

  it("rejects signed session claims with unsafe scope ids before authorization", () => {
    const headers = createUaisAiAccessSessionHeaders({
      secret: signingSecret,
      claims: {
        actor: {
          actorId: "teacher-kang",
          role: "teacher",
        },
        scopes: {
          courseIds: ["/Users/example/research-methods"],
        },
        expiresAt: "2026-06-16T12:10:00.000Z",
      },
    });

    const decision = authorizeUaisAiAccess({
      request: new Request("http://localhost/api/ai/ppt-narration", {
        headers,
      }),
      action: "ppt-narration-submit",
      env: { UAIS_AI_ACCESS_SIGNING_SECRET: signingSecret },
      now,
    });

    expect(decision).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "signed-session-invalid",
        responsibleSession: "S12",
        authMode: "signed-session",
      }),
    );
    expect(JSON.stringify(decision)).not.toContain("/Users/example/research-methods");
    expect(JSON.stringify(decision)).not.toContain(signingSecret);
  });

  it("rejects unsafe signed-session resource ids before scope authorization", () => {
    const decision = authorizeUaisAiAccess({
      request: new Request("http://localhost/api/ai/ppt-narration", {
        headers: signedTeacherHeaders(),
      }),
      action: "ppt-narration-submit",
      resource: {
        teacherId: "teacher-kang",
        courseId: "/Users/example/research-methods",
      },
      env: { UAIS_AI_ACCESS_SIGNING_SECRET: signingSecret },
      now,
    });

    expect(decision).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "resource-context-invalid",
        responsibleSession: "S12",
        authMode: "signed-session",
      }),
    );
    expect(JSON.stringify(decision)).not.toContain("/Users/example/research-methods");
    expect(JSON.stringify(decision)).not.toContain(signingSecret);
  });

  it("rejects expired signed session claims", () => {
    const decision = authorizeUaisAiAccess({
      request: new Request("http://localhost/api/ai/ppt-narration", {
        headers: signedTeacherHeaders({ expiresAt: "2026-06-16T11:59:00.000Z" }),
      }),
      action: "ppt-narration-submit",
      resource: {
        teacherId: "teacher-kang",
        courseId: "research-methods",
      },
      env: { UAIS_AI_ACCESS_SIGNING_SECRET: signingSecret },
      now,
    });

    expect(decision).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "signed-session-expired",
        responsibleSession: "S12",
        authMode: "signed-session",
      }),
    );
  });

  it("applies the same resource-scope checks to signed session claims", () => {
    const decision = authorizeUaisAiAccess({
      request: new Request("http://localhost/api/ai/ppt-narration", {
        headers: signedTeacherHeaders({
          scopes: {
            teacherIds: ["teacher-kang"],
            courseIds: ["other-course"],
          },
        }),
      }),
      action: "ppt-narration-submit",
      resource: {
        teacherId: "teacher-kang",
        courseId: "research-methods",
      },
      env: { UAIS_AI_ACCESS_SIGNING_SECRET: signingSecret },
      now,
    });

    expect(decision).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "course-scope-denied",
        responsibleSession: "S12",
        authMode: "signed-session",
        actor: {
          actorId: "teacher-kang",
          role: "teacher",
        },
      }),
    );
  });

  it("keeps legacy scoped headers available for local development compatibility", () => {
    const decision = authorizeUaisAiAccess({
      request: new Request("http://localhost/api/ai/ppt-narration", {
        headers: legacyTeacherHeaders(),
      }),
      action: "ppt-narration-submit",
      resource: {
        teacherId: "teacher-kang",
        courseId: "research-methods",
      },
      env: { UAIS_AI_ACCESS_SIGNING_SECRET: signingSecret },
      now,
    });

    expect(decision).toEqual(
      expect.objectContaining({
        status: "authorized",
        reasonCode: "authorized",
        authMode: "scoped-headers",
      }),
    );
  });

  it("rejects unsafe legacy scoped header actor ids before local authorization", () => {
    const decision = authorizeUaisAiAccess({
      request: new Request("http://localhost/api/ai/ppt-narration", {
        headers: {
          ...legacyTeacherHeaders(),
          "x-uais-actor-id": "/Users/example/teacher-kang",
        },
      }),
      action: "ppt-narration-submit",
      resource: {
        teacherId: "/Users/example/teacher-kang",
        courseId: "research-methods",
      },
      env: { UAIS_AI_ACCESS_SIGNING_SECRET: signingSecret },
      now,
    });

    expect(decision).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "actor-context-required",
        responsibleSession: "S12",
        authMode: "scoped-headers",
      }),
    );
    expect(JSON.stringify(decision)).not.toContain("/Users/example/teacher-kang");
    expect(JSON.stringify(decision)).not.toContain(signingSecret);
  });

  it("rejects unsafe AI access resource ids before local authorization", () => {
    const decision = authorizeUaisAiAccess({
      request: new Request("http://localhost/api/ai/ppt-narration", {
        headers: legacyTeacherHeaders(),
      }),
      action: "ppt-narration-submit",
      resource: {
        teacherId: "teacher-kang",
        courseId: "/Users/example/research-methods",
      },
      env: { UAIS_AI_ACCESS_SIGNING_SECRET: signingSecret },
      now,
    });

    expect(decision).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "actor-context-required",
        responsibleSession: "S12",
        authMode: "scoped-headers",
      }),
    );
    expect(JSON.stringify(decision)).not.toContain("/Users/example/research-methods");
    expect(JSON.stringify(decision)).not.toContain(signingSecret);
  });

  it("rejects legacy scoped headers in production when signed sessions are required", () => {
    const decision = authorizeUaisAiAccess({
      request: new Request("http://localhost/api/ai/ppt-narration", {
        headers: legacyTeacherHeaders(),
      }),
      action: "ppt-narration-submit",
      resource: {
        teacherId: "teacher-kang",
        courseId: "research-methods",
      },
      env: {
        NODE_ENV: "production",
        UAIS_AI_ACCESS_SIGNING_SECRET: signingSecret,
      },
      now,
    });

    expect(decision).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "signed-session-required",
        responsibleSession: "S12",
        authMode: "scoped-headers",
      }),
    );
  });

  it("rejects legacy scoped headers when deployment markers indicate production", () => {
    for (const scenario of [
      {
        name: "UAIS_DEPLOYMENT_ENV",
        env: {
          NODE_ENV: "development",
          UAIS_DEPLOYMENT_ENV: "production",
        },
      },
      {
        name: "VERCEL_ENV",
        env: {
          NODE_ENV: "development",
          VERCEL_ENV: "production",
        },
      },
    ] as const) {
      const decision = authorizeUaisAiAccess({
        request: new Request("http://localhost/api/ai/ppt-narration", {
          headers: legacyTeacherHeaders(),
        }),
        action: "ppt-narration-submit",
        resource: {
          teacherId: "teacher-kang",
          courseId: "research-methods",
        },
        env: {
          ...scenario.env,
          UAIS_AI_ACCESS_SIGNING_SECRET: signingSecret,
        },
        now,
      });

      expect(decision, scenario.name).toEqual(
        expect.objectContaining({
          status: "denied",
          reasonCode: "signed-session-required",
          responsibleSession: "S12",
          authMode: "scoped-headers",
        }),
      );
    }
  });

  it("requires signed admin AI access when deployment markers indicate production", () => {
    for (const scenario of [
      {
        name: "UAIS_DEPLOYMENT_ENV",
        env: {
          NODE_ENV: "development",
          UAIS_DEPLOYMENT_ENV: "production",
        },
      },
      {
        name: "VERCEL_ENV",
        env: {
          NODE_ENV: "development",
          VERCEL_ENV: "production",
        },
      },
    ] as const) {
      expect(() =>
        assertProductionUaisAiAdminAccess({
          request: new Request("http://localhost/api/ai/readiness", {
            headers: {
              "x-uais-actor-id": "uais-admin",
              "x-uais-actor-role": "admin",
            },
          }),
          action: "provider-readiness",
          env: {
            ...scenario.env,
            UAIS_AI_ACCESS_SIGNING_SECRET: signingSecret,
          },
        }),
      ).toThrow("UAIS AI access denied: signed-session-required");
    }
  });

  it("issues scoped signed AI access from an authenticated teacher session", () => {
    const issued = createUaisAiAccessSessionFromAuthenticatedTeacher({
      secret: signingSecret,
      now,
      ttlSeconds: 600,
      authenticatedSession: {
        sessionId: "session-teacher-kang-1",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-16T11:55:00.000Z",
        expiresAt: "2026-06-16T12:20:00.000Z",
        grants: {
          teacherIds: ["teacher-kang"],
          courseIds: ["research-methods"],
          sampleAssetIds: ["asset-voice-10s"],
          pptAssetIds: ["research-methods-unit-3"],
          voiceRefIds: ["qwen-voice-ref-teacher-kang-asset-voice-10s"],
          audioManifestIds: ["audio-manifest-research-methods-unit-3"],
        },
      },
      requestedScopes: {
        teacherIds: [" teacher-kang "],
        courseIds: ["research-methods"],
        sampleAssetIds: ["asset-voice-10s"],
        pptAssetIds: ["research-methods-unit-3"],
        voiceRefIds: ["qwen-voice-ref-teacher-kang-asset-voice-10s"],
        audioManifestIds: ["audio-manifest-research-methods-unit-3"],
      },
    });

    expect(issued).toEqual(
      expect.objectContaining({
        responsibleSession: "S12",
        authSource: "uais-authenticated-session",
        authSessionRef: "server-side-auth-session",
        claims: {
          actor: {
            actorId: "teacher-kang",
            role: "teacher",
          },
          issuedAt: "2026-06-16T12:00:00.000Z",
          expiresAt: "2026-06-16T12:10:00.000Z",
          scopes: {
            teacherIds: ["teacher-kang"],
            courseIds: ["research-methods"],
            sampleAssetIds: ["asset-voice-10s"],
            pptAssetIds: ["research-methods-unit-3"],
            voiceRefIds: ["qwen-voice-ref-teacher-kang-asset-voice-10s"],
            audioManifestIds: ["audio-manifest-research-methods-unit-3"],
          },
        },
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      }),
    );
    expect(JSON.stringify(issued)).not.toContain(signingSecret);
    expect(JSON.stringify(issued)).not.toContain("session-teacher-kang-1");

    const pptDecision = authorizeUaisAiAccess({
      request: new Request("http://localhost/api/ai/ppt-narration", {
        headers: issued.headers,
      }),
      action: "ppt-narration-submit",
      resource: {
        teacherId: "teacher-kang",
        courseId: "research-methods",
        sampleAssetId: "asset-voice-10s",
        pptAssetId: "research-methods-unit-3",
        voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
      },
      env: {
        NODE_ENV: "production",
        UAIS_AI_ACCESS_SIGNING_SECRET: signingSecret,
      },
      now: new Date("2026-06-16T12:09:59.000Z"),
    });
    expect(pptDecision.reasonCode).toBe("authorized");

    const revokeDecision = authorizeUaisAiAccess({
      request: new Request("http://localhost/api/ai/voice-clone/revoke", {
        headers: issued.headers,
      }),
      action: "voice-clone-revoke",
      resource: {
        teacherId: "teacher-kang",
        sampleAssetId: "asset-voice-10s",
        voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
      },
      env: {
        NODE_ENV: "production",
        UAIS_AI_ACCESS_SIGNING_SECRET: signingSecret,
      },
      now: new Date("2026-06-16T12:09:59.000Z"),
    });
    expect(revokeDecision.reasonCode).toBe("authorized");
  });

  it("rejects authenticated teacher session issuing for ungranted resources", () => {
    expect(() =>
      createUaisAiAccessSessionFromAuthenticatedTeacher({
        secret: signingSecret,
        now,
        authenticatedSession: {
          sessionId: "session-teacher-kang-1",
          actorId: "teacher-kang",
          role: "teacher",
          authenticatedAt: "2026-06-16T11:55:00.000Z",
          expiresAt: "2026-06-16T12:20:00.000Z",
          grants: {
            teacherIds: ["teacher-kang"],
            courseIds: ["research-methods"],
            sampleAssetIds: ["asset-voice-10s"],
            voiceRefIds: ["qwen-voice-ref-teacher-kang-asset-voice-10s"],
          },
        },
        requestedScopes: {
          teacherIds: ["teacher-kang"],
          courseIds: ["other-course"],
          sampleAssetIds: ["asset-voice-10s"],
          voiceRefIds: ["qwen-voice-ref-teacher-kang-asset-voice-10s"],
        },
      }),
    ).toThrow("Authenticated teacher session is not authorized for requested AI scopes.");
  });

  it("limits issued AI access session lifetime to the authenticated session expiry", () => {
    const issued = createUaisAiAccessSessionFromAuthenticatedTeacher({
      secret: signingSecret,
      now,
      ttlSeconds: 600,
      authenticatedSession: {
        sessionId: "session-teacher-kang-short",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-16T11:55:00.000Z",
        expiresAt: "2026-06-16T12:02:00.000Z",
        grants: {
          teacherIds: ["teacher-kang"],
          courseIds: ["research-methods"],
        },
      },
      requestedScopes: {
        teacherIds: ["teacher-kang"],
        courseIds: ["research-methods"],
      },
    });

    expect(issued.claims.expiresAt).toBe("2026-06-16T12:02:00.000Z");
  });

  it("derives minimal signed AI scopes from teacher-owned PPT narration resources", () => {
    const ownership: UaisTeacherAiResourceOwnership = {
      teacherId: " teacher-kang ",
      courseIds: ["research-methods", "research-methods"],
      sampleAssets: [
        {
          sampleAssetId: "asset-voice-10s",
          courseId: "research-methods",
        },
      ],
      pptAssets: [
        {
          pptAssetId: "research-methods-unit-3",
          courseId: "research-methods",
        },
      ],
      clonedVoiceRefs: [
        {
          voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
          sampleAssetId: "asset-voice-10s",
        },
      ],
      audioManifests: [
        {
          audioManifestId: "audio-manifest-research-methods-unit-3",
          courseId: "research-methods",
          pptAssetId: "research-methods-unit-3",
          voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
        },
      ],
    };

    expect(createUaisTeacherAiResourceGrants(ownership)).toEqual({
      teacherIds: ["teacher-kang"],
      courseIds: ["research-methods"],
      sampleAssetIds: ["asset-voice-10s"],
      pptAssetIds: ["research-methods-unit-3"],
      voiceRefIds: ["qwen-voice-ref-teacher-kang-asset-voice-10s"],
      audioManifestIds: ["audio-manifest-research-methods-unit-3"],
    });

    const plan = createUaisTeacherAiWorkflowAccessPlan({
      ownership,
      action: "ppt-narration-submit",
      resource: {
        teacherId: "teacher-kang",
        courseId: "research-methods",
        sampleAssetId: "asset-voice-10s",
        pptAssetId: "research-methods-unit-3",
        voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
      },
    });

    expect(plan).toEqual(
      expect.objectContaining({
        responsibleSession: "S12",
        action: "ppt-narration-submit",
        requestedScopes: {
          teacherIds: ["teacher-kang"],
          courseIds: ["research-methods"],
          sampleAssetIds: ["asset-voice-10s"],
          pptAssetIds: ["research-methods-unit-3"],
          voiceRefIds: ["qwen-voice-ref-teacher-kang-asset-voice-10s"],
        },
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      }),
    );

    const issued = createUaisAiAccessSessionFromAuthenticatedTeacher({
      secret: signingSecret,
      now,
      authenticatedSession: {
        sessionId: "session-teacher-kang-resource-plan",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-16T11:55:00.000Z",
        expiresAt: "2026-06-16T12:20:00.000Z",
        grants: plan.grants,
      },
      requestedScopes: plan.requestedScopes,
    });

    const decision = authorizeUaisAiAccess({
      request: new Request("http://localhost/api/ai/ppt-narration", {
        headers: issued.headers,
      }),
      action: plan.action,
      resource: plan.resource,
      env: {
        NODE_ENV: "production",
        UAIS_AI_ACCESS_SIGNING_SECRET: signingSecret,
      },
      now,
    });

    expect(decision.reasonCode).toBe("authorized");
  });

  it("rejects teacher AI workflow plans for resources outside the teacher ownership record", () => {
    const ownership: UaisTeacherAiResourceOwnership = {
      teacherId: "teacher-kang",
      courseIds: ["research-methods"],
      sampleAssets: [{ sampleAssetId: "asset-voice-10s" }],
      clonedVoiceRefs: [
        {
          voiceRefId: "qwen-voice-ref-owned",
          sampleAssetId: "asset-voice-10s",
        },
      ],
      audioManifests: [{ audioManifestId: "audio-manifest-owned" }],
    };

    expect(() =>
      createUaisTeacherAiWorkflowAccessPlan({
        ownership,
        action: "voice-clone-revoke",
        resource: {
          teacherId: "teacher-kang",
          sampleAssetId: "asset-voice-10s",
          voiceRefId: "qwen-voice-ref-other",
        },
      }),
    ).toThrow(/voiceRefId/);

    expect(() =>
      createUaisTeacherAiWorkflowAccessPlan({
        ownership,
        action: "ppt-narration-audio-download",
        resource: {
          teacherId: "teacher-kang",
          audioManifestId: "audio-manifest-other",
        },
      }),
    ).toThrow(/audioManifestId/);
  });

  it("keeps private provider ids, local paths, and audio payloads out of teacher AI grants", () => {
    const ownership = {
      teacherId: "teacher-kang",
      courseIds: ["research-methods"],
      sampleAssets: [
        {
          sampleAssetId: "asset-voice-10s",
          sourceAudioPath: "/private/tmp/kangxia-source.m4a",
          audioBase64: "base64-audio-payload",
        },
      ],
      clonedVoiceRefs: [
        {
          voiceRefId: "public-qwen-voice-ref",
          sampleAssetId: "asset-voice-10s",
          privateProviderVoiceId: "private-qwen-voice-id",
        },
      ],
    } as UaisTeacherAiResourceOwnership;

    const plan = createUaisTeacherAiWorkflowAccessPlan({
      ownership,
      action: "voice-clone-revoke",
      resource: {
        teacherId: "teacher-kang",
        sampleAssetId: "asset-voice-10s",
        voiceRefId: "public-qwen-voice-ref",
      },
    });

    const serialized = JSON.stringify(plan);
    expect(serialized).not.toContain("private-qwen-voice-id");
    expect(serialized).not.toContain("/private/tmp/kangxia-source.m4a");
    expect(serialized).not.toContain("base64-audio-payload");
    expect(plan.redaction).toEqual({
      secrets: "omitted",
      localFiles: "omitted",
      assets: "ids-only",
    });
  });
});

describe("UAIS teacher AI ownership registry", () => {
  it("does not use the local ownership adapter when a durable backend is selected", () => {
    const adapter = createLocalUaisTeacherAiOwnershipAdapter({
      env: {
        UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "postgres",
      },
    });

    expect(adapter).toBeUndefined();
  });

  it("does not create a local ownership reader in production runtime", () => {
    const adapter = createUaisTeacherAiOwnershipAdapter({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "local-json-file",
        UAIS_TEACHER_AI_OWNERSHIP_DIR: "/tmp/uais-local-ownership-should-not-be-used",
      },
    });
    const localAdapter = createLocalUaisTeacherAiOwnershipAdapter({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "local-json-file",
        UAIS_TEACHER_AI_OWNERSHIP_DIR: "/tmp/uais-local-ownership-should-not-be-used",
      },
    });

    expect(adapter).toBeUndefined();
    expect(localAdapter).toBeUndefined();
  });

  it("reads teacher ownership through the external durable storage adapter without leaking private fields", async () => {
    const requests: Array<{
      url: string;
      authorization: string | null;
    }> = [];
    const adapter = createUaisTeacherAiOwnershipAdapter({
      env: {
        UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "external",
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: "secret-external-storage-token-strong-fixture",
      },
      fetch: async (url, init) => {
        const headers = new Headers(init?.headers);
        requests.push({
          url: String(url),
          authorization: headers.get("authorization"),
        });
        return Response.json({
          teacherId: "teacher-kang",
          courseIds: ["research-methods"],
          sampleAssets: [
            {
              sampleAssetId: "asset-voice-10s",
              courseId: "research-methods",
              privateSourcePath: "/Users/dongpinhu/Library/Containers/private-source.m4a",
            },
          ],
          pptAssets: [{ pptAssetId: "research-methods-unit-3", courseId: "research-methods" }],
          clonedVoiceRefs: [
            {
              voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
              sampleAssetId: "asset-voice-10s",
              privateProviderVoiceId: "voice-qwen-private-should-not-return",
            },
          ],
          audioManifests: [
            {
              audioManifestId: "audio-manifest-research-methods-unit-3",
              courseId: "research-methods",
              pptAssetId: "research-methods-unit-3",
              voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
              audioBase64: "data:audio/wav;base64,not-allowed",
            },
          ],
        });
      },
    });

    expect(adapter).toBeDefined();
    const ownership = await adapter?.({
      request: new Request("http://localhost/api/ai/session"),
      authenticatedSession: {
        sessionId: "session-teacher-kang",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-16T11:55:00.000Z",
        expiresAt: "2026-06-16T12:20:00.000Z",
      },
    });

    expect(requests).toEqual([
      {
        url: "https://storage.example.test/uais/teacher-ai-ownership/teacher-kang",
        authorization: "Bearer secret-external-storage-token-strong-fixture",
      },
    ]);
    expect(ownership).toEqual({
      teacherId: "teacher-kang",
      courseIds: ["research-methods"],
      sampleAssets: [{ sampleAssetId: "asset-voice-10s", courseId: "research-methods" }],
      pptAssets: [{ pptAssetId: "research-methods-unit-3", courseId: "research-methods" }],
      clonedVoiceRefs: [
        {
          voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
          sampleAssetId: "asset-voice-10s",
        },
      ],
      audioManifests: [
        {
          audioManifestId: "audio-manifest-research-methods-unit-3",
          courseId: "research-methods",
          pptAssetId: "research-methods-unit-3",
          voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
        },
      ],
    });
    expect(JSON.stringify(ownership)).not.toContain("secret-external-storage-token");
    expect(JSON.stringify(ownership)).not.toContain("voice-qwen-private");
    expect(JSON.stringify(ownership)).not.toContain("/Users/");
    expect(JSON.stringify(ownership)).not.toContain("audioBase64");
  });

  it("merges teacher ownership through the external durable storage adapter without leaking private fields", async () => {
    const requests: Array<{
      url: string;
      method: string | undefined;
      authorization: string | null;
      contentType: string | null;
      body: unknown;
    }> = [];
    const adapter = createUaisTeacherAiOwnershipMergeAdapter({
      env: {
        UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "external",
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: "secret-external-storage-token-strong-fixture",
      },
      fetch: async (url, init) => {
        const headers = new Headers(init?.headers);
        requests.push({
          url: String(url),
          method: init?.method,
          authorization: headers.get("authorization"),
          contentType: headers.get("content-type"),
          body: JSON.parse(String(init?.body)),
        });
        return Response.json({ ok: true });
      },
    });

    expect(adapter).toBeDefined();
    const receipt = await adapter?.({
      updatedAt: "2026-06-17T01:00:00.000Z",
      ownership: {
        teacherId: "teacher-kang",
        courseIds: ["research-methods"],
        sampleAssets: [
          {
            sampleAssetId: "asset-voice-10s",
            courseId: "research-methods",
            privateSourcePath: "/Users/dongpinhu/Library/Containers/private-source.m4a",
          },
        ],
        pptAssets: [{ pptAssetId: "research-methods-unit-3", courseId: "research-methods" }],
        clonedVoiceRefs: [
          {
            voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
            sampleAssetId: "asset-voice-10s",
            privateProviderVoiceId: "voice-qwen-private-should-not-return",
          },
        ],
        audioManifests: [
          {
            audioManifestId: "audio-manifest-research-methods-unit-3",
            courseId: "research-methods",
            pptAssetId: "research-methods-unit-3",
            voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
            audioBase64: "data:audio/wav;base64,not-allowed",
          },
        ],
      } as UaisTeacherAiResourceOwnership,
    });

    expect(requests).toEqual([
      {
        url: "https://storage.example.test/uais/teacher-ai-ownership/teacher-kang/merge",
        method: "POST",
        authorization: "Bearer secret-external-storage-token-strong-fixture",
        contentType: "application/json",
        body: {
          action: "merge-teacher-ai-ownership",
          updatedAt: "2026-06-17T01:00:00.000Z",
          ownership: {
            teacherId: "teacher-kang",
            courseIds: ["research-methods"],
            sampleAssets: [{ sampleAssetId: "asset-voice-10s", courseId: "research-methods" }],
            pptAssets: [{ pptAssetId: "research-methods-unit-3", courseId: "research-methods" }],
            clonedVoiceRefs: [
              {
                voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
                sampleAssetId: "asset-voice-10s",
              },
            ],
            audioManifests: [
              {
                audioManifestId: "audio-manifest-research-methods-unit-3",
                courseId: "research-methods",
                pptAssetId: "research-methods-unit-3",
                voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
              },
            ],
          },
        },
      },
    ]);
    expect(receipt).toEqual({
      teacherId: "teacher-kang",
      courseIds: ["research-methods"],
      status: "merged",
      storagePolicy: "external-redacted-teacher-ai-ownership-merge",
      storageWritePolicy: "external-atomic-merge",
      responsibleSession: "S12",
      updatedAt: "2026-06-17T01:00:00.000Z",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    });
    const serializedRequest = JSON.stringify(requests);
    const serializedReceipt = JSON.stringify(receipt);
    expect(serializedRequest).not.toContain("voice-qwen-private");
    expect(serializedRequest).not.toContain("/Users/");
    expect(serializedRequest).not.toContain("audioBase64");
    expect(serializedReceipt).not.toContain("secret-external-storage-token");
    expect(serializedReceipt).not.toContain("https://storage.example.test");
  });

  it("reports ownership relationship consistency without exposing private asset data", () => {
    const report = createUaisTeacherAiOwnershipConsistencyReport({
      teacherId: "teacher-kang",
      courseIds: ["research-methods"],
      sampleAssets: [{ sampleAssetId: "asset-voice-10s", courseId: "research-methods" }],
      pptAssets: [{ pptAssetId: "research-methods-unit-3", courseId: "research-methods" }],
      clonedVoiceRefs: [
        {
          voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
          sampleAssetId: "asset-voice-10s",
        },
      ],
      audioManifests: [
        {
          audioManifestId: "audio-manifest-good",
          courseId: "research-methods",
          pptAssetId: "research-methods-unit-3",
          voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
        },
        {
          audioManifestId: "audio-manifest-missing-voice",
          courseId: "research-methods",
          pptAssetId: "research-methods-unit-3",
          voiceRefId: "qwen-voice-ref-missing",
        },
      ],
    });

    expect(report).toEqual({
      responsibleSession: "S12/S24",
      status: "blocked",
      recordCounts: {
        courseIds: 1,
        sampleAssets: 1,
        pptAssets: 1,
        clonedVoiceRefs: 1,
        audioManifests: 2,
      },
      checks: [
        {
          id: "sample-assets-course-links",
          status: "ready",
          missingReferences: [],
        },
        {
          id: "ppt-assets-course-links",
          status: "ready",
          missingReferences: [],
        },
        {
          id: "voice-refs-sample-links",
          status: "ready",
          missingReferences: [],
        },
        {
          id: "audio-manifests-course-links",
          status: "ready",
          missingReferences: [],
        },
        {
          id: "audio-manifests-ppt-links",
          status: "ready",
          missingReferences: [],
        },
        {
          id: "audio-manifests-voice-links",
          status: "blocked",
          missingReferences: [
            {
              ownerId: "audio-manifest-missing-voice",
              missingField: "voiceRefId",
              missingId: "qwen-voice-ref-missing",
            },
          ],
        },
      ],
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    });
    expect(JSON.stringify(report)).not.toContain("voice-qwen-private");
    expect(JSON.stringify(report)).not.toContain("data:audio");
    expect(JSON.stringify(report)).not.toContain("/Users/");
  });

  it("stores ownership records with an atomic file-replace policy", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "uais-ownership-atomic-"));
    try {
      const stored = await storeUaisTeacherAiOwnershipRecord({
        baseDir,
        updatedAt: "2026-06-17T01:10:00.000Z",
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["research-methods"],
        },
      });
      const fileNames = (await readdir(baseDir)).sort();
      const rawRecord = await readFile(join(baseDir, "teacher-kang.json"), "utf8");

      expect(stored).toEqual(
        expect.objectContaining({
          storagePolicy: "local-server-teacher-ai-ownership-registry",
          storageWritePolicy: "atomic-json-file-replace",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      );
      expect(fileNames).toEqual(["teacher-kang.json"]);
      expect(JSON.parse(rawRecord)).toEqual(
        expect.objectContaining({
          teacherId: "teacher-kang",
          storageWritePolicy: "atomic-json-file-replace",
        }),
      );
      expect(rawRecord).not.toContain(baseDir);
      expect(rawRecord).not.toContain("secret-qwen");
      expect(rawRecord).not.toContain("voice-qwen-private");
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("merges asset ownership records without exposing local registry paths or secrets", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "uais-ownership-merge-"));
    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir,
        updatedAt: "2026-06-17T00:00:00.000Z",
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["research-methods"],
        },
      });

      const merged = await mergeUaisTeacherAiOwnershipRecord({
        baseDir,
        updatedAt: "2026-06-17T00:10:00.000Z",
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["research-methods"],
          sampleAssets: [{ sampleAssetId: "asset-voice-10s", courseId: "research-methods" }],
          pptAssets: [{ pptAssetId: "research-methods-unit-3", courseId: "research-methods" }],
          clonedVoiceRefs: [
            {
              voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
              sampleAssetId: "asset-voice-10s",
            },
          ],
          audioManifests: [
            {
              audioManifestId: "audio-manifest-research-methods-unit-3",
              courseId: "research-methods",
              pptAssetId: "research-methods-unit-3",
              voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
            },
          ],
        },
      });
      const reread = await readUaisTeacherAiOwnershipRecord({
        baseDir,
        teacherId: "teacher-kang",
      });

      expect(merged).toEqual(
        expect.objectContaining({
          teacherId: "teacher-kang",
          courseIds: ["research-methods"],
          sampleAssets: [{ sampleAssetId: "asset-voice-10s", courseId: "research-methods" }],
          pptAssets: [{ pptAssetId: "research-methods-unit-3", courseId: "research-methods" }],
          clonedVoiceRefs: [
            {
              voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
              sampleAssetId: "asset-voice-10s",
            },
          ],
          audioManifests: [
            {
              audioManifestId: "audio-manifest-research-methods-unit-3",
              courseId: "research-methods",
              pptAssetId: "research-methods-unit-3",
              voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
            },
          ],
          storagePolicy: "local-server-teacher-ai-ownership-registry",
          responsibleSession: "S12",
          updatedAt: "2026-06-17T00:10:00.000Z",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      );
      expect(reread).toEqual({
        teacherId: "teacher-kang",
        courseIds: ["research-methods"],
        sampleAssets: [{ sampleAssetId: "asset-voice-10s", courseId: "research-methods" }],
        pptAssets: [{ pptAssetId: "research-methods-unit-3", courseId: "research-methods" }],
        clonedVoiceRefs: [
          {
            voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
            sampleAssetId: "asset-voice-10s",
          },
        ],
        audioManifests: [
          {
            audioManifestId: "audio-manifest-research-methods-unit-3",
            courseId: "research-methods",
            pptAssetId: "research-methods-unit-3",
            voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
          },
        ],
      });
      expect(JSON.stringify(merged)).not.toContain(baseDir);
      expect(JSON.stringify(merged)).not.toContain("secret-qwen");
      expect(JSON.stringify(merged)).not.toContain("secret-deepseek");
      expect(JSON.stringify(merged)).not.toContain("voice-qwen-private");
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
