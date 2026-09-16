import { isCourseSettingsPrimarySave } from "./teaching-page-inline-receipt-guards";

// Write-path student-preview-session helpers for course-settings secondary.
// The operations receipt already carries a student-preview artifact; the course-
// management receipt should echo the same generated-session fields. The client
// uses either source so a persisted preview can open previewUrl even when the
// unscoped audit GET is still incomplete (#21 family / #24 / #26).
// Secondary persistConfirmed also follows primary best-effort: a domain write
// that persisted student-preview-session is enough, even if the receipt is bare.

export type TeachingStudentPreviewArtifactLike = {
  kind?: string;
  previewId?: unknown;
  previewUrl?: unknown;
};

export type TeachingStudentPreviewSessionReceiptLike = {
  objectType?: unknown;
  previewStatus?: unknown;
  previewUrl?: unknown;
  previewId?: unknown;
  previewScope?: unknown;
  previewPolicy?: unknown;
  previewedBy?: unknown;
  generatedAt?: unknown;
};

export type TeachingDomainPersistenceSummaryLike = {
  status?: "persisted" | "missing-domain-objects" | "not-required";
  persistedObjectTypes?: string[];
};

export type GeneratedStudentPreviewSession = {
  objectType: "student-preview-session";
  previewStatus: "generated";
  previewUrl: string;
  previewId?: string;
  previewScope?: string;
  previewPolicy?: string;
  previewedBy?: string;
  generatedAt?: string;
};

export type CourseSettingsPersistConfirmationInput = {
  operationId?: string;
  actionSlot?: "primary" | "secondary";
  artifacts?: TeachingStudentPreviewArtifactLike[];
  studentPreviewSessionReceipt?: TeachingStudentPreviewSessionReceiptLike;
  domainPersistenceSummary?: TeachingDomainPersistenceSummaryLike;
  courseId?: string;
};

export function isCourseSettingsStudentPreview(
  operationId: string | undefined,
  actionSlot: "primary" | "secondary" | undefined,
) {
  return operationId === "course-settings" && actionSlot === "secondary";
}

export function resolveCourseSettingsPersistConfirmation(
  input: CourseSettingsPersistConfirmationInput,
) {
  const generatedPreview = readGeneratedStudentPreviewSession(input);
  const persistConfirmed =
    isCourseSettingsPrimarySave(input.operationId, input.actionSlot) ||
    Boolean(generatedPreview) ||
    isCourseSettingsSecondaryDomainPersisted(input);
  const previewUrl = isCourseSettingsStudentPreview(input.operationId, input.actionSlot)
    ? (generatedPreview?.previewUrl ??
      (persistConfirmed ? readFallbackTeachingStudentPreviewUrl(input.courseId) : undefined))
    : undefined;
  return {
    generatedPreview,
    persistConfirmed,
    previewUrl,
  };
}

export function confirmAndOpenCourseSettingsStudentPreview(
  input: CourseSettingsPersistConfirmationInput,
) {
  const confirmation = resolveCourseSettingsPersistConfirmation(input);
  if (confirmation.previewUrl) {
    openTeachingStudentPreviewUrl(confirmation.previewUrl);
  }
  return confirmation;
}

export function isSafeTeachingStudentPreviewUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.includes("/Users/") &&
    value.trim().length > 0
  );
}

export function readGeneratedStudentPreviewSession(input: {
  operationId?: string;
  actionSlot?: "primary" | "secondary";
  artifacts?: TeachingStudentPreviewArtifactLike[];
  studentPreviewSessionReceipt?: TeachingStudentPreviewSessionReceiptLike;
}): GeneratedStudentPreviewSession | undefined {
  if (!isCourseSettingsStudentPreview(input.operationId, input.actionSlot)) {
    return undefined;
  }

  const receipt = input.studentPreviewSessionReceipt;
  const receiptUrl = readSafePreviewUrl(receipt?.previewUrl);
  const previewArtifact = input.artifacts?.find(
    (artifact) =>
      artifact.kind === "student-preview" && isSafeTeachingStudentPreviewUrl(artifact.previewUrl),
  );
  const artifactUrl = readSafePreviewUrl(previewArtifact?.previewUrl);
  const previewUrl = receiptUrl ?? artifactUrl;
  if (!previewUrl) {
    return undefined;
  }

  const receiptLooksGenerated =
    receipt?.objectType === "student-preview-session" && receipt.previewStatus === "generated";
  if (receipt && !receiptLooksGenerated && !previewArtifact) {
    return undefined;
  }
  if (receipt && receipt.previewStatus && receipt.previewStatus !== "generated") {
    return undefined;
  }

  return {
    objectType: "student-preview-session",
    previewStatus: "generated",
    previewUrl,
    ...optionalPreviewField("previewId", previewArtifact?.previewId ?? receipt?.previewId),
    ...optionalPreviewField("previewScope", receipt?.previewScope),
    ...optionalPreviewField("previewPolicy", receipt?.previewPolicy),
    ...optionalPreviewField("previewedBy", receipt?.previewedBy),
    ...optionalPreviewField("generatedAt", receipt?.generatedAt),
  };
}

export function openTeachingStudentPreviewUrl(previewUrl: string) {
  const safePreviewUrl = readSafePreviewUrl(previewUrl);
  if (!safePreviewUrl) {
    return;
  }
  window.location.assign(safePreviewUrl);
}

export function readFallbackTeachingStudentPreviewUrl(courseId: unknown) {
  if (typeof courseId !== "string" || courseId.trim().length === 0) {
    return undefined;
  }
  return readSafePreviewUrl(
    `/learning?teacherPreview=1&course=${encodeURIComponent(courseId.trim())}`,
  );
}

function isCourseSettingsSecondaryDomainPersisted(
  input: CourseSettingsPersistConfirmationInput,
) {
  return (
    isCourseSettingsStudentPreview(input.operationId, input.actionSlot) &&
    input.domainPersistenceSummary?.status === "persisted" &&
    Boolean(
      input.domainPersistenceSummary.persistedObjectTypes?.includes("student-preview-session"),
    )
  );
}

function readSafePreviewUrl(value: unknown) {
  return isSafeTeachingStudentPreviewUrl(value) ? value.trim() : undefined;
}

function optionalPreviewField<K extends string>(key: K, value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? ({ [key]: value.trim() } as Record<K, string>)
    : {};
}
