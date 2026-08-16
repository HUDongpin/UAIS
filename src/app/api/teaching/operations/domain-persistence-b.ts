import { createUaisTeachingCourseManagementRepository } from "@/lib/server/teaching-course-management-external-store";
import {
  assertTeachingCourseManagementLocalJsonRuntimeAllowed,
  markTeachingCollaborationInviteNotificationDelivered,
  markTeachingCourseExportProviderExported,
  markTeachingGradingFeedbackProviderGenerated,
  readTeachingCourseManagementSnapshot,
  resolveTeachingCourseManagementDataDir,
  saveTeachingClassInviteCodeDraftRecord,
  saveTeachingCollaborationInviteNotificationRecord,
  saveTeachingCourseExportManifestRecord,
  saveTeachingCourseExportRedactionValidationRecord,
  saveTeachingGradingFeedbackDraftRecord,
  saveTeachingGradingQueueRecord,
  TeachingCourseManagementStoreError,
} from "@/lib/server/teaching-course-management-store";
import type {
  TeachingOperationAuditRequestSource,
  TeachingOperationReceipt,
} from "@/lib/server/teaching-operations-store";
import {
  readCollaborationInviteEmailProviderConfig,
  readCourseExportProviderConfig,
  readGradingFeedbackProviderConfig,
  readProviderDeliveryId,
  readProviderExportId,
  readProviderFeedbackId,
} from "./provider-config";
import {
  createRedaction,
  isTeachingCourseManagementPersistenceConfigured,
  isTeachingOperationProductionRuntime,
  readGeneratedInviteCode,
  readTargetClassId,
  type TeachingOperationAuthenticatedTeacher,
} from "./route-utils";

// Domain-object persistence handlers (part B) for the teaching-operations route
// (Phase 3 decomposition): collaboration-invite notification/email delivery, course
// export manifest/provider/redaction, grading queue/feedback, invite-code draft.
// Cycle-free: deps are the course-management store handlers + extracted route-utils/
// provider-config modules; store types type-only.

export async function maybePersistCollaborationInviteNotificationDomainObject(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "admins" ||
    input.receipt.actionSlot !== "secondary" ||
    !input.courseId
  ) {
    return undefined;
  }
  const outboxArtifact = input.receipt.artifacts.find(
    (
      artifact,
    ): artifact is Extract<TeachingOperationReceipt["artifacts"][number], { kind: "outbox" }> =>
      artifact.kind === "outbox" && artifact.channel === "collaboration-invite",
  );
  if (!outboxArtifact) {
    return undefined;
  }
  if (
    !isTeachingCourseManagementPersistenceConfigured(input.env) &&
    !isTeachingOperationProductionRuntime(input.env)
  ) {
    return undefined;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  const { receipt } = await saveTeachingCollaborationInviteNotificationRecord({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    outboxId: outboxArtifact.outboxId,
    ...(input.receipt.sourceAction ? { sourceAction: input.receipt.sourceAction } : {}),
    traceId: input.traceId,
    audit: {
      requestSource: input.requestSource,
    },
    now: input.now,
  });
  return receipt;
}

