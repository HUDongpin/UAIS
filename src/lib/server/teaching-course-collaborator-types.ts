export const TEACHING_COURSE_COLLABORATOR_ROLES = [
  "observer",
  "reviewer",
  "teaching-assistant",
  "co-instructor",
] as const;

export type TeachingCourseCollaboratorRole =
  (typeof TEACHING_COURSE_COLLABORATOR_ROLES)[number];

export const TEACHING_COURSE_DELEGATABLE_CAPABILITIES = [
  "course.read",
  "course.content.write",
  "course.students.manage",
  "course.grading.manage",
  "course.settings.manage",
  "course.export",
] as const;

export type TeachingCourseDelegatableCapability =
  (typeof TEACHING_COURSE_DELEGATABLE_CAPABILITIES)[number];

export const TEACHING_COURSE_COLLABORATOR_ROLE_CEILINGS = {
  observer: ["course.read"],
  reviewer: ["course.read", "course.grading.manage"],
  "teaching-assistant": [
    "course.read",
    "course.content.write",
    "course.students.manage",
    "course.grading.manage",
  ],
  "co-instructor": [
    "course.read",
    "course.content.write",
    "course.students.manage",
    "course.grading.manage",
    "course.settings.manage",
    "course.export",
  ],
} as const satisfies Record<
  TeachingCourseCollaboratorRole,
  readonly TeachingCourseDelegatableCapability[]
>;

export const TEACHING_COURSE_COLLABORATOR_GRANT_STATUSES = [
  "active",
  "expired",
  "revoked",
] as const;

export type TeachingCourseCollaboratorGrantStatus =
  (typeof TEACHING_COURSE_COLLABORATOR_GRANT_STATUSES)[number];

export const TEACHING_COURSE_COLLABORATOR_EVENTS = [
  "grant-issued",
  "grant-revoked",
] as const;

export type TeachingCourseCollaboratorEvent =
  (typeof TEACHING_COURSE_COLLABORATOR_EVENTS)[number];

export const TEACHING_COURSE_COLLABORATOR_OUTBOX_STATUSES = [
  "pending",
  "processing",
  "sent",
  "failed",
  "dead",
] as const;

export type TeachingCourseCollaboratorOutboxStatus =
  (typeof TEACHING_COURSE_COLLABORATOR_OUTBOX_STATUSES)[number];

export type TeachingCourseCollaboratorGrantPolicy = {
  role: TeachingCourseCollaboratorRole;
  scopes: TeachingCourseDelegatableCapability[];
  grantedAt: string;
  expiresAt?: string;
};

export type TeachingCourseCollaboratorGrant = {
  grantId: string;
  courseId: string;
  recipientUserId: string;
  grantedByUserId: string;
  role: TeachingCourseCollaboratorRole;
  scopes: TeachingCourseDelegatableCapability[];
  status: TeachingCourseCollaboratorGrantStatus;
  revision: number;
  grantedAt: string;
  expiresAt?: string;
  revokedAt?: string;
  revokedByUserId?: string;
};

// Deliberately closed and address-free. Delivery routing stays internal to the
// grant/outbox store; persisted or returned receipts expose only the user UUID.
export type TeachingCourseCollaboratorPersistedReceipt = {
  status: "persisted";
  event: TeachingCourseCollaboratorEvent;
  grantId: string;
  courseId: string;
  recipientUserId: string;
  role: TeachingCourseCollaboratorRole;
  scopes: TeachingCourseDelegatableCapability[];
  grantStatus: TeachingCourseCollaboratorGrantStatus;
  revision: number;
  grantedAt: string;
  expiresAt?: string;
  revokedAt?: string;
  traceId: string;
  persistedAt: string;
};

export type TeachingCourseCollaboratorAlreadyActiveReceipt = {
  status: "already-active";
  grantId: string;
  courseId: string;
  recipientUserId: string;
  role: TeachingCourseCollaboratorRole;
  scopes: TeachingCourseDelegatableCapability[];
  grantStatus: "active";
  revision: number;
  grantedAt: string;
  expiresAt?: string;
  traceId: string;
  persistedAt: string;
};

export type TeachingCourseCollaboratorReceipt =
  | TeachingCourseCollaboratorPersistedReceipt
  | TeachingCourseCollaboratorAlreadyActiveReceipt;

const explicitOffsetTimestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export class TeachingCourseCollaboratorValidationError extends Error {
  readonly reasonCode: string;

  constructor(reasonCode: string) {
    super(reasonCode);
    this.name = "TeachingCourseCollaboratorValidationError";
    this.reasonCode = reasonCode;
  }
}

