"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr/ArrowLeft";
import { CheckCircle } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { ClipboardText } from "@phosphor-icons/react/dist/ssr/ClipboardText";
import { Lightning } from "@phosphor-icons/react/dist/ssr/Lightning";
import { ShieldCheck } from "@phosphor-icons/react/dist/ssr/ShieldCheck";
import { SquaresFour } from "@phosphor-icons/react/dist/ssr/SquaresFour";
import { useAppPreferences } from "@/components/providers/app-preferences";
import {
  getTeachingOperationHrefWithCourse,
  isTeachingOperationId,
  type TeachingOperationId,
} from "@/components/teaching/teaching-operation-data";
import { localizedText } from "@/components/ui/localized-text";
import { teacherCourses, teacherSidebarItems } from "@/data/uais";
import type { LocalizedText, Locale } from "@/i18n/copy";
import { createTeachingOperationIdempotencyKey } from "@/lib/teaching-operation-idempotency";
import { defaultExportManifest } from "@/components/teaching/teaching-operation-page-data";
import {
  formatCourseAction,
  OperationSpecificPreview,
} from "./teaching-operation-previews";
import {
  operationConfigs,
  operationMenuIcons,
  type ExportManifestState,
} from "@/components/teaching/teaching-operation-page-data";

type TeachingOperationPageProps = {
  operationId: string;
  selectedCourseId?: string;
  selectedClassId?: string;
  action?: string;
};

type KnowledgeResourceRightsBasis =
  | ""
  | "owner-created"
  | "licensed"
  | "open-access"
  | "permission-granted";

type KnowledgeResourceAuditExpectation = {
  title: string;
  rightsBasis: Exclude<KnowledgeResourceRightsBasis, "">;
  visibility: "course-only";
};

type TeachingOperationBackendArtifact =
  | {
      kind: "export-file";
      manifestId: string;
      downloadUrl: string;
      contentType: "application/json";
    }
  | {
      kind: "invite-code";
      code: string;
      status: "generated" | "published";
      joinUrl: string;
    }
  | {
      kind: string;
      [key: string]: unknown;
    };

type TeachingOperationBackendReceipt = {
  receiptId?: string;
  operationId?: string;
  actionSlot?: "primary" | "secondary";
  courseId?: string;
  displayMessage?: LocalizedText;
  artifacts?: TeachingOperationBackendArtifact[];
};

type TeachingOperationDomainPersistenceSummary = {
  status?: "persisted" | "missing-domain-objects" | "not-required";
  required?: boolean;
  operationReceiptId?: string;
  expectedObjectTypes?: string[];
  persistedObjectTypes?: string[];
  missingObjectTypes?: string[];
};

type TeachingOperationAuditReadbackResponse = {
  actorId?: string;
  auditEventCount?: number;
  records?: Array<{
    recordId?: string;
    courseId?: string;
  }>;
  auditEvents?: Array<{
    traceId?: string;
    actorId?: string;
    courseId?: string;
    authSession?: {
      sessionId?: string;
      authenticatedAt?: string;
      expiresAt?: string;
    };
  }>;
  domainProjections?: Array<{
    objectId?: string;
    objectType?: string;
    courseId?: string;
    operationRecordId?: string;
    status?: string;
    updatedBy?: string;
    updatedAt?: string;
    previewedBy?: string;
    previewStatus?: string;
    previewId?: string;
    previewUrl?: string;
    previewScope?: string;
    previewPolicy?: string;
    generatedAt?: string;
    savedBy?: string;
    planStatus?: string;
    enabledAgents?: string[];
    governancePolicy?: string;
    savedAt?: string;
    checkedBy?: string;
    preflightStatus?: string;
    checkedPermissions?: string[];
    preflightPolicy?: string;
    checkedAt?: string;
    syncedBy?: string;
    syncStatus?: string;
    sourceSystems?: string[];
    pendingTeacherReviewCount?: number;
    syncedAt?: string;
    queuedBy?: string;
    reviewStatus?: string;
    resourceSource?: string;
    title?: string;
    sourceFingerprint?: string;
    rightsBasis?: string;
    visibility?: string;
    reviewPolicy?: string;
    queuedAt?: string;
    publishedBy?: string;
    publicationStatus?: string;
    releaseScope?: string;
    publishedAt?: string;
    generatedBy?: string;
    suggestionStatus?: string;
    groupingBasis?: string[];
    draftStatus?: string;
    artifactId?: string;
    settingsStatus?: string;
    adminScopes?: string[];
    notificationStatus?: string;
    deliveryChannel?: string;
    outboxId?: string;
    deliveryPolicy?: string;
    createdBy?: string;
    exportStatus?: string;
    manifestId?: string;
    datasetScopes?: string[];
    exportPolicy?: string;
    createdAt?: string;
    validatedBy?: string;
    validationStatus?: string;
    checkedScopes?: string[];
    validationPolicy?: string;
    validatedAt?: string;
    refreshedBy?: string;
    refreshStatus?: string;
    visibleMetrics?: string[];
    refreshPolicy?: string;
    refreshedAt?: string;
    lockedBy?: string;
    snapshotStatus?: string;
    snapshotId?: string;
    snapshotScope?: string;
    retentionPolicy?: string;
    lockedAt?: string;
    flaggedBy?: string;
    flaggedSignals?: string[];
    flaggedAt?: string;
    queueStatus?: string;
    feedbackStatus?: string;
    feedbackScope?: string;
    inviteCode?: string;
    joinUrl?: string;
    invitePolicy?: string;
    enrollmentPolicy?: string;
  }>;
};

type TeachingOperationPartialFailure = {
  operationReceiptId?: string;
  rollbackRoute?: string;
  compensation?: {
    status?: string;
    receipt?: {
      targetRecordId?: string;
    };
  };
};

type TeachingOperationBackendResponse = {
  receipt?: TeachingOperationBackendReceipt;
  domainPersistenceSummary?: TeachingOperationDomainPersistenceSummary;
  partialFailure?: TeachingOperationPartialFailure;
  access?: {
    reasonCode?: string;
  };
  error?: string;
  traceId?: string;
};

const defaultInviteCode = "55395057";

type VerifiedOperationArtifacts = {
  exportArtifact?: Extract<TeachingOperationBackendArtifact, { kind: "export-file" }>;
  inviteArtifact?: Extract<TeachingOperationBackendArtifact, { kind: "invite-code" }>;
};

type OperationAuditStatus =
  | {
      status: "pending";
      traceId: string;
    }
  | {
      status: "verified";
      traceId: string;
      actorId?: string;
      auditEventCount?: number;
      authSession?: {
        sessionId?: string;
        authenticatedAt?: string;
        expiresAt?: string;
      };
      domainProjection?: {
        objectId: string;
        objectType: string;
      };
    }
  | {
      status: "failed";
      traceId: string;
    };

