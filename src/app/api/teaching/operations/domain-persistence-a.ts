import { createUaisTeachingCourseManagementRepository } from "@/lib/server/teaching-course-management-external-store";
import {
  assertTeachingCourseManagementLocalJsonRuntimeAllowed,
  markTeachingCourseContentProviderPublished,
  markTeachingKnowledgeIndexProviderSynced,
  markTeachingStudentRosterProviderSynced,
  readTeachingCourseManagementSnapshot,
  resolveTeachingCourseManagementDataDir,
  saveTeachingAdminSettingsRecord,
  saveTeachingAgentPermissionPreflightRecord,
  saveTeachingAgentSettingsRecord,
  saveTeachingCourseContentPublishRecord,
  saveTeachingCourseDashboardRefreshRecord,
  saveTeachingCourseDashboardSnapshotRecord,
  saveTeachingCourseQuizAssessmentRecord,
  saveTeachingCourseQuizItemReviewRecord,
  saveTeachingCourseSettingsRecord,
  saveTeachingCourseUnitDraftRecord,
  saveTeachingKnowledgeIndexSyncRecord,
  saveTeachingResourceReviewItemRecord,
  saveTeachingStudentGroupSuggestionRecord,
  saveTeachingStudentPreviewSessionRecord,
  saveTeachingStudentRosterSyncRecord,
  TeachingCourseManagementStoreError,
} from "@/lib/server/teaching-course-management-store";
import type {
  TeachingOperationAuditRequestSource,
  TeachingOperationReceipt,
} from "@/lib/server/teaching-operations-store";
import {
  readCourseContentPublishProviderConfig,
  readKnowledgeIndexSyncProviderConfig,
  readKnowledgeProviderSyncId,
  readProviderPublishId,
  readProviderSyncId,
  readStudentRosterSyncProviderConfig,
} from "./provider-config";
import {
  createRedaction,
  isRecord,
  isTeachingCourseManagementPersistenceConfigured,
  isTeachingOperationProductionRuntime,
  type TeachingOperationAuthenticatedTeacher,
} from "./route-utils";

// Domain-object persistence handlers (part A) for the teaching-operations route
// (Phase 3 decomposition): course settings, student preview/roster/groups, knowledge
// index, resource review, content publish, unit draft, dashboard, quiz, admin/agent
// settings. Cycle-free: deps are the course-management store handlers + extracted
// route-utils/provider-config modules; store types type-only.