export function isTeachingCourseCollaboratorRole(
  value: unknown,
): value is TeachingCourseCollaboratorRole {
  return (
    typeof value === "string" &&
    TEACHING_COURSE_COLLABORATOR_ROLES.some((role) => role === value)
  );
}

export function isTeachingCourseDelegatableCapability(
  value: unknown,
): value is TeachingCourseDelegatableCapability {
  return (
    typeof value === "string" &&
    TEACHING_COURSE_DELEGATABLE_CAPABILITIES.some(
      (capability) => capability === value,
    )
  );
}

export function normalizeTeachingCourseCollaboratorRoleAndScopes(input: {
  role: unknown;
  scopes: unknown;
}): Pick<TeachingCourseCollaboratorGrantPolicy, "role" | "scopes"> {
  if (!isTeachingCourseCollaboratorRole(input.role)) {
    throw new TeachingCourseCollaboratorValidationError("role-unknown");
  }
  if (!Array.isArray(input.scopes) || input.scopes.length === 0) {
    throw new TeachingCourseCollaboratorValidationError("scope-required");
  }

  const scopes = input.scopes.map((scope) =>
    typeof scope === "string" ? scope.trim() : scope,
  );
  if (!scopes.every(isTeachingCourseDelegatableCapability)) {
    throw new TeachingCourseCollaboratorValidationError("scope-unknown");
  }
  const normalizedScopes = [...new Set(scopes)].sort() as TeachingCourseDelegatableCapability[];
  const ceiling: readonly TeachingCourseDelegatableCapability[] =
    TEACHING_COURSE_COLLABORATOR_ROLE_CEILINGS[input.role];
  if (normalizedScopes.some((scope) => !ceiling.includes(scope))) {
    throw new TeachingCourseCollaboratorValidationError(
      "scope-exceeds-role-ceiling",
    );
  }

  return { role: input.role, scopes: normalizedScopes };
}

export function normalizeTeachingCourseCollaboratorGrantPolicy(input: {
  role: unknown;
  scopes: unknown;
  grantedAt: unknown;
  expiresAt?: unknown;
}): TeachingCourseCollaboratorGrantPolicy {
  const assignment = normalizeTeachingCourseCollaboratorRoleAndScopes(input);

  const grantedAt = normalizeIsoTimestamp(input.grantedAt, "granted-at-invalid");
  if (input.expiresAt === undefined || input.expiresAt === null) {
    return { ...assignment, grantedAt };
  }
  const expiresAt = normalizeTeachingCourseCollaboratorExpiryTimestamp(
    input.expiresAt,
  );
  if (Date.parse(expiresAt) <= Date.parse(grantedAt)) {
    throw new TeachingCourseCollaboratorValidationError(
      "expiry-must-follow-grant",
    );
  }
  return {
    ...assignment,
    grantedAt,
    expiresAt,
  };
}

export function normalizeTeachingCourseCollaboratorExpiryTimestamp(
  value: unknown,
) {
  return normalizeIsoTimestamp(value, "expiry-invalid");
}

export function getTeachingCourseCollaboratorGrantStatus(
  input: { expiresAt?: string; revokedAt?: string },
  now: Date = new Date(),
): TeachingCourseCollaboratorGrantStatus {
  if (input.revokedAt) return "revoked";
  if (!input.expiresAt) return "active";
  const nowTimestamp = now.getTime();
  const expiresAt = Date.parse(input.expiresAt);
  return !Number.isFinite(nowTimestamp) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= nowTimestamp
    ? "expired"
    : "active";
}

export function createTeachingCourseCollaboratorPersistedReceipt(input: {
  grant: TeachingCourseCollaboratorGrant;
  event: TeachingCourseCollaboratorEvent;
  traceId: string;
  persistedAt: string;
}): TeachingCourseCollaboratorPersistedReceipt {
  const { grant } = input;
  return {
    status: "persisted",
    event: input.event,
    grantId: grant.grantId,
    courseId: grant.courseId,
    recipientUserId: grant.recipientUserId,
    role: grant.role,
    scopes: [...grant.scopes],
    grantStatus: grant.status,
    revision: grant.revision,
    grantedAt: grant.grantedAt,
    ...(grant.expiresAt ? { expiresAt: grant.expiresAt } : {}),
    ...(grant.revokedAt ? { revokedAt: grant.revokedAt } : {}),
    traceId: input.traceId,
    persistedAt: normalizeIsoTimestamp(input.persistedAt, "persisted-at-invalid"),
  };
}

