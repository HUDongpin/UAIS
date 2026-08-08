import { resolve } from "node:path";

// Filesystem path resolvers for the external-storage route service (Phase 3
// decomposition). Every resolver funnels through ensureWithinBase so a crafted
// teacherId/backupId cannot escape the configured data directory. Pure — depends
// only on node:path — so the service's read/write helpers import these instead of
// carrying ~130 lines of path plumbing inline.

export function resolveTeacherOwnershipPath(dataDir: string, teacherId: string) {
  const filePath = resolve(dataDir, "teacher-ai-ownership", `${teacherId}.json`);
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

export function resolveLifecycleAuditPath(dataDir: string) {
  const filePath = resolve(dataDir, "qwen-voice-lifecycle-audit.jsonl");
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

export function resolveTeachingCourseManagementSnapshotPath(dataDir: string) {
  const filePath = resolve(dataDir, "teaching-course-management", "database.json");
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

export function resolveTeachingCourseAssetsSnapshotPath(dataDir: string) {
  const filePath = resolve(dataDir, "teaching-course-assets", "database.json");
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

export function resolveLearningChatroomTranscriptsSnapshotPath(dataDir: string) {
  const filePath = resolve(dataDir, "learning-chatroom-transcripts", "database.json");
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

export function resolveTeachingCourseManagementBackupPath(dataDir: string, backupId: string) {
  const filePath = resolve(
    dataDir,
    "teaching-course-management-backups",
    `${backupId}.json`,
  );
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

export function resolveTeachingCourseManagementRestoreDrillLogPath(dataDir: string) {
  const filePath = resolve(dataDir, "teaching-course-management-restore-drills.jsonl");
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

export function resolveTeachingCourseAssetsBackupPath(dataDir: string, backupId: string) {
  const filePath = resolve(dataDir, "teaching-course-assets-backups", `${backupId}.json`);
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

export function resolveTeachingCourseAssetsRestoreDrillLogPath(dataDir: string) {
  const filePath = resolve(dataDir, "teaching-course-assets-restore-drills.jsonl");
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

export function resolveTeachingOperationLogPath(dataDir: string, teacherId: string) {
  const filePath = resolve(dataDir, "teaching-operations", `${teacherId}.jsonl`);
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

export function resolveTeachingOperationAuditLogPath(dataDir: string, teacherId: string) {
  const filePath = resolve(dataDir, "teaching-operations-audit", `${teacherId}.jsonl`);
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

export function resolveTeachingOperationAlertNotificationLogPath(
  dataDir: string,
  teacherId: string,
) {
  const filePath = resolve(
    dataDir,
    "teaching-operation-alert-notifications",
    `${teacherId}.jsonl`,
  );
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

export function resolveTeachingOperationAlertWebhookDeliveryLogPath(
  dataDir: string,
  teacherId: string,
) {
  const filePath = resolve(
    dataDir,
    "teaching-operation-alert-webhook-deliveries",
    `${teacherId}.jsonl`,
  );
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

export function resolveTeachingOperationRollbackLogPath(dataDir: string, teacherId: string) {
  const filePath = resolve(
    dataDir,
    "teaching-operation-rollbacks",
    `${teacherId}.jsonl`,
  );
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

export function resolveTeachingOperationBackupPath(
  dataDir: string,
  teacherId: string,
  backupId: string,
) {
  const filePath = resolve(
    dataDir,
    "teaching-operation-backups",
    teacherId,
    `${backupId}.json`,
  );
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

export function resolveTeachingOperationRestoreDrillLogPath(
  dataDir: string,
  teacherId: string,
) {
  const filePath = resolve(
    dataDir,
    "teaching-operation-restore-drills",
    `${teacherId}.jsonl`,
  );
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

export function ensureWithinBase(baseDir: string, targetPath: string) {
  if (targetPath !== baseDir && !targetPath.startsWith(`${baseDir}/`)) {
    throw new Error("Resolved external storage path escapes the configured data directory.");
  }
}