export async function maybeDeliverCollaborationInviteEmail(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  notificationPersisted: boolean;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "admins" ||
    input.receipt.actionSlot !== "secondary" ||
    !input.courseId ||
    !input.notificationPersisted
  ) {
    return undefined;
  }
  const providerConfig = readCollaborationInviteEmailProviderConfig(input.env);
  if (!providerConfig) {
    return undefined;
  }
  const outboxArtifact = input.receipt.artifacts.find(
    (
      artifact,
    ): artifact is Extract<TeachingOperationReceipt["artifacts"][number], { kind: "outbox" }> =>
      artifact.kind === "outbox" && artifact.channel === "collaboration-invite",
  );
  if (!outboxArtifact) {
    return undefined;
  }
  if (
    input.receipt.idempotencyStatus === "already-persisted" &&
    (await hasDeliveredCollaborationInviteEmailNotification({
      env: input.env,
      fetch: input.fetch,
      courseId: input.courseId,
      operationRecordId: input.receipt.receiptId,
      outboxId: outboxArtifact.outboxId,
    }))
  ) {
    return undefined;
  }

  const fetchImpl = input.fetch ?? fetch;
  const providerResponse = await fetchImpl(providerConfig.url, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${providerConfig.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      action: "deliver-collaboration-invite-email",
      actorId: input.authenticatedTeacher.actorId,
      courseId: input.courseId,
      traceId: input.traceId,
      operationRecordId: input.receipt.receiptId,
      outboxId: outboxArtifact.outboxId,
      deliveryChannel: "collaboration-invite-email",
      templateId: "uais-collaboration-invite-v1",
      redaction: createRedaction(),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!providerResponse.ok) {
    throw new TeachingCourseManagementStoreError(
      502,
      "Collaboration invite email provider delivery failed.",
    );
  }
  const providerBody = await providerResponse.json();
  const providerDeliveryId = readProviderDeliveryId(providerBody);

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }
  const { receipt } = await markTeachingCollaborationInviteNotificationDelivered({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    outboxId: outboxArtifact.outboxId,
    providerDeliveryId,
    audit: {
      requestSource: input.requestSource,
    },
    traceId: input.traceId,
    now: input.now,
  });

  return {
    ...receipt,
    action: "deliver-collaboration-invite-email" as const,
    status: "delivered" as const,
    providerStatus: "smtp-provider-delivered" as const,
    deliveryId: providerDeliveryId,
    outboxId: outboxArtifact.outboxId,
  };
}

export async function hasDeliveredCollaborationInviteEmailNotification(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  courseId: string;
  operationRecordId: string;
  outboxId: string;
}) {
  if (
    !isTeachingCourseManagementPersistenceConfigured(input.env) &&
    !isTeachingOperationProductionRuntime(input.env)
  ) {
    return false;
  }
  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }
  const snapshot = await readTeachingCourseManagementSnapshot({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    courseId: input.courseId,
  });
  return Boolean(
    snapshot.database.collaborationInviteNotifications?.some(
      (notification) =>
        notification.courseId === input.courseId &&
        notification.operationRecordId === input.operationRecordId &&
        notification.outboxId === input.outboxId &&
        notification.notificationStatus === "delivered-to-provider",
    ),
  );
}

export async function maybePersistCourseExportManifestDomainObject(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "data-export" ||
    input.receipt.actionSlot !== "primary" ||
    !input.courseId
  ) {
    return undefined;
  }
  const exportFileArtifact = input.receipt.artifacts.find(
    (
      artifact,
    ): artifact is Extract<TeachingOperationReceipt["artifacts"][number], { kind: "export-file" }> =>
      artifact.kind === "export-file",
  );
  if (!exportFileArtifact) {
    return undefined;
  }
  if (
    !isTeachingCourseManagementPersistenceConfigured(input.env) &&
    !isTeachingOperationProductionRuntime(input.env)
  ) {
    return undefined;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  const { receipt } = await saveTeachingCourseExportManifestRecord({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    teachingOperationManifestId: exportFileArtifact.manifestId,
    ...(input.receipt.sourceAction ? { sourceAction: input.receipt.sourceAction } : {}),
    traceId: input.traceId,
    audit: {
      requestSource: input.requestSource,
    },
    now: input.now,
  });
  return receipt;
}