export function createTeachingCourseCollaboratorAlreadyActiveReceipt(input: {
  grant: TeachingCourseCollaboratorGrant;
  traceId: string;
  persistedAt: string;
}): TeachingCourseCollaboratorAlreadyActiveReceipt {
  if (input.grant.status !== "active") {
    throw new TeachingCourseCollaboratorValidationError(
      "already-active-receipt-invalid",
    );
  }
  return {
    status: "already-active",
    grantId: input.grant.grantId,
    courseId: input.grant.courseId,
    recipientUserId: input.grant.recipientUserId,
    role: input.grant.role,
    scopes: [...input.grant.scopes],
    grantStatus: "active",
    revision: input.grant.revision,
    grantedAt: input.grant.grantedAt,
    ...(input.grant.expiresAt ? { expiresAt: input.grant.expiresAt } : {}),
    traceId: input.traceId,
    persistedAt: normalizeIsoTimestamp(input.persistedAt, "persisted-at-invalid"),
  };
}

export function normalizeTeachingCourseCollaboratorPersistedReceipt(
  value: unknown,
): TeachingCourseCollaboratorReceipt {
  const receipt = readRecord(value, "idempotency-receipt-invalid");
  const isPersisted = receipt.status === "persisted";
  const isAlreadyActive = receipt.status === "already-active";
  if (
    (!isPersisted && !isAlreadyActive) ||
    (isPersisted &&
      !TEACHING_COURSE_COLLABORATOR_EVENTS.includes(
        receipt.event as TeachingCourseCollaboratorEvent,
      )) ||
    !TEACHING_COURSE_COLLABORATOR_GRANT_STATUSES.includes(
      receipt.grantStatus as TeachingCourseCollaboratorGrantStatus,
    ) ||
    (isAlreadyActive && receipt.grantStatus !== "active") ||
    !Number.isInteger(receipt.revision) ||
    Number(receipt.revision) <= 0
  ) {
    throw new TeachingCourseCollaboratorValidationError(
      "idempotency-receipt-invalid",
    );
  }
  const policy = normalizeTeachingCourseCollaboratorGrantPolicy({
    role: receipt.role,
    scopes: receipt.scopes,
    grantedAt: receipt.grantedAt,
    expiresAt: receipt.expiresAt,
  });
  const grantId = requireNonEmptyString(receipt.grantId);
  const courseId = requireNonEmptyString(receipt.courseId);
  const recipientUserId = requireNonEmptyString(receipt.recipientUserId);
  const traceId = requireNonEmptyString(receipt.traceId);
  if (!grantId || !courseId || !recipientUserId || !traceId) {
    throw new TeachingCourseCollaboratorValidationError(
      "idempotency-receipt-invalid",
    );
  }
  const revokedAt = receipt.revokedAt
    ? normalizeIsoTimestamp(receipt.revokedAt, "idempotency-receipt-invalid")
    : undefined;
  const lifecycleIsConsistent = isAlreadyActive
    ? receipt.grantStatus === "active" && !revokedAt
    : receipt.event === "grant-issued"
      ? receipt.grantStatus === "active" && !revokedAt
      : receipt.event === "grant-revoked" &&
        receipt.grantStatus === "revoked" &&
        Boolean(revokedAt);
  if (!lifecycleIsConsistent) {
    throw new TeachingCourseCollaboratorValidationError(
      "idempotency-receipt-invalid",
    );
  }
  const common = {
    grantId,
    courseId,
    recipientUserId,
    role: policy.role,
    scopes: policy.scopes,
    grantStatus: receipt.grantStatus as TeachingCourseCollaboratorGrantStatus,
    revision: Number(receipt.revision),
    grantedAt: policy.grantedAt,
    ...(policy.expiresAt ? { expiresAt: policy.expiresAt } : {}),
    ...(revokedAt ? { revokedAt } : {}),
    traceId,
    persistedAt: normalizeIsoTimestamp(
      receipt.persistedAt,
      "idempotency-receipt-invalid",
    ),
  };
  return isAlreadyActive
    ? {
        status: "already-active",
        ...common,
        grantStatus: "active",
      }
    : {
        status: "persisted",
        event: receipt.event as TeachingCourseCollaboratorEvent,
        ...common,
      };
}

function normalizeIsoTimestamp(value: unknown, reasonCode: string) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  if (
    typeof value !== "string" ||
    !explicitOffsetTimestampPattern.test(value)
  ) {
    throw new TeachingCourseCollaboratorValidationError(reasonCode);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new TeachingCourseCollaboratorValidationError(reasonCode);
  }
  return new Date(timestamp).toISOString();
}

function readRecord(value: unknown, reasonCode: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TeachingCourseCollaboratorValidationError(reasonCode);
  }
  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
