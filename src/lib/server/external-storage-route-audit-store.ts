import { appendFile, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRedaction } from "./external-storage-route-guards";
import { ensureWithinBase, resolveTeachingOperationAuditLogPath } from "./external-storage-route-paths";
import { normalizeTeachingOperationAuditEvent, normalizeTeachingOperationAuditLedgerEntry } from "./external-storage-serialization";

export async function appendTeachingOperationAuditEvent(input: {
  dataDir: string;
  teacherId: string;
  auditEvent: ReturnType<typeof normalizeTeachingOperationAuditEvent>;
}) {
  const auditDir = resolve(input.dataDir, "teaching-operations-audit");
  ensureWithinBase(input.dataDir, auditDir);
  await mkdir(auditDir, { recursive: true });
  await appendFile(
    resolveTeachingOperationAuditLogPath(input.dataDir, input.teacherId),
    `${JSON.stringify({
      auditEvent: input.auditEvent,
      storagePolicy: "external-redacted-teaching-operation-audit-log",
      storageWritePolicy: "external-append-only-audit-log",
      responsibleSession: "S12",
      redaction: createRedaction(),
    })}\n`,
    "utf8",
  );
}

export async function listTeachingOperationAuditEvents(dataDir: string, teacherId: string) {
  const auditPath = resolveTeachingOperationAuditLogPath(dataDir, teacherId);
  const raw = await readFile(auditPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return "";
    }
    throw error;
  });
  const events = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      normalizeTeachingOperationAuditLedgerEntry(JSON.parse(line), teacherId),
    )
    .sort((left, right) => {
      const byTime = left.createdAt.localeCompare(right.createdAt);
      return byTime === 0 ? left.auditId.localeCompare(right.auditId) : byTime;
    });

  return {
    teacherId,
    eventType: "teaching-operation-audit",
    storagePolicy: "external-redacted-teaching-operation-audit-log",
    storageWritePolicy: "external-append-only-audit-log",
    recordCount: events.length,
    events,
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}