export async function maybePersistCourseSettingsDomainObject(input: {
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
    input.receipt.operationId !== "course-settings" ||
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

  const { receipt } = await saveTeachingCourseSettingsRecord({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    ...(input.receipt.sourceAction ? { sourceAction: input.receipt.sourceAction } : {}),
    ...(isRecord(input.body.courseSettingsPatch)
      ? { settingsPatch: input.body.courseSettingsPatch }
      : {}),
    traceId: input.traceId,
    audit: {
      requestSource: input.requestSource,
    },
    now: input.now,
  });
  return receipt;
}

export async function maybePersistStudentPreviewSessionDomainObject(input: {
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
    input.receipt.operationId !== "course-settings" ||
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

  const { receipt } = await saveTeachingStudentPreviewSessionRecord({
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

export async function maybePersistStudentRosterSyncDomainObject(input: {
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
    input.receipt.operationId !== "students" ||
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

  const { receipt } = await saveTeachingStudentRosterSyncRecord({
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

export async function maybeSyncStudentRosterWithProvider(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  rosterPersisted: boolean;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "students" ||
    input.receipt.actionSlot !== "primary" ||
    !input.courseId ||
    !input.rosterPersisted
  ) {
    return undefined;
  }
  const providerConfig = readStudentRosterSyncProviderConfig(input.env);
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
  });
  const rosterId = `student-roster-${input.courseId}`;
  const studentRoster = snapshot.database.studentRosters?.find(
    (roster) =>
      roster.rosterId === rosterId && roster.operationRecordId === input.receipt.receiptId,
  );
  if (!studentRoster) {
    throw new TeachingCourseManagementStoreError(
      404,
      "Teaching student roster sync record was not found.",
    );
  }
  if (studentRoster.providerStatus === "sis-provider-synced" && studentRoster.providerSyncId) {
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
      action: "sync-student-roster",
      actorId: input.authenticatedTeacher.actorId,
      courseId: input.courseId,
      traceId: input.traceId,
      operationRecordId: input.receipt.receiptId,
      rosterId: studentRoster.rosterId,
      approvedStudentCount: studentRoster.approvedStudentCount,
      pendingTeacherReviewCount: studentRoster.pendingTeacherReviewCount,
      classCount: studentRoster.classCount,
      sourceSystems: studentRoster.sourceSystems,
      redaction: createRedaction(),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!providerResponse.ok) {
    throw new TeachingCourseManagementStoreError(
      502,
      "Student roster sync provider failed.",
    );
  }
  const providerBody = await providerResponse.json();
  const providerSyncId = readProviderSyncId(providerBody);

  const { receipt } = await markTeachingStudentRosterProviderSynced({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    providerSyncId,
    audit: {
      requestSource: input.requestSource,
    },
    traceId: input.traceId,
    now: input.now,
  });

  return {
    ...receipt,
    action: "sync-student-roster-provider" as const,
    status: "synced" as const,
    providerStatus: "sis-provider-synced" as const,
    providerSyncId,
    rosterId: studentRoster.rosterId,
  };
}

export async function maybePersistStudentGroupSuggestionDomainObject(input: {
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
    input.receipt.operationId !== "students" ||
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

  const { receipt } = await saveTeachingStudentGroupSuggestionRecord({
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

export async function maybePersistKnowledgeIndexSyncDomainObject(input: {
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
    input.receipt.operationId !== "knowledge-base" ||
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

  const { receipt } = await saveTeachingKnowledgeIndexSyncRecord({
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

export async function maybeSyncKnowledgeIndexWithProvider(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  indexPersisted: boolean;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "knowledge-base" ||
    input.receipt.actionSlot !== "primary" ||
    !input.courseId ||
    !input.indexPersisted
  ) {
    return undefined;
  }
  const providerConfig = readKnowledgeIndexSyncProviderConfig(input.env);
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
  });
  const indexId = `knowledge-index-${input.courseId}`;
  const knowledgeIndex = snapshot.database.knowledgeIndexes?.find(
    (item) => item.indexId === indexId && item.operationRecordId === input.receipt.receiptId,
  );
  if (!knowledgeIndex) {
    throw new TeachingCourseManagementStoreError(
      404,
      "Teaching knowledge index sync record was not found.",
    );
  }
  if (
    knowledgeIndex.providerStatus === "knowledge-provider-synced" &&
    knowledgeIndex.providerSyncId
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
      action: "sync-knowledge-index",
      actorId: input.authenticatedTeacher.actorId,
      courseId: input.courseId,
      traceId: input.traceId,
      operationRecordId: input.receipt.receiptId,
      indexId: knowledgeIndex.indexId,
      syncStatus: knowledgeIndex.syncStatus,
      sourceSystems: knowledgeIndex.sourceSystems,
      redaction: createRedaction(),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!providerResponse.ok) {
    throw new TeachingCourseManagementStoreError(
      502,
      "Knowledge index sync provider failed.",
    );
  }
  const providerBody = await providerResponse.json();
  const providerSyncId = readKnowledgeProviderSyncId(providerBody);

  const { receipt } = await markTeachingKnowledgeIndexProviderSynced({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    providerSyncId,
    audit: {
      requestSource: input.requestSource,
    },
    traceId: input.traceId,
    now: input.now,
  });

  return {
    ...receipt,
    action: "sync-knowledge-index-provider" as const,
    status: "synced" as const,
    providerStatus: "knowledge-provider-synced" as const,
    providerSyncId,
    indexId: knowledgeIndex.indexId,
  };
}

export async function maybePersistResourceReviewItemDomainObject(input: {
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
    input.receipt.operationId !== "knowledge-base" ||
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

  const { receipt } = await saveTeachingResourceReviewItemRecord({
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

export async function maybePersistCourseContentPublishDomainObject(input: {
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
    input.receipt.operationId !== "content" ||
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

  const { receipt } = await saveTeachingCourseContentPublishRecord({
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

export async function maybePublishCourseContentWithProvider(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  contentPersisted: boolean;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "content" ||
    input.receipt.actionSlot !== "primary" ||
    !input.courseId ||
    !input.contentPersisted
  ) {
    return undefined;
  }
  const providerConfig = readCourseContentPublishProviderConfig(input.env);
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
  });
  const contentId = `course-content-${input.courseId}`;
  const contentPackage = snapshot.database.contentPackages?.find(
    (item) =>
      item.contentId === contentId && item.operationRecordId === input.receipt.receiptId,
  );
  if (!contentPackage) {
    throw new TeachingCourseManagementStoreError(
      404,
      "Teaching course content publish record was not found.",
    );
  }
  if (
    contentPackage.providerStatus === "content-provider-published" &&
    contentPackage.providerPublishId
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
      action: "publish-course-content",
      actorId: input.authenticatedTeacher.actorId,
      courseId: input.courseId,
      traceId: input.traceId,
      operationRecordId: input.receipt.receiptId,
      contentId: contentPackage.contentId,
      releaseScope: contentPackage.releaseScope,
      publicationStatus: contentPackage.publicationStatus,
      publishedAt: contentPackage.publishedAt,
      redaction: createRedaction(),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!providerResponse.ok) {
    throw new TeachingCourseManagementStoreError(
      502,
      "Course content publish provider failed.",
    );
  }
  const providerBody = await providerResponse.json();
  const providerPublishId = readProviderPublishId(providerBody);

  const { receipt } = await markTeachingCourseContentProviderPublished({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    providerPublishId,
    audit: {
      requestSource: input.requestSource,
    },
    traceId: input.traceId,
    now: input.now,
  });

  return {
    ...receipt,
    action: "publish-course-content-provider" as const,
    status: "published" as const,
    providerStatus: "content-provider-published" as const,
    providerPublishId,
    contentId: contentPackage.contentId,
  };
}

export async function maybePersistCourseUnitDraftDomainObject(input: {
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
    input.receipt.operationId !== "content" ||
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

  const { receipt } = await saveTeachingCourseUnitDraftRecord({
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

export async function maybePersistDashboardRefreshDomainObject(input: {
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
    input.receipt.operationId !== "dashboard" ||
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

  const { receipt } = await saveTeachingCourseDashboardRefreshRecord({
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

export async function maybePersistDashboardSnapshotDomainObject(input: {
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
    input.receipt.operationId !== "dashboard" ||
    input.receipt.actionSlot !== "secondary" ||
    !input.courseId
  ) {
    return undefined;
  }
  const dashboardSnapshotArtifact = input.receipt.artifacts.find(
    (
      artifact,
    ): artifact is Extract<
      TeachingOperationReceipt["artifacts"][number],
      { kind: "dashboard-snapshot" }
    > => artifact.kind === "dashboard-snapshot",
  );
  if (!dashboardSnapshotArtifact) {
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

  const { receipt } = await saveTeachingCourseDashboardSnapshotRecord({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    teachingOperationSnapshotId: dashboardSnapshotArtifact.snapshotId,
    ...(input.receipt.sourceAction ? { sourceAction: input.receipt.sourceAction } : {}),
    audit: {
      requestSource: input.requestSource,
    },
    traceId: input.traceId,
    now: input.now,
  });
  return receipt;
}

export async function maybePersistQuizAssessmentDomainObject(input: {
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
    input.receipt.operationId !== "quiz-board" ||
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

  const { receipt } = await saveTeachingCourseQuizAssessmentRecord({
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

export async function maybePersistQuizItemReviewDomainObject(input: {
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
    input.receipt.operationId !== "quiz-board" ||
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

  const { receipt } = await saveTeachingCourseQuizItemReviewRecord({
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

export async function maybePersistAdminSettingsDomainObject(input: {
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

  const { receipt } = await saveTeachingAdminSettingsRecord({
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

export async function maybePersistAgentSettingsDomainObject(input: {
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
    input.receipt.operationId !== "agents" ||
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

  const { receipt } = await saveTeachingAgentSettingsRecord({
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

export async function maybePersistAgentPermissionPreflightDomainObject(input: {
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
    input.receipt.operationId !== "agents" ||
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

  const { receipt } = await saveTeachingAgentPermissionPreflightRecord({
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
