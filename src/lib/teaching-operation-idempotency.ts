type CreateTeachingOperationIdempotencyKeyInput = {
  operationId: string;
  actionSlot: "primary" | "secondary";
  courseId?: string;
  sourceAction?: string;
};

const maxTeachingOperationIdempotencyKeyLength = 120;

export function createTeachingOperationIdempotencyKey(
  input: CreateTeachingOperationIdempotencyKeyInput,
) {
  const nonce = createIdempotencyNonce();
  const prefix = [
    "teaching-operation",
    input.operationId,
    input.actionSlot,
    input.courseId ?? "course-unspecified",
    input.sourceAction ?? "source-unspecified",
  ]
    .map(sanitizeIdempotencyKeyPart)
    .join("-");
  const fullKey = `${prefix}-${nonce}`;
  if (fullKey.length <= maxTeachingOperationIdempotencyKeyLength) {
    return fullKey;
  }

  const prefixBudget = maxTeachingOperationIdempotencyKeyLength - nonce.length - 1;
  const trimmedPrefix =
    prefix.slice(0, prefixBudget).replace(/[-._]+$/g, "") || "teaching-operation";
  return `${trimmedPrefix}-${nonce}`;
}

function sanitizeIdempotencyKeyPart(value: string) {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[^a-zA-Z0-9]+/g, "")
    .slice(0, 64);
  return normalized || "unspecified";
}

function createIdempotencyNonce() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) {
    return uuid.replace(/-/g, "").slice(0, 16);
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