const TEACHING_OPERATION_SAVE_FAILED_MESSAGE: LocalizedText = {
  "zh-CN": "未保存到服务器，请重新登录或检查课程权限。",
  "en-US": "Not saved to the server. Please sign in again or check course access.",
};

const TEACHING_OPERATION_SAVE_PENDING_MESSAGE: LocalizedText = {
  "zh-CN": "正在保存到服务器，请稍候。",
  "en-US": "Saving to the server. Please wait.",
};

const TEACHING_OPERATION_AUDIT_PENDING_MESSAGE: LocalizedText = {
  "zh-CN": "正在读取审计证据。",
  "en-US": "Reading audit evidence.",
};

const TEACHING_OPERATION_AUDIT_FAILED_MESSAGE: LocalizedText = {
  "zh-CN": "审计读回未完成，请稍后刷新。",
  "en-US": "Audit readback is not complete. Please refresh later.",
};

const TEACHING_OPERATION_DOMAIN_EVIDENCE_MISSING_MESSAGE: LocalizedText = {
  "zh-CN": "领域对象持久化证据缺失，请稍后重试。",
  "en-US": "Domain persistence evidence is missing. Please retry later.",
};

const TEACHING_OPERATION_RECEIPT_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "服务端回执未匹配当前操作，请稍后重试。",
  "en-US": "The server receipt did not match the current operation. Please retry later.",
};

// The generic save-failure copy sends the teacher to check sign-in and course
// permissions, which is the wrong instruction when the request simply carried no
// course: the fix is to re-enter from a course card, not to sign in again. The
// wording matches the inline workspace's `course-id-required` detail so both
// teaching surfaces name the same condition the same way.
const TEACHING_OPERATION_COURSE_CONTEXT_MISSING_MESSAGE: LocalizedText = {
  "zh-CN": "未保存到服务器：缺少课程上下文，请从课程卡片进入。",
  "en-US": "Not saved to the server: course context is missing. Please enter from a course card.",
};

