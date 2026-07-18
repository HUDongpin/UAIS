import { TeachingOperationStoreError } from "./teaching-operations-error";
import {
  createRedaction,
  isRecord,
  requireInviteCode,
  requireIsoDate,
  requireSafeId,
  requireSafeUrlPath,
} from "./teaching-operations-guards";
import type {
  TeachingOperationArtifact,
  TeachingOperationDomainObjectType,
  TeachingOperationExportManifest,
  TeachingOperationInviteCodeRecord,
  TeachingOperationOutboxRecord,
} from "./teaching-operations-store";

// Leaf entity normalizers (invite code, outbox, export manifest, artifact) for the
// teaching-operations store (Phase 3 decomposition). Self-contained: the only
// runtime deps are the extracted guards/error modules; store types are a type-only
// import (no runtime cycle). Behavior is identical to the previous inline defs.

export function normalizeInviteCode(value: unknown): TeachingOperationInviteCodeRecord {
  if (!isRecord(value) || value.operationId !== "invite-code") {
    throw new TeachingOperationStoreError(500, "Invite code record is invalid.");
  }

  return {
    inviteId: requireSafeId(value.inviteId, "invite id"),
    operationId: "invite-code",
    code: requireInviteCode(value.code),
    status: value.status === "published" ? "published" : "generated",
    ...(value.courseId ? { courseId: requireSafeId(value.courseId, "course id") } : {}),
    actorId: requireSafeId(value.actorId, "actor id"),
    createdAt: requireIsoDate(value.createdAt, "createdAt"),
  };
}

export function normalizeOutboxRecord(value: unknown): TeachingOperationOutboxRecord {
  if (!isRecord(value) || value.operationId !== "admins") {
    throw new TeachingOperationStoreError(500, "Outbox record is invalid.");
  }

  return {
    outboxId: requireSafeId(value.outboxId, "outbox id"),
    operationId: "admins",
    channel: "collaboration-invite",
    deliveryStatus: "sent-to-local-outbox",
    ...(value.courseId ? { courseId: requireSafeId(value.courseId, "course id") } : {}),
    actorId: requireSafeId(value.actorId, "actor id"),
    createdAt: requireIsoDate(value.createdAt, "createdAt"),
  };
}

export function normalizeExportManifest(value: unknown): TeachingOperationExportManifest {
  if (!isRecord(value) || value.operationId !== "data-export") {
    throw new TeachingOperationStoreError(500, "Export manifest is invalid.");
  }

  return {
    manifestId: requireSafeId(value.manifestId, "manifest id"),
    operationId: "data-export",
    ...(value.courseId ? { courseId: requireSafeId(value.courseId, "course id") } : {}),
    actorId: requireSafeId(value.actorId, "actor id"),
    createdAt: requireIsoDate(value.createdAt, "createdAt"),
    datasets: Array.isArray(value.datasets)
      ? value.datasets.map((item) => requireSafeId(item, "dataset id"))
      : [],
    formats: Array.isArray(value.formats)
      ? value.formats.map((item) => requireSafeId(item, "format id"))
      : [],
    redactionScope: {
      studentPrivateNotes: "excluded",
      credentials: "excluded",
      localPaths: "excluded",
    },
    redaction: createRedaction(),
  };
}