export async function maybeExportCourseDataWithProvider(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  exportManifestPersisted: boolean;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "data-export" ||
    input.receipt.actionSlot !== "primary" ||
    !input.courseId ||
    !input.exportManifestPersisted
  ) {
    return undefined;
  }
  const providerConfig = readCourseExportProviderConfig(input.env);
  if (!providerConfig) {
    return undefined;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  const snapshot = await readTeachingCourseManagementSnapshot({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    courseId: input.courseId,
  });
  const exportManifestId = `export-manifest-${input.courseId}`;
  const exportManifest = snapshot.database.exportManifests?.find(
    (item) =>
      item.exportManifestId === exportManifestId &&
      item.operationRecordId === input.receipt.receiptId,
  );
  if (!exportManifest) {
    throw new TeachingCourseManagementStoreError(
      404,
      "Teaching export manifest record was not found.",
    );
  }
  if (
    exportManifest.providerStatus === "export-provider-exported" &&
    exportManifest.providerExportId
  ) {
    return undefined;
  }

  const fetchImpl = input.fetch ?? fetch;
  const providerResponse = await fetchImpl(providerConfig.url, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${providerConfig.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      action: "export-course-data",
      actorId: input.authenticatedTeacher.actorId,
      courseId: input.courseId,
      traceId: input.traceId,
      operationRecordId: input.receipt.receiptId,
      exportManifestId: exportManifest.exportManifestId,
      teachingOperationManifestId: exportManifest.teachingOperationManifestId,
      downloadRoute: exportManifest.downloadRoute,
      datasetScopes: exportManifest.datasetScopes,
      formats: exportManifest.formats,
      exportPolicy: exportManifest.exportPolicy,
      redaction: createRedaction(),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!providerResponse.ok) {
    throw new TeachingCourseManagementStoreError(
      502,
      "Course export provider failed.",
    );
  }
  const providerBody = await providerResponse.json();
  const providerExportId = readProviderExportId(providerBody);

  const { receipt } = await markTeachingCourseExportProviderExported({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    providerExportId,
    audit: {
      requestSource: input.requestSource,
    },
    traceId: input.traceId,
    now: input.now,
  });

  return {
    ...receipt,
    action: "export-course-data-provider" as const,
    status: "exported" as const,
    providerStatus: "export-provider-exported" as const,
    providerExportId,
    exportManifestId: exportManifest.exportManifestId,
    teachingOperationManifestId: exportManifest.teachingOperationManifestId,
  };
}

export async function maybePersistCourseExportRedactionValidationDomainObject(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "data-export" ||
    input.receipt.actionSlot !== "secondary" ||
    !input.courseId
  ) {
    return undefined;
  }
  if (
    !isTeachingCourseManagementPersistenceConfigured(input.env) &&
    !isTeachingOperationProductionRuntime(input.env)
  ) {
    return undefined;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  const { receipt } = await saveTeachingCourseExportRedactionValidationRecord({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    ...(input.receipt.sourceAction ? { sourceAction: input.receipt.sourceAction } : {}),
    traceId: input.traceId,
    audit: {
      requestSource: input.requestSource,
    },
    now: input.now,
  });
  return receipt;
}

export async function maybePersistGradingQueueDomainObject(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "grading" ||
    input.receipt.actionSlot !== "primary" ||
    !input.courseId
  ) {
    return undefined;
  }
  if (
    !isTeachingCourseManagementPersistenceConfigured(input.env) &&
    !isTeachingOperationProductionRuntime(input.env)
  ) {
    return undefined;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  const { receipt } = await saveTeachingGradingQueueRecord({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    ...(input.receipt.sourceAction ? { sourceAction: input.receipt.sourceAction } : {}),
    traceId: input.traceId,
    audit: {
      requestSource: input.requestSource,
    },
    now: input.now,
  });
  return receipt;
}

export async function maybePersistGradingFeedbackDraftDomainObject(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "grading" ||
    input.receipt.actionSlot !== "secondary" ||
    !input.courseId
  ) {
    return undefined;
  }
  const feedbackArtifact = input.receipt.artifacts.find(
    (
      artifact,
    ): artifact is TeachingOperationReceipt["artifacts"][number] & {
      kind: "ai-feedback";
      artifactId: string;
    } =>
      artifact.kind === "ai-feedback" &&
      "artifactId" in artifact &&
      typeof artifact.artifactId === "string",
  );
  if (!feedbackArtifact) {
    return undefined;
  }
  if (
    !isTeachingCourseManagementPersistenceConfigured(input.env) &&
    !isTeachingOperationProductionRuntime(input.env)
  ) {
    return undefined;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  const { receipt } = await saveTeachingGradingFeedbackDraftRecord({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    teachingOperationFeedbackArtifactId: feedbackArtifact.artifactId,
    ...(input.receipt.sourceAction ? { sourceAction: input.receipt.sourceAction } : {}),
    traceId: input.traceId,
    audit: {
      requestSource: input.requestSource,
    },
    now: input.now,
  });
  return receipt;
}

export async function maybeGenerateGradingFeedbackWithProvider(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  gradingFeedbackDraftPersisted: boolean;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "grading" ||
    input.receipt.actionSlot !== "secondary" ||
    !input.courseId ||
    !input.gradingFeedbackDraftPersisted
  ) {
    return undefined;
  }
  const providerConfig = readGradingFeedbackProviderConfig(input.env);
  if (!providerConfig) {
    return undefined;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  const snapshot = await readTeachingCourseManagementSnapshot({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    courseId: input.courseId,
  });
  const gradingFeedbackDraftId = `grading-feedback-draft-${input.courseId}`;
  const gradingFeedbackDraft = snapshot.database.gradingFeedbackDrafts?.find(
    (item) =>
      item.gradingFeedbackDraftId === gradingFeedbackDraftId &&
      item.operationRecordId === input.receipt.receiptId,
  );
  if (!gradingFeedbackDraft) {
    throw new TeachingCourseManagementStoreError(
      404,
      "Teaching grading feedback draft record was not found.",
    );
  }
  if (
    gradingFeedbackDraft.providerStatus === "feedback-provider-generated" &&
    gradingFeedbackDraft.providerFeedbackId
  ) {
    return undefined;
  }

  const fetchImpl = input.fetch ?? fetch;
  const providerResponse = await fetchImpl(providerConfig.url, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${providerConfig.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      action: "generate-grading-feedback",
      actorId: input.authenticatedTeacher.actorId,
      courseId: input.courseId,
      traceId: input.traceId,
      operationRecordId: input.receipt.receiptId,
      gradingFeedbackDraftId: gradingFeedbackDraft.gradingFeedbackDraftId,
      teachingOperationFeedbackArtifactId:
        gradingFeedbackDraft.teachingOperationFeedbackArtifactId,
      feedbackScope: gradingFeedbackDraft.feedbackScope,
      reviewPolicy: gradingFeedbackDraft.reviewPolicy,
      releasePolicy: gradingFeedbackDraft.releasePolicy,
      redaction: createRedaction(),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!providerResponse.ok) {
    throw new TeachingCourseManagementStoreError(
      502,
      "Grading feedback provider failed.",
    );
  }
  const providerBody = await providerResponse.json();
  const providerFeedbackId = readProviderFeedbackId(providerBody);

  const { receipt } = await markTeachingGradingFeedbackProviderGenerated({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    providerFeedbackId,
    audit: {
      requestSource: input.requestSource,
    },
    traceId: input.traceId,
    now: input.now,
  });

  return {
    ...receipt,
    action: "generate-grading-feedback-provider" as const,
    status: "generated" as const,
    providerStatus: "feedback-provider-generated" as const,
    providerFeedbackId,
    gradingFeedbackDraftId: gradingFeedbackDraft.gradingFeedbackDraftId,
  };
}

export async function maybePersistInviteCodeDraftDomainObject(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  body: Record<string, unknown>;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "invite-code" ||
    input.receipt.actionSlot !== "primary" ||
    !input.courseId
  ) {
    return undefined;
  }

  const targetClassId = readTargetClassId(input.body);
  if (!targetClassId) {
    return undefined;
  }

  const invitationCode = readGeneratedInviteCode(input.receipt);
  if (!invitationCode) {
    return undefined;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  const { receipt } = await saveTeachingClassInviteCodeDraftRecord({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    classId: targetClassId,
    operationRecordId: input.receipt.receiptId,
    invitationCode,
    ...(input.receipt.sourceAction ? { sourceAction: input.receipt.sourceAction } : {}),
    audit: { requestSource: input.requestSource },
    traceId: input.traceId,
    now: input.now,
  });
  return receipt;
}