export function TeachingOperationPage({
  operationId,
  selectedCourseId,
  selectedClassId,
  action,
}: TeachingOperationPageProps) {
  const { locale } = useAppPreferences();
  const safeOperationId = isTeachingOperationId(operationId) ? operationId : "content";
  const operation = teacherSidebarItems.find((item) => item.id === safeOperationId);
  const config = operationConfigs[safeOperationId];
  const title = operation ? localizedText(operation.title, locale) : safeOperationId;
  const description = operation ? localizedText(operation.description, locale) : "";
  const selectedCourse = teacherCourses.find((course) => course.id === selectedCourseId);
  const [statusMessage, setStatusMessage] = useState(localizedText(config.readyMessage, locale));
  const [manifestReady, setManifestReady] = useState(false);
  const [exportManifest, setExportManifest] =
    useState<ExportManifestState>(defaultExportManifest);
  const [inviteCode, setInviteCode] = useState(defaultInviteCode);
  const [auditStatus, setAuditStatus] = useState<OperationAuditStatus>();
  const [knowledgeResourceTitle, setKnowledgeResourceTitle] = useState("");
  const [knowledgeResourceUrl, setKnowledgeResourceUrl] = useState("");
  const [knowledgeResourceRightsBasis, setKnowledgeResourceRightsBasis] =
    useState<KnowledgeResourceRightsBasis>("");
  const [isActionPending, setIsActionPending] = useState(false);
  const actionPendingRef = useRef(false);
  const isStatusFailure = isTeachingOperationFailureStatus(statusMessage, locale);
  const isAuditPending = auditStatus?.status === "pending";
  const areActionButtonsDisabled = isActionPending || isAuditPending;
  const isKnowledgeResourceRegistrationReady = Boolean(
    selectedCourseId &&
      knowledgeResourceTitle.trim() &&
      knowledgeResourceUrl.trim() &&
      knowledgeResourceRightsBasis,
  );

  function runPrimaryAction() {
    if (actionPendingRef.current || isAuditPending) {
      return;
    }
    void persistTeachingOperationAction("primary");
  }

  function runSecondaryAction() {
    if (actionPendingRef.current || isAuditPending) {
      return;
    }
    if (safeOperationId === "knowledge-base" && !isKnowledgeResourceRegistrationReady) {
      return;
    }
    void persistTeachingOperationAction("secondary");
  }

  function resetTransientArtifactsForAction(actionSlot: "primary" | "secondary") {
    if (safeOperationId === "data-export" && actionSlot === "primary") {
      setManifestReady(false);
      setExportManifest(defaultExportManifest);
    }

    if (safeOperationId === "invite-code" && actionSlot === "primary") {
      setInviteCode(defaultInviteCode);
    }
  }

  async function persistTeachingOperationAction(actionSlot: "primary" | "secondary") {
    if (actionPendingRef.current || isAuditPending) {
      return;
    }

    actionPendingRef.current = true;
    setIsActionPending(true);
    setStatusMessage(localizedText(TEACHING_OPERATION_SAVE_PENDING_MESSAGE, locale));
    setAuditStatus(undefined);
    resetTransientArtifactsForAction(actionSlot);

    try {
      const sourceAction = action;
      const knowledgeResource =
        safeOperationId === "knowledge-base" &&
        actionSlot === "secondary" &&
        knowledgeResourceRightsBasis
          ? {
              title: knowledgeResourceTitle.trim(),
              sourceUrl: knowledgeResourceUrl.trim(),
              rightsBasis: knowledgeResourceRightsBasis,
              visibility: "course-only" as const,
            }
          : undefined;
      const targetClassId = resolveTeachingOperationTargetClassId({
        operationId: safeOperationId,
        selectedCourseId,
      });
      const response = await fetch("/api/teaching/operations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operationId: safeOperationId,
          actionSlot,
          courseId: selectedCourseId,
          ...(targetClassId ? { targetClassId } : {}),
          sourceAction,
          ...(knowledgeResource ? { knowledgeResource } : {}),
          idempotencyKey: createTeachingOperationIdempotencyKey({
            operationId: safeOperationId,
            actionSlot,
            courseId: selectedCourseId,
            sourceAction,
          }),
        }),
      });

      if (!response.ok) {
        const payload = await readJsonPayload<TeachingOperationBackendResponse>(response);
        setStatusMessage(
          localizedText(
            createTeachingOperationPartialFailureMessage(payload?.partialFailure) ??
              (payload?.access?.reasonCode === "course-id-required"
                ? TEACHING_OPERATION_COURSE_CONTEXT_MISSING_MESSAGE
                : TEACHING_OPERATION_SAVE_FAILED_MESSAGE),
            locale,
          ),
        );
        return;
      }

      const payload = (await response.json()) as TeachingOperationBackendResponse;
      const receipt = payload.receipt;
      if (!receipt) {
        setStatusMessage(localizedText(TEACHING_OPERATION_SAVE_FAILED_MESSAGE, locale));
        return;
      }
      if (
        isMismatchedTeachingOperationReceipt(receipt, {
          operationId: safeOperationId,
          actionSlot,
        })
      ) {
        setStatusMessage(localizedText(TEACHING_OPERATION_RECEIPT_MISMATCH_MESSAGE, locale));
        return;
      }
      const domainPersistenceFailureMessage = createTeachingOperationDomainPersistenceFailureMessage(
        payload.domainPersistenceSummary,
        receipt,
      );
      if (domainPersistenceFailureMessage) {
        setStatusMessage(localizedText(domainPersistenceFailureMessage, locale));
        return;
      }

      const verifiedStatusMessage = receipt.displayMessage
        ? localizedText(receipt.displayMessage, locale)
        : actionSlot === "primary"
          ? localizedText(config.primaryMessage, locale)
          : localizedText(config.secondaryMessage, locale);

      const exportArtifact = receipt.artifacts?.find(
        (artifact): artifact is Extract<TeachingOperationBackendArtifact, { kind: "export-file" }> =>
          artifact.kind === "export-file" &&
          typeof artifact.manifestId === "string" &&
          typeof artifact.downloadUrl === "string",
      );
      const inviteArtifact = receipt.artifacts?.find(
        (artifact): artifact is Extract<TeachingOperationBackendArtifact, { kind: "invite-code" }> =>
          artifact.kind === "invite-code" && typeof artifact.code === "string",
      );
      const verifiedArtifacts: VerifiedOperationArtifacts = {
        ...(exportArtifact ? { exportArtifact } : {}),
        ...(inviteArtifact ? { inviteArtifact } : {}),
      };

      if (payload.traceId) {
        if (!receipt.receiptId) {
          setStatusMessage(localizedText(TEACHING_OPERATION_AUDIT_FAILED_MESSAGE, locale));
          setAuditStatus({
            status: "failed",
            traceId: payload.traceId,
          });
          return;
        }
        setStatusMessage(localizedText(TEACHING_OPERATION_AUDIT_PENDING_MESSAGE, locale));
        await readOperationAuditEvidence({
          traceId: payload.traceId,
          recordId: receipt.receiptId,
          courseId: receipt.courseId ?? selectedCourseId,
          actionSlot,
          verifiedStatusMessage,
          artifacts: verifiedArtifacts,
          ...(knowledgeResource
            ? {
                knowledgeResource: {
                  title: knowledgeResource.title,
                  rightsBasis: knowledgeResource.rightsBasis,
                  visibility: knowledgeResource.visibility,
                },
              }
            : {}),
        });
      } else {
        applyTeachingOperationArtifacts(verifiedArtifacts);
        setStatusMessage(verifiedStatusMessage);
      }
    } catch {
      setStatusMessage(localizedText(TEACHING_OPERATION_SAVE_FAILED_MESSAGE, locale));
    } finally {
      actionPendingRef.current = false;
      setIsActionPending(false);
    }
  }

  async function readOperationAuditEvidence(input: {
    traceId: string;
    recordId: string;
    courseId?: string;
    actionSlot: "primary" | "secondary";
    verifiedStatusMessage?: string;
    artifacts?: VerifiedOperationArtifacts;
    knowledgeResource?: KnowledgeResourceAuditExpectation;
  }) {
    setAuditStatus({
      status: "pending",
      traceId: input.traceId,
    });

    try {
      const response = await fetch("/api/teaching/operations/audit", {
        method: "GET",
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error("Teaching operation audit readback failed.");
      }
      const audit = (await response.json()) as TeachingOperationAuditReadbackResponse;
      const matchingRecord = audit.records?.find((record) => {
        if (record.recordId !== input.recordId) {
          return false;
        }
        return input.courseId ? record.courseId === input.courseId : true;
      });
      const matchingAuditEvent = audit.auditEvents?.find((event) => {
        if (event.traceId !== input.traceId) {
          return false;
        }
        return input.courseId ? event.courseId === input.courseId : true;
      });
      const matchingDomainProjection = audit.domainProjections?.find((projection) => {
        if (projection.operationRecordId !== input.recordId) {
          return false;
        }
        return input.courseId ? projection.courseId === input.courseId : true;
      });
      if (
        !matchingRecord ||
        !matchingAuditEvent ||
        !matchingDomainProjection?.objectId ||
        !matchingDomainProjection.objectType ||
        !isVerifiedOperationAuditAuthSession(matchingAuditEvent.authSession) ||
        !doesOperationPageDomainProjectionMatchBusinessSemantics(matchingDomainProjection, {
          operationId: safeOperationId,
          actionSlot: input.actionSlot,
          knowledgeResource: input.knowledgeResource,
        })
      ) {
        throw new Error("Teaching operation audit readback did not include the saved operation.");
      }

      setAuditStatus({
        status: "verified",
        traceId: input.traceId,
        actorId: matchingAuditEvent.actorId ?? audit.actorId,
        auditEventCount: audit.auditEventCount,
        authSession: {
          sessionId: matchingAuditEvent.authSession.sessionId,
          authenticatedAt: matchingAuditEvent.authSession.authenticatedAt,
          expiresAt: matchingAuditEvent.authSession.expiresAt,
        },
        domainProjection: {
          objectId: matchingDomainProjection.objectId,
          objectType: matchingDomainProjection.objectType,
        },
      });
      if (input.knowledgeResource) {
        setKnowledgeResourceTitle("");
        setKnowledgeResourceUrl("");
        setKnowledgeResourceRightsBasis("");
      }
      applyTeachingOperationArtifacts(input.artifacts);
      if (input.verifiedStatusMessage) {
        setStatusMessage(input.verifiedStatusMessage);
      }
    } catch {
      setStatusMessage(localizedText(TEACHING_OPERATION_AUDIT_FAILED_MESSAGE, locale));
      setAuditStatus({
        status: "failed",
        traceId: input.traceId,
      });
    }
  }

  function isVerifiedOperationAuditAuthSession(
    authSession: NonNullable<
      TeachingOperationAuditReadbackResponse["auditEvents"]
    >[number]["authSession"],
  ): authSession is {
    sessionId: string;
    authenticatedAt: string;
    expiresAt: string;
  } {
    return (
      typeof authSession?.sessionId === "string" &&
      authSession.sessionId.trim().length > 0 &&
      typeof authSession.authenticatedAt === "string" &&
      authSession.authenticatedAt.trim().length > 0 &&
      typeof authSession.expiresAt === "string" &&
      authSession.expiresAt.trim().length > 0
    );
  }

  function doesOperationPageDomainProjectionMatchBusinessSemantics(
    projection: NonNullable<TeachingOperationAuditReadbackResponse["domainProjections"]>[number],
    input: {
      operationId: TeachingOperationId;
      actionSlot: "primary" | "secondary";
      knowledgeResource?: KnowledgeResourceAuditExpectation;
    },
  ) {
    if (input.operationId === "course-settings" && input.actionSlot === "primary") {
      return (
        projection.objectType === "course-settings" &&
        projection.status === "saved" &&
        typeof projection.updatedBy === "string" &&
        projection.updatedBy.trim().length > 0 &&
        typeof projection.updatedAt === "string" &&
        projection.updatedAt.trim().length > 0
      );
    }
    if (input.operationId === "course-settings" && input.actionSlot === "secondary") {
      return (
        projection.objectType === "student-preview-session" &&
        projection.previewStatus === "generated" &&
        projection.previewScope === "teacher-course-preview" &&
        projection.previewPolicy === "teacher-visible-preview-only" &&
        typeof projection.previewedBy === "string" &&
        projection.previewedBy.trim().length > 0 &&
        typeof projection.previewId === "string" &&
        projection.previewId.trim().length > 0 &&
        typeof projection.previewUrl === "string" &&
        projection.previewUrl.trim().length > 0 &&
        typeof projection.generatedAt === "string" &&
        projection.generatedAt.trim().length > 0
      );
    }
    if (input.operationId === "agents" && input.actionSlot === "primary") {
      const expectedEnabledAgents = [
        "research-assistant",
        "math-coach",
        "writing-mentor",
      ];
      return (
        projection.objectType === "agent-plan" &&
        projection.planStatus === "saved" &&
        projection.governancePolicy === "teacher-reviewed-agent-plan" &&
        typeof projection.savedBy === "string" &&
        projection.savedBy.trim().length > 0 &&
        typeof projection.savedAt === "string" &&
        projection.savedAt.trim().length > 0 &&
        Array.isArray(projection.enabledAgents) &&
        expectedEnabledAgents.every((agent) => projection.enabledAgents?.includes(agent))
      );
    }
    if (input.operationId === "agents" && input.actionSlot === "secondary") {
      const expectedCheckedPermissions = [
        "course-bindings",
        "agent-roles",
        "student-access",
      ];
      return (
        projection.objectType === "permission-preflight" &&
        projection.preflightStatus === "passed" &&
        projection.preflightPolicy === "teacher-agent-permission-gate" &&
        typeof projection.checkedBy === "string" &&
        projection.checkedBy.trim().length > 0 &&
        typeof projection.checkedAt === "string" &&
        projection.checkedAt.trim().length > 0 &&
        Array.isArray(projection.checkedPermissions) &&
        expectedCheckedPermissions.every((permission) =>
          projection.checkedPermissions?.includes(permission),
        )
      );
    }
    if (input.operationId === "knowledge-base" && input.actionSlot === "primary") {
      const expectedSourceSystems = [
        "course-files",
        "teacher-resources",
        "agent-grounding-index",
      ];
      return (
        projection.objectType === "knowledge-index" &&
        projection.syncStatus === "synced" &&
        typeof projection.syncedBy === "string" &&
        projection.syncedBy.trim().length > 0 &&
        typeof projection.syncedAt === "string" &&
        projection.syncedAt.trim().length > 0 &&
        Array.isArray(projection.sourceSystems) &&
        expectedSourceSystems.every((sourceSystem) =>
          projection.sourceSystems?.includes(sourceSystem),
        )
      );
    }
    if (input.operationId === "knowledge-base" && input.actionSlot === "secondary") {
      return (
        projection.objectType === "resource-review-item" &&
        projection.reviewStatus === "pending-teacher-review" &&
        projection.resourceSource === "teacher-submitted-url" &&
        typeof projection.title === "string" &&
        projection.title === input.knowledgeResource?.title &&
        typeof projection.sourceFingerprint === "string" &&
        /^sha256:[a-f0-9]{64}$/.test(projection.sourceFingerprint) &&
        projection.rightsBasis === input.knowledgeResource?.rightsBasis &&
        projection.visibility === "course-only" &&
        projection.reviewPolicy === "teacher-review-before-knowledge-index" &&
        typeof projection.queuedBy === "string" &&
        projection.queuedBy.trim().length > 0 &&
        typeof projection.queuedAt === "string" &&
        projection.queuedAt.trim().length > 0
      );
    }
    if (input.operationId === "content" && input.actionSlot === "primary") {
      return (
        projection.objectType === "course-content" &&
        projection.publicationStatus === "published" &&
        projection.releaseScope === "course-visible-content" &&
        typeof projection.publishedBy === "string" &&
        projection.publishedBy.trim().length > 0 &&
        typeof projection.publishedAt === "string" &&
        projection.publishedAt.trim().length > 0
      );
    }
    if (input.operationId === "content" && input.actionSlot === "secondary") {
      return (
        projection.objectType === "unit-draft" &&
        projection.draftStatus === "ready-for-teacher-review" &&
        projection.reviewPolicy === "teacher-review-before-course-publish" &&
        typeof projection.generatedBy === "string" &&
        projection.generatedBy.trim().length > 0 &&
        typeof projection.artifactId === "string" &&
        projection.artifactId.trim().length > 0 &&
        typeof projection.generatedAt === "string" &&
        projection.generatedAt.trim().length > 0
      );
    }
    if (input.operationId === "admins" && input.actionSlot === "primary") {
      const expectedAdminScopes = [
        "course-collaborators",
        "permission-boundary",
        "audit-routing",
      ];
      return (
        projection.objectType === "admin-settings" &&
        projection.settingsStatus === "saved" &&
        projection.governancePolicy === "teacher-controlled-admin-settings" &&
        typeof projection.savedBy === "string" &&
        projection.savedBy.trim().length > 0 &&
        typeof projection.savedAt === "string" &&
        projection.savedAt.trim().length > 0 &&
        Array.isArray(projection.adminScopes) &&
        expectedAdminScopes.every((scope) => projection.adminScopes?.includes(scope))
      );
    }
    if (input.operationId === "admins" && input.actionSlot === "secondary") {
      return (
        projection.objectType === "email-notification" &&
        projection.notificationStatus === "queued" &&
        projection.deliveryChannel === "collaboration-invite-email" &&
        projection.deliveryPolicy === "server-outbox-before-smtp-provider" &&
        typeof projection.queuedBy === "string" &&
        projection.queuedBy.trim().length > 0 &&
        typeof projection.outboxId === "string" &&
        projection.outboxId.trim().length > 0 &&
        typeof projection.queuedAt === "string" &&
        projection.queuedAt.trim().length > 0
      );
    }
    if (input.operationId === "students" && input.actionSlot === "primary") {
      // Mirrors `isVerifiedStudentRosterProjection`: the action recounts local
      // membership rows, so the projection it verifies must say `local-recount`
      // over local sources. The `pendingTeacherReviewCount === 3` check that
      // used to sit here was verifying a hardcoded literal - it passed for every
      // course in every deployment and told a teacher nothing.
      const expectedSourceSystems = [
        "local-class-memberships",
        "local-class-records",
      ];
      return (
        projection.objectType === "student-roster" &&
        projection.syncStatus === "local-recount" &&
        typeof projection.syncedBy === "string" &&
        projection.syncedBy.trim().length > 0 &&
        typeof projection.syncedAt === "string" &&
        projection.syncedAt.trim().length > 0 &&
        Array.isArray(projection.sourceSystems) &&
        expectedSourceSystems.every((sourceSystem) =>
          projection.sourceSystems?.includes(sourceSystem),
        )
      );
    }
    if (input.operationId === "students" && input.actionSlot === "secondary") {
      const expectedGroupingBasis = [
        "participation",
        "progress",
        "collaboration-balance",
      ];
      return (
        projection.objectType === "group-suggestions" &&
        projection.suggestionStatus === "ready-for-teacher-review" &&
        projection.reviewPolicy === "teacher-review-before-group-assignment" &&
        typeof projection.generatedBy === "string" &&
        projection.generatedBy.trim().length > 0 &&
        typeof projection.artifactId === "string" &&
        projection.artifactId.trim().length > 0 &&
        typeof projection.generatedAt === "string" &&
        projection.generatedAt.trim().length > 0 &&
        Array.isArray(projection.groupingBasis) &&
        expectedGroupingBasis.every((basis) => projection.groupingBasis?.includes(basis))
      );
    }
    if (input.operationId === "data-export" && input.actionSlot === "primary") {
      const expectedDatasetScopes = [
        "learning-records",
        "chat-threads",
        "grades",
        "activities",
      ];
      return (
        projection.objectType === "export-manifest" &&
        projection.exportStatus === "generated" &&
        projection.exportPolicy === "redacted-teacher-export-manifest" &&
        typeof projection.createdBy === "string" &&
        projection.createdBy.trim().length > 0 &&
        typeof projection.manifestId === "string" &&
        projection.manifestId.trim().length > 0 &&
        typeof projection.createdAt === "string" &&
        projection.createdAt.trim().length > 0 &&
        Array.isArray(projection.datasetScopes) &&
        expectedDatasetScopes.every((scope) => projection.datasetScopes?.includes(scope))
      );
    }
    if (input.operationId === "data-export" && input.actionSlot === "secondary") {
      const expectedCheckedScopes = [
        "student-private-notes",
        "credentials",
        "local-paths",
      ];
      return (
        projection.objectType === "redaction-validation" &&
        projection.validationStatus === "passed" &&
        projection.validationPolicy === "exclude-private-and-secret-fields" &&
        typeof projection.validatedBy === "string" &&
        projection.validatedBy.trim().length > 0 &&
        typeof projection.validatedAt === "string" &&
        projection.validatedAt.trim().length > 0 &&
        Array.isArray(projection.checkedScopes) &&
        expectedCheckedScopes.every((scope) => projection.checkedScopes?.includes(scope))
      );
    }
    if (input.operationId === "dashboard" && input.actionSlot === "primary") {
      const expectedVisibleMetrics = [
        "engagement",
        "progress",
        "assessment-quality",
      ];
      return (
        projection.objectType === "dashboard-state" &&
        projection.refreshStatus === "refreshed" &&
        projection.refreshPolicy === "teacher-visible-course-dashboard" &&
        typeof projection.refreshedBy === "string" &&
        projection.refreshedBy.trim().length > 0 &&
        typeof projection.refreshedAt === "string" &&
        projection.refreshedAt.trim().length > 0 &&
        Array.isArray(projection.visibleMetrics) &&
        expectedVisibleMetrics.every((metricName) =>
          projection.visibleMetrics?.includes(metricName),
        )
      );
    }
    if (input.operationId === "dashboard" && input.actionSlot === "secondary") {
      return (
        projection.objectType === "dashboard-snapshot" &&
        projection.snapshotStatus === "locked" &&
        projection.snapshotScope === "daily-course-dashboard" &&
        projection.retentionPolicy === "teacher-locked-dashboard-snapshot" &&
        typeof projection.lockedBy === "string" &&
        projection.lockedBy.trim().length > 0 &&
        typeof projection.snapshotId === "string" &&
        projection.snapshotId.trim().length > 0 &&
        typeof projection.lockedAt === "string" &&
        projection.lockedAt.trim().length > 0
      );
    }
    if (input.operationId === "quiz-board" && input.actionSlot === "primary") {
      const expectedVisibleMetrics = [
        "completion-rate",
        "item-quality",
        "misconception-clusters",
      ];
      return (
        projection.objectType === "quiz-board-state" &&
        projection.refreshStatus === "refreshed" &&
        projection.reviewPolicy === "teacher-visible-quiz-quality-board" &&
        typeof projection.refreshedBy === "string" &&
        projection.refreshedBy.trim().length > 0 &&
        typeof projection.refreshedAt === "string" &&
        projection.refreshedAt.trim().length > 0 &&
        Array.isArray(projection.visibleMetrics) &&
        expectedVisibleMetrics.every((metricName) =>
          projection.visibleMetrics?.includes(metricName),
        )
      );
    }
    if (input.operationId === "quiz-board" && input.actionSlot === "secondary") {
      const expectedFlaggedSignals = [
        "low-discrimination",
        "high-error-rate",
        "teacher-review-needed",
      ];
      return (
        projection.objectType === "quiz-item-review" &&
        projection.reviewStatus === "flagged-for-review" &&
        projection.reviewPolicy === "teacher-review-before-quiz-reuse" &&
        typeof projection.flaggedBy === "string" &&
        projection.flaggedBy.trim().length > 0 &&
        typeof projection.flaggedAt === "string" &&
        projection.flaggedAt.trim().length > 0 &&
        Array.isArray(projection.flaggedSignals) &&
        expectedFlaggedSignals.every((signal) => projection.flaggedSignals?.includes(signal))
      );
    }
    if (input.operationId === "grading" && input.actionSlot === "primary") {
      return (
        projection.objectType === "grading-queue" &&
        projection.queueStatus === "saved" &&
        projection.reviewPolicy === "teacher-review-before-release" &&
        typeof projection.savedBy === "string" &&
        projection.savedBy.trim().length > 0 &&
        typeof projection.savedAt === "string" &&
        projection.savedAt.trim().length > 0
      );
    }
    if (input.operationId === "grading" && input.actionSlot === "secondary") {
      return (
        projection.objectType === "ai-feedback-draft" &&
        projection.feedbackStatus === "ready-for-teacher-review" &&
        projection.feedbackScope === "grading-review-queue" &&
        projection.reviewPolicy === "teacher-review-before-student-release" &&
        typeof projection.generatedBy === "string" &&
        projection.generatedBy.trim().length > 0 &&
        typeof projection.artifactId === "string" &&
        projection.artifactId.trim().length > 0 &&
        typeof projection.generatedAt === "string" &&
        projection.generatedAt.trim().length > 0
      );
    }
    if (input.operationId === "invite-code" && input.actionSlot === "primary") {
      return (
        projection.objectType === "invite-code-draft" &&
        projection.draftStatus === "generated" &&
        projection.invitePolicy === "teacher-review-before-publication" &&
        typeof projection.inviteCode === "string" &&
        /^\d{8}$/.test(projection.inviteCode) &&
        typeof projection.joinUrl === "string" &&
        projection.joinUrl.trim().length > 0 &&
        projection.joinUrl.includes(projection.inviteCode) &&
        typeof projection.generatedBy === "string" &&
        projection.generatedBy.trim().length > 0 &&
        typeof projection.generatedAt === "string" &&
        projection.generatedAt.trim().length > 0
      );
    }
    if (input.operationId === "invite-code" && input.actionSlot === "secondary") {
      return (
        projection.objectType === "enrollment-access" &&
        projection.publicationStatus === "published" &&
        projection.enrollmentPolicy === "teacher-confirmed-course-scope" &&
        typeof projection.inviteCode === "string" &&
        /^\d{8}$/.test(projection.inviteCode) &&
        typeof projection.joinUrl === "string" &&
        projection.joinUrl.trim().length > 0 &&
        projection.joinUrl.includes(projection.inviteCode) &&
        typeof projection.publishedBy === "string" &&
        projection.publishedBy.trim().length > 0 &&
        typeof projection.publishedAt === "string" &&
        projection.publishedAt.trim().length > 0
      );
    }

    return true;
  }

  function applyTeachingOperationArtifacts(artifacts: VerifiedOperationArtifacts | undefined) {
    if (artifacts?.exportArtifact) {
      setManifestReady(true);
      setExportManifest({
        manifestId: artifacts.exportArtifact.manifestId,
        downloadUrl: artifacts.exportArtifact.downloadUrl,
      });
    }

    if (artifacts?.inviteArtifact) {
      setInviteCode(artifacts.inviteArtifact.code);
    }
  }

  return (
    <div className="space-y-5" data-uais-teaching-operation={safeOperationId}>
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_18px_48px_var(--shadow)] md:p-7">
        <Link
          href="/teaching"
          className="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--foreground)] outline-none transition hover:bg-[var(--surface-soft)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <ArrowLeft size={17} weight="bold" />
          {locale === "zh-CN" ? "返回我的教学" : "Back to My Teaching"}
        </Link>

        <div className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-[var(--accent)]">
              {localizedText(config.pillar, locale)}
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--foreground)] sm:text-4xl">
              {title}
            </h1>
            <p className="mt-3 max-w-3xl text-base leading-7 text-[var(--muted)]">
              {description || localizedText(config.summary, locale)}
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--accent-border)] bg-[var(--accent-soft)] px-4 py-3 text-sm text-[var(--foreground)]">
            <p className="font-semibold">{locale === "zh-CN" ? "页面已接通" : "Route connected"}</p>
            <p className="mt-1 text-[var(--muted)]">
              {locale === "zh-CN" ? "当前教学操作" : `/teaching/${safeOperationId}`}
            </p>
          </div>
        </div>
      </section>

      <section
        className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]"
        data-uais-operation-layout="vertical-menu"
      >
        <aside className="xl:sticky xl:top-24 xl:self-start">
          <nav
            aria-label={locale === "zh-CN" ? "教学操作页面" : "Teaching operation pages"}
            className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[0_18px_42px_var(--shadow)]"
            data-uais-operation-menu-orientation="vertical"
          >
            <h2 className="px-2 text-base font-semibold text-[var(--muted)]">
              {locale === "zh-CN" ? "轻量教学操作" : "Lightweight Teaching Operations"}
            </h2>
            <div className="mt-4 space-y-2">
              {teacherSidebarItems.map((item) => {
                const active = item.id === safeOperationId;
                const Icon =
                  operationMenuIcons[item.id as keyof typeof operationMenuIcons] ?? SquaresFour;

                return (
                  <Link
                    key={item.id}
                    href={getTeachingOperationHrefWithCourse(item.id, selectedCourseId)}
                    aria-current={active ? "page" : undefined}
                    className={[
                      "flex min-h-14 w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left outline-none transition active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                      active
                        ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)]"
                        : "border-transparent text-[var(--foreground)] hover:border-[var(--border)] hover:bg-[var(--surface-soft)]",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "flex size-10 shrink-0 items-center justify-center rounded-2xl",
                        active
                          ? "bg-[var(--surface)] text-[var(--accent)]"
                          : "bg-[var(--accent-soft)] text-[var(--foreground)]",
                      ].join(" ")}
                    >
                      <Icon size={20} weight="duotone" />
                    </span>
                    <span className="min-w-0 text-base font-semibold">
                      {localizedText(item.title, locale)}
                    </span>
                  </Link>
                );
              })}
            </div>
          </nav>
        </aside>

        <div className="space-y-5">
          <section className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_360px]">
            <div className="space-y-5">
              <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_18px_42px_var(--shadow)]">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-sm font-semibold text-[var(--accent)]">
                  {locale === "zh-CN" ? `企业级流程：${title}` : `Enterprise workflow: ${title}`}
                </p>
                <h2 className="mt-2 text-xl font-semibold text-[var(--foreground)]">
                  {localizedText(config.summary, locale)}
                </h2>
              </div>
              <span className="inline-flex h-9 items-center gap-2 self-start rounded-full border border-[var(--border)] bg-[var(--surface-soft)] px-3 text-sm font-semibold text-[var(--foreground)]">
                <ShieldCheck size={17} weight="duotone" />
                {locale === "zh-CN" ? "无真实密钥暴露" : "No real secrets exposed"}
              </span>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {config.metrics.map((item) => (
                <article
                  key={`${safeOperationId}-${localizedText(item.label, locale)}`}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4"
                >
                  <p className="text-xs font-semibold uppercase text-[var(--muted)]">
                    {localizedText(item.label, locale)}
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
                    {typeof item.value === "string"
                      ? item.value
                      : localizedText(item.value, locale)}
                  </p>
                </article>
              ))}
            </div>

            <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
              {/* Every operation on this page posts a courseId, so "all courses"
                  was never a real scope: without course context the actions can
                  only fail. A persisted course that is not in the static catalog
                  still shows its id rather than claiming no course, so a teacher
                  can see that navigation carried the context. */}
              <p className="text-sm font-semibold text-[var(--foreground)]">
                {selectedCourseId
                  ? `${locale === "zh-CN" ? "已选择课程" : "Selected course"}：${
                      selectedCourse
                        ? localizedText(selectedCourse.title, locale)
                        : selectedCourseId
                    }`
                  : locale === "zh-CN"
                    ? "未选择课程：教学操作需要课程上下文。"
                    : "No course selected: teaching operations need course context."}
              </p>
              {/* Shown for the same reason the course id is: the class arrives in
                  the url and a teacher should be able to see that the click they
                  made carried it. Rendered as the id because the static catalog
                  has no class titles to resolve against. */}
              {selectedClassId ? (
                <p
                  data-uais-operation-selected-class={selectedClassId}
                  className="mt-2 text-sm font-medium text-[var(--foreground)]"
                >
                  {`${locale === "zh-CN" ? "已选择班级" : "Selected class"}：${selectedClassId}`}
                </p>
              ) : undefined}
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                {action
                  ? `${locale === "zh-CN" ? "来源动作" : "Source action"}：${formatCourseAction(
                      action,
                      locale,
                    )}`
                  : locale === "zh-CN"
                    ? "可从课程卡片进入并自动携带课程上下文。"
                    : "Course-card entry can carry course context automatically."}
              </p>
            </div>

            {safeOperationId === "knowledge-base" ? (
              <fieldset className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
                <legend className="px-1 text-sm font-semibold text-[var(--foreground)]">
                  {locale === "zh-CN" ? "登记公开知识来源" : "Register a public knowledge source"}
                </legend>
                <div className="mt-2 grid gap-4 lg:grid-cols-2">
                  <label className="grid gap-2 text-sm font-semibold text-[var(--foreground)]">
                    {locale === "zh-CN" ? "资料标题" : "Resource title"}
                    <input
                      type="text"
                      value={knowledgeResourceTitle}
                      maxLength={160}
                      onChange={(event) => setKnowledgeResourceTitle(event.target.value)}
                      className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-normal text-[var(--foreground)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    />
                  </label>
                  <label className="grid gap-2 text-sm font-semibold text-[var(--foreground)]">
                    {locale === "zh-CN" ? "公开 HTTPS 来源" : "Public HTTPS source"}
                    <input
                      type="url"
                      inputMode="url"
                      autoComplete="off"
                      value={knowledgeResourceUrl}
                      maxLength={2048}
                      aria-describedby="knowledge-resource-url-help"
                      onChange={(event) => setKnowledgeResourceUrl(event.target.value)}
                      className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-normal text-[var(--foreground)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    />
                  </label>
                  <label className="grid gap-2 text-sm font-semibold text-[var(--foreground)]">
                    {locale === "zh-CN" ? "权利依据" : "Rights basis"}
                    <select
                      value={knowledgeResourceRightsBasis}
                      onChange={(event) =>
                        setKnowledgeResourceRightsBasis(
                          event.target.value as KnowledgeResourceRightsBasis,
                        )
                      }
                      className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-normal text-[var(--foreground)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    >
                      <option value="">{locale === "zh-CN" ? "请选择" : "Select one"}</option>
                      <option value="owner-created">{locale === "zh-CN" ? "教师原创" : "Owner-created"}</option>
                      <option value="licensed">{locale === "zh-CN" ? "已获许可" : "Licensed"}</option>
                      <option value="open-access">{locale === "zh-CN" ? "开放获取" : "Open access"}</option>
                      <option value="permission-granted">{locale === "zh-CN" ? "已获授权" : "Permission granted"}</option>
                    </select>
                  </label>
                  <div className="rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-3 text-sm text-[var(--foreground)]">
                    <p className="font-semibold">
                      {locale === "zh-CN" ? "可见范围：仅当前课程" : "Visibility: current course only"}
                    </p>
                    <p id="knowledge-resource-url-help" className="mt-1 leading-6 text-[var(--muted)]">
                      {locale === "zh-CN"
                        ? "本步骤只登记来源并排队审核，不会立即抓取内容或同步索引。"
                        : "This step only registers the source for review; it does not fetch content or sync the index."}
                    </p>
                  </div>
                </div>
              </fieldset>
            ) : undefined}

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                className="inline-flex h-11 items-center gap-2 rounded-full bg-[var(--accent)] px-5 text-sm font-semibold text-white outline-none transition hover:bg-[var(--accent-strong)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-[var(--accent)] disabled:active:translate-y-0"
                disabled={areActionButtonsDisabled}
                onClick={runPrimaryAction}
              >
                <Lightning size={18} weight="bold" />
                {localizedText(config.primaryAction, locale)}
              </button>
              <button
                type="button"
                className="inline-flex h-11 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-5 text-sm font-semibold text-[var(--foreground)] outline-none transition hover:bg-[var(--surface-soft)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-[var(--surface)] disabled:active:translate-y-0"
                disabled={
                  areActionButtonsDisabled ||
                  (safeOperationId === "knowledge-base" &&
                    !isKnowledgeResourceRegistrationReady)
                }
                onClick={runSecondaryAction}
              >
                <CheckCircle size={18} weight="duotone" />
                {localizedText(config.secondaryAction, locale)}
              </button>
            </div>

            <p
              aria-live={isStatusFailure ? "assertive" : "polite"}
              role={isStatusFailure ? "alert" : "status"}
              className={[
                "mt-4 rounded-xl border px-4 py-3 text-sm font-semibold",
                isStatusFailure
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)]",
              ].join(" ")}
            >
              {statusMessage}
            </p>
            {auditStatus ? (
              <div
                aria-live="polite"
                data-uais-operation-audit-status={safeOperationId}
                className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-3 text-sm text-[var(--muted)]"
              >
                {auditStatus.status === "verified" ? (
                  <>
                    <p className="font-semibold text-[var(--foreground)]">
                      {locale === "zh-CN" ? "审计读回已验证" : "Audit readback verified"}：
                      {auditStatus.traceId}
                    </p>
                    <p className="mt-1">
                      {locale === "zh-CN" ? "操作者" : "Actor"}：
                      {auditStatus.actorId ?? "unknown"} ·{" "}
                      {locale === "zh-CN" ? "审计事件" : "Audit events"}：
                      {auditStatus.auditEventCount ?? 0}
                    </p>
                    {auditStatus.authSession?.sessionId ? (
                      <p className="mt-1">
                        {locale === "zh-CN"
                          ? "签名会话已验证"
                          : "Signed session verified"}
                        ：{auditStatus.authSession.sessionId}
                      </p>
                    ) : null}
                    {auditStatus.domainProjection ? (
                      <p className="mt-1">
                        {locale === "zh-CN"
                          ? "领域对象已验证"
                          : "Domain object verified"}
                        ：{auditStatus.domainProjection.objectType} /{" "}
                        {auditStatus.domainProjection.objectId}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="font-semibold text-[var(--foreground)]">
                    {auditStatus.status === "pending"
                      ? localizedText(TEACHING_OPERATION_AUDIT_PENDING_MESSAGE, locale)
                      : localizedText(TEACHING_OPERATION_AUDIT_FAILED_MESSAGE, locale)}
                  </p>
                )}
              </div>
            ) : null}

            <OperationSpecificPreview
              config={config}
              exportManifest={exportManifest}
              inviteCode={inviteCode}
              locale={locale}
              manifestReady={manifestReady}
            />
              </section>
            </div>

            <aside className="space-y-5">
              <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_18px_42px_var(--shadow)]">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
                    <SquaresFour size={21} weight="duotone" />
                  </span>
                  <h2 className="text-lg font-semibold text-[var(--foreground)]">
                    {locale === "zh-CN" ? "流程状态" : "Workflow Status"}
                  </h2>
                </div>
                <div className="mt-4 space-y-3">
                  {config.workflow.map((step, index) => (
                    <div
                      key={`${safeOperationId}-step-${localizedText(step, locale)}`}
                      className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-3 text-sm"
                    >
                      <span className="flex size-7 items-center justify-center rounded-full bg-[var(--accent-soft)] text-xs font-semibold text-[var(--accent)]">
                        {index + 1}
                      </span>
                      <span className="font-medium text-[var(--foreground)]">
                        {localizedText(step, locale)}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_18px_42px_var(--shadow)]">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-2xl bg-[var(--surface-soft)] text-[var(--foreground)]">
                    <ClipboardText size={21} weight="duotone" />
                  </span>
                  <h2 className="text-lg font-semibold text-[var(--foreground)]">
                    {locale === "zh-CN" ? "操作记录" : "Operation Log"}
                  </h2>
                </div>
                <div className="mt-4 space-y-3">
                  {config.records.map((record) => (
                    <p
                      key={`${safeOperationId}-${localizedText(record, locale)}`}
                      className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-3 text-sm leading-6 text-[var(--muted)]"
                    >
                      {localizedText(record, locale)}
                    </p>
                  ))}
                </div>
              </section>
            </aside>
          </section>
        </div>
      </section>
    </div>
  );
}


async function readJsonPayload<T>(response: Response): Promise<T | undefined> {
  try {
    return (await response.json()) as T;
  } catch {
    return undefined;
  }
}

function createTeachingOperationPartialFailureMessage(
  partialFailure: TeachingOperationPartialFailure | undefined,
): LocalizedText | undefined {
  if (!partialFailure) {
    return undefined;
  }

  const targetRecordId =
    partialFailure.compensation?.receipt?.targetRecordId ?? partialFailure.operationReceiptId;
  if (partialFailure.compensation?.status === "rolled-back" && targetRecordId) {
    return {
      "zh-CN": `发布未完成，已自动撤回：${targetRecordId}。`,
      "en-US": `Publish did not complete; the operation was automatically rolled back: ${targetRecordId}.`,
    };
  }

  if (partialFailure.rollbackRoute) {
    return {
      "zh-CN": "发布未完成，已保留撤回入口，请在审计记录中复核。",
      "en-US": "Publish did not complete; a rollback route is available for audit review.",
    };
  }

  return undefined;
}

function createTeachingOperationDomainPersistenceFailureMessage(
  summary: TeachingOperationDomainPersistenceSummary | undefined,
  receipt: TeachingOperationBackendReceipt | undefined,
): LocalizedText | undefined {
  if (!summary && receipt?.operationId && receipt.actionSlot) {
    return TEACHING_OPERATION_DOMAIN_EVIDENCE_MISSING_MESSAGE;
  }

  if (!summary || summary.required === false || summary.status === "not-required") {
    return undefined;
  }

  const missingObjectTypes = filterNonEmptyStrings(summary.missingObjectTypes);
  const expectedObjectTypes = filterNonEmptyStrings(summary.expectedObjectTypes);
  const persistedObjectTypes = new Set(filterNonEmptyStrings(summary.persistedObjectTypes));
  const unpersistedExpectedObjectTypes = expectedObjectTypes.filter(
    (objectType) => !persistedObjectTypes.has(objectType),
  );
  const receiptMismatch =
    Boolean(summary.operationReceiptId) &&
    Boolean(receipt?.receiptId) &&
    summary.operationReceiptId !== receipt?.receiptId;

  if (
    summary.status === "persisted" &&
    missingObjectTypes.length === 0 &&
    unpersistedExpectedObjectTypes.length === 0 &&
    !receiptMismatch
  ) {
    return undefined;
  }

  const objectTypes =
    missingObjectTypes.length > 0
      ? missingObjectTypes
      : unpersistedExpectedObjectTypes.length > 0
        ? unpersistedExpectedObjectTypes
        : expectedObjectTypes;
  const detail = objectTypes.length > 0 ? objectTypes.join(", ") : (summary.status ?? "unknown");

  return {
    "zh-CN": `领域对象未保存到服务器：${detail}。请稍后重试。`,
    "en-US": `Domain objects were not saved to the server: ${detail}. Please retry later.`,
  };
}

function isMismatchedTeachingOperationReceipt(
  receipt: TeachingOperationBackendReceipt,
  expected: {
    operationId: TeachingOperationId;
    actionSlot: "primary" | "secondary";
  },
) {
  if (receipt.operationId && receipt.operationId !== expected.operationId) {
    return true;
  }
  if (receipt.actionSlot && receipt.actionSlot !== expected.actionSlot) {
    return true;
  }
  return false;
}

function isTeachingOperationFailureStatus(statusMessage: string, locale: Locale) {
  return (
    statusMessage === localizedText(TEACHING_OPERATION_SAVE_FAILED_MESSAGE, locale) ||
    statusMessage === localizedText(TEACHING_OPERATION_RECEIPT_MISMATCH_MESSAGE, locale) ||
    statusMessage ===
      localizedText(TEACHING_OPERATION_DOMAIN_EVIDENCE_MISSING_MESSAGE, locale) ||
    statusMessage.startsWith(locale === "zh-CN" ? "领域对象未保存到服务器：" : "Domain objects were not saved")
  );
}

function filterNonEmptyStrings(values: string[] | undefined) {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

function resolveTeachingOperationTargetClassId(input: {
  operationId: TeachingOperationId;
  selectedCourseId?: string;
}) {
  const courseId = input.selectedCourseId?.trim();
  if (input.operationId !== "invite-code" || !courseId) {
    return undefined;
  }

  return `${courseId}-class-1`;
}
