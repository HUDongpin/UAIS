// Admin/agent settings handler family for the teaching-course-management store
// (Phase 3 decomposition): admin settings, agent settings, agent permission
// preflight. Cycle-free: runtime deps are the extracted io/helpers/guards/error
// modules; store types are a type-only import.

import { TeachingCourseManagementStoreError } from "./teaching-course-management-error";
import { createRedaction, requireSafeId } from "./teaching-course-management-guards";
import {
  createAuditEvent,
  createReceipt,
  isTeachingCourseManagementOptimisticSnapshotConflict,
} from "./teaching-course-management-helpers";
import {
  localTeachingCourseManagementStorage,
  readTeachingCourseManagementSnapshot,
  resolveTeachingCourseManagementDataDir,
  writeTeachingCourseManagementSnapshot,
} from "./teaching-course-management-io";
import type {
  TeachingCourseAdminSettingsRecord,
  TeachingCourseAgentPermissionPreflightRecord,
  TeachingCourseAgentSettingsRecord,
  TeachingCourseManagementAuditRequestSource,
  TeachingCourseManagementReceipt,
  TeachingCourseManagementRepository,
} from "@/lib/server/teaching-course-management-types";

export async function saveTeachingAdminSettingsRecord(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  operationRecordId: string;
  sourceAction?: string;
  traceId?: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  now?: Date;
}): Promise<{
  adminSettings: TeachingCourseAdminSettingsRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const sourceAction = input.sourceAction
    ? requireSafeId(input.sourceAction, "source action")
    : undefined;
  const now = input.now ?? new Date();
  const savedAt = now.toISOString();
  const adminSettingsId = `admin-settings-${courseId}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const courseIndex = database.courses.findIndex((course) => course.courseId === courseId);
    if (courseIndex < 0) {
      throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
    }

    const course = database.courses[courseIndex];
    if (course.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(
        403,
        "Teaching course ownership is required.",
      );
    }

    const adminSettingsRecords = database.adminSettings ?? [];
    const existingAdminSettingsIndex = adminSettingsRecords.findIndex(
      (item) => item.adminSettingsId === adminSettingsId,
    );
    const existingAdminSettings =
      existingAdminSettingsIndex >= 0 ? adminSettingsRecords[existingAdminSettingsIndex] : undefined;
    if (existingAdminSettings?.operationRecordId === operationRecordId) {
      const receipt = createReceipt({
        action: "save-admin-settings",
        actorId,
        courseId,
        traceId: input.traceId,
        createdAt: existingAdminSettings.savedAt,
        storage,
      });
      return {
        adminSettings: existingAdminSettings,
        receipt,
      };
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: savedAt,
    };

    const adminSettings: TeachingCourseAdminSettingsRecord = {
      adminSettingsId,
      courseId,
      ownerTeacherId: course.ownerTeacherId,
      savedBy: actorId,
      settingsStatus: "saved",
      operationRecordId,
      ...(sourceAction ? { sourceAction } : {}),
      adminScopes: ["course-collaborators", "permission-boundary", "audit-routing"],
      governancePolicy: "teacher-controlled-admin-settings",
      savedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
    database.adminSettings =
      existingAdminSettingsIndex >= 0
        ? adminSettingsRecords.map((item, index) =>
            index === existingAdminSettingsIndex ? adminSettings : item,
          )
        : [...adminSettingsRecords, adminSettings];
    database.updatedAt = savedAt;

    const receipt = createReceipt({
      action: "save-admin-settings",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt: savedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "save-admin-settings",
      actorId,
      courseId,
      traceId: receipt.traceId,
      createdAt: savedAt,
      storage,
      requestSource: input.audit?.requestSource,
    });
    database.auditEvents.push(auditEvent);

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return {
        adminSettings,
        receipt,
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function saveTeachingAgentSettingsRecord(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  operationRecordId: string;
  sourceAction?: string;
  traceId?: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  now?: Date;
}): Promise<{
  agentSettings: TeachingCourseAgentSettingsRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const sourceAction = input.sourceAction
    ? requireSafeId(input.sourceAction, "source action")
    : undefined;
  const now = input.now ?? new Date();
  const savedAt = now.toISOString();
  const agentSettingsId = `agent-settings-${courseId}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const courseIndex = database.courses.findIndex((course) => course.courseId === courseId);
    if (courseIndex < 0) {
      throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
    }

    const course = database.courses[courseIndex];
    if (course.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(
        403,
        "Teaching course ownership is required.",
      );
    }

    const agentSettingsRecords = database.agentSettings ?? [];
    const existingAgentSettingsIndex = agentSettingsRecords.findIndex(
      (item) => item.agentSettingsId === agentSettingsId,
    );
    const existingAgentSettings =
      existingAgentSettingsIndex >= 0 ? agentSettingsRecords[existingAgentSettingsIndex] : undefined;
    if (existingAgentSettings?.operationRecordId === operationRecordId) {
      const receipt = createReceipt({
        action: "save-agent-settings",
        actorId,
        courseId,
        traceId: input.traceId,
        createdAt: existingAgentSettings.savedAt,
        storage,
      });
      return {
        agentSettings: existingAgentSettings,
        receipt,
      };
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: savedAt,
    };

    const agentSettings: TeachingCourseAgentSettingsRecord = {
      agentSettingsId,
      courseId,
      ownerTeacherId: course.ownerTeacherId,
      savedBy: actorId,
      settingsStatus: "saved",
      operationRecordId,
      ...(sourceAction ? { sourceAction } : {}),
      agentScopes: ["research-agent", "method-agent", "writing-agent", "math-agent"],
      governancePolicy: "teacher-controlled-agent-settings",
      savedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
    database.agentSettings =
      existingAgentSettingsIndex >= 0
        ? agentSettingsRecords.map((item, index) =>
            index === existingAgentSettingsIndex ? agentSettings : item,
          )
        : [...agentSettingsRecords, agentSettings];
    database.updatedAt = savedAt;

    const receipt = createReceipt({
      action: "save-agent-settings",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt: savedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "save-agent-settings",
      actorId,
      courseId,
      traceId: receipt.traceId,
      createdAt: savedAt,
      storage,
      requestSource: input.audit?.requestSource,
    });
    database.auditEvents.push(auditEvent);

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return {
        agentSettings,
        receipt,
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function saveTeachingAgentPermissionPreflightRecord(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  operationRecordId: string;
  sourceAction?: string;
  traceId?: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  now?: Date;
}): Promise<{
  agentPermissionPreflight: TeachingCourseAgentPermissionPreflightRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const sourceAction = input.sourceAction
    ? requireSafeId(input.sourceAction, "source action")
    : undefined;
  const now = input.now ?? new Date();
  const checkedAt = now.toISOString();
  const preflightId = `agent-permission-preflight-${courseId}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const courseIndex = database.courses.findIndex((course) => course.courseId === courseId);
    if (courseIndex < 0) {
      throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
    }

    const course = database.courses[courseIndex];
    if (course.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(
        403,
        "Teaching course ownership is required.",
      );
    }

    const agentPermissionPreflightRecords = database.agentPermissionPreflights ?? [];
    const existingPreflightIndex = agentPermissionPreflightRecords.findIndex(
      (item) => item.preflightId === preflightId,
    );
    const existingPreflight =
      existingPreflightIndex >= 0 ? agentPermissionPreflightRecords[existingPreflightIndex] : undefined;
    if (existingPreflight?.operationRecordId === operationRecordId) {
      const receipt = createReceipt({
        action: "record-agent-permission-preflight",
        actorId,
        courseId,
        traceId: input.traceId,
        createdAt: existingPreflight.checkedAt,
        storage,
      });
      return {
        agentPermissionPreflight: existingPreflight,
        receipt,
      };
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: checkedAt,
    };

    const agentPermissionPreflight: TeachingCourseAgentPermissionPreflightRecord = {
      preflightId,
      courseId,
      ownerTeacherId: course.ownerTeacherId,
      checkedBy: actorId,
      preflightStatus: "passed",
      operationRecordId,
      ...(sourceAction ? { sourceAction } : {}),
      checkedPermissions: ["course-bindings", "agent-roles", "student-access"],
      preflightPolicy: "teacher-agent-permission-gate",
      checkedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
    database.agentPermissionPreflights =
      existingPreflightIndex >= 0
        ? agentPermissionPreflightRecords.map((item, index) =>
            index === existingPreflightIndex ? agentPermissionPreflight : item,
          )
        : [...agentPermissionPreflightRecords, agentPermissionPreflight];
    database.updatedAt = checkedAt;

    const receipt = createReceipt({
      action: "record-agent-permission-preflight",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt: checkedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "record-agent-permission-preflight",
      actorId,
      courseId,
      traceId: receipt.traceId,
      createdAt: checkedAt,
      storage,
      requestSource: input.audit?.requestSource,
    });
    database.auditEvents.push(auditEvent);

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return {
        agentPermissionPreflight,
        receipt,
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}
