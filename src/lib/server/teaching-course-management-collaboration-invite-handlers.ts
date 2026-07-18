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
  TeachingCourseCollaborationInviteNotificationRecord,
  TeachingCourseManagementAuditRequestSource,
  TeachingCourseManagementReceipt,
  TeachingCourseManagementRepository,
} from "@/lib/server/teaching-course-management-types";

// Collaboration-invite handler family for the teaching-course-management store
// (Phase 3 decomposition): invite notification, delivery marking, email delivery
// callback. Cycle-free: runtime deps are the extracted io/helpers/guards/error
// modules; store types are a type-only import.

export async function saveTeachingCollaborationInviteNotificationRecord(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  operationRecordId: string;
  outboxId: string;
  sourceAction?: string;
  traceId?: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  now?: Date;
}): Promise<{
  notification: TeachingCourseCollaborationInviteNotificationRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const outboxId = requireSafeId(input.outboxId, "outbox id");
  const sourceAction = input.sourceAction
    ? requireSafeId(input.sourceAction, "source action")
    : undefined;
  const now = input.now ?? new Date();
  const queuedAt = now.toISOString();
  const notificationId = `collaboration-invite-notification-${courseId}`;

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

    const notifications = database.collaborationInviteNotifications ?? [];
    const existingNotificationIndex = notifications.findIndex(
      (item) => item.notificationId === notificationId,
    );
    const existingNotification =
      existingNotificationIndex >= 0 ? notifications[existingNotificationIndex] : undefined;
    if (
      existingNotification?.operationRecordId === operationRecordId &&
      existingNotification.outboxId === outboxId
    ) {
      const receipt = createReceipt({
        action: "queue-collaboration-invite-notification",
        actorId,
        courseId,
        traceId: input.traceId,
        createdAt: existingNotification.queuedAt,
        storage,
      });
      return {
        notification: existingNotification,
        receipt,
      };
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: queuedAt,
    };

    const notification: TeachingCourseCollaborationInviteNotificationRecord = {
      notificationId,
      courseId,
      ownerTeacherId: course.ownerTeacherId,
      queuedBy: actorId,
      notificationStatus: "queued-for-provider",
      operationRecordId,
      ...(sourceAction ? { sourceAction } : {}),
      outboxId,
      deliveryChannel: "collaboration-invite-email",
      providerStatus: "smtp-provider-pending",
      deliveryPolicy: "server-outbox-before-smtp-provider",
      queuedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
    database.collaborationInviteNotifications =
      existingNotificationIndex >= 0
        ? notifications.map((item, index) =>
            index === existingNotificationIndex ? notification : item,
          )
        : [...notifications, notification];
    database.updatedAt = queuedAt;

    const receipt = createReceipt({
      action: "queue-collaboration-invite-notification",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt: queuedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "queue-collaboration-invite-notification",
      actorId,
      courseId,
      traceId: receipt.traceId,
      createdAt: queuedAt,
      requestSource: input.audit?.requestSource,
      storage,
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
        notification,
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

export async function markTeachingCollaborationInviteNotificationDelivered(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  operationRecordId: string;
  outboxId: string;
  providerDeliveryId: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  traceId?: string;
  now?: Date;
}): Promise<{
  notification: TeachingCourseCollaborationInviteNotificationRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const outboxId = requireSafeId(input.outboxId, "outbox id");
  const providerDeliveryId = requireSafeId(input.providerDeliveryId, "provider delivery id");
  const now = input.now ?? new Date();
  const deliveredAt = now.toISOString();
  const notificationId = `collaboration-invite-notification-${courseId}`;

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

    const notifications = database.collaborationInviteNotifications ?? [];
    const existingNotificationIndex = notifications.findIndex(
      (item) =>
        item.notificationId === notificationId &&
        item.operationRecordId === operationRecordId &&
        item.outboxId === outboxId,
    );
    if (existingNotificationIndex < 0) {
      throw new TeachingCourseManagementStoreError(
        404,
        "Teaching collaboration invite notification was not found.",
      );
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: deliveredAt,
    };

    const notification: TeachingCourseCollaborationInviteNotificationRecord = {
      ...notifications[existingNotificationIndex],
      notificationStatus: "delivered-to-provider",
      providerStatus: "smtp-provider-delivered",
      providerDeliveryId,
      deliveredAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      redaction: createRedaction(),
    };
    database.collaborationInviteNotifications = notifications.map((item, index) =>
      index === existingNotificationIndex ? notification : item,
    );
    database.updatedAt = deliveredAt;

    const receipt = createReceipt({
      action: "deliver-collaboration-invite-email",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt: deliveredAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "deliver-collaboration-invite-email",
      actorId,
      courseId,
      traceId: receipt.traceId,
      requestSource: input.audit?.requestSource,
      createdAt: deliveredAt,
      storage,
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
        notification,
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

export async function recordTeachingCollaborationInviteEmailDeliveryCallback(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  courseId: string;
  operationRecordId: string;
  outboxId: string;
  providerDeliveryId: string;
  providerStatus: "bounced";
  failureReason: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  traceId?: string;
  now?: Date;
}): Promise<{
  notification: TeachingCourseCollaborationInviteNotificationRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const outboxId = requireSafeId(input.outboxId, "outbox id");
  const providerDeliveryId = requireSafeId(input.providerDeliveryId, "provider delivery id");
  const failureReason = requireSafeId(input.failureReason, "delivery failure reason");
  const callbackAt = (input.now ?? new Date()).toISOString();
  const notificationId = `collaboration-invite-notification-${courseId}`;

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
    const notifications = database.collaborationInviteNotifications ?? [];
    const existingNotificationIndex = notifications.findIndex(
      (item) =>
        item.notificationId === notificationId &&
        item.operationRecordId === operationRecordId &&
        item.outboxId === outboxId &&
        item.providerDeliveryId === providerDeliveryId,
    );
    if (existingNotificationIndex < 0) {
      throw new TeachingCourseManagementStoreError(
        404,
        "Teaching collaboration invite notification delivery was not found.",
      );
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: callbackAt,
    };

    const notification: TeachingCourseCollaborationInviteNotificationRecord = {
      ...notifications[existingNotificationIndex],
      notificationStatus: "delivery-failed",
      providerStatus: "smtp-provider-bounced",
      providerDeliveryId,
      deliveryFailureReason: failureReason,
      providerCallbackAt: callbackAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      redaction: createRedaction(),
    };
    database.collaborationInviteNotifications = notifications.map((item, index) =>
      index === existingNotificationIndex ? notification : item,
    );
    database.updatedAt = callbackAt;

    const receipt = createReceipt({
      action: "record-collaboration-invite-email-delivery-callback",
      actorId: course.ownerTeacherId,
      courseId,
      traceId: input.traceId,
      createdAt: callbackAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "record-collaboration-invite-email-delivery-callback",
      actorId: course.ownerTeacherId,
      courseId,
      traceId: receipt.traceId,
      requestSource: input.audit?.requestSource,
      createdAt: callbackAt,
      storage,
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
        notification,
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
