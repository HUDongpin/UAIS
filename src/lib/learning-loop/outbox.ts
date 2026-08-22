import { createHash } from "node:crypto";

const retryDelaysMs = [60_000, 300_000, 900_000, 3_600_000, 21_600_000] as const;

export function getLearningOutboxRetryDelayMs(attemptCount: number) {
  const normalizedAttempt = Math.max(1, Math.floor(attemptCount));
  return retryDelaysMs[Math.min(normalizedAttempt - 1, retryDelaysMs.length - 1)];
}

export function createDeterministicXapiStatementId(learningEventId: string) {
  const bytes = Buffer.from(
    createHash("sha256").update(`uais-learning-event:${learningEventId}`).digest().subarray(0, 16),
  );
  // UUIDv4 shape, with deterministic bytes. xAPI needs a stable UUID; the
  // version/variant bits keep it accepted by LRS implementations that validate
  // the canonical UUID form.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
