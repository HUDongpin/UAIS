import type { TeachingOperationId } from "@/components/teaching/teaching-operation-data";
import { createRedaction } from "./teaching-operations-guards";
import { normalizeCourseSettingsPatchProjectionSnapshot } from "./teaching-operations-input-normalizers";
import {
  createTeachingResourceReviewItemId,
  type TeachingKnowledgeResourceRegistration,
} from "./teaching-knowledge-resource";
import type {
  TeachingOperationActionId,
  TeachingOperationActionSlot,
  TeachingOperationArtifact,
  TeachingOperationDomainProjection,
} from "./teaching-operations-store";

// Domain-projection builder for the teaching-operations store (Phase 3
// decomposition): constructs the per-operation domain projections from a validated
// action input. Runtime deps are createRedaction (guards) and the course-settings
// input normalizer; store types are a type-only import (no runtime cycle). Behavior
// is identical to the previous inline definition.

export function createDomainProjections(input: {
  operationId: TeachingOperationId;
  actionSlot: TeachingOperationActionSlot;
  actionId: TeachingOperationActionId;
  actorId: string;
  courseId?: string;
  sourceAction?: string;
  courseSettingsPatch?: unknown;
  knowledgeResource?: TeachingKnowledgeResourceRegistration;
  recordId: string;
  createdAt: string;
  artifacts: TeachingOperationArtifact[];
}): TeachingOperationDomainProjection[] {
  if (
    input.operationId === "course-settings" &&
    input.actionSlot === "primary" &&
    input.actionId === "save-course-settings" &&
    input.courseId
  ) {
    const courseSettingsSnapshot = normalizeCourseSettingsPatchProjectionSnapshot(
      input.courseSettingsPatch,
    );
    return [
      {
        objectId: `course-settings-${input.courseId}`,
        objectType: "course-settings",
        courseId: input.courseId,
        updatedBy: input.actorId,
        status: "saved",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        ...courseSettingsSnapshot,
        updatedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-course-settings",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "course-settings" &&
    input.actionSlot === "secondary" &&
    input.actionId === "preview-student-view" &&
    input.courseId
  ) {
    const previewArtifact = input.artifacts.find(
      (
        artifact,
      ): artifact is {
        kind: "student-preview";
        previewId: string;
        previewUrl: string;
      } => artifact.kind === "student-preview" && "previewId" in artifact,
    );
    if (!previewArtifact) {
      return [];
    }

    return [
      {
        objectId: `student-preview-session-${input.courseId}`,
        objectType: "student-preview-session",
        courseId: input.courseId,
        previewedBy: input.actorId,
        previewStatus: "generated",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        previewId: previewArtifact.previewId,
        previewUrl: previewArtifact.previewUrl,
        previewScope: "teacher-course-preview",
        previewPolicy: "teacher-visible-preview-only",
        generatedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-student-preview-session",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "students" &&
    input.actionSlot === "primary" &&
    input.actionId === "sync-roster" &&
    input.courseId
  ) {
    return [
      {
        objectId: `student-roster-${input.courseId}`,
        objectType: "student-roster",
        courseId: input.courseId,
        syncedBy: input.actorId,
        // Matches the roster record this action actually writes: a recount of
        // local membership rows, not an import from a student information
        // system this deployment never contacts.
        syncStatus: "local-recount",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        sourceSystems: ["local-class-memberships", "local-class-records"],
        syncedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-student-roster",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "agents" &&
    input.actionSlot === "secondary" &&
    input.actionId === "run-permission-preflight" &&
    input.courseId
  ) {
    const preflightArtifact = input.artifacts.find(
      (
        artifact,
      ): artifact is {
        kind: "preflight";
        status: "passed";
        checkedPermissions: string[];
      } => artifact.kind === "preflight" && "checkedPermissions" in artifact,
    );
    if (!preflightArtifact) {
      return [];
    }

    return [
      {
        objectId: `permission-preflight-${input.courseId}`,
        objectType: "permission-preflight",
        courseId: input.courseId,
        checkedBy: input.actorId,
        preflightStatus: "passed",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        checkedPermissions: ["course-bindings", "agent-roles", "student-access"],
        preflightPolicy: "teacher-agent-permission-gate",
        checkedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-permission-preflight",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "agents" &&
    input.actionSlot === "primary" &&
    input.actionId === "save-agent-plan" &&
    input.courseId
  ) {
    return [
      {
        objectId: `agent-plan-${input.courseId}`,
        objectType: "agent-plan",
        courseId: input.courseId,
        savedBy: input.actorId,
        planStatus: "saved",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        enabledAgents: ["research-assistant", "math-coach", "writing-mentor"],
        governancePolicy: "teacher-reviewed-agent-plan",
        savedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-agent-plan",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "dashboard" &&
    input.actionSlot === "primary" &&
    input.actionId === "refresh-dashboard" &&
    input.courseId
  ) {
    return [
      {
        objectId: `dashboard-state-${input.courseId}`,
        objectType: "dashboard-state",
        courseId: input.courseId,
        refreshedBy: input.actorId,
        refreshStatus: "refreshed",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        visibleMetrics: ["engagement", "progress", "assessment-quality"],
        refreshPolicy: "teacher-visible-course-dashboard",
        refreshedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-dashboard-state",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "dashboard" &&
    input.actionSlot === "secondary" &&
    input.actionId === "lock-daily-snapshot" &&
    input.courseId
  ) {
    const snapshotArtifact = input.artifacts.find(
      (
        artifact,
      ): artifact is {
        kind: "dashboard-snapshot";
        snapshotId: string;
        status: "locked";
      } => artifact.kind === "dashboard-snapshot" && "snapshotId" in artifact,
    );
    if (!snapshotArtifact) {
      return [];
    }

    return [
      {
        objectId: `dashboard-snapshot-${input.courseId}`,
        objectType: "dashboard-snapshot",
        courseId: input.courseId,
        lockedBy: input.actorId,
        snapshotStatus: "locked",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        snapshotId: snapshotArtifact.snapshotId,
        snapshotScope: "daily-course-dashboard",
        retentionPolicy: "teacher-locked-dashboard-snapshot",
        lockedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-dashboard-snapshot",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "admins" &&
    input.actionSlot === "primary" &&
    input.actionId === "save-admin-settings" &&
    input.courseId
  ) {
    return [
      {
        objectId: `admin-settings-${input.courseId}`,
        objectType: "admin-settings",
        courseId: input.courseId,
        savedBy: input.actorId,
        settingsStatus: "saved",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        adminScopes: ["course-collaborators", "permission-boundary", "audit-routing"],
        governancePolicy: "teacher-controlled-admin-settings",
        savedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-admin-settings",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "quiz-board" &&
    input.actionSlot === "primary" &&
    input.actionId === "refresh-quiz-board" &&
    input.courseId
  ) {
    return [
      {
        objectId: `quiz-board-state-${input.courseId}`,
        objectType: "quiz-board-state",
        courseId: input.courseId,
        refreshedBy: input.actorId,
        refreshStatus: "refreshed",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        visibleMetrics: ["completion-rate", "item-quality", "misconception-clusters"],
        reviewPolicy: "teacher-visible-quiz-quality-board",
        refreshedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-quiz-board-state",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "quiz-board" &&
    input.actionSlot === "secondary" &&
    input.actionId === "flag-low-quality-items" &&
    input.courseId
  ) {
    return [
      {
        objectId: `quiz-item-review-${input.courseId}`,
        objectType: "quiz-item-review",
        courseId: input.courseId,
        flaggedBy: input.actorId,
        reviewStatus: "flagged-for-review",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        flaggedSignals: ["low-discrimination", "high-error-rate", "teacher-review-needed"],
        reviewPolicy: "teacher-review-before-quiz-reuse",
        flaggedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-quiz-item-review",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "data-export" &&
    input.actionSlot === "primary" &&
    input.actionId === "create-export-manifest" &&
    input.courseId
  ) {
    const exportArtifact = input.artifacts.find(
      (
        artifact,
      ): artifact is Extract<TeachingOperationArtifact, { kind: "export-file" }> =>
        artifact.kind === "export-file",
    );
    if (!exportArtifact) {
      return [];
    }

    return [
      {
        objectId: `export-manifest-${input.courseId}`,
        objectType: "export-manifest",
        courseId: input.courseId,
        createdBy: input.actorId,
        exportStatus: "generated",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        manifestId: exportArtifact.manifestId,
        datasetScopes: ["learning-records", "chat-threads", "grades", "activities"],
        exportPolicy: "redacted-teacher-export-manifest",
        createdAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-export-manifest",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "data-export" &&
    input.actionSlot === "secondary" &&
    input.actionId === "validate-redaction-scope" &&
    input.courseId
  ) {
    const redactionArtifact = input.artifacts.find(
      (
        artifact,
      ): artifact is Extract<TeachingOperationArtifact, { kind: "redaction-check" }> =>
        artifact.kind === "redaction-check",
    );
    if (!redactionArtifact) {
      return [];
    }

    return [
      {
        objectId: `redaction-validation-${input.courseId}`,
        objectType: "redaction-validation",
        courseId: input.courseId,
        validatedBy: input.actorId,
        validationStatus: "passed",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        checkedScopes: ["student-private-notes", "credentials", "local-paths"],
        validationPolicy: "exclude-private-and-secret-fields",
        validatedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-redaction-validation",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "knowledge-base" &&
    input.actionSlot === "primary" &&
    input.actionId === "sync-knowledge-index" &&
    input.courseId
  ) {
    return [
      {
        objectId: `knowledge-index-${input.courseId}`,
        objectType: "knowledge-index",
        courseId: input.courseId,
        syncedBy: input.actorId,
        syncStatus: "synced",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        sourceSystems: ["course-files", "teacher-resources", "agent-grounding-index"],
        syncedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-knowledge-index",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "knowledge-base" &&
    input.actionSlot === "secondary" &&
    input.actionId === "register-knowledge-source" &&
    input.courseId &&
    input.knowledgeResource
  ) {
    return [
      {
        objectId: createTeachingResourceReviewItemId({
          courseId: input.courseId,
          sourceUrl: input.knowledgeResource.sourceUrl,
        }),
        objectType: "resource-review-item",
        courseId: input.courseId,
        queuedBy: input.actorId,
        reviewStatus: "pending-teacher-review",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        resourceSource: "teacher-submitted-url",
        title: input.knowledgeResource.title,
        sourceFingerprint: input.knowledgeResource.sourceFingerprint,
        rightsBasis: input.knowledgeResource.rightsBasis,
        visibility: input.knowledgeResource.visibility,
        reviewPolicy: "teacher-review-before-knowledge-index",
        queuedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-resource-review-item",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "content" &&
    input.actionSlot === "primary" &&
    input.actionId === "publish-course-content" &&
    input.courseId
  ) {
    return [
      {
        objectId: `course-content-${input.courseId}`,
        objectType: "course-content",
        courseId: input.courseId,
        publishedBy: input.actorId,
        publicationStatus: "published",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        releaseScope: "course-visible-content",
        publishedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-course-content",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "content" &&
    input.actionSlot === "secondary" &&
    input.actionId === "generate-unit-draft" &&
    input.courseId
  ) {
    const draftArtifact = input.artifacts.find(
      (
        artifact,
      ): artifact is {
        kind: "generated-draft";
        artifactId: string;
        status: "ready-for-teacher-review";
      } => artifact.kind === "generated-draft" && "artifactId" in artifact,
    );
    if (!draftArtifact) {
      return [];
    }

    return [
      {
        objectId: `unit-draft-${input.courseId}`,
        objectType: "unit-draft",
        courseId: input.courseId,
        generatedBy: input.actorId,
        draftStatus: "ready-for-teacher-review",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        artifactId: draftArtifact.artifactId,
        reviewPolicy: "teacher-review-before-course-publish",
        generatedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-unit-draft",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "students" &&
    input.actionSlot === "secondary" &&
    input.actionId === "generate-group-suggestions" &&
    input.courseId
  ) {
    const suggestionsArtifact = input.artifacts.find(
      (
        artifact,
      ): artifact is {
        kind: "group-suggestions";
        artifactId: string;
        status: "ready-for-teacher-review";
      } => artifact.kind === "group-suggestions" && "artifactId" in artifact,
    );
    if (!suggestionsArtifact) {
      return [];
    }

    return [
      {
        objectId: `group-suggestions-${input.courseId}`,
        objectType: "group-suggestions",
        courseId: input.courseId,
        generatedBy: input.actorId,
        suggestionStatus: "ready-for-teacher-review",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        artifactId: suggestionsArtifact.artifactId,
        groupingBasis: ["participation", "progress", "collaboration-balance"],
        reviewPolicy: "teacher-review-before-group-assignment",
        generatedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-group-suggestions",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "admins" &&
    input.actionSlot === "secondary" &&
    input.actionId === "send-collaboration-invite" &&
    input.courseId
  ) {
    const outboxArtifact = input.artifacts.find(
      (artifact): artifact is Extract<TeachingOperationArtifact, { kind: "outbox" }> =>
        artifact.kind === "outbox" && artifact.channel === "collaboration-invite",
    );
    if (!outboxArtifact) {
      return [];
    }

    return [
      {
        objectId: `email-notification-${input.courseId}-collaboration-invite`,
        objectType: "email-notification",
        courseId: input.courseId,
        queuedBy: input.actorId,
        notificationStatus: "queued",
        deliveryChannel: "collaboration-invite-email",
        outboxId: outboxArtifact.outboxId,
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        deliveryPolicy: "server-outbox-before-smtp-provider",
        queuedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-email-notification",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "grading" &&
    input.actionSlot === "secondary" &&
    input.actionId === "generate-ai-feedback" &&
    input.courseId
  ) {
    const feedbackArtifact = input.artifacts.find(
      (
        artifact,
      ): artifact is {
        kind: "ai-feedback";
        artifactId: string;
        status: "ready-for-teacher-review";
      } => artifact.kind === "ai-feedback" && "artifactId" in artifact,
    );
    if (!feedbackArtifact) {
      return [];
    }

    return [
      {
        objectId: `ai-feedback-draft-${input.courseId}`,
        objectType: "ai-feedback-draft",
        courseId: input.courseId,
        generatedBy: input.actorId,
        feedbackStatus: "ready-for-teacher-review",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        artifactId: feedbackArtifact.artifactId,
        feedbackScope: "grading-review-queue",
        reviewPolicy: "teacher-review-before-student-release",
        generatedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-ai-feedback-draft",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "grading" &&
    input.actionSlot === "primary" &&
    input.actionId === "save-review-queue" &&
    input.courseId
  ) {
    return [
      {
        objectId: `grading-queue-${input.courseId}`,
        objectType: "grading-queue",
        courseId: input.courseId,
        savedBy: input.actorId,
        queueStatus: "saved",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        reviewPolicy: "teacher-review-before-release",
        savedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-grading-queue",
        redaction: createRedaction(),
      },
      {
        objectId: `gradebook-update-${input.courseId}`,
        objectType: "gradebook-update",
        courseId: input.courseId,
        updatedBy: input.actorId,
        updateStatus: "pending-release",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        releasePolicy: "teacher-confirmed-grade-release",
        updatedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-gradebook-update",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "invite-code" &&
    input.actionSlot === "primary" &&
    input.actionId === "generate-invite-code" &&
    input.courseId
  ) {
    const inviteArtifact = input.artifacts.find(
      (
        artifact,
      ): artifact is Extract<TeachingOperationArtifact, { kind: "invite-code" }> =>
        artifact.kind === "invite-code" && artifact.status === "generated",
    );
    if (!inviteArtifact) {
      return [];
    }

    return [
      {
        objectId: `invite-code-draft-${input.courseId}-${inviteArtifact.code}`,
        objectType: "invite-code-draft",
        courseId: input.courseId,
        inviteCode: inviteArtifact.code,
        joinUrl: inviteArtifact.joinUrl,
        generatedBy: input.actorId,
        draftStatus: "generated",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        invitePolicy: "teacher-review-before-publication",
        generatedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-invite-code-draft",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "invite-code" &&
    input.actionSlot === "secondary" &&
    input.actionId === "publish-invite-code" &&
    input.courseId
  ) {
    const inviteArtifact = input.artifacts.find(
      (
        artifact,
      ): artifact is Extract<TeachingOperationArtifact, { kind: "invite-code" }> =>
        artifact.kind === "invite-code" && artifact.status === "published",
    );
    if (!inviteArtifact) {
      return [];
    }

    return [
      {
        objectId: `enrollment-access-${input.courseId}-${inviteArtifact.code}`,
        objectType: "enrollment-access",
        courseId: input.courseId,
        inviteCode: inviteArtifact.code,
        joinUrl: inviteArtifact.joinUrl,
        publishedBy: input.actorId,
        publicationStatus: "published",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        enrollmentPolicy: "teacher-confirmed-course-scope",
        publishedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-enrollment-access",
        redaction: createRedaction(),
      },
    ];
  }
  return [];
}
