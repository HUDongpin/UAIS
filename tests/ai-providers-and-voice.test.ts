import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getProviderForRole,
  getRedactedProviderReadiness,
} from "@/lib/ai/providers/registry";
import {
  QWEN_REALTIME_VOICE_CLONE_MODEL,
  createPptNarrationAudioManifest,
  createPptNarrationJob,
  createTeacherVoiceCloneJob,
} from "@/lib/ai/voice/ppt-narration";
import {
  assertPptNarrationScriptPackageIsDisplaySafe,
  createPptNarrationRoutePayloadFromScriptPackage,
  type PptNarrationScriptPackage,
} from "@/lib/ai/voice/ppt-narration-package";
import {
  readPptNarrationAudioAsset,
  storePptNarrationAudioAssets,
} from "@/lib/ai/voice/ppt-narration-assets";
import {
  createUaisVoiceAssetRetentionReport,
  readLocalUaisVoiceAssetRetentionReport,
} from "@/lib/ai/voice/asset-retention-report";
import { createPptNarrationExportPackage } from "@/lib/ai/voice/ppt-narration-export-package";
import { createVoiceCloneTaskStatus } from "@/lib/ai/voice/clone-task";
import { createTeacherVoiceClonePreflight } from "@/lib/ai/voice/live-preflight";
import { createTeacherVoiceSampleIntake } from "@/lib/ai/voice/sample-intake";
import {
  readTeacherVoiceSampleAsset,
  storeTeacherVoiceSampleAsset,
} from "@/lib/ai/voice/sample-assets";
import {
  listQwenClonedVoiceLifecycleAuditRecords,
  readQwenClonedVoiceReference,
  revokeAndDeleteQwenClonedVoiceReference,
  storeQwenClonedVoiceReference,
} from "@/lib/ai/voice/cloned-voice-registry";
import {
  appendQwenVoiceLifecycleAuditEvent,
  createQwenVoiceLifecycleAuditAdapter,
  createQwenVoiceLifecycleAuditEvent,
  listQwenVoiceLifecycleAuditEvents,
} from "@/lib/ai/voice/lifecycle-audit-store";

describe("UAIS AI provider registry", () => {
  it("maps text reasoning to DeepSeek and multimodal work to Qwen", () => {
    expect(getProviderForRole("text-reasoning").provider).toBe("deepseek");
    expect(getProviderForRole("multimodal").provider).toBe("qwen");
    expect(getProviderForRole("voice-clone").provider).toBe("qwen");
    expect(getProviderForRole("ppt-narration").provider).toBe("qwen");
  });

  it("uses the Qwen realtime voice-clone model for voice clone and PPT narration", () => {
    expect(getProviderForRole("voice-clone").defaultModel).toBe(QWEN_REALTIME_VOICE_CLONE_MODEL);
    expect(getProviderForRole("ppt-narration").defaultModel).toBe(QWEN_REALTIME_VOICE_CLONE_MODEL);
  });

  it("reports readiness without exposing secret values", () => {
    const readiness = getRedactedProviderReadiness({
      DEEPSEEK_API_KEY: "secret-deepseek",
      DASHSCOPE_API_KEY: "secret-qwen",
    });

    expect(readiness).toEqual([
      { provider: "deepseek", requiredEnv: "DEEPSEEK_API_KEY", status: "present" },
      { provider: "qwen", requiredEnv: "DASHSCOPE_API_KEY", status: "present" },
    ]);
  });
});