export function normalizeArtifact(value: unknown): TeachingOperationArtifact {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new TeachingOperationStoreError(500, "Teaching operation artifact is invalid.");
  }

  if (value.kind === "database-record") {
    return {
      kind: "database-record",
      table: requireSafeId(value.table, "table"),
      recordId: requireSafeId(value.recordId, "record id"),
    };
  }
  if (value.kind === "student-preview") {
    return {
      kind: "student-preview",
      previewId: requireSafeId(value.previewId, "preview id"),
      previewUrl: requireSafeUrlPath(value.previewUrl, "preview url"),
    };
  }
  if (value.kind === "preflight") {
    return {
      kind: "preflight",
      status: "passed",
      checkedPermissions: Array.isArray(value.checkedPermissions)
        ? value.checkedPermissions.map((item) => requireSafeId(item, "permission id"))
        : [],
    };
  }
  if (value.kind === "export-file") {
    return {
      kind: "export-file",
      manifestId: requireSafeId(value.manifestId, "manifest id"),
      downloadUrl: requireSafeUrlPath(value.downloadUrl, "download url"),
      contentType: "application/json",
    };
  }
  if (value.kind === "outbox") {
    return {
      kind: "outbox",
      outboxId: requireSafeId(value.outboxId, "outbox id"),
      channel: "collaboration-invite",
      deliveryStatus: "sent-to-local-outbox",
    };
  }
  if (value.kind === "invite-code") {
    return {
      kind: "invite-code",
      code: requireInviteCode(value.code),
      status: value.status === "published" ? "published" : "generated",
      joinUrl: requireSafeUrlPath(value.joinUrl, "join url"),
    };
  }
  if (value.kind === "dashboard-snapshot") {
    return {
      kind: "dashboard-snapshot",
      snapshotId: requireSafeId(value.snapshotId, "snapshot id"),
      status: "locked",
    };
  }
  if (value.kind === "redaction-check") {
    return {
      kind: "redaction-check",
      status: "passed",
      checkedScopes: Array.isArray(value.checkedScopes)
        ? value.checkedScopes.map((item) => requireSafeId(item, "redaction scope"))
        : [],
    };
  }
  if (
    value.kind === "generated-draft" ||
    value.kind === "group-suggestions" ||
    value.kind === "ai-feedback"
  ) {
    return {
      kind: value.kind,
      artifactId: requireSafeId(value.artifactId, "artifact id"),
      status: "ready-for-teacher-review",
    };
  }
  if (value.kind === "domain-object") {
    let objectType: TeachingOperationDomainObjectType;
    if (value.objectType === "course-settings") {
      objectType = "course-settings";
    } else if (value.objectType === "student-preview-session") {
      objectType = "student-preview-session";
    } else if (value.objectType === "agent-plan") {
      objectType = "agent-plan";
    } else if (value.objectType === "permission-preflight") {
      objectType = "permission-preflight";
    } else if (value.objectType === "dashboard-state") {
      objectType = "dashboard-state";
    } else if (value.objectType === "admin-settings") {
      objectType = "admin-settings";
    } else if (value.objectType === "quiz-board-state") {
      objectType = "quiz-board-state";
    } else if (value.objectType === "resource-review-item") {
      objectType = "resource-review-item";
    } else if (value.objectType === "unit-draft") {
      objectType = "unit-draft";
    } else if (value.objectType === "group-suggestions") {
      objectType = "group-suggestions";
    } else if (value.objectType === "ai-feedback-draft") {
      objectType = "ai-feedback-draft";
    } else if (value.objectType === "dashboard-snapshot") {
      objectType = "dashboard-snapshot";
    } else if (value.objectType === "quiz-item-review") {
      objectType = "quiz-item-review";
    } else if (value.objectType === "export-manifest") {
      objectType = "export-manifest";
    } else if (value.objectType === "redaction-validation") {
      objectType = "redaction-validation";
    } else if (value.objectType === "student-roster") {
      objectType = "student-roster";
    } else if (value.objectType === "invite-code-draft") {
      objectType = "invite-code-draft";
    } else if (value.objectType === "enrollment-access") {
      objectType = "enrollment-access";
    } else if (value.objectType === "knowledge-index") {
      objectType = "knowledge-index";
    } else if (value.objectType === "course-content") {
      objectType = "course-content";
    } else if (value.objectType === "grading-queue") {
      objectType = "grading-queue";
    } else if (value.objectType === "gradebook-update") {
      objectType = "gradebook-update";
    } else if (value.objectType === "email-notification") {
      objectType = "email-notification";
    } else if (value.objectType === "grade-release-notification") {
      objectType = "grade-release-notification";
    } else if (value.objectType === "grade-release-rollback-notification") {
      objectType = "grade-release-rollback-notification";
    } else {
      throw new TeachingOperationStoreError(500, "Teaching operation domain artifact is invalid.");
    }
    return {
      kind: "domain-object",
      objectType,
      objectId: requireSafeId(value.objectId, "domain object id"),
    };
  }

  throw new TeachingOperationStoreError(500, "Teaching operation artifact kind is invalid.");
}