describe("UAIS Qwen voice and PPT narration contracts", () => {
  it("registers a consented 10-second teacher voice sample for clone intake", () => {
    const intake = createTeacherVoiceSampleIntake({
      teacherId: "teacher-kang",
      consentConfirmed: true,
      consentScope: "ppt-narration",
      sampleAssetId: "asset-voice-10s",
      sampleDurationSeconds: 10,
      mimeType: "audio/wav",
      sourceKind: "owner-provided",
    });

    expect(intake).toEqual({
      assetId: "asset-voice-10s",
      teacherId: "teacher-kang",
      providerRole: "voice-clone",
      provider: "qwen",
      status: "ready-for-clone",
      sampleDurationSeconds: 10,
      consentScope: "ppt-narration",
      storagePolicy: "metadata-only",
    });
    expect(JSON.stringify(intake)).not.toContain("/Users/");
  });

  it("stores a consented teacher voice sample as a private local audio asset", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "uais-teacher-sample-"));
    try {
      const createdAt = "2026-06-16T00:00:00.000Z";
      const stored = await storeTeacherVoiceSampleAsset({
        baseDir,
        teacherId: "teacher-kang",
        sampleAssetId: "asset-voice-10s",
        sampleDurationSeconds: 11.2,
        consentScope: "ppt-narration",
        sourceKind: "owner-provided",
        mimeType: "audio/mp4",
        audioBase64: Buffer.from("fake-audio").toString("base64"),
        createdAt,
      });

      expect(stored).toEqual({
        assetId: "asset-voice-10s",
        teacherId: "teacher-kang",
        provider: "qwen",
        providerRole: "voice-clone",
        status: "stored",
        mimeType: "audio/mp4",
        byteLength: 10,
        sampleDurationSeconds: 11.2,
        consentScope: "ppt-narration",
        sourceKind: "owner-provided",
        storagePolicy: "local-private-audio-asset",
        dataUrlRef: "server-side-only",
        responsibleSession: "S24/S12",
        retention: {
          classification: "teacher-voice-biometric-sensitive",
          policy: "delete-source-sample-after-30-days-or-owner-request",
          createdAt,
          deleteAfter: "2026-07-16T00:00:00.000Z",
          deleteAfterDays: 30,
          responsibleSession: "S24",
        },
        provenance: {
          sourceKind: "owner-provided",
          consentScope: "ppt-narration",
          consentRecord: "owner-confirmed-for-ppt-narration",
          provider: "qwen",
          providerRole: "voice-clone",
        },
      });
      expect(JSON.stringify(stored)).not.toContain(baseDir);
      expect(JSON.stringify(stored)).not.toContain("ZmFrZS1hdWRpbw==");

      const asset = await readTeacherVoiceSampleAsset({
        baseDir,
        teacherId: "teacher-kang",
        sampleAssetId: "asset-voice-10s",
      });
      expect(asset.contentType).toBe("audio/mp4");
      expect(asset.filename).toBe("asset-voice-10s.m4a");
      expect(asset.bytes.toString("utf8")).toBe("fake-audio");
      expect(asset.dataUrl).toBe("data:audio/mp4;base64,ZmFrZS1hdWRpbw==");
      await expect(readFile(join(baseDir, "teacher-kang", "asset-voice-10s.json"), "utf8")).resolves.not.toContain(
        baseDir,
      );
      await expect(readFile(join(baseDir, "teacher-kang", "asset-voice-10s.json"), "utf8")).resolves.toContain(
        "delete-source-sample-after-30-days-or-owner-request",
      );
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("stores a Qwen cloned voice id behind a server-side reference", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "uais-cloned-voice-"));
    try {
      const stored = await storeQwenClonedVoiceReference({
        baseDir,
        teacherId: "teacher-kang",
        sampleAssetId: "asset-voice-10s",
        providerTaskId: "task-voice-1",
        clonedVoiceId: "voice-qwen-private",
        targetModel: QWEN_REALTIME_VOICE_CLONE_MODEL,
        createdAt: "2026-06-16T00:00:00.000Z",
      });

      expect(stored).toEqual({
        voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
        teacherId: "teacher-kang",
        sampleAssetId: "asset-voice-10s",
        provider: "qwen",
        providerRole: "voice-clone",
        status: "ready",
        providerTaskId: "task-voice-1",
        targetModel: QWEN_REALTIME_VOICE_CLONE_MODEL,
        voiceRef: "server-side-cloned-qwen-voice",
        storagePolicy: "local-private-cloned-voice-reference",
        responsibleSession: "S07/S12/S24",
        retention: {
          classification: "provider-cloned-voice-reference-sensitive",
          policy: "revoke-provider-voice-and-delete-reference-on-owner-request-or-sample-expiry",
          createdAt: "2026-06-16T00:00:00.000Z",
          reviewAfter: "2026-07-16T00:00:00.000Z",
          reviewAfterDays: 30,
          deletionTrigger: "owner-request-or-source-sample-deletion",
          responsibleSession: "S24",
        },
        provenance: {
          provider: "qwen",
          providerRole: "voice-clone",
          sourceSampleAssetId: "asset-voice-10s",
          providerTaskId: "task-voice-1",
          voiceRef: "server-side-cloned-qwen-voice",
          privateProviderVoiceId: "server-side-only",
        },
      });
      expect(JSON.stringify(stored)).not.toContain("voice-qwen-private");
      expect(JSON.stringify(stored)).not.toContain(baseDir);
      await expect(readFile(join(baseDir, stored.voiceRefId + ".json"), "utf8")).resolves.toContain(
        "revoke-provider-voice-and-delete-reference-on-owner-request-or-sample-expiry",
      );
      await expect(readFile(join(baseDir, stored.voiceRefId + ".json"), "utf8")).resolves.not.toContain(baseDir);

      const privateReference = await readQwenClonedVoiceReference({
        baseDir,
        voiceRefId: stored.voiceRefId,
      });
      expect(privateReference.clonedVoiceId).toBe("voice-qwen-private");
      expect(privateReference.publicReference).toEqual(stored);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("revokes a Qwen cloned voice reference and deletes the local private registry entry", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "uais-cloned-voice-delete-"));
    try {
      const stored = await storeQwenClonedVoiceReference({
        baseDir,
        teacherId: "teacher-kang",
        sampleAssetId: "asset-voice-10s",
        providerTaskId: "task-voice-1",
        clonedVoiceId: "voice-qwen-private",
        targetModel: QWEN_REALTIME_VOICE_CLONE_MODEL,
        createdAt: "2026-06-16T00:00:00.000Z",
      });
      let revokedProviderVoiceId: string | undefined;

      const result = await revokeAndDeleteQwenClonedVoiceReference({
        baseDir,
        voiceRefId: stored.voiceRefId,
        deletionReason: "owner-request",
        deletedAt: "2026-06-17T00:00:00.000Z",
        revokeProviderVoice: async ({ clonedVoiceId }) => {
          revokedProviderVoiceId = clonedVoiceId;
          return { status: "revoked" };
        },
      });

      expect(revokedProviderVoiceId).toBe("voice-qwen-private");
      expect(result).toEqual({
        voiceRefId: stored.voiceRefId,
        provider: "qwen",
        providerRole: "voice-clone",
        status: "revoked-and-deleted",
        deletionReason: "owner-request",
        providerRevocation: {
          status: "revoked",
          provider: "qwen",
          providerRole: "voice-clone",
        },
        localReference: {
          status: "deleted",
          storagePolicy: "local-private-cloned-voice-reference",
        },
        auditRecord: {
          auditId: "qwen-cloned-voice-revocation-qwen-voice-ref-teacher-kang-asset-voice-10s",
          written: true,
          storagePolicy: "local-redacted-lifecycle-audit",
        },
        responsibleSession: "S24/S12",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      });
      expect(JSON.stringify(result)).not.toContain("voice-qwen-private");
      expect(JSON.stringify(result)).not.toContain(baseDir);
      const auditJson = await readFile(
        join(baseDir, ".deletion-audit", `${stored.voiceRefId}.json`),
        "utf8",
      );
      expect(JSON.parse(auditJson)).toEqual({
        auditId: "qwen-cloned-voice-revocation-qwen-voice-ref-teacher-kang-asset-voice-10s",
        voiceRefId: stored.voiceRefId,
        provider: "qwen",
        providerRole: "voice-clone",
        deletionReason: "owner-request",
        deletedAt: "2026-06-17T00:00:00.000Z",
        providerRevocation: {
          status: "revoked",
        },
        localReference: {
          status: "deleted",
        },
        responsibleSession: "S24/S12",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      });
      expect(auditJson).not.toContain("voice-qwen-private");
      expect(auditJson).not.toContain(baseDir);
      const auditIndex = await listQwenClonedVoiceLifecycleAuditRecords({ baseDir });
      expect(auditIndex).toEqual({
        provider: "qwen",
        providerRole: "voice-clone",
        storagePolicy: "local-redacted-lifecycle-audit",
        recordCount: 1,
        records: [
          {
            auditId: "qwen-cloned-voice-revocation-qwen-voice-ref-teacher-kang-asset-voice-10s",
            voiceRefId: stored.voiceRefId,
            deletionReason: "owner-request",
            deletedAt: "2026-06-17T00:00:00.000Z",
            providerRevocation: {
              status: "revoked",
            },
            localReference: {
              status: "deleted",
            },
            responsibleSession: "S24/S12",
          },
        ],
        responsibleSession: "S24/S12",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      });
      expect(JSON.stringify(auditIndex)).not.toContain("voice-qwen-private");
      expect(JSON.stringify(auditIndex)).not.toContain(baseDir);
      await expect(readFile(join(baseDir, stored.voiceRefId + ".json"), "utf8")).rejects.toThrow();
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("appends redacted Qwen voice lifecycle audit events without private voice ids or local paths", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "uais-voice-lifecycle-audit-"));
    try {
      const event = createQwenVoiceLifecycleAuditEvent({
        eventId: "qwen-voice-lifecycle-qwen-voice-ref-teacher-kang-asset-voice-10s-20260617",
        occurredAt: "2026-06-17T00:00:00.000Z",
        actor: {
          actorId: "teacher-kang",
          role: "teacher",
        },
        resource: {
          teacherId: "teacher-kang",
          sampleAssetId: "asset-voice-10s",
          voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
        },
        deletionReason: "owner-request",
        providerRevocation: {
          status: "revoked",
          requestId: "request-revoke-live",
        },
        localReference: {
          status: "deleted",
        },
        localAuditRecord: {
          auditId: "qwen-cloned-voice-revocation-qwen-voice-ref-teacher-kang-asset-voice-10s",
          storagePolicy: "local-redacted-lifecycle-audit",
        },
      });
      const receipt = await appendQwenVoiceLifecycleAuditEvent({
        baseDir,
        event,
      });

      expect(receipt).toEqual({
        eventId: event.eventId,
        provider: "qwen",
        providerRole: "voice-clone",
        action: "voice-clone-revoke",
        status: "recorded",
        storagePolicy: "append-only-redacted-lifecycle-audit",
        responsibleSession: "S12/S24",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      });
      const auditJsonl = await readFile(
        join(baseDir, "qwen-voice-lifecycle-audit.jsonl"),
        "utf8",
      );
      expect(JSON.parse(auditJsonl.trim())).toEqual(event);
      expect(auditJsonl).not.toContain("voice-qwen-private");
      expect(auditJsonl).not.toContain(baseDir);
      expect(auditJsonl).not.toContain("secret-qwen");
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("lists redacted Qwen voice lifecycle audit events for enterprise review", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "uais-voice-lifecycle-index-"));
    try {
      const olderEvent = createQwenVoiceLifecycleAuditEvent({
        eventId: "qwen-voice-lifecycle-qwen-voice-ref-teacher-kang-asset-voice-10s-20260617",
        occurredAt: "2026-06-17T00:00:00.000Z",
        actor: {
          actorId: "teacher-kang",
          role: "teacher",
        },
        resource: {
          teacherId: "teacher-kang",
          sampleAssetId: "asset-voice-10s",
          voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
        },
        deletionReason: "owner-request",
        providerRevocation: {
          status: "revoked",
          requestId: "request-revoke-older",
        },
        localReference: {
          status: "deleted",
        },
        localAuditRecord: {
          auditId: "qwen-cloned-voice-revocation-qwen-voice-ref-teacher-kang-asset-voice-10s",
          storagePolicy: "local-redacted-lifecycle-audit",
        },
      });
      const newerEvent = createQwenVoiceLifecycleAuditEvent({
        eventId: "qwen-voice-lifecycle-qwen-voice-ref-teacher-peter-asset-voice-10s-20260618",
        occurredAt: "2026-06-18T00:00:00.000Z",
        actor: {
          actorId: "admin-ai-ops",
          role: "admin",
        },
        resource: {
          teacherId: "teacher-peter",
          sampleAssetId: "asset-peter-voice-10s",
          voiceRefId: "qwen-voice-ref-teacher-peter-asset-peter-voice-10s",
        },
        deletionReason: "source-sample-deletion",
        providerRevocation: {
          status: "revoked",
          requestId: "request-revoke-newer",
        },
        localReference: {
          status: "deleted",
        },
        localAuditRecord: {
          auditId: "qwen-cloned-voice-revocation-qwen-voice-ref-teacher-peter-asset-peter-voice-10s",
          storagePolicy: "local-redacted-lifecycle-audit",
        },
      });
      await appendQwenVoiceLifecycleAuditEvent({ baseDir, event: newerEvent });
      await appendQwenVoiceLifecycleAuditEvent({ baseDir, event: olderEvent });

      const index = await listQwenVoiceLifecycleAuditEvents({ baseDir });

      expect(index).toEqual({
        provider: "qwen",
        providerRole: "voice-clone",
        eventType: "qwen-voice-lifecycle",
        storagePolicy: "append-only-redacted-lifecycle-audit",
        recordCount: 2,
        events: [olderEvent, newerEvent],
        responsibleSession: "S12/S24",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      });
      expect(JSON.stringify(index)).not.toContain("voice-qwen-private");
      expect(JSON.stringify(index)).not.toContain(baseDir);
      expect(JSON.stringify(index)).not.toContain("secret-qwen");
      expect(JSON.stringify(index)).not.toContain("data:audio");
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("uses the external durable lifecycle audit adapter without returning secrets or local paths", async () => {
    const event = createQwenVoiceLifecycleAuditEvent({
      eventId: "qwen-voice-lifecycle-qwen-voice-ref-teacher-kang-asset-voice-10s-20260617",
      occurredAt: "2026-06-17T00:00:00.000Z",
      actor: {
        actorId: "teacher-kang",
        role: "teacher",
      },
      resource: {
        teacherId: "teacher-kang",
        sampleAssetId: "asset-voice-10s",
        voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
      },
      deletionReason: "owner-request",
      providerRevocation: {
        status: "revoked",
        requestId: "request-revoke-live",
      },
      localReference: {
        status: "deleted",
      },
      localAuditRecord: {
        auditId: "qwen-cloned-voice-revocation-qwen-voice-ref-teacher-kang-asset-voice-10s",
        storagePolicy: "local-redacted-lifecycle-audit",
      },
    });
    const requests: Array<{
      url: string;
      method: string | undefined;
      authorization: string | null;
      body?: unknown;
    }> = [];
    const adapter = createQwenVoiceLifecycleAuditAdapter({
      env: {
        UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND: "external",
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: "secret-external-storage-token-strong-fixture",
      },
      fetch: async (url, init) => {
        const headers = new Headers(init?.headers);
        const body =
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
        requests.push({
          url: String(url),
          method: init?.method,
          authorization: headers.get("authorization"),
          body,
        });
        if (init?.method === "POST") {
          return Response.json({});
        }
        return Response.json({
          provider: "qwen",
          providerRole: "voice-clone",
          eventType: "qwen-voice-lifecycle",
          storagePolicy: "append-only-redacted-lifecycle-audit",
          recordCount: 1,
          events: [event],
          responsibleSession: "S12/S24",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      },
    });

    expect(adapter).toBeDefined();
    const receipt = await adapter?.appendEvent(event);
    const index = await adapter?.listEvents();

    expect(receipt).toEqual({
      eventId: event.eventId,
      provider: "qwen",
      providerRole: "voice-clone",
      action: "voice-clone-revoke",
      status: "recorded",
      storagePolicy: "append-only-redacted-lifecycle-audit",
      responsibleSession: "S12/S24",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    });
    expect(index).toEqual({
      provider: "qwen",
      providerRole: "voice-clone",
      eventType: "qwen-voice-lifecycle",
      storagePolicy: "append-only-redacted-lifecycle-audit",
      recordCount: 1,
      events: [event],
      responsibleSession: "S12/S24",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    });
    expect(requests.map((request) => request.url)).toEqual([
      "https://storage.example.test/uais/qwen-voice-lifecycle-audit",
      "https://storage.example.test/uais/qwen-voice-lifecycle-audit",
    ]);
    expect(requests.map((request) => request.method)).toEqual(["POST", "GET"]);
    expect(requests.map((request) => request.authorization)).toEqual([
      "Bearer secret-external-storage-token-strong-fixture",
      "Bearer secret-external-storage-token-strong-fixture",
    ]);
    expect(requests[0].body).toEqual(event);
    expect(JSON.stringify(receipt)).not.toContain("secret-external-storage-token");
    expect(JSON.stringify(index)).not.toContain("secret-external-storage-token");
    expect(JSON.stringify(index)).not.toContain("voice-qwen-private");
    expect(JSON.stringify(index)).not.toContain("/Users/");
  });

  it("rejects voice sample intake without PPT narration consent", () => {
    expect(() =>
      createTeacherVoiceSampleIntake({
        teacherId: "teacher-kang",
        consentConfirmed: false,
        consentScope: "ppt-narration",
        sampleAssetId: "asset-voice-10s",
        sampleDurationSeconds: 10,
        mimeType: "audio/wav",
        sourceKind: "owner-provided",
      }),
    ).toThrow("Teacher consent is required");
  });

  it("accepts a consented 10-second teacher sample for voice cloning", () => {
    const job = createTeacherVoiceCloneJob({
      teacherId: "teacher-kang",
      consentConfirmed: true,
      sampleAssetId: "asset-voice-10s",
      sampleDurationSeconds: 10,
      language: "zh-CN",
      targetVoiceLabel: "Kang teacher PPT voice",
    });

    expect(job.provider).toBe("qwen");
    expect(job.status).toBe("queued");
  });

  it("builds a Qwen PPT narration payload from a safe Kang Xia script package", () => {
    const scriptPackage: PptNarrationScriptPackage = {
      packageId: "kangxia-natural-number-ordinal-theory-v1",
      sourceDeckTitle: "初等数学研究+PPT1+自然数的序数理论.pptx",
      courseId: "elementary-math-research",
      pptAssetId: "natural-number-ordinal-theory-ppt1",
      expectedSlideCount: 2,
      language: "zh-CN",
      teacherVoice: {
        teacherId: "teacher-kang",
        sampleAssetId: "teacher-kang-10s-sample",
        sampleDurationSeconds: 10,
        targetVoiceLabel: "Kang Xia PPT narration voice",
        voiceRefId: "qwen-voice-ref-teacher-kang-teacher-kang-10s-sample",
        voiceRef: "server-side-cloned-qwen-voice",
      },
      slideScripts: [
        {
          slideId: "slide-01",
          narrationText: "同学们，今天我们从自然数的序数理论进入初等数学研究。",
        },
        {
          slideId: "slide-02",
          narrationText: "请先思考三个问题：它是什么，为什么学，又该如何教。",
        },
      ],
      responsibleSessions: ["S07", "S12", "S24"],
    };

    const safePackage = assertPptNarrationScriptPackageIsDisplaySafe(scriptPackage);
    const payload = createPptNarrationRoutePayloadFromScriptPackage(safePackage);

    expect(payload.voiceClone).toEqual({
      teacherId: "teacher-kang",
      consentConfirmed: true,
      sampleAssetId: "teacher-kang-10s-sample",
      sampleDurationSeconds: 10,
      language: "zh-CN",
      targetVoiceLabel: "Kang Xia PPT narration voice",
    });
    expect(payload.pptNarration).toEqual({
      courseId: "elementary-math-research",
      pptAssetId: "natural-number-ordinal-theory-ppt1",
      clonedVoiceRef: "qwen-voice-ref-teacher-kang-teacher-kang-10s-sample",
      language: "zh-CN",
      slideScripts: scriptPackage.slideScripts,
    });
    expect(JSON.stringify(payload)).not.toContain("voice-qwen-private");
    expect(JSON.stringify(payload)).not.toContain("/Users/");
    expect(JSON.stringify(payload)).not.toContain("data:audio");
  });

  it("rejects unsafe or incomplete PPT narration script packages", () => {
    const unsafePackage: PptNarrationScriptPackage = {
      packageId: "unsafe",
      sourceDeckTitle: "/Users/dongpinhu/private/source.pptx",
      courseId: "elementary-math-research",
      pptAssetId: "natural-number-ordinal-theory-ppt1",
      expectedSlideCount: 1,
      language: "zh-CN",
      teacherVoice: {
        teacherId: "teacher-kang",
        sampleAssetId: "teacher-kang-10s-sample",
        sampleDurationSeconds: 10,
        targetVoiceLabel: "Kang Xia PPT narration voice",
        voiceRefId: "qwen-voice-ref-teacher-kang-teacher-kang-10s-sample",
        voiceRef: "server-side-cloned-qwen-voice",
      },
      slideScripts: [
        {
          slideId: "slide-01",
          narrationText: "data:audio/mp4;base64,ZmFrZS1hdWRpbw==",
        },
      ],
      responsibleSessions: ["S07", "S12", "S24"],
    };

    expect(() => assertPptNarrationScriptPackageIsDisplaySafe(unsafePackage)).toThrow(
      "PPT narration script package contains non-display-safe data.",
    );

    expect(() =>
      createPptNarrationRoutePayloadFromScriptPackage({
        ...unsafePackage,
        sourceDeckTitle: "safe title",
        slideScripts: [],
        expectedSlideCount: 1,
      }),
    ).toThrow("PPT narration script package slide count does not match.");
  });

  it("validates the Kang Xia natural-number PPT narration package artifact", async () => {
    const packageFile = await readFile(
      "coordination/reports/2026-06-16-kangxia-natural-number-ordinal-narration-package.json",
      "utf8",
    );
    const scriptPackage = JSON.parse(packageFile) as PptNarrationScriptPackage;
    const payload = createPptNarrationRoutePayloadFromScriptPackage(
      assertPptNarrationScriptPackageIsDisplaySafe(scriptPackage),
    );

    expect(scriptPackage.expectedSlideCount).toBe(19);
    expect(scriptPackage.slideScripts).toHaveLength(19);
    expect(payload.voiceClone.teacherId).toBe("teacher-kang");
    expect(payload.voiceClone.sampleAssetId).toBe("teacher-kang-10s-sample");
    expect(payload.pptNarration.clonedVoiceRef).toBe(
      "qwen-voice-ref-teacher-kang-teacher-kang-10s-sample",
    );
    expect(payload.pptNarration.slideScripts[0].slideId).toBe("slide-01");
    expect(payload.pptNarration.slideScripts[18].slideId).toBe("slide-19");
    expect(JSON.stringify(scriptPackage)).not.toContain("/Users/");
    expect(JSON.stringify(scriptPackage)).not.toContain("voice-qwen-private");
    expect(JSON.stringify(scriptPackage)).not.toContain("data:audio");
    expect(JSON.stringify(scriptPackage)).not.toContain("API_KEY");
  });

  it("rejects voice cloning samples shorter than 10 seconds", () => {
    expect(() =>
      createTeacherVoiceCloneJob({
        teacherId: "teacher-kang",
        consentConfirmed: true,
        sampleAssetId: "asset-short",
        sampleDurationSeconds: 9.9,
        language: "zh-CN",
        targetVoiceLabel: "short sample",
      }),
    ).toThrow("at least 10 seconds");
  });

  it("creates a PPT narration job only after a cloned voice is available", () => {
    const job = createPptNarrationJob({
      courseId: "research-methods",
      pptAssetId: "ppt-unit-3",
      clonedVoiceId: "voice-qwen-redacted",
      language: "zh-CN",
      slideScripts: [
        { slideId: "s1", narrationText: "今天我们学习研究问题。" },
        { slideId: "s2", narrationText: "请观察变量之间的关系。" },
      ],
    });

    expect(job.provider).toBe("qwen");
    expect(job.slideCount).toBe(2);
    expect(job.targetModel).toBe(QWEN_REALTIME_VOICE_CLONE_MODEL);
  });

  it("plans OpenMAIC-style PPT audio segments without exposing the cloned voice id", () => {
    const manifest = createPptNarrationAudioManifest({
      courseId: "research-methods",
      pptAssetId: "ppt-unit-3",
      clonedVoiceId: "voice-qwen-private",
      language: "zh-CN",
      slideScripts: [
        { slideId: "s1", narrationText: "今天我们学习研究问题。" },
        { slideId: "s2", narrationText: "请观察变量之间的关系。" },
      ],
    });

    expect(manifest).toEqual({
      id: "audio-manifest-research-methods-ppt-unit-3",
      provider: "qwen",
      providerRole: "ppt-narration",
      targetModel: QWEN_REALTIME_VOICE_CLONE_MODEL,
      voiceRef: "server-side-cloned-qwen-voice",
      courseId: "research-methods",
      pptAssetId: "ppt-unit-3",
      language: "zh-CN",
      sourcePattern: "openmaic-register-once-speech-action-tts",
      segments: [
        {
          id: "tts-s1",
          slideId: "s1",
          audioId: "tts_ppt-unit-3_s1",
          narrationText: "今天我们学习研究问题。",
          format: "pcm",
          sampleRateHz: 24000,
          status: "queued",
          responsibleSession: "S07/S12/S24",
        },
        {
          id: "tts-s2",
          slideId: "s2",
          audioId: "tts_ppt-unit-3_s2",
          narrationText: "请观察变量之间的关系。",
          format: "pcm",
          sampleRateHz: 24000,
          status: "queued",
          responsibleSession: "S07/S12/S24",
        },
      ],
    });
    expect(JSON.stringify(manifest)).not.toContain("voice-qwen-private");
  });

  it("stores PPT narration audio as downloadable WAV assets with redacted paths", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "uais-ppt-audio-"));
    try {
      const createdAt = "2026-06-16T00:00:00.000Z";
      const manifest = createPptNarrationAudioManifest({
        courseId: "research-methods",
        pptAssetId: "ppt-unit-3",
        clonedVoiceId: "voice-qwen-private",
        language: "zh-CN",
        slideScripts: [{ slideId: "s1", narrationText: "今天我们学习研究问题。" }],
      });
      const stored = await storePptNarrationAudioAssets({
        manifest,
        baseDir,
        createdAt,
        audioSegments: [
          {
            slideId: "s1",
            audioId: "tts_ppt-unit-3_s1",
            audioBase64: Buffer.from([0, 0, 1, 0]).toString("base64"),
            byteLength: 4,
            format: "pcm",
            sampleRateHz: 24000,
          },
        ],
      });

      expect(stored).toEqual({
        id: "audio-manifest-research-methods-ppt-unit-3",
        provider: "qwen",
        providerRole: "ppt-narration",
        targetModel: QWEN_REALTIME_VOICE_CLONE_MODEL,
        courseId: "research-methods",
        pptAssetId: "ppt-unit-3",
        language: "zh-CN",
        voiceRef: "server-side-cloned-qwen-voice",
        sourcePattern: "openmaic-audio-id-download-assets",
        retention: {
          classification: "course-ppt-narration-derived-audio",
          policy: "retain-derived-audio-for-365-days-or-owner-request",
          createdAt,
          deleteAfter: "2027-06-16T00:00:00.000Z",
          deleteAfterDays: 365,
          responsibleSession: "S24",
        },
        provenance: {
          provider: "qwen",
          providerRole: "ppt-narration",
          sourcePattern: "openmaic-audio-id-download-assets",
          voiceRef: "server-side-cloned-qwen-voice",
          generatedFrom: "qwen-realtime-tts",
        },
        assets: [
          {
            slideId: "s1",
            audioId: "tts_ppt-unit-3_s1",
            format: "wav",
            sampleRateHz: 24000,
            byteLength: 48,
            downloadUrl:
              "/api/ai/ppt-narration/audio/audio-manifest-research-methods-ppt-unit-3/tts_ppt-unit-3_s1",
          },
        ],
      });
      expect(JSON.stringify(stored)).not.toContain("voice-qwen-private");
      expect(JSON.stringify(stored)).not.toContain(baseDir);
      expect(JSON.stringify(stored)).not.toContain("AAABAA==");

      const asset = await readPptNarrationAudioAsset({
        baseDir,
        manifestId: stored.id,
        audioId: "tts_ppt-unit-3_s1",
      });
      expect(asset.contentType).toBe("audio/wav");
      expect(asset.filename).toBe("tts_ppt-unit-3_s1.wav");
      expect(asset.bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(asset.bytes.subarray(8, 12).toString("ascii")).toBe("WAVE");
      await expect(stat(join(baseDir, stored.id, "tts_ppt-unit-3_s1.wav"))).resolves.toBeTruthy();
      await expect(readFile(join(baseDir, stored.id, "manifest.json"), "utf8")).resolves.not.toContain(
        "voice-qwen-private",
      );
      await expect(readFile(join(baseDir, stored.id, "manifest.json"), "utf8")).resolves.toContain(
        "retain-derived-audio-for-365-days-or-owner-request",
      );
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("summarizes voice and PPT asset retention without private ids or local paths", async () => {
    const sampleBaseDir = await mkdtemp(join(tmpdir(), "uais-retention-sample-"));
    const voiceBaseDir = await mkdtemp(join(tmpdir(), "uais-retention-voice-"));
    const pptBaseDir = await mkdtemp(join(tmpdir(), "uais-retention-ppt-"));
    try {
      const createdAt = "2026-06-16T00:00:00.000Z";
      const sample = await storeTeacherVoiceSampleAsset({
        baseDir: sampleBaseDir,
        teacherId: "teacher-kang",
        sampleAssetId: "asset-voice-10s",
        sampleDurationSeconds: 11.2,
        consentScope: "ppt-narration",
        sourceKind: "owner-provided",
        mimeType: "audio/mp4",
        audioBase64: Buffer.from("fake-audio").toString("base64"),
        createdAt,
      });
      const voiceRef = await storeQwenClonedVoiceReference({
        baseDir: voiceBaseDir,
        teacherId: "teacher-kang",
        sampleAssetId: "asset-voice-10s",
        providerTaskId: "task-voice-1",
        clonedVoiceId: "voice-qwen-private",
        targetModel: QWEN_REALTIME_VOICE_CLONE_MODEL,
        createdAt,
      });
      const manifest = createPptNarrationAudioManifest({
        courseId: "research-methods",
        pptAssetId: "ppt-unit-3",
        clonedVoiceId: "voice-qwen-private",
        language: "zh-CN",
        slideScripts: [{ slideId: "s1", narrationText: "今天我们学习研究问题。" }],
      });
      const pptAudio = await storePptNarrationAudioAssets({
        manifest,
        baseDir: pptBaseDir,
        createdAt,
        audioSegments: [
          {
            slideId: "s1",
            audioId: "tts_ppt-unit-3_s1",
            audioBase64: Buffer.from([0, 0, 1, 0]).toString("base64"),
            byteLength: 4,
            format: "pcm",
            sampleRateHz: 24000,
          },
        ],
      });

      const report = createUaisVoiceAssetRetentionReport({
        now: "2026-07-20T00:00:00.000Z",
        teacherVoiceSamples: [sample],
        clonedVoiceRefs: [voiceRef],
        pptAudioManifests: [pptAudio],
      });

      expect(report).toEqual({
        provider: "qwen",
        scope: "teacher-voice-and-ppt-narration-assets",
        status: "action-required",
        recordCounts: {
          teacherVoiceSamples: 1,
          clonedVoiceRefs: 1,
          pptAudioManifests: 1,
        },
        items: [
          {
            assetKind: "teacher-voice-sample",
            assetId: "asset-voice-10s",
            teacherId: "teacher-kang",
            action: "delete-source-sample",
            status: "due",
            dueAt: "2026-07-16T00:00:00.000Z",
            daysUntilDue: -4,
            responsibleSession: "S24",
          },
          {
            assetKind: "qwen-cloned-voice-reference",
            assetId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
            teacherId: "teacher-kang",
            sampleAssetId: "asset-voice-10s",
            action: "review-or-revoke-provider-voice",
            status: "due",
            dueAt: "2026-07-16T00:00:00.000Z",
            daysUntilDue: -4,
            responsibleSession: "S24",
          },
          {
            assetKind: "ppt-narration-audio-manifest",
            assetId: "audio-manifest-research-methods-ppt-unit-3",
            courseId: "research-methods",
            pptAssetId: "ppt-unit-3",
            action: "retain-derived-audio",
            status: "active",
            dueAt: "2027-06-16T00:00:00.000Z",
            daysUntilDue: 331,
            responsibleSession: "S24",
          },
        ],
        responsibleSession: "S24/S12",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      });
      expect(JSON.stringify(report)).not.toContain("voice-qwen-private");
      expect(JSON.stringify(report)).not.toContain(sampleBaseDir);
      expect(JSON.stringify(report)).not.toContain(voiceBaseDir);
      expect(JSON.stringify(report)).not.toContain(pptBaseDir);
      expect(JSON.stringify(report)).not.toContain("ZmFrZS1hdWRpbw==");
      expect(JSON.stringify(report)).not.toContain("data:audio");
    } finally {
      await rm(sampleBaseDir, { recursive: true, force: true });
      await rm(voiceBaseDir, { recursive: true, force: true });
      await rm(pptBaseDir, { recursive: true, force: true });
    }
  });

  it("reads local voice and PPT asset metadata into a redacted retention report", async () => {
    const sampleBaseDir = await mkdtemp(join(tmpdir(), "uais-retention-reader-sample-"));
    const voiceBaseDir = await mkdtemp(join(tmpdir(), "uais-retention-reader-voice-"));
    const pptBaseDir = await mkdtemp(join(tmpdir(), "uais-retention-reader-ppt-"));
    try {
      const createdAt = "2026-06-16T00:00:00.000Z";
      await storeTeacherVoiceSampleAsset({
        baseDir: sampleBaseDir,
        teacherId: "teacher-kang",
        sampleAssetId: "asset-voice-10s",
        sampleDurationSeconds: 11.2,
        consentScope: "ppt-narration",
        sourceKind: "owner-provided",
        mimeType: "audio/mp4",
        audioBase64: Buffer.from("fake-audio").toString("base64"),
        createdAt,
      });
      await storeQwenClonedVoiceReference({
        baseDir: voiceBaseDir,
        teacherId: "teacher-kang",
        sampleAssetId: "asset-voice-10s",
        providerTaskId: "task-voice-1",
        clonedVoiceId: "voice-qwen-private",
        targetModel: QWEN_REALTIME_VOICE_CLONE_MODEL,
        createdAt,
      });
      const manifest = createPptNarrationAudioManifest({
        courseId: "research-methods",
        pptAssetId: "ppt-unit-3",
        clonedVoiceId: "voice-qwen-private",
        language: "zh-CN",
        slideScripts: [{ slideId: "s1", narrationText: "今天我们学习研究问题。" }],
      });
      await storePptNarrationAudioAssets({
        manifest,
        baseDir: pptBaseDir,
        createdAt,
        audioSegments: [
          {
            slideId: "s1",
            audioId: "tts_ppt-unit-3_s1",
            audioBase64: Buffer.from([0, 0, 1, 0]).toString("base64"),
            byteLength: 4,
            format: "pcm",
            sampleRateHz: 24000,
          },
        ],
      });

      const report = await readLocalUaisVoiceAssetRetentionReport({
        now: "2026-07-20T00:00:00.000Z",
        teacherVoiceSampleBaseDir: sampleBaseDir,
        clonedVoiceRegistryBaseDir: voiceBaseDir,
        pptAudioBaseDir: pptBaseDir,
      });

      expect(report).toEqual(
        expect.objectContaining({
          provider: "qwen",
          scope: "teacher-voice-and-ppt-narration-assets",
          status: "action-required",
          recordCounts: {
            teacherVoiceSamples: 1,
            clonedVoiceRefs: 1,
            pptAudioManifests: 1,
          },
          responsibleSession: "S24/S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      );
      expect(report.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            assetKind: "teacher-voice-sample",
            assetId: "asset-voice-10s",
            status: "due",
          }),
          expect.objectContaining({
            assetKind: "qwen-cloned-voice-reference",
            assetId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
            status: "due",
          }),
          expect.objectContaining({
            assetKind: "ppt-narration-audio-manifest",
            assetId: "audio-manifest-research-methods-ppt-unit-3",
            status: "active",
          }),
        ]),
      );
      expect(JSON.stringify(report)).not.toContain("voice-qwen-private");
      expect(JSON.stringify(report)).not.toContain(sampleBaseDir);
      expect(JSON.stringify(report)).not.toContain(voiceBaseDir);
      expect(JSON.stringify(report)).not.toContain(pptBaseDir);
      expect(JSON.stringify(report)).not.toContain("ZmFrZS1hdWRpbw==");
      expect(JSON.stringify(report)).not.toContain("data:audio");
    } finally {
      await rm(sampleBaseDir, { recursive: true, force: true });
      await rm(voiceBaseDir, { recursive: true, force: true });
      await rm(pptBaseDir, { recursive: true, force: true });
    }
  });

  it("creates a redacted ZIP export package for stored PPT narration audio", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "uais-ppt-export-"));
    try {
      const manifest = createPptNarrationAudioManifest({
        courseId: "research-methods",
        pptAssetId: "ppt-unit-3",
        clonedVoiceId: "voice-qwen-private",
        language: "zh-CN",
        slideScripts: [
          { slideId: "s1", narrationText: "今天我们学习研究问题。" },
          { slideId: "s2", narrationText: "第二页继续说明。" },
        ],
      });
      const stored = await storePptNarrationAudioAssets({
        manifest,
        baseDir,
        createdAt: "2026-06-16T00:00:00.000Z",
        audioSegments: [
          {
            slideId: "s1",
            audioId: "tts_ppt-unit-3_s1",
            audioBase64: Buffer.from([0, 0, 1, 0]).toString("base64"),
            byteLength: 4,
            format: "pcm",
            sampleRateHz: 24000,
          },
          {
            slideId: "s2",
            audioId: "tts_ppt-unit-3_s2",
            audioBase64: Buffer.from([2, 0, 3, 0]).toString("base64"),
            byteLength: 4,
            format: "pcm",
            sampleRateHz: 24000,
          },
        ],
      });

      const exportPackage = await createPptNarrationExportPackage({
        manifestId: stored.id,
        baseDir,
      });
      const zipText = exportPackage.bytes.toString("latin1");

      expect(exportPackage).toEqual(
        expect.objectContaining({
          contentType: "application/zip",
          filename: "audio-manifest-research-methods-ppt-unit-3-ppt-narration.zip",
          manifestId: stored.id,
          assetCount: 2,
          responsibleSession: "S24",
        }),
      );
      expect(exportPackage.bytes.subarray(0, 4).toString("latin1")).toBe("PK\u0003\u0004");
      expect(zipText).toContain("README.md");
      expect(zipText).toContain("manifest.json");
      expect(zipText).toContain("audio/tts_ppt-unit-3_s1.wav");
      expect(zipText).toContain("audio/tts_ppt-unit-3_s2.wav");
      expect(JSON.stringify(exportPackage)).not.toContain("voice-qwen-private");
      expect(JSON.stringify(exportPackage)).not.toContain(baseDir);
      expect(zipText).not.toContain("voice-qwen-private");
      expect(zipText).not.toContain(baseDir);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("marks a Qwen voice clone task ready only when a cloned voice id is present", () => {
    const status = createVoiceCloneTaskStatus({
      providerTaskId: "task-voice-1",
      providerStatus: "SUCCEEDED",
      clonedVoiceId: "voice-qwen-redacted",
    });

    expect(status).toEqual({
      provider: "qwen",
      providerRole: "voice-clone",
      providerTaskId: "task-voice-1",
      status: "ready",
      clonedVoiceId: "voice-qwen-redacted",
      nextAction: "create-ppt-narration",
    });
  });

  it("keeps a Qwen voice clone task in polling state while it is running", () => {
    const status = createVoiceCloneTaskStatus({
      providerTaskId: "task-voice-1",
      providerStatus: "RUNNING",
    });

    expect(status).toEqual({
      provider: "qwen",
      providerRole: "voice-clone",
      providerTaskId: "task-voice-1",
      status: "processing",
      nextAction: "poll-qwen-voice-clone-task",
    });
  });

  it("rejects a succeeded voice clone task without a cloned voice id", () => {
    expect(() =>
      createVoiceCloneTaskStatus({
        providerTaskId: "task-voice-1",
        providerStatus: "SUCCEEDED",
      }),
    ).toThrow("cloned voice id");
  });

  it("marks live Qwen voice clone preflight ready only when all owning sessions are green", () => {
    const preflight = createTeacherVoiceClonePreflight({
      env: {
        DASHSCOPE_API_KEY: "secret-qwen",
        UAIS_LIVE_AI_APPROVAL_TOKEN: "secret-approval-token",
      },
      approvalHeader: "secret-approval-token",
      request: {
        liveProviderApproved: true,
        teacherId: "teacher-kang",
        consentConfirmed: true,
        consentScope: "ppt-narration",
        sampleAssetId: "asset-voice-10s",
        sampleDurationSeconds: 10,
        mimeType: "audio/wav",
        sourceKind: "owner-provided",
        targetVoiceLabel: "Kang teacher PPT voice",
      },
    });

    expect(preflight.status).toBe("ready");
    expect(preflight.nextAction).toBe("submit-qwen-voice-clone");
    expect(preflight.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "s07-qwen-provider", responsibleSession: "S07", status: "ready" }),
        expect.objectContaining({
          id: "s24-teacher-voice-sample",
          responsibleSession: "S24",
          status: "ready",
        }),
        expect.objectContaining({ id: "s19-dashscope-env", responsibleSession: "S19", status: "ready" }),
        expect.objectContaining({ id: "s12-live-approval", responsibleSession: "S12", status: "ready" }),
      ]),
    );
    expect(JSON.stringify(preflight)).not.toContain("secret-qwen");
    expect(JSON.stringify(preflight)).not.toContain("secret-approval-token");
    expect(JSON.stringify(preflight)).not.toContain("/Users/");
  });

  it("blocks live Qwen voice clone preflight with agent-owned reasons when sample or env is missing", () => {
    const preflight = createTeacherVoiceClonePreflight({
      env: {},
      request: {
        liveProviderApproved: true,
        teacherId: "teacher-kang",
        consentConfirmed: true,
        consentScope: "ppt-narration",
        sampleAssetId: "asset-short",
        sampleDurationSeconds: 9.5,
        mimeType: "audio/wav",
        sourceKind: "owner-provided",
        targetVoiceLabel: "",
      },
    });

    expect(preflight.status).toBe("blocked");
    expect(preflight.nextAction).toBe("resolve-preflight-blockers");
    expect(preflight.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s24-teacher-voice-sample",
          responsibleSession: "S24",
          status: "blocked",
          message: expect.stringContaining("10 seconds"),
        }),
        expect.objectContaining({
          id: "s24-target-voice-label",
          responsibleSession: "S24",
          status: "blocked",
        }),
        expect.objectContaining({ id: "s19-dashscope-env", responsibleSession: "S19", status: "blocked" }),
        expect.objectContaining({
          id: "s19-live-approval-token",
          responsibleSession: "S19",
          status: "blocked",
        }),
        expect.objectContaining({ id: "s12-live-approval", responsibleSession: "S12", status: "blocked" }),
      ]),
    );
    expect(JSON.stringify(preflight)).not.toContain("API_KEY");
    expect(JSON.stringify(preflight)).not.toContain("/Users/");
  });
});
