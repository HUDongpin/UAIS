import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeachingPage } from "@/components/pages/teaching-page";

const mockPreferences = vi.hoisted(() => ({
  locale: "zh-CN" as "zh-CN" | "en-US",
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    onClick,
    ...props
  }: {
    href: string;
    children: ReactNode;
  } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      href={href}
      onClick={(event) => {
        onClick?.(event);
      }}
      {...props}
    >
      {children}
    </a>
  ),
}));

vi.mock("@/components/providers/app-preferences", () => ({
  useAppPreferences: () => ({
    locale: mockPreferences.locale,
    theme: "light",
    toggleLocale: vi.fn(),
    toggleTheme: vi.fn(),
  }),
}));

afterEach(() => {
  mockPreferences.locale = "zh-CN";
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

// Plan E9: the inline operations refuse to run until a course is explicitly
// chosen. The picker replaced a silent `courseCards[0]` fallback, so every test
// that used to rely on that fallback now names the same course out loud.
async function chooseWorkspaceCourse(courseId: string) {
  const courseSelect = screen.getByLabelText(
    mockPreferences.locale === "zh-CN" ? "工作台操作课程" : "Course for workspace actions",
  );
  // A course only becomes selectable once it is in the workspace's list, which for
  // a persisted course means after the signed course readback lands.
  await waitFor(() => {
    expect(courseSelect.querySelector(`option[value="${courseId}"]`)).toBeTruthy();
  });
  fireEvent.change(courseSelect, { target: { value: courseId } });
}

// The invite actions target one class. The class list arrives with the signed
// course readback, so a click fired before that lands is refused on purpose;
// these tests wait for the target to resolve rather than for a fallback to guess.
async function waitForInviteClassTarget() {
  await waitFor(() => {
    expect(
      (screen.getByLabelText("操作班级") as HTMLSelectElement).value,
    ).not.toBe("");
  });
}

// A signed course readback carrying the demo research-methods course together
// with its one class, so the invite workspace has a real class to target instead
// of the first-class fallback plan E9 removed.
function createResearchMethodsClassCourseListReadback() {
  return Response.json({
    courses: [
      {
        courseId: "teacher-research-methods",
        courseName: "大学研究方法",
        instructor: "康霞",
        unit: "广州大学（404）",
        department: "实验教学中心",
        semester: "2026 春季",
        students: 32,
      },
    ],
    classes: [
      {
        classId: "teacher-research-methods-class-1",
        courseId: "teacher-research-methods",
        className: "研究方法一班",
        students: 32,
        semester: "2026 春季",
        invitationCode: "55395057",
      },
    ],
    receipt: {
      action: "list-courses",
      actorId: "teacher-kang",
      status: "read",
      responsibleSession: "S12",
    },
  });
}

// Plan E9 roster fixtures: one class whose waiting/approved/closed rows the
// bulk-approve, reject and remove controls act on.
function createBulkRosterCourseListReadback(
  pendingStudents: string[],
  approvePending: boolean,
  closedStudents: string[] = [],
  approvedStudents: string[] = [],
  invitePolicy?: {
    inviteExpiresAt?: string;
    inviteMaxJoins?: number;
    inviteDisabled?: boolean;
  },
  extraClasses: Array<{ classId: string; className: string }> = [],
) {
  const classId = "teacher-course-enterprise-operations-20260623-class-1";
  const courseId = "teacher-course-enterprise-operations-20260623";
  const membership = (studentId: string, membershipStatus: string) => ({
    membershipId: `membership-${studentId}`,
    courseId,
    classId,
    invitationCode: "66334455",
    studentId,
    studentDisplayName: studentId,
    membershipStatus,
    joinedAt: "2026-06-23T08:10:00.000Z",
  });
  const closed = new Set(closedStudents);
  return Response.json({
    courses: [
      {
        courseId,
        courseName: "企业级普通教学管理",
        instructor: "康霞",
        unit: "广州大学（404）",
        department: "实验教学中心",
        semester: "2026 春季",
        students: 12,
      },
    ],
    classes: [
      {
        classId,
        courseId,
        className: "企业管理实验班",
        students: 12,
        semester: "2026 春季",
        invitationCode: "66334455",
        joinUrl: "/courses?invite=66334455",
        ...(invitePolicy ?? {}),
      },
      ...extraClasses.map((extraClass) => ({
        classId: extraClass.classId,
        courseId,
        className: extraClass.className,
        students: 0,
        semester: "2026 春季",
        invitationCode: "66334456",
      })),
    ],
    memberships: [
      ...pendingStudents.map((studentId) =>
        membership(
          studentId,
          closed.has(studentId)
            ? "rejected"
            : approvePending
              ? "approved"
              : "pending-teacher-review",
        ),
      ),
      ...approvedStudents.map((studentId) =>
        membership(studentId, closed.has(studentId) ? "removed" : "approved"),
      ),
    ],
    receipt: {
      action: "list-courses",
      actorId: "teacher-kang",
      status: "read",
      traceId: "trace-list-courses",
    },
  });
}

function openAgentWorkspace() {
  fireEvent.click(screen.getByRole("link", { name: "智能体配置" }));
}

function createSignedTeachingCourseListReadback(actorId = "teacher-kang") {
  return Response.json({
    courses: [],
    classes: [],
    memberships: [],
    receipt: {
      action: "list-courses",
      actorId,
      status: "read",
      traceId: "trace-list-courses",
    },
  });
}

async function waitForSignedTeachingCourseListReadback(fetchMock: ReturnType<typeof vi.fn>) {
  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/teaching/courses",
      expect.objectContaining({ method: "GET" }),
    );
  });
}

function createRedactedTeacherAiSessionResponse(init?: RequestInit) {
  const body = JSON.parse(String(init?.body ?? "{}")) as { action?: string };
  const action = body.action ?? "unknown";
  return Response.json({
    accessSession: {
      headers: {
        "x-uais-access-claims": `redacted-claims-${action}`,
        "x-uais-access-signature": `redacted-signature-${action}`,
      },
    },
    accessPlan: {
      action,
      redaction: { secrets: "omitted", localFiles: "omitted", assets: "ids-only" },
    },
  });
}

const testInlineOperationDomainObjectTypes = {
  "course-settings": {
    primary: ["course-settings"],
    secondary: ["student-preview-session"],
  },
  agents: {
    primary: ["agent-plan"],
    secondary: ["permission-preflight"],
  },
  "knowledge-base": {
    primary: ["knowledge-index"],
    secondary: ["resource-review-item"],
  },
  content: {
    primary: ["course-content"],
    secondary: ["unit-draft"],
  },
  admins: {
    primary: ["admin-settings"],
    secondary: ["email-notification"],
  },
  students: {
    primary: ["student-roster"],
    secondary: ["group-suggestions"],
  },
  "data-export": {
    primary: ["export-manifest"],
    secondary: ["redaction-validation"],
  },
  dashboard: {
    primary: ["dashboard-state"],
    secondary: ["dashboard-snapshot"],
  },
  "quiz-board": {
    primary: ["quiz-board-state"],
    secondary: ["quiz-item-review"],
  },
  grading: {
    primary: ["grading-queue", "gradebook-update"],
    secondary: ["ai-feedback-draft"],
  },
  "invite-code": {
    primary: ["invite-code-draft"],
    secondary: ["enrollment-access"],
  },
} as const;

function createPersistedDomainPersistenceSummary(
  operationReceiptId: string,
  objectTypes: readonly string[] = ["course-settings"],
) {
  return {
    status: "persisted",
    required: true,
    operationReceiptId,
    expectedObjectTypes: [...objectTypes],
    persistedObjectTypes: [...objectTypes],
    missingObjectTypes: [],
  };
}

function createPersistedInlineOperationDomainPersistenceSummary(
  operationReceiptId: string,
  operationId: string,
  actionSlot: "primary" | "secondary",
) {
  const byAction =
    testInlineOperationDomainObjectTypes[
      operationId as keyof typeof testInlineOperationDomainObjectTypes
    ];
  return createPersistedDomainPersistenceSummary(
    operationReceiptId,
    byAction?.[actionSlot] ?? ["teaching-operation"],
  );
}

function getTestInlineOperationDomainObjectTypes(
  operationId: string,
  actionSlot: "primary" | "secondary",
) {
  const byAction =
    testInlineOperationDomainObjectTypes[
      operationId as keyof typeof testInlineOperationDomainObjectTypes
    ];
  return byAction?.[actionSlot] ?? ["teaching-operation"];
}

function createInlineAuditAuthSession() {
  return {
    sessionId: "teacher-inline-session",
    authenticatedAt: "2026-06-22T10:40:00.000Z",
    expiresAt: "2026-06-22T11:40:00.000Z",
  };
}

function createSignedInlineOperationReceiptAudit() {
  return {
    authMode: "signed-teacher-session",
    authSession: createInlineAuditAuthSession(),
  };
}

function createVerifiedInlineOperationAuditReadbackResponse(input: {
  traceId: string;
  recordId: string;
  operationId: string;
  actionSlot: "primary" | "secondary";
  courseId?: string;
}) {
  const courseId = input.courseId ?? "teacher-research-methods";
  const objectTypes = getTestInlineOperationDomainObjectTypes(
    input.operationId,
    input.actionSlot,
  );
  const domainProjections = objectTypes.map((objectType) => ({
      objectId: `${objectType}-${courseId}`,
      objectType,
      courseId,
      operationRecordId: input.recordId,
      ...(objectType === "course-settings"
        ? {
            updatedBy: "teacher-kang",
            status: "saved",
            updatedAt: "2026-06-22T10:40:00.000Z",
          }
        : {}),
      // The roster action recounts local membership rows and imports nothing, so
      // the projection the workspace verifies says `local-recount` over local
      // sources. A response still claiming `synced` from an `sis-roster` is now
      // an UNVERIFIED projection, which is what the fixture below pins.
      ...(objectType === "student-roster"
        ? {
            syncedBy: "teacher-kang",
            syncStatus: "local-recount",
            sourceSystems: ["local-class-memberships", "local-class-records"],
            syncedAt: "2026-06-22T10:40:00.000Z",
          }
        : {}),
      ...(objectType === "knowledge-index"
        ? {
            syncedBy: "teacher-kang",
            syncStatus: "synced",
            sourceSystems: ["course-files", "teacher-resources", "agent-grounding-index"],
            syncedAt: "2026-06-22T10:40:00.000Z",
          }
        : {}),
      ...(objectType === "group-suggestions"
        ? {
            generatedBy: "teacher-kang",
            suggestionStatus: "ready-for-teacher-review",
            artifactId: "group-suggestions-20260622104000000",
            groupingBasis: ["participation", "progress", "collaboration-balance"],
            reviewPolicy: "teacher-review-before-group-assignment",
            generatedAt: "2026-06-22T10:40:00.000Z",
          }
        : {}),
      ...(objectType === "resource-review-item"
        ? {
            queuedBy: "teacher-kang",
            reviewStatus: "pending-teacher-review",
            resourceSource: "teacher-placeholder",
            reviewPolicy: "teacher-review-before-knowledge-index",
            queuedAt: "2026-06-22T10:40:00.000Z",
          }
        : {}),
      ...(objectType === "dashboard-state"
        ? {
            refreshedBy: "teacher-kang",
            refreshStatus: "refreshed",
            visibleMetrics: ["engagement", "progress", "assessment-quality"],
            refreshedAt: "2026-06-22T10:40:00.000Z",
          }
        : {}),
      ...(objectType === "course-content"
        ? {
            publishedBy: "teacher-kang",
            publicationStatus: "published",
            releaseScope: "course-visible-content",
            publishedAt: "2026-06-22T10:40:00.000Z",
          }
        : {}),
      ...(objectType === "unit-draft"
        ? {
            generatedBy: "teacher-kang",
            draftStatus: "ready-for-teacher-review",
            artifactId: "unit-draft-20260622104000000",
            reviewPolicy: "teacher-review-before-course-publish",
            generatedAt: "2026-06-22T10:40:00.000Z",
          }
        : {}),
      ...(objectType === "agent-plan"
        ? {
            savedBy: "teacher-kang",
            planStatus: "saved",
            enabledAgents: ["research-assistant", "math-coach", "writing-mentor"],
            governancePolicy: "teacher-reviewed-agent-plan",
            savedAt: "2026-06-22T10:40:00.000Z",
          }
        : {}),
      ...(objectType === "permission-preflight"
        ? {
            checkedBy: "teacher-kang",
            preflightStatus: "passed",
            checkedPermissions: ["course-bindings", "agent-roles", "student-access"],
            preflightPolicy: "teacher-agent-permission-gate",
            checkedAt: "2026-06-22T10:40:00.000Z",
          }
        : {}),
      ...(objectType === "admin-settings"
        ? {
            savedBy: "teacher-kang",
            settingsStatus: "saved",
            adminScopes: ["course-collaborators", "permission-boundary", "audit-routing"],
            governancePolicy: "teacher-controlled-admin-settings",
            savedAt: "2026-06-22T10:40:00.000Z",
          }
        : {}),
      ...(objectType === "email-notification"
        ? {
            queuedBy: "teacher-kang",
            notificationStatus: "queued",
            deliveryChannel: "collaboration-invite-email",
            outboxId: "collaboration-invite-teacher-kang-20260622104000000",
            deliveryPolicy: "server-outbox-before-smtp-provider",
            queuedAt: "2026-06-22T10:40:00.000Z",
          }
        : {}),
      ...(objectType === "quiz-board-state"
        ? {
            refreshedBy: "teacher-kang",
            refreshStatus: "refreshed",
            visibleMetrics: [
              "completion-rate",
              "item-quality",
              "misconception-clusters",
            ],
            reviewPolicy: "teacher-visible-quiz-quality-board",
            refreshedAt: "2026-06-22T10:40:00.000Z",
          }
        : {}),
      ...(objectType === "quiz-item-review"
        ? {
            flaggedBy: "teacher-kang",
            reviewStatus: "flagged-for-review",
            flaggedSignals: [
              "low-discrimination",
              "high-error-rate",
              "teacher-review-needed",
            ],
            reviewPolicy: "teacher-review-before-quiz-reuse",
            flaggedAt: "2026-06-22T10:40:00.000Z",
          }
        : {}),
      ...(objectType === "dashboard-snapshot"
        ? {
            lockedBy: "teacher-kang",
            snapshotStatus: "locked",
            snapshotId: "dashboard-snapshot-20260622104000000",
            snapshotScope: "daily-course-dashboard",
            retentionPolicy: "teacher-locked-dashboard-snapshot",
            lockedAt: "2026-06-22T10:40:00.000Z",
          }
        : {}),
      ...(objectType === "grading-queue"
        ? {
            savedBy: "teacher-kang",
            queueStatus: "saved",
            reviewPolicy: "teacher-review-before-release",
            savedAt: "2026-06-22T10:40:00.000Z",
          }
        : {}),
      ...(objectType === "gradebook-update"
        ? {
            updatedBy: "teacher-kang",
            updateStatus: "pending-release",
            releasePolicy: "teacher-confirmed-grade-release",
            updatedAt: "2026-06-22T10:40:00.000Z",
          }
        : {}),
      ...(objectType === "ai-feedback-draft"
        ? {
            generatedBy: "teacher-kang",
            feedbackStatus: "ready-for-teacher-review",
            artifactId: "ai-feedback-draft-20260622104000000",
            feedbackScope: "grading-review-queue",
            reviewPolicy: "teacher-review-before-student-release",
            generatedAt: "2026-06-22T10:40:00.000Z",
          }
        : {}),
      ...(objectType === "invite-code-draft"
        ? {
            inviteCode: "66334455",
            joinUrl: "/courses?invite=66334455",
            generatedBy: "teacher-kang",
            draftStatus: "generated",
            invitePolicy: "teacher-review-before-publication",
            generatedAt: "2026-06-22T10:40:00.000Z",
          }
        : {}),
      ...(objectType === "enrollment-access"
        ? {
            inviteCode: "77441122",
            joinUrl: "/courses?invite=77441122",
            publishedBy: "teacher-kang",
            publicationStatus: "published",
            enrollmentPolicy: "teacher-confirmed-course-scope",
            publishedAt: "2026-06-22T10:40:00.000Z",
          }
        : {}),
      ...(objectType === "student-preview-session"
        ? {
            previewedBy: "teacher-kang",
            previewStatus: "generated",
            previewId: "student-preview-session-20260622104000000",
            previewUrl: `/learning?teacherPreview=1&course=${courseId}`,
            previewScope: "teacher-course-preview",
            previewPolicy: "teacher-visible-preview-only",
            generatedAt: "2026-06-22T10:40:00.000Z",
          }
        : {}),
      ...(objectType === "export-manifest"
        ? {
            createdBy: "teacher-kang",
            exportStatus: "generated",
            manifestId: "export-manifest-teacher-kang-20260622104000000",
            datasetScopes: ["learning-records", "chat-threads", "grades", "activities"],
            exportPolicy: "redacted-teacher-export-manifest",
            createdAt: "2026-06-22T10:40:00.000Z",
          }
        : {}),
      ...(objectType === "redaction-validation"
        ? {
            validatedBy: "teacher-kang",
            validationStatus: "passed",
            checkedScopes: ["student-private-notes", "credentials", "local-paths"],
            validationPolicy: "exclude-private-and-secret-fields",
            validatedAt: "2026-06-22T10:40:00.000Z",
          }
        : {}),
    }));
  return Response.json({
    traceId: `audit-${input.traceId}`,
    actorId: "teacher-kang",
    auditEventCount: 1,
    records: [
      {
        recordId: input.recordId,
        courseId,
        operationId: input.operationId,
        actionSlot: input.actionSlot,
        status: "persisted",
      },
    ],
    auditEvents: [
      {
        eventId: `audit-${input.recordId}`,
        traceId: input.traceId,
        eventType: "teaching-operation.persisted",
        actorId: "teacher-kang",
        authSession: createInlineAuditAuthSession(),
        courseId,
      },
    ],
    domainProjections,
  });
}

function createClearInlineOperationAuditAlertsResponse(traceId: string) {
  return Response.json({
    traceId: `alerts-${traceId}`,
    status: "clear",
    alertCount: 0,
    alerts: [],
  });
}

function createMergedCourseOwnershipReceipt(
  courseId: string,
  teacherId = "teacher-kang",
) {
  return {
    teacherId,
    courseIds: [courseId],
    status: "merged",
    storagePolicy: "external-redacted-teacher-ai-ownership-merge",
    storageWritePolicy: "external-atomic-merge",
    responsibleSession: "S12",
    updatedAt: "2026-06-22T11:20:00.000Z",
    redaction: {
      secrets: "omitted",
      localFiles: "omitted",
      assets: "ids-only",
    },
  };
}

function createPersistedCourseReceipt(courseId: string, actorId = "teacher-kang") {
  return {
    action: "create-course",
    actorId,
    courseId,
    traceId: `trace-${courseId}`,
    status: "persisted",
    authSession: createInlineAuditAuthSession(),
  };
}

function createPersistedClassReceipt(
  courseId: string,
  classId: string,
  actorId = "teacher-kang",
) {
  return {
    action: "create-class",
    actorId,
    courseId,
    classId,
    traceId: `trace-${classId}`,
    status: "persisted",
    authSession: createInlineAuditAuthSession(),
  };
}

function createPersistedMembershipApprovalReceipt(
  courseId: string,
  classId: string,
  actorId = "teacher-kang",
) {
  return {
    action: "approve-class-membership",
    actorId,
    courseId,
    classId,
    traceId: `trace-approve-${classId}`,
    status: "persisted",
    responsibleSession: "S12",
  };
}

function createPeterMembershipCourseListReadback(input?: {
  approved?: boolean;
  includeMembership?: boolean;
}) {
  const isApproved = Boolean(input?.approved);
  const includeMembership = input?.includeMembership !== false;
  return Response.json({
    courses: [
      {
        courseId: "teacher-course-enterprise-operations-20260623",
        courseName: "企业级普通教学管理",
        instructor: "康霞",
        unit: "广州大学（404）",
        department: "实验教学中心",
        semester: "2026 春季",
        students: isApproved ? 13 : 12,
      },
    ],
    classes: [
      {
        classId: "teacher-course-enterprise-operations-20260623-class-1",
        courseId: "teacher-course-enterprise-operations-20260623",
        className: "企业管理实验班",
        students: isApproved ? 13 : 12,
        semester: "2026 春季",
        invitationCode: "66334455",
      },
    ],
    memberships: includeMembership
      ? [
          {
            membershipId:
              "membership-teacher-course-enterprise-operations-20260623-class-1-Peter",
            courseId: "teacher-course-enterprise-operations-20260623",
            classId: "teacher-course-enterprise-operations-20260623-class-1",
            invitationCode: "66334455",
            studentId: "Peter",
            studentDisplayName: "Peter",
            membershipStatus: isApproved ? "approved" : "pending-teacher-review",
            joinedAt: "2026-06-23T08:10:00.000Z",
            ...(isApproved ? { approvedAt: "2026-06-23T08:15:00.000Z" } : {}),
          },
        ]
      : [],
  });
}

function createApprovedPeterMembershipApprovalResponse() {
  return Response.json({
    membership: {
      membershipId: "membership-teacher-course-enterprise-operations-20260623-class-1-Peter",
      courseId: "teacher-course-enterprise-operations-20260623",
      classId: "teacher-course-enterprise-operations-20260623-class-1",
      invitationCode: "66334455",
      studentId: "Peter",
      studentDisplayName: "Peter",
      membershipStatus: "approved",
      joinedAt: "2026-06-23T08:10:00.000Z",
      approvedAt: "2026-06-23T08:15:00.000Z",
      approvedByTeacherId: "teacher-kang",
    },
    classItem: {
      classId: "teacher-course-enterprise-operations-20260623-class-1",
      courseId: "teacher-course-enterprise-operations-20260623",
      className: "企业管理实验班",
      students: 13,
      semester: "2026 春季",
      invitationCode: "66334455",
    },
    course: {
      courseId: "teacher-course-enterprise-operations-20260623",
      courseName: "企业级普通教学管理",
      instructor: "康霞",
      unit: "广州大学（404）",
      department: "实验教学中心",
      semester: "2026 春季",
      students: 13,
    },
    receipt: createPersistedMembershipApprovalReceipt(
      "teacher-course-enterprise-operations-20260623",
      "teacher-course-enterprise-operations-20260623-class-1",
    ),
  });
}

function createPersistedCourseCoverGenerationBody(input: {
  courseId: string;
  assetId?: string;
  imageUrl?: string;
  requestId?: string;
  model?: string;
}) {
  const requestId = input.requestId ?? "request-course-cover-1";
  const assetId = input.assetId ?? `course-cover-${requestId}`;
  const imageUrl = input.imageUrl ?? "https://dashscope-result/course-cover.png";
  const model = input.model ?? "qwen-image-2.0";
  return {
    cover: {
      provider: "qwen",
      providerRole: "image-generation",
      model,
      imageUrl,
      requestId,
      usage: { width: 800, height: 480, imageCount: 1 },
    },
    asset: {
      assetId,
      assetType: "course-cover",
      courseId: input.courseId,
      imageUrl,
      storagePolicy: "local-json-teaching-course-cover-assets",
    },
    assetPersistence: {
      status: "persisted",
      storagePolicy: "local-json-teaching-course-cover-assets",
      storageWritePolicy: "atomic-json-file-replace",
      concurrencyControl: "atomic-json-file-replace",
      revisionRetry: {
        status: "not-applicable",
        attempts: 1,
        conflicts: 0,
        maxAttempts: 1,
      },
      responsibleSession: "S12",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "generated-url-only",
      },
    },
    audit: {
      auditId: `audit-${assetId}`,
      traceId: "trace-course-cover-ui-test",
      eventType: "teaching-course-cover.generated",
      actor: {
        actorId: "teacher-kang",
        role: "teacher",
      },
      authMode: "signed-teacher-session",
      authSession: {
        sessionId: "teacher-cover-ui-session",
        authenticatedAt: "2026-06-30T08:00:00.000Z",
        expiresAt: "2026-06-30T10:00:00.000Z",
      },
      courseId: input.courseId,
      assetId,
      providerRequestId: requestId,
      requestSource: {
        userAgent: "UAIS teaching page test",
        ipAddress: "redacted",
      },
      storagePolicy: "local-json-teaching-course-cover-audit-log",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "generated-url-only",
      },
    },
    redaction: {
      secrets: "omitted",
      localFiles: "omitted",
      assets: "generated-url-only",
    },
  };
}

describe("TeachingPage", () => {
  it("renders one focused enterprise workspace for the selected left menu entry", () => {
    const { container } = render(<TeachingPage />);

    expect(
      container.querySelectorAll("[data-uais-teaching-workspace-panel]"),
    ).toHaveLength(1);
    expect(
      container.querySelector('[data-uais-active-teaching-workspace="course-settings"]'),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "课程设置工作台" })).toBeTruthy();

    fireEvent.click(screen.getByRole("link", { name: "智能体配置" }));

    expect(
      container.querySelectorAll("[data-uais-teaching-workspace-panel]"),
    ).toHaveLength(1);
    expect(
      container.querySelector('[data-uais-active-teaching-workspace="agents"]'),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "智能体配置工作台" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "我的课程" })).toBeNull();

    fireEvent.click(screen.getByRole("link", { name: "数据导出" }));

    expect(
      container.querySelector('[data-uais-active-teaching-workspace="data-export"]'),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "数据导出工作台" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "智能体配置工作台" })).toBeNull();
  });

  it("keeps course settings actions inside the main workspace instead of a management hop", async () => {
    const traceId = "trace-inline-course-settings-primary";
    const receiptId = "operation-record-course-settings-primary";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/teaching/operations/audit") {
        return createVerifiedInlineOperationAuditReadbackResponse({
          traceId,
          recordId: receiptId,
          operationId: "course-settings",
          actionSlot: "primary",
        });
      }
      if (String(input) === "/api/teaching/operations/audit/alerts") {
        return createClearInlineOperationAuditAlertsResponse(traceId);
      }
      return Response.json({
        receipt: {
          receiptId,
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          status: "persisted",
          audit: createSignedInlineOperationReceiptAudit(),
          displayMessage: {
            "zh-CN": "课程设置已由服务端持久化。",
            "en-US": "Course settings persisted by the server.",
          },
        },
        domainPersistenceSummary: createPersistedDomainPersistenceSummary(
          receiptId,
        ),
        traceId,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    expect(screen.queryByRole("link", { name: "进入管理" })).toBeNull();
    expect(screen.getByRole("button", { name: "保存课程设置" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "预览学生端" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

    await waitFor(() => {
      expect(screen.getByText("课程设置已由服务端持久化。")).toBeTruthy();
    });
    expect(screen.queryByText("课程设置已保存到本地工作区。")).toBeNull();
  });

  it("lets course card management links navigate to routed course workspaces", () => {
    render(<TeachingPage />);

    const manageCourseLink = screen.getAllByRole("link", { name: "管理课程" })[0];

    expect(manageCourseLink.getAttribute("href")).toBe(
      "/teaching/course-settings?course=teacher-research-methods&action=manage",
    );
    expect(fireEvent.click(manageCourseLink)).toBe(true);
  });

  it("does not show inline workspace success when the backend omits a persisted receipt", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        traceId: "trace-inline-missing-receipt",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

    await waitFor(() => {
      expect(screen.getByText("未保存到服务器，请重新登录或检查课程权限。")).toBeTruthy();
    });
    expect(screen.queryByText("课程设置已由服务端持久化，等待审计读回。")).toBeNull();
  });

  it("requires signed teacher-session evidence in the inline operation receipt before audit readback", async () => {
    const receiptId = "operation-record-course-settings-receipt-session-missing";
    const fetchMock = vi.fn(async () =>
      Response.json({
        receipt: {
          receiptId,
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          status: "persisted",
          audit: {
            authMode: "signed-teacher-session",
          },
          displayMessage: {
            "zh-CN": "课程设置已由服务端持久化。",
            "en-US": "Course settings persisted by the server.",
          },
        },
        domainPersistenceSummary: createPersistedDomainPersistenceSummary(receiptId),
        traceId: "trace-inline-receipt-session-missing",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

    await waitFor(() => {
      expect(screen.getByText("未保存到服务器，请重新登录或检查课程权限。")).toBeTruthy();
    });
    expect(screen.queryByText("课程设置已由服务端持久化。")).toBeNull();
    expect(screen.queryByText("审计读回已验证")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/teaching/operations/audit",
      expect.anything(),
    );
  });

  it("surfaces inline workspace role-denial details and trace id instead of generic local feedback", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        {
          traceId: "trace-inline-teacher-role-denied",
          error: "UAIS teacher role is required.",
          access: {
            status: "denied",
            reasonCode: "teacher-role-required",
            responsibleSession: "S12",
          },
        },
        { status: 403 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "未保存到服务器：当前账号没有教师权限。追踪编号：trace-inline-teacher-role-denied",
        ),
      ).toBeTruthy();
    });
    expect(screen.queryByText("课程设置已保存到本地工作区。")).toBeNull();
    expect(screen.queryByText("课程设置已由服务端持久化。")).toBeNull();
  });

  it("loads persisted teacher courses and classes from the backend on mount", async () => {
    window.history.replaceState(null, "", "/teaching");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/teaching/courses");
      expect(init?.method).toBe("GET");

      return Response.json({
        courses: [
          {
            courseId: "teacher-course-enterprise-operations-20260623",
            courseName: "企业级普通教学管理",
            instructor: "康霞",
            unit: "广州大学（404）",
            department: "实验教学中心",
            semester: "2026 春季",
            students: 12,
          },
        ],
        classes: [
          {
            classId: "teacher-course-enterprise-operations-20260623-class-1",
            courseId: "teacher-course-enterprise-operations-20260623",
            className: "企业管理实验班",
            students: 12,
            semester: "2026 春季",
            invitationCode: "66334455",
          },
        ],
        receipt: {
          action: "list-courses",
          actorId: "teacher-kang",
          status: "read",
          responsibleSession: "S12",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-course-enterprise-operations-20260623");

    await waitFor(() => {
      expect(screen.getByText("企业级普通教学管理")).toBeTruthy();
      expect(screen.getByText("企业管理实验班")).toBeTruthy();
      expect(screen.getByText("学生：12")).toBeTruthy();
      expect(screen.getAllByText("2026 春季")[0]).toBeTruthy();
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "打开企业管理实验班的邀请码",
      }),
    );

    expect(screen.getByRole("dialog", { name: "企业管理实验班邀请码" })).toBeTruthy();
    expect(screen.getByText("66334455")).toBeTruthy();
    expect(container.querySelector('[data-uais-class-invitation-qr="66334455"]')).toBeTruthy();
  });

  it("separates class entry, class activities, and invite-code actions", async () => {
    window.history.replaceState(null, "", "/teaching");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/teaching/courses");
      expect(init?.method).toBe("GET");

      return Response.json({
        courses: [
          {
            courseId: "teacher-course-enterprise-operations-20260623",
            courseName: "企业级普通教学管理",
            instructor: "康霞",
            unit: "广州大学（404）",
            department: "实验教学中心",
            semester: "2026 春季",
            students: 12,
          },
        ],
        classes: [
          {
            classId: "teacher-course-enterprise-operations-20260623-class-1",
            courseId: "teacher-course-enterprise-operations-20260623",
            className: "企业管理实验班",
            students: 12,
            semester: "2026 春季",
            invitationCode: "66334455",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);

    await screen.findByText("企业管理实验班");

    const enterClassLink = screen.getByRole("link", { name: "进入企业管理实验班" });
    const activityListLink = screen.getByRole("link", {
      name: "查看企业管理实验班活动列表",
    });
    const inviteCodeButton = screen.getByRole("button", {
      name: "打开企业管理实验班的邀请码",
    });

    expect(enterClassLink.getAttribute("href")).toBe(
      "/teaching/students?course=teacher-course-enterprise-operations-20260623&class=teacher-course-enterprise-operations-20260623-class-1&action=enter-class",
    );
    expect(activityListLink.getAttribute("href")).toBe(
      "/teaching/quiz-board?course=teacher-course-enterprise-operations-20260623&class=teacher-course-enterprise-operations-20260623-class-1&action=activity-list",
    );

    fireEvent.click(activityListLink);
    expect(screen.queryByRole("dialog", { name: "企业管理实验班邀请码" })).toBeNull();

    fireEvent.click(inviteCodeButton);
    expect(screen.getByRole("dialog", { name: "企业管理实验班邀请码" })).toBeTruthy();
  });

  it("surfaces persisted course load failures instead of silently keeping demo data", async () => {
    window.history.replaceState(null, "", "/teaching");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/teaching/courses");
      expect(init?.method).toBe("GET");
      return Response.json(
        { error: "UAIS teacher authentication is required." },
        { status: 401 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("服务端课程数据未读回");
    expect(alert.textContent).toContain("UAIS teacher authentication is required.");
    expect(screen.getByText("大学研究方法")).toBeTruthy();
  });

  it("lets teachers approve pending invite-code memberships from course classes", async () => {
    window.history.replaceState(null, "", "/teaching");
    let resolveApproval: (response: Response) => void = () => undefined;
    let courseListReadCount = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teaching/courses") {
        expect(init?.method).toBe("GET");
        courseListReadCount += 1;
        return Promise.resolve(
          createPeterMembershipCourseListReadback({ approved: courseListReadCount > 1 }),
        );
      }

      expect(url).toBe(
        "/api/teaching/classes/teacher-course-enterprise-operations-20260623-class-1/memberships/membership-teacher-course-enterprise-operations-20260623-class-1-Peter/approve",
      );
      expect(init?.method).toBe("POST");
      return new Promise<Response>((resolve) => {
        resolveApproval = resolve;
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);

    await waitFor(() => {
      expect(screen.getByText("Peter 等待加入")).toBeTruthy();
      expect(screen.getByText("学生：12")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "审批Peter加入企业管理实验班" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/classes/teacher-course-enterprise-operations-20260623-class-1/memberships/membership-teacher-course-enterprise-operations-20260623-class-1-Peter/approve",
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(screen.getByText("正在审批加入申请，请稍候。")).toBeTruthy();
    expect(screen.getByText("学生：12")).toBeTruthy();

    resolveApproval(createApprovedPeterMembershipApprovalResponse());

    await waitFor(() => {
      expect(screen.getByText("学生：13")).toBeTruthy();
      expect(screen.queryByText("Peter 等待加入")).toBeNull();
      expect(screen.getByText("Peter 已加入企业管理实验班。")).toBeTruthy();
    });
    expect(courseListReadCount).toBe(2);
  });

  it("requires a membership approval receipt before marking a student as joined", async () => {
    window.history.replaceState(null, "", "/teaching");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teaching/courses") {
        expect(init?.method).toBe("GET");
        return Response.json({
          courses: [
            {
              courseId: "teacher-course-enterprise-operations-20260623",
              courseName: "企业级普通教学管理",
              instructor: "康霞",
              unit: "广州大学（404）",
              department: "实验教学中心",
              semester: "2026 春季",
              students: 12,
            },
          ],
          classes: [
            {
              classId: "teacher-course-enterprise-operations-20260623-class-1",
              courseId: "teacher-course-enterprise-operations-20260623",
              className: "企业管理实验班",
              students: 12,
              semester: "2026 春季",
              invitationCode: "66334455",
            },
          ],
          memberships: [
            {
              membershipId:
                "membership-teacher-course-enterprise-operations-20260623-class-1-Peter",
              courseId: "teacher-course-enterprise-operations-20260623",
              classId: "teacher-course-enterprise-operations-20260623-class-1",
              invitationCode: "66334455",
              studentId: "Peter",
              studentDisplayName: "Peter",
              membershipStatus: "pending-teacher-review",
              joinedAt: "2026-06-23T08:10:00.000Z",
            },
          ],
        });
      }

      expect(url).toBe(
        "/api/teaching/classes/teacher-course-enterprise-operations-20260623-class-1/memberships/membership-teacher-course-enterprise-operations-20260623-class-1-Peter/approve",
      );
      expect(init?.method).toBe("POST");
      return Response.json({
        traceId: "trace-membership-approval-receipt-missing",
        membership: {
          membershipId:
            "membership-teacher-course-enterprise-operations-20260623-class-1-Peter",
          courseId: "teacher-course-enterprise-operations-20260623",
          classId: "teacher-course-enterprise-operations-20260623-class-1",
          invitationCode: "66334455",
          studentId: "Peter",
          studentDisplayName: "Peter",
          membershipStatus: "approved",
          joinedAt: "2026-06-23T08:10:00.000Z",
          approvedAt: "2026-06-23T08:15:00.000Z",
          approvedByTeacherId: "teacher-kang",
        },
        classItem: {
          classId: "teacher-course-enterprise-operations-20260623-class-1",
          courseId: "teacher-course-enterprise-operations-20260623",
          className: "企业管理实验班",
          students: 13,
          semester: "2026 春季",
          invitationCode: "66334455",
        },
        course: {
          courseId: "teacher-course-enterprise-operations-20260623",
          courseName: "企业级普通教学管理",
          instructor: "康霞",
          unit: "广州大学（404）",
          department: "实验教学中心",
          semester: "2026 春季",
          students: 13,
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);

    await waitFor(() => {
      expect(screen.getByText("Peter 等待加入")).toBeTruthy();
      expect(screen.getByText("学生：12")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "审批Peter加入企业管理实验班" }));

    await waitFor(() => {
      expect(screen.getByText("审批服务端回执缺失，请稍后重试。")).toBeTruthy();
    });
    expect(screen.getByText("Peter 等待加入")).toBeTruthy();
    expect(screen.getByText("学生：12")).toBeTruthy();
    expect(screen.queryByText("Peter 已加入企业管理实验班。")).toBeNull();
  });

  it("requires membership approval readback before marking a student as joined", async () => {
    window.history.replaceState(null, "", "/teaching");
    let courseListReadCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teaching/courses") {
        expect(init?.method).toBe("GET");
        courseListReadCount += 1;
        return createPeterMembershipCourseListReadback({
          includeMembership: courseListReadCount === 1,
        });
      }

      expect(url).toBe(
        "/api/teaching/classes/teacher-course-enterprise-operations-20260623-class-1/memberships/membership-teacher-course-enterprise-operations-20260623-class-1-Peter/approve",
      );
      expect(init?.method).toBe("POST");
      return createApprovedPeterMembershipApprovalResponse();
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);

    await waitFor(() => {
      expect(screen.getByText("Peter 等待加入")).toBeTruthy();
      expect(screen.getByText("学生：12")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "审批Peter加入企业管理实验班" }));

    await waitFor(() => {
      expect(
        screen.getByText("成员审批已提交，但服务端列表尚未读回该成员，请稍后刷新。"),
      ).toBeTruthy();
    });
    expect(courseListReadCount).toBe(2);
    expect(screen.getByText("Peter 等待加入")).toBeTruthy();
    expect(screen.getByText("学生：12")).toBeTruthy();
    expect(screen.queryByText("Peter 已加入企业管理实验班。")).toBeNull();
  });

  it("rejects membership approval success when the backend returns a different membership", async () => {
    window.history.replaceState(null, "", "/teaching");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teaching/courses") {
        expect(init?.method).toBe("GET");
        return Response.json({
          courses: [
            {
              courseId: "teacher-course-enterprise-operations-20260623",
              courseName: "企业级普通教学管理",
              instructor: "康霞",
              unit: "广州大学（404）",
              department: "实验教学中心",
              semester: "2026 春季",
              students: 12,
            },
          ],
          classes: [
            {
              classId: "teacher-course-enterprise-operations-20260623-class-1",
              courseId: "teacher-course-enterprise-operations-20260623",
              className: "企业管理实验班",
              students: 12,
              semester: "2026 春季",
              invitationCode: "66334455",
            },
          ],
          memberships: [
            {
              membershipId:
                "membership-teacher-course-enterprise-operations-20260623-class-1-Peter",
              courseId: "teacher-course-enterprise-operations-20260623",
              classId: "teacher-course-enterprise-operations-20260623-class-1",
              invitationCode: "66334455",
              studentId: "Peter",
              studentDisplayName: "Peter",
              membershipStatus: "pending-teacher-review",
              joinedAt: "2026-06-23T08:10:00.000Z",
            },
          ],
        });
      }

      expect(url).toBe(
        "/api/teaching/classes/teacher-course-enterprise-operations-20260623-class-1/memberships/membership-teacher-course-enterprise-operations-20260623-class-1-Peter/approve",
      );
      expect(init?.method).toBe("POST");
      return Response.json({
        membership: {
          membershipId: "membership-teacher-course-enterprise-operations-20260623-class-2-Eve",
          courseId: "teacher-course-enterprise-operations-20260623",
          classId: "teacher-course-enterprise-operations-20260623-class-2",
          invitationCode: "77441122",
          studentId: "Eve",
          studentDisplayName: "Eve",
          membershipStatus: "approved",
          joinedAt: "2026-06-23T08:12:00.000Z",
          approvedAt: "2026-06-23T08:15:00.000Z",
          approvedByTeacherId: "teacher-kang",
        },
        receipt: createPersistedMembershipApprovalReceipt(
          "teacher-course-enterprise-operations-20260623",
          "teacher-course-enterprise-operations-20260623-class-1",
        ),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);

    await waitFor(() => {
      expect(screen.getByText("Peter 等待加入")).toBeTruthy();
      expect(screen.getByText("学生：12")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "审批Peter加入企业管理实验班" }));

    await waitFor(() => {
      expect(screen.getByText("审批未保存到服务器，请重新登录或检查班级权限。")).toBeTruthy();
    });
    expect(screen.getByText("Peter 等待加入")).toBeTruthy();
    expect(screen.getByText("学生：12")).toBeTruthy();
    expect(screen.queryByText("Peter 已加入企业管理实验班。")).toBeNull();
    expect(screen.queryByText("Eve 已加入企业管理实验班。")).toBeNull();
  });

  it("surfaces membership approval authorization failures with trace ids", async () => {
    window.history.replaceState(null, "", "/teaching");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teaching/courses") {
        expect(init?.method).toBe("GET");
        return Response.json({
          courses: [
            {
              courseId: "teacher-course-enterprise-operations-20260623",
              courseName: "企业级普通教学管理",
              instructor: "康霞",
              unit: "广州大学（404）",
              department: "实验教学中心",
              semester: "2026 春季",
              students: 12,
            },
          ],
          classes: [
            {
              classId: "teacher-course-enterprise-operations-20260623-class-1",
              courseId: "teacher-course-enterprise-operations-20260623",
              className: "企业管理实验班",
              students: 12,
              semester: "2026 春季",
              invitationCode: "66334455",
            },
          ],
          memberships: [
            {
              membershipId:
                "membership-teacher-course-enterprise-operations-20260623-class-1-Peter",
              courseId: "teacher-course-enterprise-operations-20260623",
              classId: "teacher-course-enterprise-operations-20260623-class-1",
              invitationCode: "66334455",
              studentId: "Peter",
              studentDisplayName: "Peter",
              membershipStatus: "pending-teacher-review",
              joinedAt: "2026-06-23T08:10:00.000Z",
            },
          ],
        });
      }

      expect(url).toBe(
        "/api/teaching/classes/teacher-course-enterprise-operations-20260623-class-1/memberships/membership-teacher-course-enterprise-operations-20260623-class-1-Peter/approve",
      );
      expect(init?.method).toBe("POST");
      return Response.json(
        {
          traceId: "trace-membership-approval-auth-required",
          error: "UAIS teacher authentication is required.",
          access: {
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          },
        },
        { status: 401 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);

    await waitFor(() => {
      expect(screen.getByText("Peter 等待加入")).toBeTruthy();
      expect(screen.getByText("学生：12")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "审批Peter加入企业管理实验班" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "审批未保存到服务器：需要重新登录教师账号。追踪编号：trace-membership-approval-auth-required",
        ),
      ).toBeTruthy();
    });
    expect(screen.getByText("学生：12")).toBeTruthy();
    expect(screen.getByText("Peter 等待加入")).toBeTruthy();
    expect(screen.queryByText("Peter 已加入企业管理实验班。")).toBeNull();
  });

  it("surfaces membership approval course-scope denial details and trace ids", async () => {
    window.history.replaceState(null, "", "/teaching");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teaching/courses") {
        expect(init?.method).toBe("GET");
        return Response.json({
          courses: [
            {
              courseId: "teacher-course-enterprise-operations-20260623",
              courseName: "企业级普通教学管理",
              instructor: "康霞",
              unit: "广州大学（404）",
              department: "实验教学中心",
              semester: "2026 春季",
              students: 12,
            },
          ],
          classes: [
            {
              classId: "teacher-course-enterprise-operations-20260623-class-1",
              courseId: "teacher-course-enterprise-operations-20260623",
              className: "企业管理实验班",
              students: 12,
              semester: "2026 春季",
              invitationCode: "66334455",
            },
          ],
          memberships: [
            {
              membershipId:
                "membership-teacher-course-enterprise-operations-20260623-class-1-Peter",
              courseId: "teacher-course-enterprise-operations-20260623",
              classId: "teacher-course-enterprise-operations-20260623-class-1",
              invitationCode: "66334455",
              studentId: "Peter",
              studentDisplayName: "Peter",
              membershipStatus: "pending-teacher-review",
              joinedAt: "2026-06-23T08:10:00.000Z",
            },
          ],
        });
      }

      expect(url).toBe(
        "/api/teaching/classes/teacher-course-enterprise-operations-20260623-class-1/memberships/membership-teacher-course-enterprise-operations-20260623-class-1-Peter/approve",
      );
      expect(init?.method).toBe("POST");
      return Response.json(
        {
          traceId: "trace-membership-approval-course-denied",
          error: "Current teacher cannot approve memberships for this course.",
          access: {
            status: "denied",
            reasonCode: "teacher-course-ownership-required",
            responsibleSession: "S12",
          },
        },
        { status: 403 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);

    await waitFor(() => {
      expect(screen.getByText("Peter 等待加入")).toBeTruthy();
      expect(screen.getByText("学生：12")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "审批Peter加入企业管理实验班" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "审批未保存到服务器：当前教师无权操作该课程。追踪编号：trace-membership-approval-course-denied",
        ),
      ).toBeTruthy();
    });
    expect(screen.getByText("学生：12")).toBeTruthy();
    expect(screen.getByText("Peter 等待加入")).toBeTruthy();
    expect(screen.queryByText("Peter 已加入企业管理实验班。")).toBeNull();
  });

  it("persists inline workspace actions through the backend and surfaces authorization failures", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        {
          traceId: "trace-inline-teacher-auth-required",
          error: "UAIS teacher authentication is required.",
          access: {
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          },
        },
        { status: 401 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(requestBody).toEqual(
      expect.objectContaining({
        operationId: "course-settings",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        sourceAction: "inline-teaching-workspace",
        idempotencyKey: expect.stringMatching(
          /^teaching-operation-course-settings-primary-teacher-research-methods-inline-teaching-workspace-[a-zA-Z0-9._-]+$/,
        ),
      }),
    );
    expect(requestBody.idempotencyKey.length).toBeLessThanOrEqual(120);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/teaching/operations",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
      }),
    );
    await waitFor(() => {
      expect(
        screen.getByText(
          "未保存到服务器：需要重新登录教师账号。追踪编号：trace-inline-teacher-auth-required",
        ),
      ).toBeTruthy();
    });
  });

  it("sends edited course settings as a backend patch from the main workspace", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        receipt: {
          receiptId: "operation-record-course-settings-primary",
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          status: "persisted",
          audit: createSignedInlineOperationReceiptAudit(),
          displayMessage: {
            "zh-CN": "课程设置已由服务端持久化。",
            "en-US": "Course settings persisted by the server.",
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.change(screen.getByLabelText("课程名称"), {
      target: { value: "企业级研究方法" },
    });
    fireEvent.change(screen.getByLabelText("学期安排"), {
      target: { value: "2026秋季学期" },
    });
    fireEvent.change(screen.getByLabelText("课程说明"), {
      target: { value: "面向普通教学管理链路的课程设置补丁。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/operations",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(requestBody).toEqual(
      expect.objectContaining({
        operationId: "course-settings",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        sourceAction: "inline-teaching-workspace",
        courseSettingsPatch: {
          courseName: "企业级研究方法",
          semester: "2026秋季学期",
          description: "面向普通教学管理链路的课程设置补丁。",
        },
      }),
    );
  });

  it("patches only the course settings fields the teacher edited", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        receipt: {
          receiptId: "operation-record-course-settings-single-field",
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          status: "persisted",
          audit: createSignedInlineOperationReceiptAudit(),
          displayMessage: {
            "zh-CN": "课程设置已由服务端持久化。",
            "en-US": "Course settings persisted by the server.",
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.change(screen.getByLabelText("课程名称"), {
      target: { value: "企业级研究方法" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/operations",
        expect.objectContaining({ method: "POST" }),
      );
    });
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(requestBody.courseSettingsPatch).toEqual({ courseName: "企业级研究方法" });
  });

  it("keeps a mid-edit locale switch out of the course settings patch", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        receipt: {
          receiptId: "operation-record-course-settings-locale-switch",
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          status: "persisted",
          audit: createSignedInlineOperationReceiptAudit(),
          displayMessage: {
            "zh-CN": "课程设置已由服务端持久化。",
            "en-US": "Course settings persisted by the server.",
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.change(screen.getByLabelText("课程说明"), {
      target: { value: "只修改课程说明。" },
    });

    mockPreferences.locale = "en-US";
    rerender(<TeachingPage />);

    // Untouched fields follow the new locale instead of freezing the zh-CN strings.
    expect((screen.getByLabelText("Course Name") as HTMLInputElement).value).toBe(
      "University Research Methods",
    );
    expect((screen.getByLabelText("Semester") as HTMLInputElement).value).toBe("Spring 2026");
    expect((screen.getByLabelText("Course Description") as HTMLTextAreaElement).value).toBe(
      "只修改课程说明。",
    );

    fireEvent.click(screen.getByRole("button", { name: "Save Course Settings" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/operations",
        expect.objectContaining({ method: "POST" }),
      );
    });
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(requestBody.courseSettingsPatch).toEqual({ description: "只修改课程说明。" });
    // No phantom rename: the localized title is not collapsed to the zh-CN string.
    expect(screen.queryAllByText("University Research Methods").length).toBeGreaterThan(0);
    // Assert on the payload, not on rendered text: once the locale flipped to en-US
    // the zh-CN title cannot render anyway, so a DOM check here proves nothing. The
    // load-bearing claim is that the pre-switch locale's strings never left the page.
    expect(String(fetchMock.mock.calls[0][1]?.body)).not.toContain("大学研究方法");
    expect(String(fetchMock.mock.calls[0][1]?.body)).not.toContain("2025-2026第二学期");
  });

  it("keeps a touched-then-reverted field out of the patch after a locale switch", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        receipt: {
          receiptId: "operation-record-course-settings-reverted-field",
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          status: "persisted",
          audit: createSignedInlineOperationReceiptAudit(),
          displayMessage: {
            "zh-CN": "课程设置已由服务端持久化。",
            "en-US": "Course settings persisted by the server.",
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    // Touch and revert: the sparse draft now holds the zh-CN strings verbatim, which
    // is indistinguishable from an edit by value alone.
    fireEvent.change(screen.getByLabelText("课程名称"), {
      target: { value: "大学研究方法X" },
    });
    fireEvent.change(screen.getByLabelText("课程名称"), {
      target: { value: "大学研究方法" },
    });
    fireEvent.change(screen.getByLabelText("学期安排"), {
      target: { value: "2025-2026第二学期X" },
    });
    fireEvent.change(screen.getByLabelText("学期安排"), {
      target: { value: "2025-2026第二学期" },
    });
    fireEvent.change(screen.getByLabelText("课程说明"), {
      target: { value: "只修改课程说明。" },
    });

    mockPreferences.locale = "en-US";
    rerender(<TeachingPage />);

    // Reverted fields are untouched, so they follow the toggle like never-edited ones.
    expect((screen.getByLabelText("Course Name") as HTMLInputElement).value).toBe(
      "University Research Methods",
    );
    expect((screen.getByLabelText("Semester") as HTMLInputElement).value).toBe("Spring 2026");
    expect((screen.getByLabelText("Course Description") as HTMLTextAreaElement).value).toBe(
      "只修改课程说明。",
    );

    fireEvent.click(screen.getByRole("button", { name: "Save Course Settings" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/operations",
        expect.objectContaining({ method: "POST" }),
      );
    });
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(requestBody.courseSettingsPatch).toEqual({ description: "只修改课程说明。" });
  });

  it("keeps a semester typed in the en-US UI that matches the zh-CN rendering", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        receipt: {
          receiptId: "operation-record-course-settings-cross-locale-semester",
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          status: "persisted",
          audit: createSignedInlineOperationReceiptAudit(),
          displayMessage: {
            "zh-CN": "课程设置已由服务端持久化。",
            "en-US": "Course settings persisted by the server.",
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    mockPreferences.locale = "en-US";
    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    // The demo cards carry no parseable semester, so the persisted rendering is the
    // locale default: "Spring 2026" here, "2025-2026第二学期" in zh-CN.
    expect((screen.getByLabelText("Semester") as HTMLInputElement).value).toBe("Spring 2026");

    fireEvent.change(screen.getByLabelText("Semester"), {
      target: { value: "2025-2026第二学期" },
    });

    // Typed text is never overwritten by the other locale's rendering.
    expect((screen.getByLabelText("Semester") as HTMLInputElement).value).toBe(
      "2025-2026第二学期",
    );

    fireEvent.click(screen.getByRole("button", { name: "Save Course Settings" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/operations",
        expect.objectContaining({ method: "POST" }),
      );
    });
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(requestBody.courseSettingsPatch).toEqual({ semester: "2025-2026第二学期" });
  });

  it("patches a rename typed in the en-US UI that matches the zh-CN course title", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        receipt: {
          receiptId: "operation-record-course-settings-cross-locale-rename",
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          status: "persisted",
          audit: createSignedInlineOperationReceiptAudit(),
          displayMessage: {
            "zh-CN": "课程设置已由服务端持久化。",
            "en-US": "Course settings persisted by the server.",
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    mockPreferences.locale = "en-US";
    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.change(screen.getByLabelText("Course Name"), {
      target: { value: "大学研究方法" },
    });

    expect((screen.getByLabelText("Course Name") as HTMLInputElement).value).toBe("大学研究方法");

    fireEvent.click(screen.getByRole("button", { name: "Save Course Settings" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/operations",
        expect.objectContaining({ method: "POST" }),
      );
    });
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(requestBody.courseSettingsPatch).toEqual({ courseName: "大学研究方法" });
  });

  it("keeps a space typed into a course settings field instead of eating the next keystroke", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        receipt: {
          receiptId: "operation-record-course-settings-trailing-space",
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          status: "persisted",
          audit: createSignedInlineOperationReceiptAudit(),
          displayMessage: {
            "zh-CN": "课程设置已由服务端持久化。",
            "en-US": "Course settings persisted by the server.",
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    mockPreferences.locale = "en-US";
    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    const courseNameInput = screen.getByLabelText("Course Name") as HTMLInputElement;
    expect(courseNameInput.value).toBe("University Research Methods");

    // Type one character at a time, always continuing from what the controlled input
    // actually shows. A value that differs from the persisted rendering only by
    // trailing whitespace must survive the re-render: if it snaps back, the space is
    // swallowed and the next keystroke lands against the un-spaced string.
    fireEvent.change(courseNameInput, { target: { value: `${courseNameInput.value} ` } });
    expect(courseNameInput.value).toBe("University Research Methods ");

    fireEvent.change(courseNameInput, { target: { value: `${courseNameInput.value}A` } });
    expect(courseNameInput.value).toBe("University Research Methods A");

    fireEvent.click(screen.getByRole("button", { name: "Save Course Settings" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/operations",
        expect.objectContaining({ method: "POST" }),
      );
    });
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    // The patch keeps trimming, so what ships is the typed string trimmed.
    expect(requestBody.courseSettingsPatch).toEqual({
      courseName: "University Research Methods A",
    });
  });

  it("keeps a cleared course settings field cleared and out of the patch", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        receipt: {
          receiptId: "operation-record-course-settings-cleared-field",
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          status: "persisted",
          audit: createSignedInlineOperationReceiptAudit(),
          displayMessage: {
            "zh-CN": "课程设置已由服务端持久化。",
            "en-US": "Course settings persisted by the server.",
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.change(screen.getByLabelText("课程名称"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("课程说明"), {
      target: { value: "只修改课程说明。" },
    });

    // The emptied input stays empty instead of snapping the persisted value back
    // under the cursor.
    expect((screen.getByLabelText("课程名称") as HTMLInputElement).value).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/operations",
        expect.objectContaining({ method: "POST" }),
      );
    });
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(requestBody.courseSettingsPatch).toEqual({ description: "只修改课程说明。" });
  });

  it("keeps a genuine zh-CN edit visible and patchable after a locale switch", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        receipt: {
          receiptId: "operation-record-course-settings-cross-locale-edit",
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          status: "persisted",
          audit: createSignedInlineOperationReceiptAudit(),
          displayMessage: {
            "zh-CN": "课程设置已由服务端持久化。",
            "en-US": "Course settings persisted by the server.",
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.change(screen.getByLabelText("课程名称"), {
      target: { value: "企业级研究方法" },
    });

    mockPreferences.locale = "en-US";
    rerender(<TeachingPage />);

    // A real edit survives the toggle instead of being discarded as a stale seed.
    expect((screen.getByLabelText("Course Name") as HTMLInputElement).value).toBe("企业级研究方法");

    fireEvent.click(screen.getByRole("button", { name: "Save Course Settings" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/operations",
        expect.objectContaining({ method: "POST" }),
      );
    });
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(requestBody.courseSettingsPatch).toEqual({ courseName: "企业级研究方法" });
  });

  it("does not claim inline course settings success when domain persistence is missing", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        receipt: {
          receiptId: "operation-record-course-settings-domain-summary-missing",
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          status: "persisted",
          audit: createSignedInlineOperationReceiptAudit(),
          displayMessage: {
            "zh-CN": "课程设置已由服务端持久化。",
            "en-US": "Course settings persisted by the server.",
          },
        },
        domainPersistenceSummary: {
          status: "missing-domain-objects",
          required: true,
          operationReceiptId: "operation-record-course-settings-domain-summary-missing",
          expectedObjectTypes: ["course-settings"],
          persistedObjectTypes: [],
          missingObjectTypes: ["course-settings"],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

    await waitFor(() => {
      expect(
        screen.getByText("领域对象未保存到服务器：course-settings。请稍后重试。"),
      ).toBeTruthy();
    });
    expect(screen.queryByText("课程设置已由服务端持久化。")).toBeNull();
    expect(screen.queryByText("审计读回已验证")).toBeNull();
  });

  it("does not claim inline course settings success when domain persistence evidence is omitted", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        receipt: {
          receiptId: "operation-record-course-settings-domain-summary-omitted",
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          status: "persisted",
          audit: createSignedInlineOperationReceiptAudit(),
          displayMessage: {
            "zh-CN": "课程设置已由服务端持久化。",
            "en-US": "Course settings persisted by the server.",
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

    await waitFor(() => {
      expect(screen.getByText("领域对象持久化证据缺失，请稍后重试。")).toBeTruthy();
    });
    expect(screen.queryByText("课程设置已由服务端持久化。")).toBeNull();
    expect(screen.queryByText("审计读回已验证")).toBeNull();
  });

  it("does not claim inline course settings success when audit trace evidence is missing", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        receipt: {
          receiptId: "operation-record-course-settings-trace-missing",
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          status: "persisted",
          audit: createSignedInlineOperationReceiptAudit(),
          displayMessage: {
            "zh-CN": "课程设置已由服务端持久化。",
            "en-US": "Course settings persisted by the server.",
          },
        },
        domainPersistenceSummary: {
          status: "persisted",
          required: true,
          operationReceiptId: "operation-record-course-settings-trace-missing",
          expectedObjectTypes: ["course-settings"],
          persistedObjectTypes: ["course-settings"],
          missingObjectTypes: [],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

    await waitFor(() => {
      expect(screen.getAllByText("审计读回未完成，请稍后刷新。").length).toBeGreaterThan(0);
    });
    expect(screen.queryByText("课程设置已由服务端持久化。")).toBeNull();
    expect(screen.queryByText("审计读回已验证")).toBeNull();
  });

  it("does not claim inline workspace success when the backend receipt identifies a different operation", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        receipt: {
          receiptId: "operation-record-course-settings-primary-wrong-workspace",
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          status: "persisted",
          audit: createSignedInlineOperationReceiptAudit(),
          displayMessage: {
            "zh-CN": "知识库索引同步已保存到服务端。",
            "en-US": "Knowledge index sync was saved to the server.",
          },
        },
        domainPersistenceSummary: {
          status: "persisted",
          required: true,
          operationReceiptId: "operation-record-course-settings-primary-wrong-workspace",
          expectedObjectTypes: ["course-settings"],
          persistedObjectTypes: ["course-settings"],
          missingObjectTypes: [],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("link", { name: "课程知识库" }));
    fireEvent.click(screen.getByRole("button", { name: "同步知识库索引" }));

    await waitFor(() => {
      expect(screen.getByText("服务端回执未匹配当前操作，请稍后重试。")).toBeTruthy();
    });
    expect(screen.queryByText("知识库索引同步已保存到服务端。")).toBeNull();
  });

  it("does not claim inline workspace success when the backend receipt omits operation identity", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        receipt: {
          receiptId: "operation-record-course-settings-identity-missing",
          courseId: "teacher-research-methods",
          status: "persisted",
          audit: createSignedInlineOperationReceiptAudit(),
          displayMessage: {
            "zh-CN": "课程设置已由服务端持久化。",
            "en-US": "Course settings persisted by the server.",
          },
        },
        domainPersistenceSummary: {
          status: "persisted",
          required: true,
          operationReceiptId: "operation-record-course-settings-identity-missing",
          expectedObjectTypes: ["course-settings"],
          persistedObjectTypes: ["course-settings"],
          missingObjectTypes: [],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

    await waitFor(() => {
      expect(screen.getByText("服务端回执未匹配当前操作，请稍后重试。")).toBeTruthy();
    });
    expect(screen.queryByText("课程设置已由服务端持久化。")).toBeNull();
    expect(screen.queryByText("审计读回已验证")).toBeNull();
  });

  it("surfaces inline operation rollback compensation when domain persistence partially fails", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/teaching/operations");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body)) as {
        operationId: string;
        actionSlot: string;
        courseId: string;
      };
      expect(body).toEqual(
        expect.objectContaining({
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
        }),
      );

      return Response.json(
        {
          traceId: "trace-inline-course-settings-domain-partial-failure",
          error: "External teaching course management persistence failed.",
          receipt: {
            receiptId: "teaching-operation-idempotent-course-settings-save",
            operationId: "course-settings",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
          },
          partialFailure: {
            status: "operation-persisted-course-management-domain-object-failed",
            failedStep: "course-management-domain-object",
            operationReceiptId: "teaching-operation-idempotent-course-settings-save",
            rollbackRoute:
              "/api/teaching/operations/records/teaching-operation-idempotent-course-settings-save/rollback",
            compensation: {
              status: "rolled-back",
              action: "rollback-teaching-operation-record",
              rollbackReason: "course-management-domain-object-failed",
              receipt: {
                receiptId:
                  "teaching-operation-rollback-teaching-operation-idempotent-course-settings-save",
                targetRecordId: "teaching-operation-idempotent-course-settings-save",
                status: "persisted",
                audit: createSignedInlineOperationReceiptAudit(),
              },
            },
          },
        },
        { status: 502 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "保存未完成，已自动撤回：teaching-operation-idempotent-course-settings-save。",
        ),
      ).toBeTruthy();
    });
    expect(screen.queryByText("未保存到服务器，请重新登录或检查课程权限。")).toBeNull();
    expect(
      screen.queryByText(
        "未保存到服务器：External teaching course management persistence failed.追踪编号：trace-inline-course-settings-domain-partial-failure",
      ),
    ).toBeNull();
  });

  it("waits for the backend receipt before showing inline workspace success", async () => {
    const traceId = "trace-inline-course-settings-primary";
    const receiptId = "operation-record-course-settings-primary";
    let resolveSave: (response: Response) => void = () => undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input) === "/api/teaching/operations/audit") {
        return Promise.resolve(
          createVerifiedInlineOperationAuditReadbackResponse({
            traceId,
            recordId: receiptId,
            operationId: "course-settings",
            actionSlot: "primary",
          }),
        );
      }
      if (String(input) === "/api/teaching/operations/audit/alerts") {
        return Promise.resolve(createClearInlineOperationAuditAlertsResponse(traceId));
      }
      return new Promise<Response>((resolve) => {
          resolveSave = resolve;
        });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/operations",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });
    expect(screen.getByText("正在保存到服务器，请稍候。")).toBeTruthy();
    expect(screen.queryByText("课程设置已保存到本地工作区。")).toBeNull();

    resolveSave(
      Response.json({
        receipt: {
          receiptId,
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          status: "persisted",
          audit: createSignedInlineOperationReceiptAudit(),
          displayMessage: {
            "zh-CN": "课程设置已由服务端持久化。",
            "en-US": "Course settings persisted by the server.",
          },
        },
        domainPersistenceSummary: createPersistedDomainPersistenceSummary(
          receiptId,
        ),
        traceId,
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("课程设置已由服务端持久化。")).toBeTruthy();
    });
  });

  it("uses server-oriented fallback copy when inline receipts omit display messages", async () => {
    const fallbackActions = [
      [
        "课程设置",
        "保存课程设置",
        "课程设置已由服务端持久化，等待审计读回。",
        "课程设置已保存到本地工作区。",
      ],
      [
        "课程知识库",
        "同步知识库索引",
        "知识库索引同步已保存到服务端。",
        "知识库索引已同步到本地预览。",
      ],
      [
        "学生管理",
        "重新统计学生名单",
        "已按当前加入记录重新统计班级和课程人数。",
        "学生名单已同步到本地视图。",
      ],
    ] as const;
    let latestAuditContext:
      | {
          traceId: string;
          recordId: string;
          operationId: string;
          actionSlot: "primary" | "secondary";
        }
      | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/operations/audit") {
        expect(latestAuditContext).toBeTruthy();
        return createVerifiedInlineOperationAuditReadbackResponse({
          traceId: latestAuditContext?.traceId ?? "trace-inline-missing",
          recordId: latestAuditContext?.recordId ?? "operation-record-missing",
          operationId: latestAuditContext?.operationId ?? "course-settings",
          actionSlot: latestAuditContext?.actionSlot ?? "primary",
        });
      }
      if (String(input) === "/api/teaching/operations/audit/alerts") {
        return createClearInlineOperationAuditAlertsResponse(
          latestAuditContext?.traceId ?? "trace-inline-missing",
        );
      }
      const body = JSON.parse(String(init?.body)) as {
        operationId: string;
        actionSlot: "primary" | "secondary";
      };
      const receiptId = `operation-record-${body.operationId}-${body.actionSlot}`;
      const traceId = `trace-inline-${body.operationId}-${body.actionSlot}`;
      latestAuditContext = {
        traceId,
        recordId: receiptId,
        operationId: body.operationId,
        actionSlot: body.actionSlot,
      };
      return Response.json({
        receipt: {
          receiptId,
          operationId: body.operationId,
          actionSlot: body.actionSlot,
          status: "persisted",
          audit: createSignedInlineOperationReceiptAudit(),
          courseId: "teacher-research-methods",
        },
        domainPersistenceSummary: createPersistedInlineOperationDomainPersistenceSummary(
          receiptId,
          body.operationId,
          body.actionSlot,
        ),
        traceId,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    for (const [workspaceLabel, actionLabel, serverCopy, localCopy] of fallbackActions) {
      fireEvent.click(screen.getByRole("link", { name: workspaceLabel }));
      fireEvent.click(screen.getByRole("button", { name: actionLabel }));

      await waitFor(() => {
        expect(screen.getByText(serverCopy)).toBeTruthy();
      });
      expect(screen.queryByText(localCopy)).toBeNull();
    }
  });

  it("requires agent plan business readback before claiming agent plan save success", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId: string;
          actionSlot: "primary" | "secondary";
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "agents",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            sourceAction: "inline-teaching-workspace",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-record-agent-plan-semantic-missing",
            operationId: "agents",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
            displayMessage: {
              "zh-CN": "智能体方案已保存，服务端密钥仍保持隔离。",
              "en-US": "Agent plan saved while server keys remain isolated.",
            },
          },
          domainPersistenceSummary: createPersistedInlineOperationDomainPersistenceSummary(
            "operation-record-agent-plan-semantic-missing",
            "agents",
            "primary",
          ),
          traceId: "trace-inline-agent-plan-semantic-missing",
        });
      }

      if (String(input) === "/api/teaching/operations/audit") {
        expect(init?.method).toBe("GET");
        return Response.json({
          traceId: "trace-audit-agent-plan-semantic-missing",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          recordCount: 1,
          auditEventCount: 1,
          domainProjectionCount: 1,
          records: [
            {
              recordId: "operation-record-agent-plan-semantic-missing",
              courseId: "teacher-research-methods",
              operationId: "agents",
              actionSlot: "primary",
              status: "persisted",
            },
          ],
          auditEvents: [
            {
              eventId: "audit-agent-plan-semantic-missing",
              traceId: "trace-inline-agent-plan-semantic-missing",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              authSession: createInlineAuditAuthSession(),
              courseId: "teacher-research-methods",
            },
          ],
          domainProjections: [
            {
              objectId: "agent-plan-teacher-research-methods",
              objectType: "agent-plan",
              courseId: "teacher-research-methods",
              operationRecordId: "operation-record-agent-plan-semantic-missing",
            },
          ],
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit/alerts");
      return createClearInlineOperationAuditAlertsResponse(
        "trace-inline-agent-plan-semantic-missing",
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("link", { name: "智能体配置" }));
    fireEvent.click(screen.getByRole("button", { name: "保存智能体方案" }));

    await waitFor(() => {
      expect(screen.getByText("智能体方案读回未匹配保存结果，请稍后刷新。")).toBeTruthy();
    });
    expect(screen.queryByText("智能体方案已保存，服务端密钥仍保持隔离。")).toBeNull();
    expect(
      screen.queryByText("领域对象已验证：agent-plan / agent-plan-teacher-research-methods"),
    ).toBeNull();
  });

  it("requires student preview session business readback before claiming preview success", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId: string;
          actionSlot: "primary" | "secondary";
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "course-settings",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            sourceAction: "inline-teaching-workspace",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-record-student-preview-session-semantic-missing",
            operationId: "course-settings",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
            displayMessage: {
              "zh-CN": "学生端预览已生成。",
              "en-US": "Student preview generated.",
            },
          },
          domainPersistenceSummary: createPersistedInlineOperationDomainPersistenceSummary(
            "operation-record-student-preview-session-semantic-missing",
            "course-settings",
            "secondary",
          ),
          traceId: "trace-inline-student-preview-session-semantic-missing",
        });
      }

      if (String(input) === "/api/teaching/operations/audit") {
        expect(init?.method).toBe("GET");
        return Response.json({
          traceId: "trace-audit-student-preview-session-semantic-missing",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          recordCount: 1,
          auditEventCount: 1,
          domainProjectionCount: 1,
          records: [
            {
              recordId: "operation-record-student-preview-session-semantic-missing",
              courseId: "teacher-research-methods",
              operationId: "course-settings",
              actionSlot: "secondary",
              status: "persisted",
            },
          ],
          auditEvents: [
            {
              eventId: "audit-student-preview-session-semantic-missing",
              traceId: "trace-inline-student-preview-session-semantic-missing",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              authSession: createInlineAuditAuthSession(),
              courseId: "teacher-research-methods",
            },
          ],
          domainProjections: [
            {
              objectId: "student-preview-session-teacher-research-methods",
              objectType: "student-preview-session",
              courseId: "teacher-research-methods",
              operationRecordId:
                "operation-record-student-preview-session-semantic-missing",
            },
          ],
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit/alerts");
      return createClearInlineOperationAuditAlertsResponse(
        "trace-inline-student-preview-session-semantic-missing",
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("button", { name: "预览学生端" }));

    await waitFor(() => {
      expect(
        screen.getByText("学生端预览读回未匹配生成结果，请稍后刷新。"),
      ).toBeTruthy();
    });
    expect(screen.queryByText("学生端预览已生成。")).toBeNull();
    expect(
      screen.queryByText(
        "领域对象已验证：student-preview-session / student-preview-session-teacher-research-methods",
      ),
    ).toBeNull();
  });

  it("requires permission preflight business readback before claiming preflight success", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId: string;
          actionSlot: "primary" | "secondary";
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "agents",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            sourceAction: "inline-teaching-workspace",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-record-permission-preflight-semantic-missing",
            operationId: "agents",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
            displayMessage: {
              "zh-CN": "权限预检仅通过课程授权角色。",
              "en-US": "Permission preflight passed for course-authorized roles only.",
            },
          },
          domainPersistenceSummary: createPersistedInlineOperationDomainPersistenceSummary(
            "operation-record-permission-preflight-semantic-missing",
            "agents",
            "secondary",
          ),
          traceId: "trace-inline-permission-preflight-semantic-missing",
        });
      }

      if (String(input) === "/api/teaching/operations/audit") {
        expect(init?.method).toBe("GET");
        return Response.json({
          traceId: "trace-audit-permission-preflight-semantic-missing",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          recordCount: 1,
          auditEventCount: 1,
          domainProjectionCount: 1,
          records: [
            {
              recordId: "operation-record-permission-preflight-semantic-missing",
              courseId: "teacher-research-methods",
              operationId: "agents",
              actionSlot: "secondary",
              status: "persisted",
            },
          ],
          auditEvents: [
            {
              eventId: "audit-permission-preflight-semantic-missing",
              traceId: "trace-inline-permission-preflight-semantic-missing",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              authSession: createInlineAuditAuthSession(),
              courseId: "teacher-research-methods",
            },
          ],
          domainProjections: [
            {
              objectId: "permission-preflight-teacher-research-methods",
              objectType: "permission-preflight",
              courseId: "teacher-research-methods",
              operationRecordId:
                "operation-record-permission-preflight-semantic-missing",
            },
          ],
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit/alerts");
      return createClearInlineOperationAuditAlertsResponse(
        "trace-inline-permission-preflight-semantic-missing",
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("link", { name: "智能体配置" }));
    fireEvent.click(screen.getByRole("button", { name: "运行权限预检" }));

    await waitFor(() => {
      expect(screen.getByText("权限预检读回未匹配检查结果，请稍后刷新。")).toBeTruthy();
    });
    expect(screen.queryByText("权限预检仅通过课程授权角色。")).toBeNull();
    expect(
      screen.queryByText(
        "领域对象已验证：permission-preflight / permission-preflight-teacher-research-methods",
      ),
    ).toBeNull();
  });

  it("requires admin settings business readback before claiming admin settings save success", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId: string;
          actionSlot: "primary" | "secondary";
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "admins",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            sourceAction: "inline-teaching-workspace",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-record-admin-settings-semantic-missing",
            operationId: "admins",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
            displayMessage: {
              "zh-CN": "管理员设置已保存，权限变更进入审计记录。",
              "en-US": "Admin settings saved with permission changes in audit.",
            },
          },
          domainPersistenceSummary: createPersistedInlineOperationDomainPersistenceSummary(
            "operation-record-admin-settings-semantic-missing",
            "admins",
            "primary",
          ),
          traceId: "trace-inline-admin-settings-semantic-missing",
        });
      }

      if (String(input) === "/api/teaching/operations/audit") {
        expect(init?.method).toBe("GET");
        return Response.json({
          traceId: "trace-audit-admin-settings-semantic-missing",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          recordCount: 1,
          auditEventCount: 1,
          domainProjectionCount: 1,
          records: [
            {
              recordId: "operation-record-admin-settings-semantic-missing",
              courseId: "teacher-research-methods",
              operationId: "admins",
              actionSlot: "primary",
              status: "persisted",
            },
          ],
          auditEvents: [
            {
              eventId: "audit-admin-settings-semantic-missing",
              traceId: "trace-inline-admin-settings-semantic-missing",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              authSession: createInlineAuditAuthSession(),
              courseId: "teacher-research-methods",
            },
          ],
          domainProjections: [
            {
              objectId: "admin-settings-teacher-research-methods",
              objectType: "admin-settings",
              courseId: "teacher-research-methods",
              operationRecordId: "operation-record-admin-settings-semantic-missing",
            },
          ],
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit/alerts");
      return createClearInlineOperationAuditAlertsResponse(
        "trace-inline-admin-settings-semantic-missing",
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("link", { name: "管理员设置" }));
    fireEvent.click(screen.getByRole("button", { name: "保存管理员设置" }));

    await waitFor(() => {
      expect(screen.getByText("管理员设置读回未匹配保存结果，请稍后刷新。")).toBeTruthy();
    });
    expect(screen.queryByText("管理员设置已保存，权限变更进入审计记录。")).toBeNull();
    expect(
      screen.queryByText("领域对象已验证：admin-settings / admin-settings-teacher-research-methods"),
    ).toBeNull();
  });

  it("requires collaboration invite notification readback before claiming invite send success", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId: string;
          actionSlot: "primary" | "secondary";
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "admins",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            sourceAction: "inline-teaching-workspace",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-record-collaboration-invite-semantic-missing",
            operationId: "admins",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
            displayMessage: {
              "zh-CN": "协作邀请通知已进入服务端邮件队列。",
              "en-US": "Collaboration invite notification queued in the server mail outbox.",
            },
          },
          domainPersistenceSummary: createPersistedInlineOperationDomainPersistenceSummary(
            "operation-record-collaboration-invite-semantic-missing",
            "admins",
            "secondary",
          ),
          traceId: "trace-inline-collaboration-invite-semantic-missing",
        });
      }

      if (String(input) === "/api/teaching/operations/audit") {
        expect(init?.method).toBe("GET");
        return Response.json({
          traceId: "trace-audit-collaboration-invite-semantic-missing",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          recordCount: 1,
          auditEventCount: 1,
          domainProjectionCount: 1,
          records: [
            {
              recordId: "operation-record-collaboration-invite-semantic-missing",
              courseId: "teacher-research-methods",
              operationId: "admins",
              actionSlot: "secondary",
              status: "persisted",
            },
          ],
          auditEvents: [
            {
              eventId: "audit-collaboration-invite-semantic-missing",
              traceId: "trace-inline-collaboration-invite-semantic-missing",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              authSession: createInlineAuditAuthSession(),
              courseId: "teacher-research-methods",
            },
          ],
          domainProjections: [
            {
              objectId: "email-notification-teacher-research-methods-collaboration-invite",
              objectType: "email-notification",
              courseId: "teacher-research-methods",
              operationRecordId:
                "operation-record-collaboration-invite-semantic-missing",
            },
          ],
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit/alerts");
      return createClearInlineOperationAuditAlertsResponse(
        "trace-inline-collaboration-invite-semantic-missing",
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("link", { name: "管理员设置" }));
    fireEvent.click(screen.getByRole("button", { name: "发送协作邀请" }));

    await waitFor(() => {
      expect(screen.getByText("协作邀请通知读回未匹配入队结果，请稍后刷新。")).toBeTruthy();
    });
    expect(screen.queryByText("协作邀请通知已进入服务端邮件队列。")).toBeNull();
    expect(
      screen.queryByText(
        "领域对象已验证：email-notification / email-notification-teacher-research-methods-collaboration-invite",
      ),
    ).toBeNull();
  });

  it("requires quiz board state business readback before claiming quiz board refresh success", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId: string;
          actionSlot: "primary" | "secondary";
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "quiz-board",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            sourceAction: "inline-teaching-workspace",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-record-quiz-board-state-semantic-missing",
            operationId: "quiz-board",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
            displayMessage: {
              "zh-CN": "测验看板已刷新，错因分布可复核。",
              "en-US": "Quiz board refreshed with error patterns ready for review.",
            },
          },
          domainPersistenceSummary: createPersistedInlineOperationDomainPersistenceSummary(
            "operation-record-quiz-board-state-semantic-missing",
            "quiz-board",
            "primary",
          ),
          traceId: "trace-inline-quiz-board-state-semantic-missing",
        });
      }

      if (String(input) === "/api/teaching/operations/audit") {
        expect(init?.method).toBe("GET");
        return Response.json({
          traceId: "trace-audit-quiz-board-state-semantic-missing",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          recordCount: 1,
          auditEventCount: 1,
          domainProjectionCount: 1,
          records: [
            {
              recordId: "operation-record-quiz-board-state-semantic-missing",
              courseId: "teacher-research-methods",
              operationId: "quiz-board",
              actionSlot: "primary",
              status: "persisted",
            },
          ],
          auditEvents: [
            {
              eventId: "audit-quiz-board-state-semantic-missing",
              traceId: "trace-inline-quiz-board-state-semantic-missing",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              authSession: createInlineAuditAuthSession(),
              courseId: "teacher-research-methods",
            },
          ],
          domainProjections: [
            {
              objectId: "quiz-board-state-teacher-research-methods",
              objectType: "quiz-board-state",
              courseId: "teacher-research-methods",
              operationRecordId: "operation-record-quiz-board-state-semantic-missing",
            },
          ],
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit/alerts");
      return createClearInlineOperationAuditAlertsResponse(
        "trace-inline-quiz-board-state-semantic-missing",
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("link", { name: "测验看板" }));
    fireEvent.click(screen.getByRole("button", { name: "刷新测验看板" }));

    await waitFor(() => {
      expect(screen.getByText("测验看板读回未匹配刷新结果，请稍后刷新。")).toBeTruthy();
    });
    expect(screen.queryByText("测验看板已刷新，错因分布可复核。")).toBeNull();
    expect(
      screen.queryByText(
        "领域对象已验证：quiz-board-state / quiz-board-state-teacher-research-methods",
      ),
    ).toBeNull();
  });

  it("requires quiz item review business readback before claiming low-quality item review success", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId: string;
          actionSlot: "primary" | "secondary";
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "quiz-board",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            sourceAction: "inline-teaching-workspace",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-record-quiz-item-review-semantic-missing",
            operationId: "quiz-board",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
            displayMessage: {
              "zh-CN": "低质题已标记为教师复核。",
              "en-US": "Low-quality items flagged for teacher review.",
            },
          },
          domainPersistenceSummary: createPersistedInlineOperationDomainPersistenceSummary(
            "operation-record-quiz-item-review-semantic-missing",
            "quiz-board",
            "secondary",
          ),
          traceId: "trace-inline-quiz-item-review-semantic-missing",
        });
      }

      if (String(input) === "/api/teaching/operations/audit") {
        expect(init?.method).toBe("GET");
        return Response.json({
          traceId: "trace-audit-quiz-item-review-semantic-missing",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          recordCount: 1,
          auditEventCount: 1,
          domainProjectionCount: 1,
          records: [
            {
              recordId: "operation-record-quiz-item-review-semantic-missing",
              courseId: "teacher-research-methods",
              operationId: "quiz-board",
              actionSlot: "secondary",
              status: "persisted",
            },
          ],
          auditEvents: [
            {
              eventId: "audit-quiz-item-review-semantic-missing",
              traceId: "trace-inline-quiz-item-review-semantic-missing",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              authSession: createInlineAuditAuthSession(),
              courseId: "teacher-research-methods",
            },
          ],
          domainProjections: [
            {
              objectId: "quiz-item-review-teacher-research-methods",
              objectType: "quiz-item-review",
              courseId: "teacher-research-methods",
              operationRecordId: "operation-record-quiz-item-review-semantic-missing",
            },
          ],
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit/alerts");
      return createClearInlineOperationAuditAlertsResponse(
        "trace-inline-quiz-item-review-semantic-missing",
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("link", { name: "测验看板" }));
    fireEvent.click(screen.getByRole("button", { name: "标记低质题复核" }));

    await waitFor(() => {
      expect(screen.getByText("低质题复核读回未匹配标记结果，请稍后刷新。")).toBeTruthy();
    });
    expect(screen.queryByText("低质题已标记为教师复核。")).toBeNull();
    expect(
      screen.queryByText(
        "领域对象已验证：quiz-item-review / quiz-item-review-teacher-research-methods",
      ),
    ).toBeNull();
  });

  it("requires export manifest business readback before claiming export manifest success", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId: string;
          actionSlot: "primary" | "secondary";
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "data-export",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            sourceAction: "inline-teaching-workspace",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-record-export-manifest-semantic-missing",
            operationId: "data-export",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
            displayMessage: {
              "zh-CN": "导出清单已生成，可交给服务端导出任务。",
              "en-US": "Export manifest created for server-side export jobs.",
            },
          },
          domainPersistenceSummary: createPersistedInlineOperationDomainPersistenceSummary(
            "operation-record-export-manifest-semantic-missing",
            "data-export",
            "primary",
          ),
          traceId: "trace-inline-export-manifest-semantic-missing",
        });
      }

      if (String(input) === "/api/teaching/operations/audit") {
        expect(init?.method).toBe("GET");
        return Response.json({
          traceId: "trace-audit-export-manifest-semantic-missing",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          recordCount: 1,
          auditEventCount: 1,
          domainProjectionCount: 1,
          records: [
            {
              recordId: "operation-record-export-manifest-semantic-missing",
              courseId: "teacher-research-methods",
              operationId: "data-export",
              actionSlot: "primary",
              status: "persisted",
            },
          ],
          auditEvents: [
            {
              eventId: "audit-export-manifest-semantic-missing",
              traceId: "trace-inline-export-manifest-semantic-missing",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              authSession: createInlineAuditAuthSession(),
              courseId: "teacher-research-methods",
            },
          ],
          domainProjections: [
            {
              objectId: "export-manifest-teacher-research-methods",
              objectType: "export-manifest",
              courseId: "teacher-research-methods",
              operationRecordId: "operation-record-export-manifest-semantic-missing",
            },
          ],
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit/alerts");
      return createClearInlineOperationAuditAlertsResponse(
        "trace-inline-export-manifest-semantic-missing",
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("link", { name: "数据导出" }));
    fireEvent.click(screen.getByRole("button", { name: "生成导出清单" }));

    await waitFor(() => {
      expect(screen.getByText("导出清单读回未匹配生成结果，请稍后刷新。")).toBeTruthy();
    });
    expect(screen.queryByText("导出清单已生成，可交给服务端导出任务。")).toBeNull();
    expect(
      screen.queryByText("领域对象已验证：export-manifest / export-manifest-teacher-research-methods"),
    ).toBeNull();
  });

  it("requires redaction validation business readback before claiming redaction validation success", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId: string;
          actionSlot: "primary" | "secondary";
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "data-export",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            sourceAction: "inline-teaching-workspace",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-record-redaction-validation-semantic-missing",
            operationId: "data-export",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
            displayMessage: {
              "zh-CN": "脱敏范围校验通过：不包含真实密钥。",
              "en-US": "Redaction scope passed with no real keys included.",
            },
          },
          domainPersistenceSummary: createPersistedInlineOperationDomainPersistenceSummary(
            "operation-record-redaction-validation-semantic-missing",
            "data-export",
            "secondary",
          ),
          traceId: "trace-inline-redaction-validation-semantic-missing",
        });
      }

      if (String(input) === "/api/teaching/operations/audit") {
        expect(init?.method).toBe("GET");
        return Response.json({
          traceId: "trace-audit-redaction-validation-semantic-missing",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          recordCount: 1,
          auditEventCount: 1,
          domainProjectionCount: 1,
          records: [
            {
              recordId: "operation-record-redaction-validation-semantic-missing",
              courseId: "teacher-research-methods",
              operationId: "data-export",
              actionSlot: "secondary",
              status: "persisted",
            },
          ],
          auditEvents: [
            {
              eventId: "audit-redaction-validation-semantic-missing",
              traceId: "trace-inline-redaction-validation-semantic-missing",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              authSession: createInlineAuditAuthSession(),
              courseId: "teacher-research-methods",
            },
          ],
          domainProjections: [
            {
              objectId: "redaction-validation-teacher-research-methods",
              objectType: "redaction-validation",
              courseId: "teacher-research-methods",
              operationRecordId:
                "operation-record-redaction-validation-semantic-missing",
            },
          ],
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit/alerts");
      return createClearInlineOperationAuditAlertsResponse(
        "trace-inline-redaction-validation-semantic-missing",
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("link", { name: "数据导出" }));
    fireEvent.click(screen.getByRole("button", { name: "校验脱敏范围" }));

    await waitFor(() => {
      expect(screen.getByText("脱敏范围读回未匹配校验结果，请稍后刷新。")).toBeTruthy();
    });
    expect(screen.queryByText("脱敏范围校验通过：不包含真实密钥。")).toBeNull();
    expect(
      screen.queryByText(
        "领域对象已验证：redaction-validation / redaction-validation-teacher-research-methods",
      ),
    ).toBeNull();
  });

  it("requires student roster business readback before claiming roster sync success", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId: string;
          actionSlot: "primary" | "secondary";
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "students",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            sourceAction: "inline-teaching-workspace",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-record-students-roster-semantic-missing",
            operationId: "students",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
            displayMessage: {
              "zh-CN": "已按当前加入记录重新统计班级和课程人数。",
              "en-US": "Student roster sync was saved to the server.",
            },
          },
          domainPersistenceSummary: createPersistedInlineOperationDomainPersistenceSummary(
            "operation-record-students-roster-semantic-missing",
            "students",
            "primary",
          ),
          traceId: "trace-inline-students-roster-semantic-missing",
        });
      }

      if (String(input) === "/api/teaching/operations/audit") {
        expect(init?.method).toBe("GET");
        return Response.json({
          traceId: "trace-audit-students-roster-semantic-missing",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          recordCount: 1,
          auditEventCount: 1,
          domainProjectionCount: 1,
          records: [
            {
              recordId: "operation-record-students-roster-semantic-missing",
              courseId: "teacher-research-methods",
              operationId: "students",
              actionSlot: "primary",
              status: "persisted",
            },
          ],
          auditEvents: [
            {
              eventId: "audit-students-roster-semantic-missing",
              traceId: "trace-inline-students-roster-semantic-missing",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              authSession: createInlineAuditAuthSession(),
              courseId: "teacher-research-methods",
            },
          ],
          domainProjections: [
            {
              objectId: "student-roster-teacher-research-methods",
              objectType: "student-roster",
              courseId: "teacher-research-methods",
              operationRecordId: "operation-record-students-roster-semantic-missing",
            },
          ],
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit/alerts");
      return createClearInlineOperationAuditAlertsResponse(
        "trace-inline-students-roster-semantic-missing",
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("link", { name: "学生管理" }));
    fireEvent.click(screen.getByRole("button", { name: "重新统计学生名单" }));

    await waitFor(() => {
      expect(screen.getByText("学生名单读回未匹配同步结果，请稍后刷新。")).toBeTruthy();
    });
    expect(screen.queryByText("已按当前加入记录重新统计班级和课程人数。")).toBeNull();
    expect(
      screen.queryByText("领域对象已验证：student-roster / student-roster-teacher-research-methods"),
    ).toBeNull();
  });

  it("requires group suggestions business readback before claiming group suggestion success", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId: string;
          actionSlot: "primary" | "secondary";
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "students",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            sourceAction: "inline-teaching-workspace",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-record-group-suggestions-semantic-missing",
            operationId: "students",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
            displayMessage: {
              "zh-CN": "分组建议已生成，等待教师确认。",
              "en-US": "Group suggestions generated for teacher confirmation.",
            },
          },
          domainPersistenceSummary: createPersistedInlineOperationDomainPersistenceSummary(
            "operation-record-group-suggestions-semantic-missing",
            "students",
            "secondary",
          ),
          traceId: "trace-inline-group-suggestions-semantic-missing",
        });
      }

      if (String(input) === "/api/teaching/operations/audit") {
        expect(init?.method).toBe("GET");
        return Response.json({
          traceId: "trace-audit-group-suggestions-semantic-missing",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          recordCount: 1,
          auditEventCount: 1,
          domainProjectionCount: 1,
          records: [
            {
              recordId: "operation-record-group-suggestions-semantic-missing",
              courseId: "teacher-research-methods",
              operationId: "students",
              actionSlot: "secondary",
              status: "persisted",
            },
          ],
          auditEvents: [
            {
              eventId: "audit-group-suggestions-semantic-missing",
              traceId: "trace-inline-group-suggestions-semantic-missing",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              authSession: createInlineAuditAuthSession(),
              courseId: "teacher-research-methods",
            },
          ],
          domainProjections: [
            {
              objectId: "group-suggestions-teacher-research-methods",
              objectType: "group-suggestions",
              courseId: "teacher-research-methods",
              operationRecordId: "operation-record-group-suggestions-semantic-missing",
            },
          ],
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit/alerts");
      return createClearInlineOperationAuditAlertsResponse(
        "trace-inline-group-suggestions-semantic-missing",
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("link", { name: "学生管理" }));
    fireEvent.click(screen.getByRole("button", { name: "生成分组建议" }));

    await waitFor(() => {
      expect(screen.getByText("分组建议读回未匹配生成结果，请稍后刷新。")).toBeTruthy();
    });
    expect(screen.queryByText("分组建议已生成，等待教师确认。")).toBeNull();
    expect(
      screen.queryByText("领域对象已验证：group-suggestions / group-suggestions-teacher-research-methods"),
    ).toBeNull();
  });

  it("shows the teacher the partition the group-suggestion action proposed", async () => {
    const recordId = "operation-record-group-suggestions-returned";
    const traceId = "trace-inline-group-suggestions-returned";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/courses") {
        return createResearchMethodsClassCourseListReadback();
      }
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        return Response.json({
          receipt: {
            receiptId: recordId,
            operationId: "students",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
            displayMessage: {
              "zh-CN": "分组建议已生成，等待教师确认。",
              "en-US": "Group suggestions generated for teacher confirmation.",
            },
          },
          // The route persists this partition and now returns it. Reporting only
          // "generated" was why the button read as unwired: the teacher was told
          // a suggestion existed and shown nothing that had been suggested.
          studentGroupSuggestionReceipt: {
            action: "generate-student-group-suggestions",
            status: "persisted",
            ungroupedStudentCount: 5,
            reviewPolicy: "teacher-review-before-group-assignment",
            suggestedGroups: [
              {
                groupName: "第1组",
                members: [
                  { studentId: "student-chen", studentDisplayName: "陈可" },
                  { studentId: "student-li", studentDisplayName: "李明" },
                  { studentId: "student-wu", studentDisplayName: "吴敏" },
                  { studentId: "student-zhao", studentDisplayName: "赵一鸣" },
                ],
              },
              {
                groupName: "第2组",
                members: [{ studentId: "student-he", studentDisplayName: "何雨桐" }],
              },
            ],
          },
          domainPersistenceSummary: createPersistedInlineOperationDomainPersistenceSummary(
            recordId,
            "students",
            "secondary",
          ),
          traceId,
        });
      }
      if (String(input) === "/api/teaching/operations/audit") {
        return createVerifiedInlineOperationAuditReadbackResponse({
          traceId,
          recordId,
          operationId: "students",
          actionSlot: "secondary",
        });
      }
      expect(String(input)).toBe("/api/teaching/operations/audit/alerts");
      return createClearInlineOperationAuditAlertsResponse(traceId);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("link", { name: "学生管理" }));
    fireEvent.click(screen.getByRole("button", { name: "生成分组建议" }));

    await waitFor(() => {
      expect(
        screen.getByText(/建议分组：第1组（4 人）、第2组（1 人）/),
      ).toBeTruthy();
    });
    // The sentence keeps the confirmation it extends, and says out loud that
    // nothing has been assigned.
    expect(screen.getByText(/分组建议已生成，等待教师确认。/)).toBeTruthy();
    expect(screen.getByText(/覆盖 5 名尚未分组的学生/)).toBeTruthy();
    expect(screen.getByText(/等待教师确认后才会写入/)).toBeTruthy();
  });

  it("requires knowledge index business readback before claiming knowledge sync success", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId: string;
          actionSlot: "primary" | "secondary";
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "knowledge-base",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            sourceAction: "inline-teaching-workspace",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-record-knowledge-index-semantic-missing",
            operationId: "knowledge-base",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
            displayMessage: {
              "zh-CN": "知识库索引同步已保存到服务端。",
              "en-US": "Knowledge index sync was saved to the server.",
            },
          },
          domainPersistenceSummary: createPersistedInlineOperationDomainPersistenceSummary(
            "operation-record-knowledge-index-semantic-missing",
            "knowledge-base",
            "primary",
          ),
          traceId: "trace-inline-knowledge-index-semantic-missing",
        });
      }

      if (String(input) === "/api/teaching/operations/audit") {
        expect(init?.method).toBe("GET");
        return Response.json({
          traceId: "trace-audit-knowledge-index-semantic-missing",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          recordCount: 1,
          auditEventCount: 1,
          domainProjectionCount: 1,
          records: [
            {
              recordId: "operation-record-knowledge-index-semantic-missing",
              courseId: "teacher-research-methods",
              operationId: "knowledge-base",
              actionSlot: "primary",
              status: "persisted",
            },
          ],
          auditEvents: [
            {
              eventId: "audit-knowledge-index-semantic-missing",
              traceId: "trace-inline-knowledge-index-semantic-missing",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              authSession: createInlineAuditAuthSession(),
              courseId: "teacher-research-methods",
            },
          ],
          domainProjections: [
            {
              objectId: "knowledge-index-teacher-research-methods",
              objectType: "knowledge-index",
              courseId: "teacher-research-methods",
              operationRecordId: "operation-record-knowledge-index-semantic-missing",
            },
          ],
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit/alerts");
      return createClearInlineOperationAuditAlertsResponse(
        "trace-inline-knowledge-index-semantic-missing",
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("link", { name: "课程知识库" }));
    fireEvent.click(screen.getByRole("button", { name: "同步知识库索引" }));

    await waitFor(() => {
      expect(screen.getByText("知识库索引读回未匹配同步结果，请稍后刷新。")).toBeTruthy();
    });
    expect(screen.queryByText("知识库索引同步已保存到服务端。")).toBeNull();
    expect(
      screen.queryByText("领域对象已验证：knowledge-index / knowledge-index-teacher-research-methods"),
    ).toBeNull();
  });

  it("requires resource review item business readback before claiming resource placeholder success", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId: string;
          actionSlot: "primary" | "secondary";
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "knowledge-base",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            sourceAction: "inline-teaching-workspace",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-record-resource-review-semantic-missing",
            operationId: "knowledge-base",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
            displayMessage: {
              "zh-CN": "资料占位已加入待审核队列。",
              "en-US": "Resource placeholder was added to the review queue.",
            },
          },
          domainPersistenceSummary: createPersistedInlineOperationDomainPersistenceSummary(
            "operation-record-resource-review-semantic-missing",
            "knowledge-base",
            "secondary",
          ),
          traceId: "trace-inline-resource-review-semantic-missing",
        });
      }

      if (String(input) === "/api/teaching/operations/audit") {
        expect(init?.method).toBe("GET");
        return Response.json({
          traceId: "trace-audit-resource-review-semantic-missing",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          recordCount: 1,
          auditEventCount: 1,
          domainProjectionCount: 1,
          records: [
            {
              recordId: "operation-record-resource-review-semantic-missing",
              courseId: "teacher-research-methods",
              operationId: "knowledge-base",
              actionSlot: "secondary",
              status: "persisted",
            },
          ],
          auditEvents: [
            {
              eventId: "audit-resource-review-semantic-missing",
              traceId: "trace-inline-resource-review-semantic-missing",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              authSession: createInlineAuditAuthSession(),
              courseId: "teacher-research-methods",
            },
          ],
          domainProjections: [
            {
              objectId: "resource-review-item-teacher-research-methods",
              objectType: "resource-review-item",
              courseId: "teacher-research-methods",
              operationRecordId: "operation-record-resource-review-semantic-missing",
            },
          ],
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit/alerts");
      return createClearInlineOperationAuditAlertsResponse(
        "trace-inline-resource-review-semantic-missing",
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("link", { name: "课程知识库" }));
    fireEvent.click(screen.getByRole("button", { name: "添加资料占位" }));

    await waitFor(() => {
      expect(screen.getByText("资源复核项读回未匹配入队结果，请稍后刷新。")).toBeTruthy();
    });
    expect(screen.queryByText("资料占位已加入待审核队列。")).toBeNull();
    expect(
      screen.queryByText(
        "领域对象已验证：resource-review-item / resource-review-item-teacher-research-methods",
      ),
    ).toBeNull();
  });

  it("requires dashboard state business readback before claiming dashboard refresh success", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId: string;
          actionSlot: "primary" | "secondary";
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "dashboard",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            sourceAction: "inline-teaching-workspace",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-record-dashboard-state-semantic-missing",
            operationId: "dashboard",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
            displayMessage: {
              "zh-CN": "数据看板已刷新。",
              "en-US": "Dashboard refreshed.",
            },
          },
          domainPersistenceSummary: createPersistedInlineOperationDomainPersistenceSummary(
            "operation-record-dashboard-state-semantic-missing",
            "dashboard",
            "primary",
          ),
          traceId: "trace-inline-dashboard-state-semantic-missing",
        });
      }

      if (String(input) === "/api/teaching/operations/audit") {
        expect(init?.method).toBe("GET");
        return Response.json({
          traceId: "trace-audit-dashboard-state-semantic-missing",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          recordCount: 1,
          auditEventCount: 1,
          domainProjectionCount: 1,
          records: [
            {
              recordId: "operation-record-dashboard-state-semantic-missing",
              courseId: "teacher-research-methods",
              operationId: "dashboard",
              actionSlot: "primary",
              status: "persisted",
            },
          ],
          auditEvents: [
            {
              eventId: "audit-dashboard-state-semantic-missing",
              traceId: "trace-inline-dashboard-state-semantic-missing",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              authSession: createInlineAuditAuthSession(),
              courseId: "teacher-research-methods",
            },
          ],
          domainProjections: [
            {
              objectId: "dashboard-state-teacher-research-methods",
              objectType: "dashboard-state",
              courseId: "teacher-research-methods",
              operationRecordId: "operation-record-dashboard-state-semantic-missing",
            },
          ],
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit/alerts");
      return createClearInlineOperationAuditAlertsResponse(
        "trace-inline-dashboard-state-semantic-missing",
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("link", { name: "数据看板" }));
    fireEvent.click(screen.getByRole("button", { name: "刷新数据看板" }));

    await waitFor(() => {
      expect(screen.getByText("数据看板读回未匹配刷新结果，请稍后刷新。")).toBeTruthy();
    });
    expect(screen.queryByText("数据看板已刷新。")).toBeNull();
    expect(
      screen.queryByText("领域对象已验证：dashboard-state / dashboard-state-teacher-research-methods"),
    ).toBeNull();
  });

  it("requires dashboard snapshot business readback before claiming daily snapshot lock success", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId: string;
          actionSlot: "primary" | "secondary";
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "dashboard",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            sourceAction: "inline-teaching-workspace",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-record-dashboard-snapshot-semantic-missing",
            operationId: "dashboard",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
            displayMessage: {
              "zh-CN": "日报快照已锁定到当前视图。",
              "en-US": "Daily snapshot locked to current view.",
            },
          },
          domainPersistenceSummary: createPersistedInlineOperationDomainPersistenceSummary(
            "operation-record-dashboard-snapshot-semantic-missing",
            "dashboard",
            "secondary",
          ),
          traceId: "trace-inline-dashboard-snapshot-semantic-missing",
        });
      }

      if (String(input) === "/api/teaching/operations/audit") {
        expect(init?.method).toBe("GET");
        return Response.json({
          traceId: "trace-audit-dashboard-snapshot-semantic-missing",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          recordCount: 1,
          auditEventCount: 1,
          domainProjectionCount: 1,
          records: [
            {
              recordId: "operation-record-dashboard-snapshot-semantic-missing",
              courseId: "teacher-research-methods",
              operationId: "dashboard",
              actionSlot: "secondary",
              status: "persisted",
            },
          ],
          auditEvents: [
            {
              eventId: "audit-dashboard-snapshot-semantic-missing",
              traceId: "trace-inline-dashboard-snapshot-semantic-missing",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              authSession: createInlineAuditAuthSession(),
              courseId: "teacher-research-methods",
            },
          ],
          domainProjections: [
            {
              objectId: "dashboard-snapshot-teacher-research-methods",
              objectType: "dashboard-snapshot",
              courseId: "teacher-research-methods",
              operationRecordId: "operation-record-dashboard-snapshot-semantic-missing",
            },
          ],
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit/alerts");
      return createClearInlineOperationAuditAlertsResponse(
        "trace-inline-dashboard-snapshot-semantic-missing",
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("link", { name: "数据看板" }));
    fireEvent.click(screen.getByRole("button", { name: "锁定日报快照" }));

    await waitFor(() => {
      expect(screen.getByText("日报快照读回未匹配锁定结果，请稍后刷新。")).toBeTruthy();
    });
    expect(screen.queryByText("日报快照已锁定到当前视图。")).toBeNull();
    expect(
      screen.queryByText(
        "领域对象已验证：dashboard-snapshot / dashboard-snapshot-teacher-research-methods",
      ),
    ).toBeNull();
  });

  it("requires course content publication readback before claiming content publish success", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId: string;
          actionSlot: "primary" | "secondary";
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "content",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            sourceAction: "inline-teaching-workspace",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-record-course-content-semantic-missing",
            operationId: "content",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
            displayMessage: {
              "zh-CN": "课程内容已进入发布前确认。",
              "en-US": "Course content moved to pre-publish confirmation.",
            },
          },
          domainPersistenceSummary: createPersistedInlineOperationDomainPersistenceSummary(
            "operation-record-course-content-semantic-missing",
            "content",
            "primary",
          ),
          traceId: "trace-inline-course-content-semantic-missing",
        });
      }

      if (String(input) === "/api/teaching/operations/audit") {
        expect(init?.method).toBe("GET");
        return Response.json({
          traceId: "trace-audit-course-content-semantic-missing",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          recordCount: 1,
          auditEventCount: 1,
          domainProjectionCount: 1,
          records: [
            {
              recordId: "operation-record-course-content-semantic-missing",
              courseId: "teacher-research-methods",
              operationId: "content",
              actionSlot: "primary",
              status: "persisted",
            },
          ],
          auditEvents: [
            {
              eventId: "audit-course-content-semantic-missing",
              traceId: "trace-inline-course-content-semantic-missing",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              authSession: createInlineAuditAuthSession(),
              courseId: "teacher-research-methods",
            },
          ],
          domainProjections: [
            {
              objectId: "course-content-teacher-research-methods",
              objectType: "course-content",
              courseId: "teacher-research-methods",
              operationRecordId: "operation-record-course-content-semantic-missing",
            },
          ],
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit/alerts");
      return createClearInlineOperationAuditAlertsResponse(
        "trace-inline-course-content-semantic-missing",
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("link", { name: "课程内容" }));
    fireEvent.click(screen.getByRole("button", { name: "发布课程内容" }));

    await waitFor(() => {
      expect(screen.getByText("课程内容读回未匹配发布结果，请稍后刷新。")).toBeTruthy();
    });
    expect(screen.queryByText("课程内容已进入发布前确认。")).toBeNull();
    expect(
      screen.queryByText("领域对象已验证：course-content / course-content-teacher-research-methods"),
    ).toBeNull();
  });

  it("requires unit draft business readback before claiming draft generation success", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId: string;
          actionSlot: "primary" | "secondary";
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "content",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            sourceAction: "inline-teaching-workspace",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-record-unit-draft-semantic-missing",
            operationId: "content",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
            displayMessage: {
              "zh-CN": "单元草稿已生成，等待教师校订。",
              "en-US": "Unit draft generated and waiting for teacher edits.",
            },
          },
          domainPersistenceSummary: createPersistedInlineOperationDomainPersistenceSummary(
            "operation-record-unit-draft-semantic-missing",
            "content",
            "secondary",
          ),
          traceId: "trace-inline-unit-draft-semantic-missing",
        });
      }

      if (String(input) === "/api/teaching/operations/audit") {
        expect(init?.method).toBe("GET");
        return Response.json({
          traceId: "trace-audit-unit-draft-semantic-missing",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          recordCount: 1,
          auditEventCount: 1,
          domainProjectionCount: 1,
          records: [
            {
              recordId: "operation-record-unit-draft-semantic-missing",
              courseId: "teacher-research-methods",
              operationId: "content",
              actionSlot: "secondary",
              status: "persisted",
            },
          ],
          auditEvents: [
            {
              eventId: "audit-unit-draft-semantic-missing",
              traceId: "trace-inline-unit-draft-semantic-missing",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              authSession: createInlineAuditAuthSession(),
              courseId: "teacher-research-methods",
            },
          ],
          domainProjections: [
            {
              objectId: "unit-draft-teacher-research-methods",
              objectType: "unit-draft",
              courseId: "teacher-research-methods",
              operationRecordId: "operation-record-unit-draft-semantic-missing",
            },
          ],
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit/alerts");
      return createClearInlineOperationAuditAlertsResponse(
        "trace-inline-unit-draft-semantic-missing",
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("link", { name: "课程内容" }));
    fireEvent.click(screen.getByRole("button", { name: "生成单元草稿" }));

    await waitFor(() => {
      expect(screen.getByText("单元草稿读回未匹配生成结果，请稍后刷新。")).toBeTruthy();
    });
    expect(screen.queryByText("单元草稿已生成，等待教师校订。")).toBeNull();
    expect(
      screen.queryByText("领域对象已验证：unit-draft / unit-draft-teacher-research-methods"),
    ).toBeNull();
  });

  it("requires grading queue and gradebook update readback before claiming review queue save success", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId: string;
          actionSlot: "primary" | "secondary";
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "grading",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            sourceAction: "inline-teaching-workspace",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-record-grading-primary-semantic-missing",
            operationId: "grading",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
            displayMessage: {
              "zh-CN": "批改队列已保存，学生端暂不发布。",
              "en-US": "Review queue saved without publishing to students.",
            },
          },
          domainPersistenceSummary: createPersistedInlineOperationDomainPersistenceSummary(
            "operation-record-grading-primary-semantic-missing",
            "grading",
            "primary",
          ),
          traceId: "trace-inline-grading-primary-semantic-missing",
        });
      }

      if (String(input) === "/api/teaching/operations/audit") {
        expect(init?.method).toBe("GET");
        return Response.json({
          traceId: "trace-audit-grading-primary-semantic-missing",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          recordCount: 1,
          auditEventCount: 1,
          domainProjectionCount: 1,
          records: [
            {
              recordId: "operation-record-grading-primary-semantic-missing",
              courseId: "teacher-research-methods",
              operationId: "grading",
              actionSlot: "primary",
              status: "persisted",
            },
          ],
          auditEvents: [
            {
              eventId: "audit-grading-primary-semantic-missing",
              traceId: "trace-inline-grading-primary-semantic-missing",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              authSession: createInlineAuditAuthSession(),
              courseId: "teacher-research-methods",
            },
          ],
          domainProjections: [
            {
              objectId: "grading-queue-teacher-research-methods",
              objectType: "grading-queue",
              courseId: "teacher-research-methods",
              operationRecordId: "operation-record-grading-primary-semantic-missing",
              savedBy: "teacher-kang",
              queueStatus: "saved",
              reviewPolicy: "teacher-review-before-release",
              savedAt: "2026-06-22T10:40:00.000Z",
            },
          ],
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit/alerts");
      return createClearInlineOperationAuditAlertsResponse(
        "trace-inline-grading-primary-semantic-missing",
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("link", { name: "作业批改" }));
    fireEvent.click(screen.getByRole("button", { name: "保存批改队列" }));

    await waitFor(() => {
      expect(
        screen.getByText("批改队列与成绩册读回未匹配保存结果，请稍后刷新。"),
      ).toBeTruthy();
    });
    expect(screen.queryByText("批改队列已保存，学生端暂不发布。")).toBeNull();
    expect(
      screen.queryByText("领域对象已验证：grading-queue / grading-queue-teacher-research-methods"),
    ).toBeNull();
  });

  it("requires ai feedback draft business readback before claiming feedback generation success", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId: string;
          actionSlot: "primary" | "secondary";
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "grading",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            sourceAction: "inline-teaching-workspace",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-record-ai-feedback-draft-semantic-missing",
            operationId: "grading",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
            displayMessage: {
              "zh-CN": "AI 反馈建议已生成，等待教师逐条确认。",
              "en-US": "AI feedback suggestions generated for teacher confirmation.",
            },
          },
          domainPersistenceSummary: createPersistedInlineOperationDomainPersistenceSummary(
            "operation-record-ai-feedback-draft-semantic-missing",
            "grading",
            "secondary",
          ),
          traceId: "trace-inline-ai-feedback-draft-semantic-missing",
        });
      }

      if (String(input) === "/api/teaching/operations/audit") {
        expect(init?.method).toBe("GET");
        return Response.json({
          traceId: "trace-audit-ai-feedback-draft-semantic-missing",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          recordCount: 1,
          auditEventCount: 1,
          domainProjectionCount: 1,
          records: [
            {
              recordId: "operation-record-ai-feedback-draft-semantic-missing",
              courseId: "teacher-research-methods",
              operationId: "grading",
              actionSlot: "secondary",
              status: "persisted",
            },
          ],
          auditEvents: [
            {
              eventId: "audit-ai-feedback-draft-semantic-missing",
              traceId: "trace-inline-ai-feedback-draft-semantic-missing",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              authSession: createInlineAuditAuthSession(),
              courseId: "teacher-research-methods",
            },
          ],
          domainProjections: [
            {
              objectId: "ai-feedback-draft-teacher-research-methods",
              objectType: "ai-feedback-draft",
              courseId: "teacher-research-methods",
              operationRecordId: "operation-record-ai-feedback-draft-semantic-missing",
            },
          ],
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit/alerts");
      return createClearInlineOperationAuditAlertsResponse(
        "trace-inline-ai-feedback-draft-semantic-missing",
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("link", { name: "作业批改" }));
    fireEvent.click(screen.getByRole("button", { name: "生成智能反馈建议" }));

    await waitFor(() => {
      expect(
        screen.getByText("AI 反馈草稿读回未匹配生成结果，请稍后刷新。"),
      ).toBeTruthy();
    });
    expect(screen.queryByText("AI 反馈建议已生成，等待教师逐条确认。")).toBeNull();
    expect(
      screen.queryByText(
        "领域对象已验证：ai-feedback-draft / ai-feedback-draft-teacher-research-methods",
      ),
    ).toBeNull();
  });

  it("prevents duplicate inline workspace submissions while a save is pending", async () => {
    const traceId = "trace-inline-course-settings-primary";
    const receiptId = "operation-record-course-settings-primary";
    let resolveSave: (response: Response) => void = () => undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input) === "/api/teaching/operations/audit") {
        return Promise.resolve(
          createVerifiedInlineOperationAuditReadbackResponse({
            traceId,
            recordId: receiptId,
            operationId: "course-settings",
            actionSlot: "primary",
          }),
        );
      }
      if (String(input) === "/api/teaching/operations/audit/alerts") {
        return Promise.resolve(createClearInlineOperationAuditAlertsResponse(traceId));
      }
      return new Promise<Response>((resolve) => {
          resolveSave = resolve;
        });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    const primaryButton = screen.getByRole("button", { name: "保存课程设置" });
    const secondaryButton = screen.getByRole("button", { name: "预览学生端" });

    fireEvent.click(primaryButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(primaryButton).toHaveProperty("disabled", true);
    expect(secondaryButton).toHaveProperty("disabled", true);

    fireEvent.click(primaryButton);
    fireEvent.click(secondaryButton);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveSave(
      Response.json({
        receipt: {
          receiptId,
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          status: "persisted",
          audit: createSignedInlineOperationReceiptAudit(),
          displayMessage: {
            "zh-CN": "课程设置已由服务端持久化。",
            "en-US": "Course settings persisted by the server.",
          },
        },
        domainPersistenceSummary: createPersistedDomainPersistenceSummary(
          receiptId,
        ),
        traceId,
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("课程设置已由服务端持久化。")).toBeTruthy();
    });
    expect(primaryButton).toHaveProperty("disabled", false);
    expect(secondaryButton).toHaveProperty("disabled", false);
  });

  it("reads back audit evidence after inline workspace persistence before claiming the audit loop is closed", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        return Response.json({
          receipt: {
            receiptId: "operation-record-course-settings-primary",
            operationId: "course-settings",
            actionSlot: "primary",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
            courseId: "teacher-research-methods",
            displayMessage: {
              "zh-CN": "课程设置已由服务端持久化。",
              "en-US": "Course settings persisted by the server.",
            },
          },
          domainPersistenceSummary: createPersistedDomainPersistenceSummary(
            "operation-record-course-settings-primary",
          ),
          traceId: "trace-inline-course-settings",
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit");
      expect(init?.method).toBe("GET");
      return Response.json({
        traceId: "trace-audit-readback",
        actorId: "teacher-kang",
        courseIds: ["teacher-research-methods"],
        recordCount: 1,
        auditEventCount: 1,
        domainProjectionCount: 1,
        records: [
          {
            recordId: "operation-record-course-settings-primary",
            courseId: "teacher-research-methods",
            operationId: "course-settings",
            actionSlot: "primary",
            status: "persisted",
          },
        ],
        auditEvents: [
          {
            eventId: "audit-inline-course-settings",
            traceId: "trace-inline-course-settings",
            eventType: "teaching-operation.persisted",
            actorId: "teacher-kang",
            authSession: {
              sessionId: "teacher-inline-session",
              authenticatedAt: "2026-06-22T10:40:00.000Z",
              expiresAt: "2026-06-22T11:40:00.000Z",
            },
            courseId: "teacher-research-methods",
          },
        ],
        domainProjections: [
          {
            objectId: "course-settings-teacher-research-methods",
            objectType: "course-settings",
            courseId: "teacher-research-methods",
            operationRecordId: "operation-record-course-settings-primary",
            updatedBy: "teacher-kang",
            status: "saved",
            updatedAt: "2026-06-22T10:40:00.000Z",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/operations/audit",
        expect.objectContaining({
          method: "GET",
          headers: { accept: "application/json" },
        }),
      );
    });
    expect(screen.getByText("审计读回已验证：trace-inline-course-settings")).toBeTruthy();
    expect(screen.getByText("操作者：teacher-kang · 审计事件：1")).toBeTruthy();
    expect(screen.getByText("签名会话已验证：teacher-inline-session")).toBeTruthy();
    expect(
      screen.getByText("领域对象已验证：course-settings / course-settings-teacher-research-methods"),
    ).toBeTruthy();
  });

  it("requires signed teacher session evidence in inline audit readback before confirming persistence", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        return Response.json({
          receipt: {
            receiptId: "operation-record-course-settings-missing-auth-session",
            operationId: "course-settings",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
            displayMessage: {
              "zh-CN": "课程设置已由服务端持久化。",
              "en-US": "Course settings persisted by the server.",
            },
          },
          domainPersistenceSummary: createPersistedDomainPersistenceSummary(
            "operation-record-course-settings-missing-auth-session",
          ),
          traceId: "trace-inline-course-settings-missing-auth-session",
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit");
      expect(init?.method).toBe("GET");
      return Response.json({
        traceId: "trace-audit-missing-auth-session",
        actorId: "teacher-kang",
        courseIds: ["teacher-research-methods"],
        recordCount: 1,
        auditEventCount: 1,
        domainProjectionCount: 1,
        records: [
          {
            recordId: "operation-record-course-settings-missing-auth-session",
            courseId: "teacher-research-methods",
            operationId: "course-settings",
            actionSlot: "primary",
            status: "persisted",
          },
        ],
        auditEvents: [
          {
            eventId: "audit-inline-course-settings-missing-auth-session",
            traceId: "trace-inline-course-settings-missing-auth-session",
            eventType: "teaching-operation.persisted",
            actorId: "teacher-kang",
            courseId: "teacher-research-methods",
          },
        ],
        domainProjections: [
          {
            objectId: "course-settings-teacher-research-methods",
            objectType: "course-settings",
            courseId: "teacher-research-methods",
            operationRecordId: "operation-record-course-settings-missing-auth-session",
            updatedBy: "teacher-kang",
            status: "saved",
            updatedAt: "2026-06-22T10:40:00.000Z",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

    await waitFor(() => {
      expect(screen.getAllByText("审计读回未完成，请稍后刷新。").length).toBeGreaterThan(0);
    });
    expect(screen.queryByText("课程设置已由服务端持久化。")).toBeNull();
    expect(
      screen.queryByText("审计读回已验证：trace-inline-course-settings-missing-auth-session"),
    ).toBeNull();
    expect(screen.queryByText("签名会话已验证")).toBeNull();
    expect(screen.queryByText(/领域对象已验证/)).toBeNull();
  });

  it("keeps the main inline status in audit-pending state before audit readback verifies persistence", async () => {
    let resolveAuditReadback: (response: Response) => void = () => undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        return Response.json({
          receipt: {
            receiptId: "operation-record-course-settings-pending-audit",
            operationId: "course-settings",
            actionSlot: "primary",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
            courseId: "teacher-research-methods",
            displayMessage: {
              "zh-CN": "课程设置已由服务端持久化。",
              "en-US": "Course settings persisted by the server.",
            },
          },
          domainPersistenceSummary: createPersistedDomainPersistenceSummary("operation-record-course-settings-pending-audit"),
          traceId: "trace-inline-course-settings-pending-audit",
        });
      }

      if (String(input) === "/api/teaching/operations/audit") {
        expect(init?.method).toBe("GET");
        return new Promise<Response>((resolve) => {
          resolveAuditReadback = resolve;
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit/alerts");
      return Response.json({
        traceId: "trace-alert-readback-pending-audit",
        actorId: "teacher-kang",
        courseIds: ["teacher-research-methods"],
        status: "clear",
        eventType: "teaching-operation-audit-alert-summary",
        storagePolicy: "external-redacted-teaching-operation-audit-alerts",
        alertCount: 0,
        alerts: [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/operations/audit",
        expect.objectContaining({
          method: "GET",
          headers: { accept: "application/json" },
        }),
      );
    });
    expect(
      container.querySelector('[data-uais-inline-workspace-status="course-settings"]')
        ?.textContent,
    ).toBe("正在读取审计证据。");
    expect(screen.queryByText("课程设置已由服务端持久化。")).toBeNull();

    resolveAuditReadback(
      Response.json({
        traceId: "trace-audit-readback-pending-audit",
        actorId: "teacher-kang",
        courseIds: ["teacher-research-methods"],
        recordCount: 1,
        auditEventCount: 1,
        domainProjectionCount: 1,
        records: [
          {
            recordId: "operation-record-course-settings-pending-audit",
            courseId: "teacher-research-methods",
            operationId: "course-settings",
            actionSlot: "primary",
            status: "persisted",
          },
        ],
        auditEvents: [
          {
            auditId: "audit-inline-course-settings-pending-audit",
            traceId: "trace-inline-course-settings-pending-audit",
            eventType: "teaching-operation.persisted",
            actorId: "teacher-kang",
            authSession: createInlineAuditAuthSession(),
            courseId: "teacher-research-methods",
          },
        ],
        domainProjections: [
          {
            objectId: "course-settings-teacher-research-methods",
            objectType: "course-settings",
            courseId: "teacher-research-methods",
            operationRecordId: "operation-record-course-settings-pending-audit",
            updatedBy: "teacher-kang",
            status: "saved",
            updatedAt: "2026-06-22T10:40:00.000Z",
          },
        ],
      }),
    );

    await waitFor(() => {
      expect(
        container.querySelector('[data-uais-inline-workspace-status="course-settings"]')
          ?.textContent,
      ).toBe("课程设置已由服务端持久化。");
    });
    expect(screen.getByText("审计读回已验证：trace-inline-course-settings-pending-audit")).toBeTruthy();
  });

  it("waits for inline audit readback before applying edited course settings to course cards", async () => {
    let resolveAuditReadback: (response: Response) => void = () => undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        return Response.json({
          receipt: {
            receiptId: "operation-record-course-settings-card-patch",
            operationId: "course-settings",
            actionSlot: "primary",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
            courseId: "teacher-research-methods",
            displayMessage: {
              "zh-CN": "课程设置已由服务端持久化。",
              "en-US": "Course settings persisted by the server.",
            },
          },
          domainPersistenceSummary: {
            status: "persisted",
            required: true,
            operationReceiptId: "operation-record-course-settings-card-patch",
            expectedObjectTypes: ["course-settings"],
            persistedObjectTypes: ["course-settings"],
            missingObjectTypes: [],
          },
          traceId: "trace-inline-course-settings-card-patch",
        });
      }

      if (String(input) === "/api/teaching/operations/audit") {
        expect(init?.method).toBe("GET");
        return new Promise<Response>((resolve) => {
          resolveAuditReadback = resolve;
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit/alerts");
      return Response.json({
        traceId: "trace-alert-readback-card-patch",
        actorId: "teacher-kang",
        courseIds: ["teacher-research-methods"],
        status: "clear",
        eventType: "teaching-operation-audit-alert-summary",
        storagePolicy: "external-redacted-teaching-operation-audit-alerts",
        alertCount: 0,
        alerts: [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    expect(screen.getByRole("heading", { name: "大学研究方法" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("课程名称"), {
      target: { value: "审计后课程设置" },
    });
    fireEvent.change(screen.getByLabelText("学期安排"), {
      target: { value: "2026审计学期" },
    });
    fireEvent.change(screen.getByLabelText("课程说明"), {
      target: { value: "审计读回前不更新课程卡片。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

    await waitFor(() => {
      expect(
        container.querySelector('[data-uais-inline-workspace-status="course-settings"]')
          ?.textContent,
      ).toBe("正在读取审计证据。");
    });
    expect(screen.getByRole("heading", { name: "大学研究方法" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "审计后课程设置" })).toBeNull();

    resolveAuditReadback(
      Response.json({
        traceId: "trace-audit-readback-card-patch",
        actorId: "teacher-kang",
        courseIds: ["teacher-research-methods"],
        recordCount: 1,
        auditEventCount: 1,
        domainProjectionCount: 1,
        records: [
          {
            recordId: "operation-record-course-settings-card-patch",
            courseId: "teacher-research-methods",
            operationId: "course-settings",
            actionSlot: "primary",
            status: "persisted",
          },
        ],
        auditEvents: [
          {
            auditId: "audit-inline-course-settings-card-patch",
            traceId: "trace-inline-course-settings-card-patch",
            eventType: "teaching-operation.persisted",
            actorId: "teacher-kang",
            authSession: createInlineAuditAuthSession(),
            courseId: "teacher-research-methods",
          },
        ],
        domainProjections: [
          {
            objectId: "course-settings-teacher-research-methods",
            objectType: "course-settings",
            courseId: "teacher-research-methods",
            operationRecordId: "operation-record-course-settings-card-patch",
            updatedBy: "teacher-kang",
            status: "saved",
            updatedAt: "2026-06-22T10:40:00.000Z",
            appliedFields: ["courseName", "semester", "description"],
            courseName: "审计后课程设置",
            semester: "2026审计学期",
            description: "审计读回前不更新课程卡片。",
          },
        ],
      }),
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "审计后课程设置" })).toBeTruthy();
    });
    expect(screen.queryByRole("heading", { name: "大学研究方法" })).toBeNull();
  });

  it("requires course settings field readback before applying edited course settings", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        return Response.json({
          receipt: {
            receiptId: "operation-record-course-settings-field-readback-missing",
            operationId: "course-settings",
            actionSlot: "primary",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
            courseId: "teacher-research-methods",
            displayMessage: {
              "zh-CN": "课程设置已由服务端持久化。",
              "en-US": "Course settings persisted by the server.",
            },
          },
          domainPersistenceSummary: {
            status: "persisted",
            required: true,
            operationReceiptId: "operation-record-course-settings-field-readback-missing",
            expectedObjectTypes: ["course-settings"],
            persistedObjectTypes: ["course-settings"],
            missingObjectTypes: [],
          },
          traceId: "trace-inline-course-settings-field-readback-missing",
        });
      }

      if (String(input) === "/api/teaching/operations/audit") {
        expect(init?.method).toBe("GET");
        return Response.json({
          traceId: "trace-audit-readback-field-readback-missing",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          recordCount: 1,
          auditEventCount: 1,
          domainProjectionCount: 1,
          records: [
            {
              recordId: "operation-record-course-settings-field-readback-missing",
              courseId: "teacher-research-methods",
              operationId: "course-settings",
              actionSlot: "primary",
              status: "persisted",
            },
          ],
          auditEvents: [
            {
              auditId: "audit-inline-course-settings-field-readback-missing",
              traceId: "trace-inline-course-settings-field-readback-missing",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              authSession: createInlineAuditAuthSession(),
              courseId: "teacher-research-methods",
            },
          ],
          domainProjections: [
            {
              objectId: "course-settings-teacher-research-methods",
              objectType: "course-settings",
              courseId: "teacher-research-methods",
              operationRecordId: "operation-record-course-settings-field-readback-missing",
            },
          ],
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit/alerts");
      return createClearInlineOperationAuditAlertsResponse(
        "trace-inline-course-settings-field-readback-missing",
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    expect(screen.getByRole("heading", { name: "大学研究方法" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("课程名称"), {
      target: { value: "字段读回课程设置" },
    });
    fireEvent.change(screen.getByLabelText("学期安排"), {
      target: { value: "2026字段读回学期" },
    });
    fireEvent.change(screen.getByLabelText("课程说明"), {
      target: { value: "服务端投影必须回显本次课程设置补丁。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

    await waitFor(() => {
      expect(screen.getByText("课程设置读回未匹配本次提交，请稍后刷新。")).toBeTruthy();
    });
    expect(screen.getByRole("heading", { name: "大学研究方法" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "字段读回课程设置" })).toBeNull();
    expect(screen.queryByText("课程设置已由服务端持久化。")).toBeNull();
  });

  it("requires course settings business readback before claiming unchanged settings save success", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId: string;
          actionSlot: "primary" | "secondary";
          courseId: string;
          sourceAction: string;
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "course-settings",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            sourceAction: "inline-teaching-workspace",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-record-course-settings-semantic-missing",
            operationId: "course-settings",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
            displayMessage: {
              "zh-CN": "课程设置已由服务端持久化。",
              "en-US": "Course settings persisted by the server.",
            },
          },
          domainPersistenceSummary: createPersistedInlineOperationDomainPersistenceSummary(
            "operation-record-course-settings-semantic-missing",
            "course-settings",
            "primary",
          ),
          traceId: "trace-inline-course-settings-semantic-missing",
        });
      }

      if (String(input) === "/api/teaching/operations/audit") {
        expect(init?.method).toBe("GET");
        return Response.json({
          traceId: "trace-audit-course-settings-semantic-missing",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          recordCount: 1,
          auditEventCount: 1,
          domainProjectionCount: 1,
          records: [
            {
              recordId: "operation-record-course-settings-semantic-missing",
              courseId: "teacher-research-methods",
              operationId: "course-settings",
              actionSlot: "primary",
              status: "persisted",
            },
          ],
          auditEvents: [
            {
              auditId: "audit-inline-course-settings-semantic-missing",
              traceId: "trace-inline-course-settings-semantic-missing",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              authSession: createInlineAuditAuthSession(),
              courseId: "teacher-research-methods",
            },
          ],
          domainProjections: [
            {
              objectId: "course-settings-teacher-research-methods",
              objectType: "course-settings",
              courseId: "teacher-research-methods",
              operationRecordId: "operation-record-course-settings-semantic-missing",
            },
          ],
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit/alerts");
      return createClearInlineOperationAuditAlertsResponse(
        "trace-inline-course-settings-semantic-missing",
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

    await waitFor(() => {
      expect(screen.getByText("课程设置读回未匹配本次提交，请稍后刷新。")).toBeTruthy();
    });
    expect(screen.queryByText("课程设置已由服务端持久化。")).toBeNull();
    expect(
      screen.queryByText("领域对象已验证：course-settings / course-settings-teacher-research-methods"),
    ).toBeNull();
  });

  it("keeps the main inline status in alert-pending state before alert readback confirms observability", async () => {
    let resolveAlertReadback: (response: Response) => void = () => undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        return Response.json({
          receipt: {
            receiptId: "operation-record-course-settings-pending-alert",
            operationId: "course-settings",
            actionSlot: "primary",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
            courseId: "teacher-research-methods",
            displayMessage: {
              "zh-CN": "课程设置已由服务端持久化。",
              "en-US": "Course settings persisted by the server.",
            },
          },
          domainPersistenceSummary: createPersistedDomainPersistenceSummary("operation-record-course-settings-pending-alert"),
          traceId: "trace-inline-course-settings-pending-alert",
        });
      }

      if (String(input) === "/api/teaching/operations/audit") {
        expect(init?.method).toBe("GET");
        return Response.json({
          traceId: "trace-audit-readback-pending-alert",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          recordCount: 1,
          auditEventCount: 1,
          domainProjectionCount: 1,
          records: [
            {
              recordId: "operation-record-course-settings-pending-alert",
              courseId: "teacher-research-methods",
              operationId: "course-settings",
              actionSlot: "primary",
              status: "persisted",
            },
          ],
          auditEvents: [
            {
              auditId: "audit-inline-course-settings-pending-alert",
              traceId: "trace-inline-course-settings-pending-alert",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              authSession: createInlineAuditAuthSession(),
              courseId: "teacher-research-methods",
            },
          ],
          domainProjections: [
            {
              objectId: "course-settings-teacher-research-methods",
            objectType: "course-settings",
            courseId: "teacher-research-methods",
            operationRecordId: "operation-record-course-settings-pending-alert",
            updatedBy: "teacher-kang",
            status: "saved",
            updatedAt: "2026-06-22T10:40:00.000Z",
          },
        ],
      });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit/alerts");
      expect(init?.method).toBe("GET");
      return new Promise<Response>((resolve) => {
        resolveAlertReadback = resolve;
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/operations/audit/alerts",
        expect.objectContaining({
          method: "GET",
          headers: { accept: "application/json" },
        }),
      );
    });
    expect(
      container.querySelector('[data-uais-inline-workspace-status="course-settings"]')
        ?.textContent,
    ).toBe("正在读取教学操作告警。");
    expect(screen.queryByText("课程设置已由服务端持久化。")).toBeNull();

    resolveAlertReadback(
      Response.json({
        traceId: "trace-alert-readback-pending-alert",
        actorId: "teacher-kang",
        courseIds: ["teacher-research-methods"],
        status: "clear",
        eventType: "teaching-operation-audit-alert-summary",
        storagePolicy: "external-redacted-teaching-operation-audit-alerts",
        alertCount: 0,
        alerts: [],
      }),
    );

    await waitFor(() => {
      expect(
        container.querySelector('[data-uais-inline-workspace-status="course-settings"]')
          ?.textContent,
      ).toBe("课程设置已由服务端持久化。");
    });
    expect(screen.getByText("教学操作告警：0")).toBeTruthy();
  });

  it("clears stale inline audit evidence when a retried workspace save fails", async () => {
    let operationPostCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/teaching/operations") {
        operationPostCount += 1;
        if (operationPostCount === 1) {
          return Response.json({
            receipt: {
              receiptId: "operation-record-course-settings-first",
              operationId: "course-settings",
              actionSlot: "primary",
              status: "persisted",
              audit: createSignedInlineOperationReceiptAudit(),
              courseId: "teacher-research-methods",
              displayMessage: {
                "zh-CN": "课程设置已由服务端持久化。",
                "en-US": "Course settings persisted by the server.",
              },
            },
            domainPersistenceSummary: createPersistedDomainPersistenceSummary(
              "operation-record-course-settings-first",
            ),
            traceId: "trace-inline-course-settings-first",
          });
        }

        return Response.json(
          {
            error: "UAIS teacher authentication is required.",
            traceId: "trace-inline-course-settings-retry-denied",
          },
          { status: 401 },
        );
      }

      if (String(input) === "/api/teaching/operations/audit") {
        return Response.json({
          traceId: "trace-audit-readback-first",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          recordCount: 1,
          auditEventCount: 1,
          domainProjectionCount: 1,
          records: [
            {
              recordId: "operation-record-course-settings-first",
              courseId: "teacher-research-methods",
              operationId: "course-settings",
              actionSlot: "primary",
              status: "persisted",
            },
          ],
          auditEvents: [
            {
              eventId: "audit-inline-course-settings-first",
              traceId: "trace-inline-course-settings-first",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              authSession: createInlineAuditAuthSession(),
              courseId: "teacher-research-methods",
            },
          ],
          domainProjections: [
            {
              objectId: "course-settings-teacher-research-methods",
              objectType: "course-settings",
              courseId: "teacher-research-methods",
              operationRecordId: "operation-record-course-settings-first",
              updatedBy: "teacher-kang",
              status: "saved",
              updatedAt: "2026-06-22T10:40:00.000Z",
            },
          ],
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit/alerts");
      return Response.json({
        traceId: "trace-alert-readback-first",
        actorId: "teacher-kang",
        courseIds: ["teacher-research-methods"],
        status: "clear",
        eventType: "teaching-operation-audit-alert-summary",
        storagePolicy: "external-redacted-teaching-operation-audit-alerts",
        alertCount: 0,
        alerts: [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

    await waitFor(() => {
      expect(screen.getByText("审计读回已验证：trace-inline-course-settings-first")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "未保存到服务器：UAIS teacher authentication is required.追踪编号：trace-inline-course-settings-retry-denied",
        ),
      ).toBeTruthy();
    });
    expect(screen.queryByText("审计读回已验证：trace-inline-course-settings-first")).toBeNull();
    expect(screen.queryByText(/领域对象已验证/)).toBeNull();
    expect(screen.queryByRole("button", { name: "撤回本次操作" })).toBeNull();
  });

  it("ignores stale inline audit readback from an earlier save after a retry fails", async () => {
    let operationPostCount = 0;
    let resolveFirstAuditReadback: (response: Response) => void = () => undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/teaching/operations") {
        operationPostCount += 1;
        if (operationPostCount === 1) {
          return Response.json({
            receipt: {
              receiptId: "operation-record-course-settings-first-late",
              operationId: "course-settings",
              actionSlot: "primary",
              status: "persisted",
              audit: createSignedInlineOperationReceiptAudit(),
              courseId: "teacher-research-methods",
              displayMessage: {
                "zh-CN": "课程设置已由服务端持久化。",
                "en-US": "Course settings persisted by the server.",
              },
            },
            domainPersistenceSummary: createPersistedDomainPersistenceSummary(
              "operation-record-course-settings-first-late",
            ),
            traceId: "trace-inline-course-settings-first-late",
          });
        }

        return Response.json(
          {
            error: "UAIS teacher authentication is required.",
            traceId: "trace-inline-course-settings-second-denied",
            access: {
              status: "denied",
              reasonCode: "authenticated-session-required",
              responsibleSession: "S12",
            },
          },
          { status: 401 },
        );
      }

      if (String(input) === "/api/teaching/operations/audit") {
        return new Promise<Response>((resolve) => {
          resolveFirstAuditReadback = resolve;
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit/alerts");
      return Response.json({
        traceId: "trace-alert-readback-first-late",
        actorId: "teacher-kang",
        courseIds: ["teacher-research-methods"],
        status: "clear",
        eventType: "teaching-operation-audit-alert-summary",
        storagePolicy: "external-redacted-teaching-operation-audit-alerts",
        alertCount: 0,
        alerts: [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/operations/audit",
        expect.objectContaining({
          method: "GET",
        }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "未保存到服务器：需要重新登录教师账号。追踪编号：trace-inline-course-settings-second-denied",
        ),
      ).toBeTruthy();
    });

    resolveFirstAuditReadback(
      Response.json({
        traceId: "trace-audit-readback-first-late",
        actorId: "teacher-kang",
        courseIds: ["teacher-research-methods"],
        recordCount: 1,
        auditEventCount: 1,
        domainProjectionCount: 1,
        records: [
          {
            recordId: "operation-record-course-settings-first-late",
            courseId: "teacher-research-methods",
            operationId: "course-settings",
            actionSlot: "primary",
            status: "persisted",
          },
        ],
        auditEvents: [
          {
            eventId: "audit-inline-course-settings-first-late",
            traceId: "trace-inline-course-settings-first-late",
            eventType: "teaching-operation.persisted",
            actorId: "teacher-kang",
            authSession: createInlineAuditAuthSession(),
            courseId: "teacher-research-methods",
          },
        ],
        domainProjections: [
          {
            objectId: "course-settings-teacher-research-methods",
            objectType: "course-settings",
            courseId: "teacher-research-methods",
            operationRecordId: "operation-record-course-settings-first-late",
            updatedBy: "teacher-kang",
            status: "saved",
            updatedAt: "2026-06-22T10:40:00.000Z",
          },
        ],
      }),
    );
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(4)).catch(
      () => undefined,
    );

    expect(
      screen.getByText(
        "未保存到服务器：需要重新登录教师账号。追踪编号：trace-inline-course-settings-second-denied",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("课程设置已由服务端持久化。")).toBeNull();
    expect(screen.queryByText("审计读回已验证：trace-inline-course-settings-first-late")).toBeNull();
    expect(screen.queryByText(/领域对象已验证/)).toBeNull();
  });

  it("requires a matching domain projection before verifying inline workspace audit readback", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        return Response.json({
          receipt: {
            receiptId: "operation-record-course-settings-domain-missing",
            operationId: "course-settings",
            actionSlot: "primary",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
            courseId: "teacher-research-methods",
            displayMessage: {
              "zh-CN": "课程设置已由服务端持久化。",
              "en-US": "Course settings persisted by the server.",
            },
          },
          domainPersistenceSummary: createPersistedDomainPersistenceSummary("operation-record-course-settings-domain-missing"),
          traceId: "trace-inline-course-settings-domain-missing",
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit");
      return Response.json({
        traceId: "trace-audit-domain-missing",
        actorId: "teacher-kang",
        courseIds: ["teacher-research-methods"],
        recordCount: 1,
        auditEventCount: 1,
        domainProjectionCount: 0,
        records: [
          {
            recordId: "operation-record-course-settings-domain-missing",
            courseId: "teacher-research-methods",
            operationId: "course-settings",
            actionSlot: "primary",
            status: "persisted",
          },
        ],
        auditEvents: [
          {
            auditId: "audit-inline-course-settings-domain-missing",
            traceId: "trace-inline-course-settings-domain-missing",
            eventType: "teaching-operation.persisted",
            actorId: "teacher-kang",
            authSession: createInlineAuditAuthSession(),
            courseId: "teacher-research-methods",
          },
        ],
        domainProjections: [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

    await waitFor(() => {
      expect(
        container.querySelector('[data-uais-inline-workspace-status="course-settings"]')
          ?.textContent,
      ).toBe("审计读回未完成，请稍后刷新。");
    });
    expect(screen.queryByText("审计读回已验证：trace-inline-course-settings-domain-missing")).toBeNull();
    expect(screen.queryByText(/领域对象已验证/)).toBeNull();
  });

  it("rejects inline audit readback when the domain projection type does not match the operation", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        return Response.json({
          receipt: {
            receiptId: "operation-record-course-settings-wrong-domain-type",
            operationId: "course-settings",
            actionSlot: "primary",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
            courseId: "teacher-research-methods",
            displayMessage: {
              "zh-CN": "课程设置已由服务端持久化。",
              "en-US": "Course settings persisted by the server.",
            },
          },
          domainPersistenceSummary: {
            status: "persisted",
            required: true,
            operationReceiptId: "operation-record-course-settings-wrong-domain-type",
            expectedObjectTypes: ["course-settings"],
            persistedObjectTypes: ["course-settings"],
            missingObjectTypes: [],
          },
          traceId: "trace-inline-course-settings-wrong-domain-type",
        });
      }

      if (String(input) === "/api/teaching/operations/audit") {
        return Response.json({
        traceId: "trace-audit-wrong-domain-type",
        actorId: "teacher-kang",
        courseIds: ["teacher-research-methods"],
        recordCount: 1,
        auditEventCount: 1,
        domainProjectionCount: 1,
        records: [
          {
            recordId: "operation-record-course-settings-wrong-domain-type",
            courseId: "teacher-research-methods",
            operationId: "course-settings",
            actionSlot: "primary",
            status: "persisted",
          },
        ],
        auditEvents: [
          {
            auditId: "audit-inline-course-settings-wrong-domain-type",
            traceId: "trace-inline-course-settings-wrong-domain-type",
            eventType: "teaching-operation.persisted",
            actorId: "teacher-kang",
            authSession: createInlineAuditAuthSession(),
            courseId: "teacher-research-methods",
          },
        ],
        domainProjections: [
          {
            objectId: "student-roster-teacher-research-methods",
            objectType: "student-roster",
            courseId: "teacher-research-methods",
            operationRecordId: "operation-record-course-settings-wrong-domain-type",
          },
        ],
      });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit/alerts");
      return Response.json({
        status: "clear",
        alertCount: 0,
        alerts: [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.change(screen.getByLabelText("课程名称"), {
      target: { value: "错误领域对象不应更新课程名" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

    await waitFor(() => {
      expect(
        container.querySelector('[data-uais-inline-workspace-status="course-settings"]')
          ?.textContent,
      ).toBe("审计读回未完成，请稍后刷新。");
    });
    expect(
      screen.queryByText("审计读回已验证：trace-inline-course-settings-wrong-domain-type"),
    ).toBeNull();
    expect(screen.queryByText(/领域对象已验证/)).toBeNull();
    expect(screen.queryByText("错误领域对象不应更新课程名")).toBeNull();
  });

  it("rejects inline audit readback when the persisted record belongs to a different operation action", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        return Response.json({
          receipt: {
            receiptId: "operation-record-course-settings-cross-action",
            operationId: "course-settings",
            actionSlot: "primary",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
            courseId: "teacher-research-methods",
            displayMessage: {
              "zh-CN": "课程设置已由服务端持久化。",
              "en-US": "Course settings persisted by the server.",
            },
          },
          domainPersistenceSummary: createPersistedDomainPersistenceSummary("operation-record-course-settings-cross-action"),
          traceId: "trace-inline-course-settings-cross-action",
        });
      }

      if (String(input) === "/api/teaching/operations/audit") {
        expect(init?.method).toBe("GET");
        return Response.json({
          traceId: "trace-audit-cross-action",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          recordCount: 1,
          auditEventCount: 1,
          domainProjectionCount: 1,
          records: [
            {
              recordId: "operation-record-course-settings-cross-action",
              courseId: "teacher-research-methods",
              operationId: "knowledge-base",
              actionSlot: "secondary",
              status: "persisted",
            },
          ],
          auditEvents: [
            {
              auditId: "audit-inline-course-settings-cross-action",
              traceId: "trace-inline-course-settings-cross-action",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              authSession: createInlineAuditAuthSession(),
              courseId: "teacher-research-methods",
            },
          ],
          domainProjections: [
            {
              objectId: "course-settings-teacher-research-methods",
              objectType: "course-settings",
              courseId: "teacher-research-methods",
              operationRecordId: "operation-record-course-settings-cross-action",
            },
          ],
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit/alerts");
      return Response.json({
        status: "clear",
        alertCount: 0,
        alerts: [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

    await waitFor(() => {
      expect(
        container.querySelector('[data-uais-inline-workspace-status="course-settings"]')
          ?.textContent,
      ).toBe("审计读回未完成，请稍后刷新。");
    });
    expect(screen.queryByText("审计读回已验证：trace-inline-course-settings-cross-action")).toBeNull();
    expect(screen.queryByText(/领域对象已验证/)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/teaching/operations/audit/alerts",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("does not claim inline audit verification when the backend omits the persisted record id", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        return Response.json({
          receipt: {
            courseId: "teacher-research-methods",
            displayMessage: {
              "zh-CN": "课程设置已由服务端持久化。",
              "en-US": "Course settings persisted by the server.",
            },
          },
          traceId: "trace-inline-course-settings-without-record",
        });
      }

      return Response.json({
        actorId: "teacher-kang",
        auditEventCount: 1,
        auditEvents: [
          {
            traceId: "trace-inline-course-settings-without-record",
            eventType: "teaching-operation.persisted",
            actorId: "teacher-kang",
            authSession: createInlineAuditAuthSession(),
            courseId: "teacher-research-methods",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

    await waitFor(() => {
      expect(screen.getByText("未保存到服务器，请重新登录或检查课程权限。")).toBeTruthy();
    });
    expect(screen.queryByText("审计读回已验证：trace-inline-course-settings-without-record")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/teaching/operations/audit",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("surfaces teaching operation audit alerts and queues alert notifications from the inline workspace", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/operations") {
        return Response.json({
          receipt: {
            receiptId: "operation-record-course-settings-primary",
            operationId: "course-settings",
            actionSlot: "primary",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
            courseId: "teacher-research-methods",
            displayMessage: {
              "zh-CN": "课程设置已由服务端持久化。",
              "en-US": "Course settings persisted by the server.",
            },
          },
          domainPersistenceSummary: createPersistedDomainPersistenceSummary("operation-record-course-settings-primary"),
          traceId: "trace-inline-course-settings",
        });
      }

      if (String(input) === "/api/teaching/operations/audit") {
        return Response.json({
          traceId: "trace-audit-readback",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          recordCount: 1,
          auditEventCount: 1,
          domainProjectionCount: 1,
          records: [
            {
              recordId: "operation-record-course-settings-primary",
              courseId: "teacher-research-methods",
              operationId: "course-settings",
              actionSlot: "primary",
              status: "persisted",
            },
          ],
          auditEvents: [
            {
              auditId: "audit-inline-course-settings",
              traceId: "trace-inline-course-settings",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              authSession: createInlineAuditAuthSession(),
              courseId: "teacher-research-methods",
            },
          ],
          domainProjections: [
            {
              objectId: "course-settings-teacher-research-methods",
              objectType: "course-settings",
              courseId: "teacher-research-methods",
              operationRecordId: "operation-record-course-settings-primary",
              updatedBy: "teacher-kang",
              status: "saved",
              updatedAt: "2026-06-22T10:40:00.000Z",
            },
          ],
        });
      }

      if (String(input) === "/api/teaching/operations/audit/alerts") {
        expect(init?.method).toBe("GET");
        expect(init?.headers).toEqual({ accept: "application/json" });
        return Response.json({
          traceId: "trace-alert-readback",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          status: "attention-required",
          eventType: "teaching-operation-audit-alert-summary",
          storagePolicy: "external-redacted-teaching-operation-audit-alerts",
          alertCount: 1,
          alerts: [
            {
              alertId: "missing-course-context-audit-inline",
              severity: "high",
              reason: "missing-course-context",
              auditId: "audit-inline-missing-course",
              traceId: "trace-inline-missing-course",
              actorId: "teacher-kang",
              operationId: "admins",
              actionSlot: "secondary",
              actionId: "send-collaboration-invite",
            },
          ],
          notificationRoute: "/api/teaching/operations/audit/alerts/notifications",
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit/alerts/notifications");
      if (init?.method === "GET") {
        expect(init.headers).toEqual({ accept: "application/json" });
        return Response.json({
          traceId: "trace-alert-notification-outbox",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          eventType: "teaching-operation-audit-alert-notification-outbox",
          deliveryChannel: "admin-outbox",
          storagePolicy: "external-redacted-teaching-operation-audit-alert-notification-outbox",
          recordCount: 1,
          notifications: [
            {
              notificationId: "alert-notification-missing-course-context-audit-inline",
              deliveryStatus: "queued",
              alertId: "missing-course-context-audit-inline",
            },
          ],
        });
      }

      expect(init?.method).toBe("POST");
      return Response.json({
        traceId: "trace-alert-notification",
        actorId: "teacher-kang",
        courseIds: ["teacher-research-methods"],
        status: "queued",
        eventType: "teaching-operation-audit-alert-notification-dispatch",
        deliveryChannel: "admin-outbox",
        storagePolicy: "external-redacted-teaching-operation-audit-alert-notification-outbox",
        notificationCount: 1,
        notifications: [
          {
            notificationId: "alert-notification-missing-course-context-audit-inline",
            deliveryStatus: "queued",
            alertId: "missing-course-context-audit-inline",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

    await waitFor(() => {
      expect(screen.getByText("教学操作告警：1")).toBeTruthy();
      expect(screen.getByText("缺少课程上下文：trace-inline-missing-course")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "通知管理员" }));

    await waitFor(() => {
      expect(screen.getByText("告警通知读回已验证：1")).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/teaching/operations/audit/alerts/notifications",
      expect.objectContaining({
        method: "POST",
        headers: { accept: "application/json" },
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/teaching/operations/audit/alerts/notifications",
      expect.objectContaining({
        method: "GET",
        headers: { accept: "application/json" },
      }),
    );
  });

  it("verifies alert notification outbox readback before claiming inline notification closure", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/operations") {
        return Response.json({
          receipt: {
            receiptId: "operation-record-course-settings-primary",
            operationId: "course-settings",
            actionSlot: "primary",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
            courseId: "teacher-research-methods",
            displayMessage: {
              "zh-CN": "课程设置已由服务端持久化。",
              "en-US": "Course settings persisted by the server.",
            },
          },
          domainPersistenceSummary: createPersistedDomainPersistenceSummary("operation-record-course-settings-primary"),
          traceId: "trace-inline-course-settings",
        });
      }

      if (String(input) === "/api/teaching/operations/audit") {
        return Response.json({
          traceId: "trace-audit-readback",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          recordCount: 1,
          auditEventCount: 1,
          domainProjectionCount: 1,
          records: [
            {
              recordId: "operation-record-course-settings-primary",
              courseId: "teacher-research-methods",
              operationId: "course-settings",
              actionSlot: "primary",
              status: "persisted",
            },
          ],
          auditEvents: [
            {
              auditId: "audit-inline-course-settings",
              traceId: "trace-inline-course-settings",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              authSession: createInlineAuditAuthSession(),
              courseId: "teacher-research-methods",
            },
          ],
          domainProjections: [
            {
              objectId: "course-settings-teacher-research-methods",
              objectType: "course-settings",
              courseId: "teacher-research-methods",
              operationRecordId: "operation-record-course-settings-primary",
              updatedBy: "teacher-kang",
              status: "saved",
              updatedAt: "2026-06-22T10:40:00.000Z",
            },
          ],
        });
      }

      if (String(input) === "/api/teaching/operations/audit/alerts") {
        return Response.json({
          traceId: "trace-alert-readback",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          status: "attention-required",
          eventType: "teaching-operation-audit-alert-summary",
          storagePolicy: "external-redacted-teaching-operation-audit-alerts",
          alertCount: 1,
          alerts: [
            {
              alertId: "missing-course-context-audit-inline",
              severity: "high",
              reason: "missing-course-context",
              auditId: "audit-inline-missing-course",
              traceId: "trace-inline-missing-course",
              actorId: "teacher-kang",
              operationId: "admins",
              actionSlot: "secondary",
              actionId: "send-collaboration-invite",
            },
          ],
          notificationRoute: "/api/teaching/operations/audit/alerts/notifications",
        });
      }

      if (
        String(input) === "/api/teaching/operations/audit/alerts/notifications" &&
        init?.method === "POST"
      ) {
        return Response.json({
          traceId: "trace-alert-notification",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          status: "queued",
          eventType: "teaching-operation-audit-alert-notification-dispatch",
          deliveryChannel: "admin-outbox",
          storagePolicy: "external-redacted-teaching-operation-audit-alert-notification-outbox",
          notificationCount: 1,
          notifications: [
            {
              notificationId: "alert-notification-missing-course-context-audit-inline",
              deliveryStatus: "queued",
              alertId: "missing-course-context-audit-inline",
            },
          ],
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit/alerts/notifications");
      expect(init?.method).toBe("GET");
      return Response.json({
        traceId: "trace-alert-notification-outbox",
        actorId: "teacher-kang",
        courseIds: ["teacher-research-methods"],
        eventType: "teaching-operation-audit-alert-notification-outbox",
        deliveryChannel: "admin-outbox",
        storagePolicy: "external-redacted-teaching-operation-audit-alert-notification-outbox",
        recordCount: 1,
        notifications: [
          {
            notificationId: "alert-notification-missing-course-context-audit-inline",
            deliveryStatus: "queued",
            alertId: "missing-course-context-audit-inline",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

    await waitFor(() => {
      expect(screen.getByText("教学操作告警：1")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "通知管理员" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/operations/audit/alerts/notifications",
        expect.objectContaining({
          method: "GET",
          headers: { accept: "application/json" },
        }),
      );
    });
    expect(screen.getByText("告警通知读回已验证：1")).toBeTruthy();
    expect(screen.queryByText("告警通知已入队：1")).toBeNull();
  });

  it("surfaces alert notification failure details and trace id from the inline workspace", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/teaching/operations") {
        return Response.json({
          receipt: {
            receiptId: "operation-record-course-settings-primary",
            operationId: "course-settings",
            actionSlot: "primary",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
            courseId: "teacher-research-methods",
            displayMessage: {
              "zh-CN": "课程设置已由服务端持久化。",
              "en-US": "Course settings persisted by the server.",
            },
          },
          domainPersistenceSummary: createPersistedDomainPersistenceSummary("operation-record-course-settings-primary"),
          traceId: "trace-inline-course-settings",
        });
      }

      if (String(input) === "/api/teaching/operations/audit") {
        return Response.json({
          traceId: "trace-audit-readback",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          recordCount: 1,
          auditEventCount: 1,
          domainProjectionCount: 1,
          records: [
            {
              recordId: "operation-record-course-settings-primary",
              courseId: "teacher-research-methods",
              operationId: "course-settings",
              actionSlot: "primary",
              status: "persisted",
            },
          ],
          auditEvents: [
            {
              auditId: "audit-inline-course-settings",
              traceId: "trace-inline-course-settings",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              authSession: createInlineAuditAuthSession(),
              courseId: "teacher-research-methods",
            },
          ],
          domainProjections: [
            {
              objectId: "course-settings-teacher-research-methods",
              objectType: "course-settings",
              courseId: "teacher-research-methods",
              operationRecordId: "operation-record-course-settings-primary",
              updatedBy: "teacher-kang",
              status: "saved",
              updatedAt: "2026-06-22T10:40:00.000Z",
            },
          ],
        });
      }

      if (String(input) === "/api/teaching/operations/audit/alerts") {
        return Response.json({
          traceId: "trace-alert-readback",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          status: "attention-required",
          eventType: "teaching-operation-audit-alert-summary",
          storagePolicy: "external-redacted-teaching-operation-audit-alerts",
          alertCount: 1,
          alerts: [
            {
              alertId: "missing-course-context-audit-inline",
              severity: "high",
              reason: "missing-course-context",
              auditId: "audit-inline-missing-course",
              traceId: "trace-inline-missing-course",
              actorId: "teacher-kang",
              operationId: "admins",
              actionSlot: "secondary",
              actionId: "send-collaboration-invite",
            },
          ],
          notificationRoute: "/api/teaching/operations/audit/alerts/notifications",
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit/alerts/notifications");
      return Response.json(
        {
          traceId: "trace-alert-notification-failed",
          error: "Teaching operation audit alert notification outbox is unavailable.",
        },
        { status: 503 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

    await waitFor(() => {
      expect(screen.getByText("教学操作告警：1")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "通知管理员" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "告警通知未入队：Teaching operation audit alert notification outbox is unavailable. 追踪编号：trace-alert-notification-failed",
        ),
      ).toBeTruthy();
    });
    expect(screen.queryByText("告警通知已入队：1")).toBeNull();
  });

  it("promotes inline audit alert readback failures to the main workspace status", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/operations") {
        return Response.json({
          receipt: {
            receiptId: "operation-record-course-settings-alert-failed",
            operationId: "course-settings",
            actionSlot: "primary",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
            courseId: "teacher-research-methods",
            displayMessage: {
              "zh-CN": "课程设置已由服务端持久化。",
              "en-US": "Course settings persisted by the server.",
            },
          },
          domainPersistenceSummary: createPersistedDomainPersistenceSummary("operation-record-course-settings-alert-failed"),
          traceId: "trace-inline-course-settings-alert-failed",
        });
      }

      if (String(input) === "/api/teaching/operations/audit") {
        return Response.json({
          traceId: "trace-audit-readback-alert-failed",
          actorId: "teacher-kang",
          auditEventCount: 1,
          records: [
            {
              recordId: "operation-record-course-settings-alert-failed",
              courseId: "teacher-research-methods",
            },
          ],
          auditEvents: [
            {
              auditId: "audit-inline-course-settings-alert-failed",
              traceId: "trace-inline-course-settings-alert-failed",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              authSession: createInlineAuditAuthSession(),
              courseId: "teacher-research-methods",
            },
          ],
          domainProjections: [
            {
              objectId: "course-settings-teacher-research-methods",
              objectType: "course-settings",
              courseId: "teacher-research-methods",
              operationRecordId: "operation-record-course-settings-alert-failed",
              updatedBy: "teacher-kang",
              status: "saved",
              updatedAt: "2026-06-22T10:40:00.000Z",
            },
          ],
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit/alerts");
      expect(init?.method).toBe("GET");
      return Response.json(
        {
          error: "Teaching operation audit alert external storage is not ready.",
          traceId: "trace-alert-readback-failed",
        },
        { status: 503 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

    await waitFor(() => {
      expect(
        container.querySelector('[data-uais-inline-workspace-status="course-settings"]')
          ?.textContent,
      ).toBe("教学操作告警读取失败，请稍后重试。");
    });
    expect(screen.getByText("审计读回已验证：trace-inline-course-settings-alert-failed")).toBeTruthy();
    expect(screen.getAllByText("教学操作告警读取失败，请稍后重试。")).toHaveLength(2);
    expect(
      container.querySelector('[data-uais-inline-workspace-status="course-settings"]')
        ?.textContent,
    ).not.toBe("课程设置已由服务端持久化。");
  });

  it("lets teachers roll back a persisted inline operation only after audit readback finds the saved record", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/operations") {
        return Response.json({
          receipt: {
            receiptId: "operation-record-course-settings-primary",
            operationId: "course-settings",
            actionSlot: "primary",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
            courseId: "teacher-research-methods",
            displayMessage: {
              "zh-CN": "课程设置已由服务端持久化。",
              "en-US": "Course settings persisted by the server.",
            },
          },
          domainPersistenceSummary: createPersistedDomainPersistenceSummary("operation-record-course-settings-primary"),
          traceId: "trace-inline-course-settings",
        });
      }

      if (String(input) === "/api/teaching/operations/audit") {
        return Response.json({
          traceId: "trace-audit-readback",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          recordCount: 1,
          auditEventCount: 1,
          domainProjectionCount: 1,
          records: [
            {
              recordId: "operation-record-course-settings-primary",
              courseId: "teacher-research-methods",
              operationId: "course-settings",
              actionSlot: "primary",
              status: "persisted",
            },
          ],
          auditEvents: [
            {
              auditId: "audit-inline-course-settings",
              traceId: "trace-inline-course-settings",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              authSession: createInlineAuditAuthSession(),
              courseId: "teacher-research-methods",
            },
          ],
          domainProjections: [
            {
              objectId: "course-settings-teacher-research-methods",
              objectType: "course-settings",
              courseId: "teacher-research-methods",
              operationRecordId: "operation-record-course-settings-primary",
              updatedBy: "teacher-kang",
              status: "saved",
              updatedAt: "2026-06-22T10:40:00.000Z",
            },
          ],
        });
      }

      expect(String(input)).toBe(
        "/api/teaching/operations/records/operation-record-course-settings-primary/rollback",
      );
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual(
        expect.objectContaining({
          "content-type": "application/json",
          "x-uais-trace-id": "trace-inline-teaching-operation-rollback",
        }),
      );
      expect(JSON.parse(String(init?.body))).toEqual({
        action: "rollback-teaching-operation-record",
        rollbackReason: "teacher-inline-workspace-rollback",
        courseId: "teacher-research-methods",
      });
      return Response.json({
        receipt: {
          action: "rollback-teaching-operation-record",
          actorId: "teacher-kang",
          targetRecordId: "operation-record-course-settings-primary",
          traceId: "trace-inline-teaching-operation-rollback",
          rollbackReason: "teacher-inline-workspace-rollback",
          status: "persisted",
          audit: createSignedInlineOperationReceiptAudit(),
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "撤回本次操作" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "撤回本次操作" }));

    await waitFor(() => {
      expect(screen.getByText("已撤回：operation-record-course-settings-primary")).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/teaching/operations/records/operation-record-course-settings-primary/rollback",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("surfaces rollback failure details and trace id after inline audit readback", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/teaching/operations") {
        return Response.json({
          receipt: {
            receiptId: "operation-record-course-settings-primary",
            operationId: "course-settings",
            actionSlot: "primary",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
            courseId: "teacher-research-methods",
            displayMessage: {
              "zh-CN": "课程设置已由服务端持久化。",
              "en-US": "Course settings persisted by the server.",
            },
          },
          domainPersistenceSummary: createPersistedDomainPersistenceSummary("operation-record-course-settings-primary"),
          traceId: "trace-inline-course-settings",
        });
      }

      if (String(input) === "/api/teaching/operations/audit") {
        return Response.json({
          traceId: "trace-audit-readback",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          recordCount: 1,
          auditEventCount: 1,
          domainProjectionCount: 1,
          records: [
            {
              recordId: "operation-record-course-settings-primary",
              courseId: "teacher-research-methods",
              operationId: "course-settings",
              actionSlot: "primary",
              status: "persisted",
            },
          ],
          auditEvents: [
            {
              auditId: "audit-inline-course-settings",
              traceId: "trace-inline-course-settings",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              authSession: createInlineAuditAuthSession(),
              courseId: "teacher-research-methods",
            },
          ],
          domainProjections: [
            {
              objectId: "course-settings-teacher-research-methods",
              objectType: "course-settings",
              courseId: "teacher-research-methods",
              operationRecordId: "operation-record-course-settings-primary",
              updatedBy: "teacher-kang",
              status: "saved",
              updatedAt: "2026-06-22T10:40:00.000Z",
            },
          ],
        });
      }

      if (String(input) === "/api/teaching/operations/audit/alerts") {
        return Response.json({
          traceId: "trace-alert-readback",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          status: "clear",
          eventType: "teaching-operation-audit-alert-summary",
          storagePolicy: "external-redacted-teaching-operation-audit-alerts",
          alertCount: 0,
          alerts: [],
        });
      }

      expect(String(input)).toBe(
        "/api/teaching/operations/records/operation-record-course-settings-primary/rollback",
      );
      return Response.json(
        {
          traceId: "trace-inline-rollback-failed",
          error: "Teaching operation rollback external storage is unavailable.",
        },
        { status: 503 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "撤回本次操作" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "撤回本次操作" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "撤回未保存到服务器：Teaching operation rollback external storage is unavailable. 追踪编号：trace-inline-rollback-failed",
        ),
      ).toBeTruthy();
    });
    expect(screen.queryByText("已撤回：operation-record-course-settings-primary")).toBeNull();
  });

  it("responds to teacher workspace menu and exposes course-card navigation without backend persistence", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);

    const courseSettingsLink = screen.getByRole("link", { name: "课程设置" });
    expect(courseSettingsLink.getAttribute("href")).toBe("/teaching/course-settings");

    fireEvent.click(courseSettingsLink);

    expect(screen.getByText("当前入口：课程设置")).toBeTruthy();
    expect(
      screen.getByText("维护课程基础信息、学期安排和课堂偏好。"),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "课程设置" }).getAttribute("aria-current")).toBe(
      "page",
    );

    const agentSetupLink = screen.getByRole("link", { name: "智能体配置" });
    expect(agentSetupLink.getAttribute("href")).toBe("/teaching/agents");

    fireEvent.click(agentSetupLink);

    expect(screen.getByText("当前入口：智能体配置")).toBeTruthy();
    expect(screen.getByRole("link", { name: "智能体配置" }).getAttribute("aria-current")).toBe(
      "page",
    );

    fireEvent.click(courseSettingsLink);

    const manageCourseLink = screen.getAllByRole("link", { name: /管理课程/ })[0];
    expect(manageCourseLink.getAttribute("href")).toBe(
      "/teaching/course-settings?course=teacher-research-methods&action=manage",
    );

    expect(fireEvent.click(manageCourseLink)).toBe(true);
    expect(screen.getByText("当前入口：课程设置")).toBeTruthy();

    const continueEditingLink = screen.getAllByRole("link", { name: /继续编辑/ })[0];
    expect(continueEditingLink.getAttribute("href")).toBe(
      "/teaching/content?course=teacher-research-methods&action=continue",
    );

    expect(fireEvent.click(continueEditingLink)).toBe(true);
    expect(screen.queryByText("课程操作：继续编辑")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("links all eleven lightweight teaching operation entries to concrete pages", () => {
    render(<TeachingPage />);

    const expectedOperations = [
      ["课程设置", "/teaching/course-settings"],
      ["智能体配置", "/teaching/agents"],
      ["课程知识库", "/teaching/knowledge-base"],
      ["课程内容", "/teaching/content"],
      ["管理员设置", "/teaching/admins"],
      ["学生管理", "/teaching/students"],
      ["数据导出", "/teaching/data-export"],
      ["数据看板", "/teaching/dashboard"],
      ["测验看板", "/teaching/quiz-board"],
      ["作业批改", "/teaching/grading"],
      ["邀请码", "/teaching/invite-code"],
    ];

    expect(
      expectedOperations.map(([label]) => {
        const link = screen.getByRole("link", { name: label });
        return [label, link.getAttribute("href")];
      }),
    ).toEqual(expectedOperations);
  });

  it("runs every teaching operation directly from its selected workspace", async () => {
    const operationActions = [
      [
        "课程设置",
        "保存课程设置",
        "预览学生端",
        "课程设置已由服务端持久化，等待审计读回。",
        "course-settings",
      ],
      ["智能体配置", "保存智能体方案", "运行权限预检", "智能体方案已保存，服务端密钥仍保持隔离。", "agents"],
      [
        "课程知识库",
        "同步知识库索引",
        "添加资料占位",
        "知识库索引同步已保存到服务端。",
        "knowledge-base",
      ],
      ["课程内容", "发布课程内容", "生成单元草稿", "课程内容已进入发布前确认。", "content"],
      ["管理员设置", "保存管理员设置", "发送协作邀请", "管理员设置已保存，权限变更进入审计记录。", "admins"],
      [
        "学生管理",
        "重新统计学生名单",
        "生成分组建议",
        "已按当前加入记录重新统计班级和课程人数。",
        "students",
      ],
      ["数据导出", "生成导出清单", "校验脱敏范围", "导出清单已生成，可交给服务端导出任务。", "data-export"],
      ["数据看板", "刷新数据看板", "锁定日报快照", "数据看板已刷新。", "dashboard"],
      ["测验看板", "刷新测验看板", "标记低质题复核", "测验看板已刷新，错因分布可复核。", "quiz-board"],
      ["作业批改", "保存批改队列", "生成智能反馈建议", "批改队列已保存，学生端暂不发布。", "grading"],
      ["邀请码", "生成新邀请码", "确认发布邀请码", "邀请码已更新并等待教师确认发布。", "invite-code"],
    ] as const;
    const primaryMessageByOperationId = new Map(
      operationActions.map(([, , , primaryMessage, operationId]) => [
        operationId,
        primaryMessage,
      ]),
    );
    let latestAuditContext:
      | {
          traceId: string;
          recordId: string;
          operationId: string;
          actionSlot: "primary" | "secondary";
        }
      | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/courses") {
        return createResearchMethodsClassCourseListReadback();
      }
      if (String(input) === "/api/teaching/operations/audit") {
        expect(latestAuditContext).toBeTruthy();
        return createVerifiedInlineOperationAuditReadbackResponse({
          traceId: latestAuditContext?.traceId ?? "trace-inline-missing",
          recordId: latestAuditContext?.recordId ?? "operation-record-missing",
          operationId: latestAuditContext?.operationId ?? "course-settings",
          actionSlot: latestAuditContext?.actionSlot ?? "primary",
        });
      }
      if (String(input) === "/api/teaching/operations/audit/alerts") {
        return createClearInlineOperationAuditAlertsResponse(
          latestAuditContext?.traceId ?? "trace-inline-missing",
        );
      }
      expect(String(input)).toBe("/api/teaching/operations");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body)) as {
        operationId: string;
        actionSlot: string;
        courseId: string;
        sourceAction: string;
        idempotencyKey?: string;
      };
      expect(body.actionSlot).toBe("primary");
      expect(body.courseId).toBe("teacher-research-methods");
      expect(body.sourceAction).toBe("inline-teaching-workspace");
      expect(body.idempotencyKey).toEqual(
        expect.stringMatching(
          new RegExp(
            `^teaching-operation-${body.operationId}-primary-teacher-research-methods-inline-teaching-workspace-[a-zA-Z0-9._-]+$`,
          ),
        ),
      );
      expect(body.idempotencyKey?.length).toBeLessThanOrEqual(120);
      const primaryMessage = primaryMessageByOperationId.get(body.operationId);
      expect(primaryMessage).toEqual(expect.any(String));
      const receiptId = `operation-record-${body.operationId}-${body.actionSlot}`;
      const traceId = `trace-inline-${body.operationId}-${body.actionSlot}`;
      latestAuditContext = {
        traceId,
        recordId: receiptId,
        operationId: body.operationId,
        actionSlot: body.actionSlot,
      };

      return Response.json({
        receipt: {
          receiptId,
          operationId: body.operationId,
          actionSlot: body.actionSlot,
          courseId: body.courseId,
          status: "persisted",
          audit: createSignedInlineOperationReceiptAudit(),
          displayMessage: {
            "zh-CN": primaryMessage,
            "en-US": primaryMessage,
          },
        },
        domainPersistenceSummary: createPersistedInlineOperationDomainPersistenceSummary(
          receiptId,
          body.operationId,
          body.actionSlot,
        ),
        traceId,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    window.history.replaceState(null, "", "/teaching");
    const { container } = render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    for (const [label, primaryAction, secondaryAction, primaryMessage] of operationActions) {
      fireEvent.click(screen.getByRole("link", { name: label }));

      expect(container.querySelector("[data-uais-teaching-workspace-panel]")).toBeTruthy();
      expect(screen.queryByRole("link", { name: /进入操作页|进入管理|打开完整配置/ })).toBeNull();
      expect(screen.getByRole("button", { name: primaryAction })).toBeTruthy();
      expect(screen.getByRole("button", { name: secondaryAction })).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: primaryAction }));

      await waitFor(() => {
        expect(screen.getByText(primaryMessage)).toBeTruthy();
      });
    }
    expect(
      fetchMock.mock.calls.filter(([input]) => String(input) === "/api/teaching/operations"),
    ).toHaveLength(operationActions.length);
  });

  it("lets teachers manage invite codes directly inside the main workspace", async () => {
    const clipboardWriteText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWriteText },
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/courses") {
        expect(init?.method).toBe("GET");
        return Response.json({
          courses: [
            {
              courseId: "teacher-research-methods",
              courseName: "大学研究方法",
              instructor: "康霞",
              unit: "广州大学（404）",
              department: "实验教学中心",
              semester: "2026 春季",
              students: 32,
            },
          ],
          classes: [
            {
              classId: "teacher-research-methods-class-1",
              courseId: "teacher-research-methods",
              className: "研究方法一班",
              students: 32,
              semester: "2026 春季",
              invitationCode: "66334455",
            },
          ],
          receipt: {
            action: "list-courses",
            actorId: "teacher-kang",
            status: "read",
            responsibleSession: "S12",
          },
        });
      }

      expect(String(input)).toBe("/api/teaching/operations");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body)) as {
        operationId: string;
        actionSlot: string;
        courseId: string;
        sourceAction: string;
        idempotencyKey?: string;
      };
      expect(body.operationId).toBe("invite-code");
      expect(body.courseId).toBe("teacher-research-methods");
      expect(body.sourceAction).toBe("inline-teaching-workspace");
      expect(body.idempotencyKey).toEqual(
        expect.stringMatching(
          new RegExp(
            `^teaching-operation-invite-code-${body.actionSlot}-teacher-research-methods-inline-teaching-workspace-[a-zA-Z0-9._-]+$`,
          ),
        ),
      );
      expect(body.idempotencyKey?.length).toBeLessThanOrEqual(120);

      if (body.actionSlot === "primary") {
        return Response.json({
          receipt: {
            displayMessage: {
              "zh-CN": "邀请码已生成并保存，等待教师发布。",
              "en-US": "Invite code generated and saved for teacher publish.",
            },
            artifacts: [
              {
                kind: "invite-code",
                code: "66334455",
                status: "generated",
                joinUrl: "/courses?invite=66334455",
              },
            ],
          },
        });
      }

      expect(body.actionSlot).toBe("secondary");
      return Response.json({
        receipt: {
          displayMessage: {
            "zh-CN": "邀请码已发布到班级加入入口。",
            "en-US": "Invite code published to the class join entry.",
          },
          artifacts: [
            {
              kind: "invite-code",
              code: "66334455",
              status: "published",
              joinUrl: "/courses?invite=66334455",
            },
          ],
        },
        classInvitePublicationReceipt: {
          action: "publish-class-invite-code",
          actorId: "teacher-kang",
          courseId: "teacher-research-methods",
          classId: "teacher-research-methods-class-1",
          traceId: "trace-invite-publication-main-workspace",
          status: "persisted",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          storageWritePolicy: "external-optimistic-snapshot-replace",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    window.history.replaceState(null, "", "/teaching");
    const { container } = render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("link", { name: "邀请码" }));

    expect(
      container.querySelector('[data-uais-active-teaching-workspace="invite-code"]'),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "邀请码工作台" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "进入操作页" })).toBeNull();
    expect(screen.getByRole("button", { name: "生成新邀请码" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "确认发布邀请码" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "复制邀请码" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "复制加入链接" })).toBeTruthy();
    expect(screen.getByText("当前班级邀请码")).toBeTruthy();
    expect(screen.getByText("55395057")).toBeTruthy();
    // Plan E9: the validity and join-limit cards read the class record, and an
    // unset field says so instead of printing a hardcoded date nobody enforces.
    expect(screen.getByText("有效期")).toBeTruthy();
    expect(screen.getByText("无过期时间")).toBeTruthy();
    expect(screen.getByText("加入上限")).toBeTruthy();
    expect(screen.getByText("不限人数")).toBeTruthy();
    expect(screen.getByText("邀请码状态")).toBeTruthy();
    expect(screen.queryByText("2026-12-17")).toBeNull();
    expect(screen.queryByText("60 人")).toBeNull();
    expect(container.querySelector('[data-uais-inline-invitation-qr="55395057"]')).toBeTruthy();

    await waitForInviteClassTarget();
    fireEvent.click(screen.getByRole("button", { name: "生成新邀请码" }));

    await waitFor(() => {
      expect(screen.getByText("66334455")).toBeTruthy();
      expect(screen.getByText("邀请码已生成并保存，等待教师发布。")).toBeTruthy();
      expect(container.querySelector('[data-uais-inline-invitation-qr="66334455"]')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "确认发布邀请码" }));

    await waitFor(() => {
      expect(screen.getByText("邀请码已发布到班级加入入口。")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "复制邀请码" }));
    await waitFor(() => {
      expect(clipboardWriteText).toHaveBeenCalledWith("66334455");
      expect(screen.getByText("邀请码已复制。")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "复制加入链接" }));
    await waitFor(() => {
      expect(clipboardWriteText).toHaveBeenCalledWith("/courses?invite=66334455");
      expect(screen.getByText("加入链接已复制。")).toBeTruthy();
    });
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === "/api/teaching/operations"))
      .toHaveLength(2);
    expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/teaching/courses"))
      .toBe(true);
  });

  it("targets the persisted class when publishing invite codes from the main workspace", async () => {
    window.history.replaceState(null, "", "/teaching");
    let courseListReadCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teaching/courses") {
        expect(init?.method).toBe("GET");
        courseListReadCount += 1;
        return Response.json({
          courses: [
            {
              courseId: "teacher-course-enterprise-operations-20260623",
              courseName: "企业级普通教学管理",
              instructor: "康霞",
              unit: "广州大学（404）",
              department: "实验教学中心",
              semester: "2026 春季",
              students: 12,
            },
          ],
          classes: [
            {
              classId: "teacher-course-enterprise-operations-20260623-class-1",
              courseId: "teacher-course-enterprise-operations-20260623",
              className: "企业管理实验班",
              students: 12,
              semester: "2026 春季",
              invitationCode: courseListReadCount === 1 ? "66334455" : "77441122",
            },
          ],
          receipt: {
            action: "list-courses",
            actorId: "teacher-kang",
            status: "read",
            responsibleSession: "S12",
          },
        });
      }

      expect(url).toBe("/api/teaching/operations");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body)) as {
        operationId: string;
        actionSlot: string;
        courseId: string;
        targetClassId?: string;
        sourceAction: string;
        idempotencyKey?: string;
      };
      expect(body).toEqual(
        expect.objectContaining({
          operationId: "invite-code",
          actionSlot: "secondary",
          courseId: "teacher-course-enterprise-operations-20260623",
          targetClassId: "teacher-course-enterprise-operations-20260623-class-1",
          sourceAction: "inline-teaching-workspace",
        }),
      );
      expect(body.idempotencyKey).toEqual(
        expect.stringMatching(
          /^teaching-operation-invite-code-secondary-teacher-course-enterprise-operations-20260623/,
        ),
      );
      expect(body.idempotencyKey?.length).toBeLessThanOrEqual(120);

      return Response.json({
        receipt: {
          displayMessage: {
            "zh-CN": "邀请码已发布到班级加入入口。",
            "en-US": "Invite code published to the class join entry.",
          },
          artifacts: [
            {
              kind: "invite-code",
              code: "77441122",
              status: "published",
              joinUrl: "/courses?invite=77441122",
            },
          ],
        },
        classInvitePublicationReceipt: {
          action: "publish-class-invite-code",
          actorId: "teacher-kang",
          classId: "teacher-course-enterprise-operations-20260623-class-1",
          courseId: "teacher-course-enterprise-operations-20260623",
          traceId: "trace-invite-publication-persisted-class",
          status: "persisted",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          storageWritePolicy: "external-optimistic-snapshot-replace",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-course-enterprise-operations-20260623");

    await waitFor(() => {
      expect(screen.getByText("企业管理实验班")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("link", { name: "邀请码" }));
    await waitForInviteClassTarget();
    fireEvent.click(screen.getByRole("button", { name: "确认发布邀请码" }));

    await waitFor(() => {
      expect(screen.getByText("邀请码已发布到班级加入入口。")).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/teaching/operations",
      expect.objectContaining({ method: "POST" }),
    );
    expect(courseListReadCount).toBeGreaterThanOrEqual(2);
  });

  it("requires class invite publication receipt before changing the published invite code", async () => {
    window.history.replaceState(null, "", "/teaching");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teaching/courses") {
        expect(init?.method).toBe("GET");
        return Response.json({
          courses: [
            {
              courseId: "teacher-course-enterprise-operations-20260623",
              courseName: "企业级普通教学管理",
              instructor: "康霞",
              unit: "广州大学（404）",
              department: "实验教学中心",
              semester: "2026 春季",
              students: 12,
            },
          ],
          classes: [
            {
              classId: "teacher-course-enterprise-operations-20260623-class-1",
              courseId: "teacher-course-enterprise-operations-20260623",
              className: "企业管理实验班",
              students: 12,
              semester: "2026 春季",
              invitationCode: "55395057",
            },
          ],
          receipt: {
            action: "list-courses",
            actorId: "teacher-kang",
            status: "read",
            responsibleSession: "S12",
          },
        });
      }

      expect(url).toBe("/api/teaching/operations");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body)) as {
        operationId: string;
        actionSlot: string;
        targetClassId?: string;
      };
      expect(body).toEqual(
        expect.objectContaining({
          operationId: "invite-code",
          actionSlot: "secondary",
          targetClassId: "teacher-course-enterprise-operations-20260623-class-1",
        }),
      );
      return Response.json({
        receipt: {
          displayMessage: {
            "zh-CN": "邀请码已发布到班级加入入口。",
            "en-US": "Invite code published to the class join entry.",
          },
          artifacts: [
            {
              kind: "invite-code",
              code: "77441122",
              status: "published",
              joinUrl: "/courses?invite=77441122",
            },
          ],
        },
        traceId: "trace-invite-publication-receipt-missing",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-course-enterprise-operations-20260623");

    await waitFor(() => {
      expect(screen.getByText("企业管理实验班")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("link", { name: "邀请码" }));
    expect(screen.getByText("55395057")).toBeTruthy();
    expect(container.querySelector('[data-uais-inline-invitation-qr="55395057"]')).toBeTruthy();

    await waitForInviteClassTarget();
    fireEvent.click(screen.getByRole("button", { name: "确认发布邀请码" }));

    await waitFor(() => {
      expect(screen.getByText("邀请码发布回执缺失，请稍后刷新。")).toBeTruthy();
    });
    expect(screen.queryByText("77441122")).toBeNull();
    expect(container.querySelector('[data-uais-inline-invitation-qr="55395057"]')).toBeTruthy();
    expect(container.querySelector('[data-uais-inline-invitation-qr="77441122"]')).toBeNull();
  });

  it("requires class invitation-code readback before changing the published invite code", async () => {
    window.history.replaceState(null, "", "/teaching");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teaching/courses") {
        expect(init?.method).toBe("GET");
        return Response.json({
          courses: [
            {
              courseId: "teacher-course-enterprise-operations-20260623",
              courseName: "企业级普通教学管理",
              instructor: "康霞",
              unit: "广州大学（404）",
              department: "实验教学中心",
              semester: "2026 春季",
              students: 12,
            },
          ],
          classes: [
            {
              classId: "teacher-course-enterprise-operations-20260623-class-1",
              courseId: "teacher-course-enterprise-operations-20260623",
              className: "企业管理实验班",
              students: 12,
              semester: "2026 春季",
              invitationCode: "55395057",
            },
          ],
          receipt: {
            action: "list-courses",
            actorId: "teacher-kang",
            status: "read",
            responsibleSession: "S12",
          },
        });
      }

      expect(url).toBe("/api/teaching/operations");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body)) as {
        operationId: string;
        actionSlot: string;
        targetClassId?: string;
      };
      expect(body).toEqual(
        expect.objectContaining({
          operationId: "invite-code",
          actionSlot: "secondary",
          targetClassId: "teacher-course-enterprise-operations-20260623-class-1",
        }),
      );
      return Response.json({
        receipt: {
          displayMessage: {
            "zh-CN": "邀请码已发布到班级加入入口。",
            "en-US": "Invite code published to the class join entry.",
          },
          artifacts: [
            {
              kind: "invite-code",
              code: "77441122",
              status: "published",
              joinUrl: "/courses?invite=77441122",
            },
          ],
        },
        classInvitePublicationReceipt: {
          action: "publish-class-invite-code",
          actorId: "teacher-kang",
          classId: "teacher-course-enterprise-operations-20260623-class-1",
          courseId: "teacher-course-enterprise-operations-20260623",
          traceId: "trace-invite-publication-class-readback-mismatch",
          status: "persisted",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          storageWritePolicy: "external-optimistic-snapshot-replace",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-course-enterprise-operations-20260623");

    await waitFor(() => {
      expect(screen.getByText("企业管理实验班")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("link", { name: "邀请码" }));
    expect(screen.getByText("55395057")).toBeTruthy();
    expect(container.querySelector('[data-uais-inline-invitation-qr="55395057"]')).toBeTruthy();

    await waitForInviteClassTarget();
    fireEvent.click(screen.getByRole("button", { name: "确认发布邀请码" }));

    await waitFor(() => {
      expect(screen.getByText("班级邀请码读回未匹配发布结果，请稍后刷新。")).toBeTruthy();
    });
    expect(screen.queryByText("77441122")).toBeNull();
    expect(screen.queryByText("邀请码已发布到班级加入入口。")).toBeNull();
    expect(container.querySelector('[data-uais-inline-invitation-qr="55395057"]')).toBeTruthy();
    expect(container.querySelector('[data-uais-inline-invitation-qr="77441122"]')).toBeNull();
  });

  it("requires enrollment access business readback before claiming invite publication success", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/courses") {
        return createResearchMethodsClassCourseListReadback();
      }
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId: string;
          actionSlot: string;
          courseId: string;
          sourceAction: string;
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "invite-code",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            sourceAction: "inline-teaching-workspace",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-record-enrollment-access-semantic-missing",
            operationId: "invite-code",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            displayMessage: {
              "zh-CN": "邀请码已发布到班级加入入口。",
              "en-US": "Invite code published to the class join entry.",
            },
            artifacts: [
              {
                kind: "invite-code",
                code: "77441122",
                status: "published",
                joinUrl: "/courses?invite=77441122",
              },
            ],
          },
          classInvitePublicationReceipt: {
            action: "publish-class-invite-code",
            actorId: "teacher-kang",
            classId: "teacher-research-methods-class-1",
            courseId: "teacher-research-methods",
            traceId: "trace-enrollment-access-publication-receipt",
            status: "persisted",
          },
          traceId: "trace-inline-enrollment-access-semantic-missing",
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit");
      expect(init?.method).toBe("GET");
      return Response.json({
        actorId: "teacher-kang",
        auditEventCount: 1,
        records: [
          {
            recordId: "operation-record-enrollment-access-semantic-missing",
            courseId: "teacher-research-methods",
            operationId: "invite-code",
            actionSlot: "secondary",
          },
        ],
        auditEvents: [
          {
            auditId: "audit-inline-enrollment-access-semantic-missing",
            traceId: "trace-inline-enrollment-access-semantic-missing",
            actorId: "teacher-kang",
            courseId: "teacher-research-methods",
          },
        ],
        domainProjections: [
          {
            objectId: "enrollment-access-teacher-research-methods-77441122",
            objectType: "enrollment-access",
            courseId: "teacher-research-methods",
            operationRecordId: "operation-record-enrollment-access-semantic-missing",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    window.history.replaceState(null, "", "/teaching");
    const { container } = render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("link", { name: "邀请码" }));
    expect(screen.getByText("55395057")).toBeTruthy();
    expect(container.querySelector('[data-uais-inline-invitation-qr="55395057"]')).toBeTruthy();

    await waitForInviteClassTarget();
    fireEvent.click(screen.getByRole("button", { name: "确认发布邀请码" }));

    await waitFor(() => {
      expect(screen.getByText("邀请码发布读回未匹配发布结果，请稍后刷新。")).toBeTruthy();
    });
    expect(screen.getByText("55395057")).toBeTruthy();
    expect(screen.queryByText("77441122")).toBeNull();
    expect(screen.queryByText("邀请码已发布到班级加入入口。")).toBeNull();
    expect(container.querySelector('[data-uais-inline-invitation-qr="55395057"]')).toBeTruthy();
    expect(container.querySelector('[data-uais-inline-invitation-qr="77441122"]')).toBeNull();
  });

  it("surfaces invite publish authorization failure details and trace id", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/courses") {
        return createResearchMethodsClassCourseListReadback();
      }
      expect(String(input)).toBe("/api/teaching/operations");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body)) as {
        operationId: string;
        actionSlot: string;
        courseId: string;
        sourceAction: string;
      };
      expect(body).toEqual(
        expect.objectContaining({
          operationId: "invite-code",
          actionSlot: "secondary",
          courseId: "teacher-research-methods",
          sourceAction: "inline-teaching-workspace",
        }),
      );
      return Response.json(
        {
          traceId: "trace-invite-publish-course-denied",
          error: "Current teacher cannot publish invite codes for this course.",
          access: {
            status: "denied",
            reasonCode: "teacher-course-ownership-required",
            responsibleSession: "S12",
          },
        },
        { status: 403 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    window.history.replaceState(null, "", "/teaching");
    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("link", { name: "邀请码" }));
    await waitForInviteClassTarget();
    fireEvent.click(screen.getByRole("button", { name: "确认发布邀请码" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "邀请码未保存到服务器：当前教师无权操作该课程。追踪编号：trace-invite-publish-course-denied",
        ),
      ).toBeTruthy();
    });
    expect(screen.queryByText("邀请码已发布到班级加入入口。")).toBeNull();
  });

  it("waits for the backend invite-code receipt before changing the visible code", async () => {
    let resolveInviteSave: (response: Response) => void = () => undefined;
    const fetchMock = vi.fn(
      (input: RequestInfo | URL) =>
        String(input) === "/api/teaching/courses"
          ? createResearchMethodsClassCourseListReadback()
          : new Promise<Response>((resolve) => {
              resolveInviteSave = resolve;
            }),
    );
    vi.stubGlobal("fetch", fetchMock);

    window.history.replaceState(null, "", "/teaching");
    const { container } = render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("link", { name: "邀请码" }));
    expect(screen.getByText("55395057")).toBeTruthy();
    expect(container.querySelector('[data-uais-inline-invitation-qr="55395057"]')).toBeTruthy();

    await waitForInviteClassTarget();
    fireEvent.click(screen.getByRole("button", { name: "生成新邀请码" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/operations",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });
    expect(screen.getByText("正在保存到服务器，请稍候。")).toBeTruthy();
    expect(screen.getByText("55395057")).toBeTruthy();
    expect(screen.queryByText("55395058")).toBeNull();
    expect(container.querySelector('[data-uais-inline-invitation-qr="55395057"]')).toBeTruthy();
    expect(container.querySelector('[data-uais-inline-invitation-qr="55395058"]')).toBeNull();

    resolveInviteSave(
      Response.json({
        receipt: {
          displayMessage: {
            "zh-CN": "邀请码已生成并保存，等待教师发布。",
            "en-US": "Invite code generated and saved for teacher publish.",
          },
          artifacts: [
            {
              kind: "invite-code",
              code: "66334455",
              status: "generated",
              joinUrl: "/courses?invite=66334455",
            },
          ],
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("66334455")).toBeTruthy();
      expect(screen.getByText("邀请码已生成并保存，等待教师发布。")).toBeTruthy();
      expect(container.querySelector('[data-uais-inline-invitation-qr="66334455"]')).toBeTruthy();
    });
    expect(screen.queryByText("55395058")).toBeNull();
  });

  it("waits for invite-code audit readback before changing the visible code when a trace is returned", async () => {
    let resolveAuditReadback: (response: Response) => void = () => undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/courses") {
        return createResearchMethodsClassCourseListReadback();
      }
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        return Response.json({
          receipt: {
            receiptId: "operation-record-invite-code-primary",
            operationId: "invite-code",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            displayMessage: {
              "zh-CN": "邀请码已生成并保存，等待教师发布。",
              "en-US": "Invite code generated and saved for teacher publish.",
            },
            artifacts: [
              {
                kind: "invite-code",
                code: "66334455",
                status: "generated",
                joinUrl: "/courses?invite=66334455",
              },
            ],
          },
          traceId: "trace-inline-invite-code-primary",
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit");
      expect(init?.method).toBe("GET");
      return new Promise<Response>((resolve) => {
        resolveAuditReadback = resolve;
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    window.history.replaceState(null, "", "/teaching");
    const { container } = render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("link", { name: "邀请码" }));
    expect(screen.getByText("55395057")).toBeTruthy();
    expect(container.querySelector('[data-uais-inline-invitation-qr="55395057"]')).toBeTruthy();

    await waitForInviteClassTarget();
    fireEvent.click(screen.getByRole("button", { name: "生成新邀请码" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/operations/audit",
        expect.objectContaining({
          method: "GET",
          headers: { accept: "application/json" },
        }),
      );
    });
    expect(screen.getByText("正在读取审计证据。")).toBeTruthy();
    expect(screen.getByText("55395057")).toBeTruthy();
    expect(screen.queryByText("66334455")).toBeNull();
    expect(screen.queryByText("邀请码已生成并保存，等待教师发布。")).toBeNull();

    resolveAuditReadback(
      Response.json({
        actorId: "teacher-kang",
        auditEventCount: 1,
        records: [
          {
            recordId: "operation-record-invite-code-primary",
            courseId: "teacher-research-methods",
          },
        ],
        auditEvents: [
          {
            auditId: "audit-inline-invite-code-primary",
            traceId: "trace-inline-invite-code-primary",
            actorId: "teacher-kang",
            courseId: "teacher-research-methods",
          },
        ],
        domainProjections: [
          {
            objectId: "invite-code-draft-teacher-research-methods-66334455",
            objectType: "invite-code-draft",
            courseId: "teacher-research-methods",
            inviteCode: "66334455",
            joinUrl: "/courses?invite=66334455",
            generatedBy: "teacher-kang",
            draftStatus: "generated",
            operationRecordId: "operation-record-invite-code-primary",
            invitePolicy: "teacher-review-before-publication",
            generatedAt: "2026-06-22T10:40:00.000Z",
          },
        ],
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("66334455")).toBeTruthy();
      expect(screen.getByText("邀请码已生成并保存，等待教师发布。")).toBeTruthy();
      expect(container.querySelector('[data-uais-inline-invitation-qr="66334455"]')).toBeTruthy();
    });
  });

  it("requires invite-code draft business readback before changing the visible invite code", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/courses") {
        return createResearchMethodsClassCourseListReadback();
      }
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        return Response.json({
          receipt: {
            receiptId: "operation-record-invite-code-draft-semantic-missing",
            operationId: "invite-code",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            displayMessage: {
              "zh-CN": "邀请码已生成并保存，等待教师发布。",
              "en-US": "Invite code generated and saved for teacher publish.",
            },
            artifacts: [
              {
                kind: "invite-code",
                code: "66334455",
                status: "generated",
                joinUrl: "/courses?invite=66334455",
              },
            ],
          },
          traceId: "trace-inline-invite-code-draft-semantic-missing",
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit");
      expect(init?.method).toBe("GET");
      return Response.json({
        actorId: "teacher-kang",
        auditEventCount: 1,
        records: [
          {
            recordId: "operation-record-invite-code-draft-semantic-missing",
            courseId: "teacher-research-methods",
            operationId: "invite-code",
            actionSlot: "primary",
          },
        ],
        auditEvents: [
          {
            auditId: "audit-inline-invite-code-draft-semantic-missing",
            traceId: "trace-inline-invite-code-draft-semantic-missing",
            actorId: "teacher-kang",
            courseId: "teacher-research-methods",
          },
        ],
        domainProjections: [
          {
            objectId: "invite-code-draft-teacher-research-methods-66334455",
            objectType: "invite-code-draft",
            courseId: "teacher-research-methods",
            operationRecordId: "operation-record-invite-code-draft-semantic-missing",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    window.history.replaceState(null, "", "/teaching");
    const { container } = render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("link", { name: "邀请码" }));
    expect(screen.getByText("55395057")).toBeTruthy();
    expect(container.querySelector('[data-uais-inline-invitation-qr="55395057"]')).toBeTruthy();

    await waitForInviteClassTarget();
    fireEvent.click(screen.getByRole("button", { name: "生成新邀请码" }));

    await waitFor(() => {
      expect(screen.getByText("邀请码草稿读回未匹配生成结果，请稍后刷新。")).toBeTruthy();
    });
    expect(screen.getByText("55395057")).toBeTruthy();
    expect(screen.queryByText("66334455")).toBeNull();
    expect(screen.queryByText("邀请码已生成并保存，等待教师发布。")).toBeNull();
    expect(container.querySelector('[data-uais-inline-invitation-qr="55395057"]')).toBeTruthy();
    expect(container.querySelector('[data-uais-inline-invitation-qr="66334455"]')).toBeNull();
  });

  it("surfaces automatic rollback compensation when invite publication partially fails", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/courses") {
        return createResearchMethodsClassCourseListReadback();
      }
      expect(String(input)).toBe("/api/teaching/operations");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body)) as {
        operationId: string;
        actionSlot: string;
      };
      expect(body.operationId).toBe("invite-code");
      expect(body.actionSlot).toBe("secondary");

      return Response.json(
        {
          error: "External teaching course management persistence failed.",
          receipt: {
            receiptId: "teaching-operation-idempotent-invite-publish",
            operationId: "invite-code",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
          },
          partialFailure: {
            status: "operation-persisted-class-invite-publication-failed",
            failedStep: "class-invite-publication",
            operationReceiptId: "teaching-operation-idempotent-invite-publish",
            rollbackRoute:
              "/api/teaching/operations/records/teaching-operation-idempotent-invite-publish/rollback",
            compensation: {
              status: "rolled-back",
              action: "rollback-teaching-operation-record",
              rollbackReason: "class-invite-publication-failed",
              receipt: {
                receiptId:
                  "teaching-operation-rollback-teaching-operation-idempotent-invite-publish",
                targetRecordId: "teaching-operation-idempotent-invite-publish",
                status: "persisted",
                audit: createSignedInlineOperationReceiptAudit(),
              },
            },
          },
        },
        { status: 502 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    window.history.replaceState(null, "", "/teaching");
    const { container } = render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    fireEvent.click(screen.getByRole("link", { name: "邀请码" }));
    expect(container.querySelector('[data-uais-inline-invitation-qr="55395057"]')).toBeTruthy();

    await waitForInviteClassTarget();
    fireEvent.click(screen.getByRole("button", { name: "确认发布邀请码" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "发布未完成，已自动撤回：teaching-operation-idempotent-invite-publish。",
        ),
      ).toBeTruthy();
    });
    expect(screen.queryByText("未保存到服务器，请重新登录或检查课程权限。")).toBeNull();
    expect(container.querySelector('[data-uais-inline-invitation-qr="55395057"]')).toBeTruthy();
  });

  it("persists the new course through the backend before adding it to the teacher list", async () => {
    const persistedCourse = {
      courseId: "teacher-course-ai-supported-elementary-math-20260623",
      courseName: "智能支持的初等数学研究",
      instructor: "康霞",
      unit: "广州大学（404）",
      department: "实验教学中心",
      semester: "2025-2026第二学期",
      description: "",
      students: 0,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/teaching/courses");
      if (init?.method === "GET") {
        return Response.json({
          courses: [persistedCourse],
          classes: [],
          receipt: {
            action: "list-courses",
            actorId: "teacher-kang",
            status: "read",
          },
        });
      }

      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ "content-type": "application/json" });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        name: "智能支持的初等数学研究",
        instructor: "康霞",
        unit: "广州大学（404）",
        department: "实验教学中心",
        semester: "2025-2026第二学期",
        description: "",
      });

      return Response.json(
        {
          course: persistedCourse,
          receipt: createPersistedCourseReceipt(persistedCourse.courseId),
          ownershipReceipt: createMergedCourseOwnershipReceipt(persistedCourse.courseId),
        },
        { status: 201 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);

    expect(screen.queryByRole("dialog", { name: "新增课程" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "新增课程" }));

    expect(screen.getByRole("dialog", { name: "新增课程" })).toBeTruthy();
    expect(screen.getByLabelText("名称").getAttribute("placeholder")).toBe(
      "输入课程名称后，可一键生成课程封面",
    );
    expect((screen.getByLabelText("讲师") as HTMLInputElement).value).toBe("康霞");
    expect((screen.getByLabelText("单位") as HTMLSelectElement).value).toBe("广州大学（404）");
    expect((screen.getByLabelText("院系") as HTMLSelectElement).value).toBe(
      "实验教学中心",
    );
    expect((screen.getByLabelText("学期") as HTMLSelectElement).value).toBe(
      "2025-2026第二学期",
    );
    expect(screen.getByText("描述")).toBeTruthy();
    expect(screen.getByText("正在使用演示教学包")).toBeTruthy();
    expect(screen.getByRole("button", { name: "完成" }).getAttribute("disabled")).not.toBeNull();

    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "智能支持的初等数学研究" },
    });

    expect(screen.getByRole("button", { name: "完成" }).getAttribute("disabled")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "完成" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/courses",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "新增课程" })).toBeNull();
      expect(screen.getByText("智能支持的初等数学研究")).toBeTruthy();
      expect(screen.getByText("康霞 · 实验教学中心 · 广州大学（404）")).toBeTruthy();
    });
  });

  it("keeps the new course dialog open while course creation is pending", async () => {
    const persistedCourse = {
      courseId: "teacher-course-pending-lock-20260625",
      courseName: "待保存课程",
      instructor: "康霞",
      unit: "广州大学（404）",
      department: "实验教学中心",
      semester: "2025-2026第二学期",
      students: 0,
    };
    let shouldReadBackCourse = false;
    let resolveCreateCourse: ((response: Response) => void) | undefined;
    const createCourseResponse = new Promise<Response>((resolve) => {
      resolveCreateCourse = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/teaching/courses");
      if (init?.method === "GET") {
        return Response.json({
          courses: shouldReadBackCourse ? [persistedCourse] : [],
          classes: [],
          receipt: {
            action: "list-courses",
            actorId: "teacher-kang",
            status: "read",
          },
        });
      }

      expect(init?.method).toBe("POST");
      return createCourseResponse;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);

    fireEvent.click(screen.getByRole("button", { name: "新增课程" }));
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "待保存课程" },
    });
    fireEvent.click(screen.getByRole("button", { name: "完成" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "保存中" })).toBeTruthy();
    });

    expect(screen.getByRole("button", { name: "取消" }).getAttribute("disabled")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "关闭新增课程弹窗" }).getAttribute("disabled"),
    ).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭新增课程弹窗" }));
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.getByRole("dialog", { name: "新增课程" })).toBeTruthy();

    shouldReadBackCourse = true;
    resolveCreateCourse?.(
      Response.json(
        {
          course: persistedCourse,
          receipt: createPersistedCourseReceipt(persistedCourse.courseId),
          ownershipReceipt: createMergedCourseOwnershipReceipt(persistedCourse.courseId),
        },
        { status: 201 },
      ),
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "新增课程" })).toBeNull();
      expect(screen.getByText("待保存课程")).toBeTruthy();
    });
  });

  it("requires course list readback before showing a newly posted course as saved", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/teaching/courses");
      if (init?.method === "GET") {
        return Response.json({
          courses: [],
          classes: [],
          receipt: {
            action: "list-courses",
            actorId: "teacher-kang",
            status: "read",
          },
        });
      }

      expect(init?.method).toBe("POST");
      return Response.json(
        {
          course: {
            courseId: "teacher-course-readback-missing-20260624",
            courseName: "读回缺失课程",
            instructor: "康霞",
            unit: "广州大学（404）",
            department: "实验教学中心",
            semester: "2025-2026第二学期",
            students: 0,
          },
          receipt: createPersistedCourseReceipt("teacher-course-readback-missing-20260624"),
          ownershipReceipt: createMergedCourseOwnershipReceipt(
            "teacher-course-readback-missing-20260624",
          ),
        },
        { status: 201 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);

    fireEvent.click(screen.getByRole("button", { name: "新增课程" }));
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "读回缺失课程" },
    });
    fireEvent.click(screen.getByRole("button", { name: "完成" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/courses",
        expect.objectContaining({ method: "GET" }),
      );
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("服务端列表尚未读回该课程");
    expect(screen.getByRole("dialog", { name: "新增课程" })).toBeTruthy();
    expect(screen.queryByText("读回缺失课程")).toBeNull();
  });

  it("requires ownership merge evidence before showing a newly posted course as saved", async () => {
    const persistedCourse = {
      courseId: "teacher-course-ownership-evidence-missing-20260628",
      courseName: "所有权证据课程",
      instructor: "康霞",
      unit: "广州大学（404）",
      department: "实验教学中心",
      semester: "2025-2026第二学期",
      students: 0,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/teaching/courses");
      if (init?.method === "GET") {
        return Response.json({
          courses: [persistedCourse],
          classes: [],
          receipt: {
            action: "list-courses",
            actorId: "teacher-kang",
            status: "read",
          },
        });
      }

      expect(init?.method).toBe("POST");
      return Response.json(
        {
          course: persistedCourse,
          receipt: createPersistedCourseReceipt(persistedCourse.courseId),
          traceId: "trace-course-create-ownership-evidence-missing",
        },
        { status: 201 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);

    fireEvent.click(screen.getByRole("button", { name: "新增课程" }));
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "所有权证据课程" },
    });
    fireEvent.click(screen.getByRole("button", { name: "完成" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("课程所有权合并证据缺失");
    expect(alert.textContent).toContain("trace-course-create-ownership-evidence-missing");
    expect(screen.getByRole("dialog", { name: "新增课程" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "所有权证据课程" })).toBeNull();
  });

  it("requires a signed teacher session in the course create receipt before showing a newly posted course as saved", async () => {
    const persistedCourse = {
      courseId: "teacher-course-create-session-missing-20260630",
      courseName: "会话回执课程",
      instructor: "康霞",
      unit: "广州大学（404）",
      department: "实验教学中心",
      semester: "2025-2026第二学期",
      students: 0,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/teaching/courses");
      if (init?.method === "GET") {
        return Response.json({
          courses: [persistedCourse],
          classes: [],
          receipt: {
            action: "list-courses",
            actorId: "teacher-kang",
            status: "read",
          },
        });
      }

      expect(init?.method).toBe("POST");
      return Response.json(
        {
          course: persistedCourse,
          receipt: {
            action: "create-course",
            actorId: "teacher-kang",
            courseId: persistedCourse.courseId,
            traceId: "trace-course-create-session-missing",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
          },
          ownershipReceipt: createMergedCourseOwnershipReceipt(persistedCourse.courseId),
          traceId: "trace-course-create-session-missing",
        },
        { status: 201 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);

    fireEvent.click(screen.getByRole("button", { name: "新增课程" }));
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "会话回执课程" },
    });
    fireEvent.click(screen.getByRole("button", { name: "完成" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("课程服务端回执缺失");
    expect(alert.textContent).toContain("trace-course-create-session-missing");
    expect(screen.getByRole("dialog", { name: "新增课程" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "会话回执课程" })).toBeNull();
  });

  it("rejects a course create readback when the saved course name does not match the submitted draft", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/teaching/courses");
      if (init?.method === "GET") {
        return Response.json({
          courses: [
            {
              courseId: "teacher-course-semantic-mismatch-20260625",
              courseName: "旧课程名称",
              instructor: "康霞",
              unit: "广州大学（404）",
              department: "实验教学中心",
              semester: "2025-2026第二学期",
              students: 0,
            },
          ],
          classes: [],
          receipt: {
            action: "list-courses",
            actorId: "teacher-kang",
            status: "read",
          },
        });
      }

      expect(init?.method).toBe("POST");
      return Response.json(
        {
          course: {
            courseId: "teacher-course-semantic-mismatch-20260625",
            courseName: "语义校验课程",
            instructor: "康霞",
            unit: "广州大学（404）",
            department: "实验教学中心",
            semester: "2025-2026第二学期",
            students: 0,
          },
          receipt: createPersistedCourseReceipt("teacher-course-semantic-mismatch-20260625"),
          ownershipReceipt: createMergedCourseOwnershipReceipt(
            "teacher-course-semantic-mismatch-20260625",
          ),
        },
        { status: 201 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);

    fireEvent.click(screen.getByRole("button", { name: "新增课程" }));
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "语义校验课程" },
    });
    fireEvent.click(screen.getByRole("button", { name: "完成" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("服务端读回的课程内容与本次提交不一致");
    expect(screen.getByRole("dialog", { name: "新增课程" })).toBeTruthy();
    expect(screen.queryByText("旧课程名称")).toBeNull();
  });

  it("rejects a course create readback when the saved course semester does not match the submitted draft", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/teaching/courses");
      if (init?.method === "GET") {
        return Response.json({
          courses: [
            {
              courseId: "teacher-course-semester-mismatch-20260627",
              courseName: "学期错配课程",
              instructor: "康霞",
              unit: "广州大学（404）",
              department: "实验教学中心",
              semester: "2026-2027第一学期",
              students: 0,
            },
          ],
          classes: [],
          receipt: {
            action: "list-courses",
            actorId: "teacher-kang",
            status: "read",
          },
        });
      }

      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        name: "学期错配课程",
        semester: "2025-2026第二学期",
      });
      return Response.json(
        {
          course: {
            courseId: "teacher-course-semester-mismatch-20260627",
            courseName: "学期错配课程",
            instructor: "康霞",
            unit: "广州大学（404）",
            department: "实验教学中心",
            semester: "2026-2027第一学期",
            students: 0,
          },
          receipt: createPersistedCourseReceipt("teacher-course-semester-mismatch-20260627"),
          ownershipReceipt: createMergedCourseOwnershipReceipt(
            "teacher-course-semester-mismatch-20260627",
          ),
        },
        { status: 201 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);

    fireEvent.click(screen.getByRole("button", { name: "新增课程" }));
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "学期错配课程" },
    });
    fireEvent.click(screen.getByRole("button", { name: "完成" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("服务端读回的课程内容与本次提交不一致");
    expect(screen.getByRole("dialog", { name: "新增课程" })).toBeTruthy();
    expect(screen.queryByText("学期错配课程")).toBeNull();
  });

  it("keeps failed course creation visible as an alert until the teacher edits the draft", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/teaching/courses");
      expect(init?.method).toBe("POST");
      return Response.json(
        { error: "UAIS teacher authentication is required." },
        { status: 401 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);

    fireEvent.click(screen.getByRole("button", { name: "新增课程" }));
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "服务端失败课程" },
    });
    fireEvent.click(screen.getByRole("button", { name: "完成" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/courses",
        expect.objectContaining({ method: "POST" }),
      );
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("UAIS teacher authentication is required.");
    expect(screen.getByRole("dialog", { name: "新增课程" })).toBeTruthy();
    expect(screen.queryByText("服务端失败课程")).toBeNull();

    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "服务端恢复课程" },
    });

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("surfaces course creation authorization failure details and trace id", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/teaching/courses");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        name: "权限拒绝课程",
      });
      return Response.json(
        {
          traceId: "trace-course-create-teacher-role-denied",
          error: "Current account does not have permission to create courses.",
          access: {
            status: "denied",
            reasonCode: "teacher-role-required",
            responsibleSession: "S12",
          },
        },
        { status: 403 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);

    fireEvent.click(screen.getByRole("button", { name: "新增课程" }));
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "权限拒绝课程" },
    });
    fireEvent.click(screen.getByRole("button", { name: "完成" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/courses",
        expect.objectContaining({ method: "POST" }),
      );
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "课程未保存到服务器：当前账号没有教师权限。追踪编号：trace-course-create-teacher-role-denied",
    );
    expect(screen.getByRole("dialog", { name: "新增课程" })).toBeTruthy();
    expect(screen.queryByText("权限拒绝课程")).toBeNull();
  });

  it("surfaces course cover asset ownership failure when creating a covered course", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/teaching/courses");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        name: "封面归属拒绝课程",
      });
      return Response.json(
        {
          traceId: "trace-course-create-cover-owner-denied",
          error: "Teaching course cover asset ownership is required.",
          access: {
            status: "denied",
            reasonCode: "teacher-course-cover-asset-ownership-required",
            responsibleSession: "S12",
            resource: {
              coverAssetId: "course-cover-owned-by-other-teacher",
            },
          },
        },
        { status: 403 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);

    fireEvent.click(screen.getByRole("button", { name: "新增课程" }));
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "封面归属拒绝课程" },
    });
    fireEvent.click(screen.getByRole("button", { name: "完成" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "课程未保存到服务器：当前教师无权使用该课程封面。追踪编号：trace-course-create-cover-owner-denied",
    );
    expect(screen.getByRole("dialog", { name: "新增课程" })).toBeTruthy();
    expect(screen.queryByText("封面归属拒绝课程")).toBeNull();
  });

  it("generates a Qwen cover from the compact new course dialog without exposing credentials", async () => {
    window.history.replaceState(null, "", "/teaching");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teaching/courses") {
        expect(init?.method).toBe("GET");
        return Response.json({
          courses: [],
          classes: [],
          receipt: {
            action: "list-courses",
            actorId: "teacher-kang",
            status: "read",
          },
        });
      }

      expect(url).toBe("/api/teaching/course-cover");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ "Content-Type": "application/json" });
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        courseId: expect.stringMatching(
          /^teacher-draft-course-teacher-kang-course-\d{8}-\d{6}$/,
        ),
        name: "智能支持的初等数学研究",
        instructor: "康霞",
        unit: "广州大学（404）",
        department: "实验教学中心",
        semester: "2025-2026第二学期",
        description: "面向师范生的研究方法课程。",
      });
      expect(JSON.stringify(body)).not.toContain("DASHSCOPE");
      expect(JSON.stringify(body)).not.toContain("API_KEY");

      return Response.json(
        createPersistedCourseCoverGenerationBody({
          courseId: String(body.courseId),
          assetId: "course-cover-request-course-cover-1",
          imageUrl: "https://dashscope-result/course-cover.png",
          requestId: "request-course-cover-1",
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<TeachingPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/courses",
        expect.objectContaining({ method: "GET" }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "新增课程" }));
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "智能支持的初等数学研究" },
    });
    fireEvent.change(screen.getByLabelText("描述"), {
      target: { value: "面向师范生的研究方法课程。" },
    });

    expect(container.querySelector('[data-uais-new-course-field-row="unit-description"]')).toBeTruthy();
    expect(container.querySelector('[data-uais-new-course-cover-panel="compact"]')).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "生成封面" }));

    expect(screen.getByRole("button", { name: "正在生成封面" })).toBeTruthy();

    await waitFor(() => {
      expect(
        screen.getByRole("img", {
          name: "为智能支持的初等数学研究生成的课程封面",
        }),
      ).toBeTruthy();
      expect(screen.getByText("封面已生成")).toBeTruthy();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("DASHSCOPE_API_KEY");
  });

  it("requires persisted course cover asset evidence before showing generated cover success", async () => {
    window.history.replaceState(null, "", "/teaching");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teaching/courses") {
        expect(init?.method).toBe("GET");
        return Response.json({
          courses: [],
          classes: [],
          receipt: {
            action: "list-courses",
            actorId: "teacher-kang",
            status: "read",
          },
        });
      }

      expect(url).toBe("/api/teaching/course-cover");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body));
      return Response.json({
        cover: {
          provider: "qwen",
          providerRole: "image-generation",
          model: "qwen-image-2.0",
          imageUrl: "https://dashscope-result/unpersisted-course-cover.png",
          requestId: "request-unpersisted-course-cover-1",
          usage: { width: 800, height: 480, imageCount: 1 },
        },
        asset: {
          assetId: "course-cover-request-unpersisted-course-cover-1",
          assetType: "course-cover",
          courseId: body.courseId,
          imageUrl: "https://dashscope-result/unpersisted-course-cover.png",
        },
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "generated-url-only",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/courses",
        expect.objectContaining({ method: "GET" }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "新增课程" }));
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "未落库封面课程" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成封面" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("封面未保存到课程资产库，请稍后重试。");
    expect(screen.queryByText("封面已生成")).toBeNull();
    expect(
      screen.queryByRole("img", { name: "为未落库封面课程生成的课程封面" }),
    ).toBeNull();
  });

  it("does not generate a draft cover with the default teacher actor before teacher readback", async () => {
    window.history.replaceState(null, "", "/teaching");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teaching/courses") {
        expect(init?.method).toBe("GET");
        return Response.json({
          courses: [],
          classes: [],
          receipt: {
            action: "list-courses",
            status: "read",
          },
        });
      }

      expect(url).not.toBe("/api/teaching/course-cover");
      return Response.json({}, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/courses",
        expect.objectContaining({ method: "GET" }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "新增课程" }));
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "Missing Actor Cover" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成封面" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("教师身份未读回");
    });
    expect(
      fetchMock.mock.calls.some(([input]) => String(input) === "/api/teaching/course-cover"),
    ).toBe(false);
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("teacher-kang");
  });

  it("uses the signed teacher actor from course readback when generating a draft cover", async () => {
    window.history.replaceState(null, "", "/teaching");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "/api/teaching/courses") {
        expect(init?.method).toBe("GET");
        return Response.json({
          courses: [],
          classes: [],
          receipt: {
            action: "list-courses",
            actorId: "teacher-lin",
            status: "read",
          },
        });
      }

      expect(url).toBe("/api/teaching/course-cover");
      expect(init?.method).toBe("POST");

      const body = JSON.parse(String(init?.body));
      return Response.json(
        createPersistedCourseCoverGenerationBody({
          courseId: String(body.courseId),
          assetId: "course-cover-request-course-cover-non-default-teacher",
          imageUrl: "https://dashscope-result/non-default-teacher-cover.png",
          requestId: "request-course-cover-non-default-teacher",
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/courses",
        expect.objectContaining({ method: "GET" }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "新增课程" }));
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "Statistics Methods" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成封面" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/course-cover",
        expect.objectContaining({ method: "POST" }),
      );
    });
    await waitFor(() => {
      expect(screen.getByText("封面已生成")).toBeTruthy();
    });

    const coverRequest = fetchMock.mock.calls.find(
      ([input]) => String(input) === "/api/teaching/course-cover",
    );
    const coverRequestBody = JSON.parse(
      String((coverRequest?.[1] as RequestInit | undefined)?.body),
    );
    expect(coverRequestBody.courseId).toMatch(
      /^teacher-draft-course-teacher-lin-statistics-methods-\d{8}-\d{6}$/,
    );
    expect(String(coverRequestBody.courseId)).not.toContain("teacher-kang");
  });

  it("does not treat a student course readback receipt as the teacher actor for draft covers", async () => {
    window.history.replaceState(null, "", "/teaching");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "/api/teaching/courses") {
        expect(init?.method).toBe("GET");
        return Response.json({
          courses: [],
          classes: [],
          memberships: [],
          receipt: {
            action: "list-student-courses",
            actorId: "student-lin",
            status: "read",
          },
        });
      }

      expect(url).not.toBe("/api/teaching/course-cover");
      return Response.json({}, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/courses",
        expect.objectContaining({ method: "GET" }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "新增课程" }));
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "Student Receipt Boundary" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成封面" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("教师身份未读回");
    });
    expect(
      fetchMock.mock.calls.some(([input]) => String(input) === "/api/teaching/course-cover"),
    ).toBe(false);
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("student-lin");
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("teacher-kang");
  });

  it("surfaces course cover authorization failure details and trace id", async () => {
    window.history.replaceState(null, "", "/teaching");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teaching/courses") {
        expect(init?.method).toBe("GET");
        return Response.json({
          courses: [],
          classes: [],
          receipt: {
            action: "list-courses",
            actorId: "teacher-kang",
            status: "read",
          },
        });
      }

      expect(url).toBe("/api/teaching/course-cover");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ "Content-Type": "application/json" });
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        name: "封面权限拒绝课程",
        instructor: "康霞",
        unit: "广州大学（404）",
      });
      expect(JSON.stringify(body)).not.toContain("DASHSCOPE");
      expect(JSON.stringify(body)).not.toContain("API_KEY");

      return Response.json(
        {
          traceId: "trace-course-cover-teacher-role-denied",
          error: "Current account does not have permission to generate course covers.",
          access: {
            status: "denied",
            reasonCode: "teacher-role-required",
            responsibleSession: "S12",
          },
        },
        { status: 403 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/courses",
        expect.objectContaining({ method: "GET" }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "新增课程" }));
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "封面权限拒绝课程" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成封面" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/course-cover",
        expect.objectContaining({ method: "POST" }),
      );
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "封面未生成：当前账号没有教师权限。追踪编号：trace-course-cover-teacher-role-denied",
    );
    expect(screen.getByRole("dialog", { name: "新增课程" })).toBeTruthy();
    expect(screen.queryByText("封面已生成")).toBeNull();
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("DASHSCOPE_API_KEY");
  });

  it("binds the generated course cover asset when creating a new course", async () => {
    window.history.replaceState(null, "", "/teaching");
    let coverCourseId = "";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "/api/teaching/course-cover") {
        expect(init?.method).toBe("POST");
        expect(init?.headers).toEqual({ "Content-Type": "application/json" });
        const body = JSON.parse(String(init?.body));
        coverCourseId = String(body.courseId);
        expect(coverCourseId).toMatch(
          /^teacher-draft-course-teacher-kang-course-\d{8}-\d{6}$/,
        );
        return Response.json(
          createPersistedCourseCoverGenerationBody({
            courseId: coverCourseId,
            assetId: "course-cover-request-course-cover-1",
            imageUrl: "https://dashscope-result/course-cover.png",
            requestId: "request-course-cover-1",
          }),
        );
      }

      expect(url).toBe("/api/teaching/courses");
      const persistedCourse = {
        courseId: coverCourseId,
        courseName: "智能支持的初等数学研究",
        instructor: "康霞",
        unit: "广州大学（404）",
        department: "实验教学中心",
        semester: "2025-2026第二学期",
        students: 0,
        coverAssetId: "course-cover-request-course-cover-1",
      };
      if (init?.method === "GET") {
        return Response.json({
          courses: [persistedCourse],
          classes: [],
          receipt: {
            action: "list-courses",
            actorId: "teacher-kang",
            status: "read",
          },
        });
      }

      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ "content-type": "application/json" });
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        courseId: coverCourseId,
        name: "智能支持的初等数学研究",
        coverAssetId: "course-cover-request-course-cover-1",
      });
      expect(JSON.stringify(body)).not.toContain("DASHSCOPE_API_KEY");

      return Response.json(
        {
          course: persistedCourse,
          receipt: createPersistedCourseReceipt(persistedCourse.courseId),
          ownershipReceipt: createMergedCourseOwnershipReceipt(persistedCourse.courseId),
        },
        { status: 201 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-research-methods");

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/courses",
        expect.objectContaining({ method: "GET" }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "新增课程" }));
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "智能支持的初等数学研究" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成封面" }));

    await waitFor(() => {
      expect(screen.getByText("封面已生成")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "完成" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/courses",
        expect.objectContaining({ method: "POST" }),
      );
      expect(screen.queryByRole("dialog", { name: "新增课程" })).toBeNull();
      expect(screen.getByText("智能支持的初等数学研究")).toBeTruthy();
    });
  });

  it("does not reuse a course-cover asset when binding partially fails", async () => {
    window.history.replaceState(null, "", "/teaching");
    let coverCourseId = "";
    let didCreateCourse = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "/api/teaching/course-cover") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body));
        coverCourseId = String(body.courseId);
        return Response.json(
          {
            traceId: "trace-course-cover-binding-partial-ui",
            error: "External teaching course management persistence failed.",
            ...createPersistedCourseCoverGenerationBody({
              courseId: coverCourseId,
              assetId: "course-cover-request-course-cover-partial-1",
              imageUrl: "https://dashscope-result/course-cover-partial.png",
              requestId: "request-course-cover-partial-1",
            }),
            partialFailure: {
              status: "cover-asset-persisted-course-binding-failed",
              failedStep: "course-cover-binding",
              courseId: coverCourseId,
              assetId: "course-cover-request-course-cover-partial-1",
              recoveryAction: "reuse-cover-asset-id-on-course-create-or-retry-binding",
              responsibleSession: "S12",
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "ids-only",
              },
            },
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          },
          { status: 502 },
        );
      }

      expect(url).toBe("/api/teaching/courses");
      const persistedCourse = {
        courseId: "teacher-course-partial-cover-fallback-20260630",
        courseName: "部分保存封面课程",
        instructor: "康霞",
        unit: "广州大学（404）",
        department: "实验教学中心",
        semester: "2025-2026第二学期",
        students: 0,
      };
      if (init?.method === "GET") {
        return Response.json({
          courses: didCreateCourse ? [persistedCourse] : [],
          classes: [],
          receipt: {
            action: "list-courses",
            actorId: "teacher-kang",
            status: "read",
          },
        });
      }

      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        name: "部分保存封面课程",
      });
      expect(body).not.toHaveProperty("courseId");
      expect(body).not.toHaveProperty("coverAssetId");
      expect(JSON.stringify(body)).not.toContain("course-cover-request-course-cover-partial-1");
      expect(JSON.stringify(body)).not.toContain(coverCourseId);
      didCreateCourse = true;
      return Response.json(
        {
          course: persistedCourse,
          receipt: createPersistedCourseReceipt(persistedCourse.courseId),
          ownershipReceipt: createMergedCourseOwnershipReceipt(persistedCourse.courseId),
        },
        { status: 201 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/courses",
        expect.objectContaining({ method: "GET" }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "新增课程" }));
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "部分保存封面课程" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成封面" }));

    await waitFor(() => {
      expect(screen.queryByText("封面已生成")).toBeNull();
      expect(screen.getByRole("alert").textContent).toContain(
        "封面已保存，但课程绑定未完成。追踪编号：trace-course-cover-binding-partial-ui",
      );
    });
    expect(
      screen.queryByRole("img", { name: "为部分保存封面课程生成的课程封面" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "完成" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/courses",
        expect.objectContaining({ method: "POST" }),
      );
      expect(screen.queryByRole("dialog", { name: "新增课程" })).toBeNull();
      expect(screen.getByText("部分保存封面课程")).toBeTruthy();
    });
  });

  it("clears stale generated cover bindings when the new course draft changes before submit", async () => {
    window.history.replaceState(null, "", "/teaching");
    let coverCourseId = "";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "/api/teaching/course-cover") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body));
        coverCourseId = String(body.courseId);
        return Response.json(
          createPersistedCourseCoverGenerationBody({
            courseId: coverCourseId,
            assetId: "course-cover-request-stale-course-cover-1",
            imageUrl: "https://dashscope-result/stale-course-cover.png",
            requestId: "request-stale-course-cover-1",
          }),
        );
      }

      expect(url).toBe("/api/teaching/courses");
      const persistedCourse = {
        courseId: "teacher-course-updated-course-name-20260623",
        courseName: "更新后的课程名称",
        instructor: "康霞",
        unit: "广州大学（404）",
        department: "实验教学中心",
        semester: "2025-2026第二学期",
        students: 0,
      };
      if (init?.method === "GET") {
        return Response.json({
          courses: [persistedCourse],
          classes: [],
          receipt: {
            action: "list-courses",
            actorId: "teacher-kang",
            status: "read",
          },
        });
      }

      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        name: "更新后的课程名称",
      });
      expect(body).not.toHaveProperty("coverAssetId");
      expect(body).not.toHaveProperty("courseId");
      expect(JSON.stringify(body)).not.toContain("course-cover-request-stale-course-cover-1");
      expect(JSON.stringify(body)).not.toContain(coverCourseId);
      return Response.json(
        {
          course: persistedCourse,
          receipt: createPersistedCourseReceipt(persistedCourse.courseId),
          ownershipReceipt: createMergedCourseOwnershipReceipt(persistedCourse.courseId),
        },
        { status: 201 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-course-updated-course-name-20260623");

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/courses",
        expect.objectContaining({ method: "GET" }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "新增课程" }));
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "原始课程名称" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成封面" }));

    await waitFor(() => {
      expect(screen.getByText("封面已生成")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "更新后的课程名称" },
    });

    expect(screen.queryByText("封面已生成")).toBeNull();
    expect(
      screen.queryByRole("img", { name: "为更新后的课程名称生成的课程封面" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "完成" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/courses",
        expect.objectContaining({ method: "POST" }),
      );
      expect(screen.queryByRole("dialog", { name: "新增课程" })).toBeNull();
      expect(screen.getByText("更新后的课程名称")).toBeTruthy();
    });
  });

  it("clears stale generated cover bindings before a retried cover generation fails", async () => {
    window.history.replaceState(null, "", "/teaching");
    let coverRequestCount = 0;
    let firstCoverCourseId = "";
    let didCreateCourse = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "/api/teaching/course-cover") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body));
        coverRequestCount += 1;
        if (coverRequestCount === 1) {
          firstCoverCourseId = String(body.courseId);
          return Response.json(
            createPersistedCourseCoverGenerationBody({
              courseId: firstCoverCourseId,
              assetId: "course-cover-request-retry-stale-cover-1",
              imageUrl: "https://dashscope-result/retry-stale-course-cover.png",
              requestId: "request-retry-stale-course-cover-1",
            }),
          );
        }

        return Response.json(
          {
            traceId: "trace-course-cover-retry-denied",
            error: "Current account does not have permission to generate course covers.",
            access: {
              status: "denied",
              reasonCode: "teacher-role-required",
              responsibleSession: "S12",
            },
          },
          { status: 403 },
        );
      }

      expect(url).toBe("/api/teaching/courses");
      const persistedCourse = {
        courseId: "teacher-course-cover-retry-fallback-20260630",
        courseName: "封面重试失败课程",
        instructor: "康霞",
        unit: "广州大学（404）",
        department: "实验教学中心",
        semester: "2025-2026第二学期",
        students: 0,
      };
      if (init?.method === "GET") {
        return Response.json({
          courses: didCreateCourse ? [persistedCourse] : [],
          classes: [],
          receipt: {
            action: "list-courses",
            actorId: "teacher-kang",
            status: "read",
          },
        });
      }

      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        name: "封面重试失败课程",
      });
      expect(body).not.toHaveProperty("coverAssetId");
      expect(body).not.toHaveProperty("courseId");
      expect(JSON.stringify(body)).not.toContain("course-cover-request-retry-stale-cover-1");
      expect(JSON.stringify(body)).not.toContain(firstCoverCourseId);
      didCreateCourse = true;
      return Response.json(
        {
          course: persistedCourse,
          receipt: createPersistedCourseReceipt(persistedCourse.courseId),
          ownershipReceipt: createMergedCourseOwnershipReceipt(persistedCourse.courseId),
        },
        { status: 201 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/courses",
        expect.objectContaining({ method: "GET" }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "新增课程" }));
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "封面重试失败课程" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成封面" }));

    await waitFor(() => {
      expect(screen.getByText("封面已生成")).toBeTruthy();
      expect(
        screen.getByRole("img", { name: "为封面重试失败课程生成的课程封面" }),
      ).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "生成封面" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "封面未生成：当前账号没有教师权限。追踪编号：trace-course-cover-retry-denied",
    );
    expect(screen.queryByText("封面已生成")).toBeNull();
    expect(
      screen.queryByRole("img", { name: "为封面重试失败课程生成的课程封面" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "完成" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/courses",
        expect.objectContaining({ method: "POST" }),
      );
      expect(screen.queryByRole("dialog", { name: "新增课程" })).toBeNull();
      expect(screen.getByText("封面重试失败课程")).toBeTruthy();
    });
  });

  it("persists a class for a backend-created course and opens its invitation QR", async () => {
    const persistedCourse = {
      courseId: "teacher-course-ai-supported-elementary-math-20260623",
      courseName: "智能支持的初等数学研究",
      instructor: "康霞",
      unit: "广州大学（404）",
      department: "实验教学中心",
      semester: "2025-2026第二学期",
      description: "",
      students: 0,
    };
    const persistedClass = {
      classId: "teacher-course-ai-supported-elementary-math-20260623-class-1",
      courseId: "teacher-course-ai-supported-elementary-math-20260623",
      className: "测试班",
      students: 0,
      semester: "2025-2026第二学期",
      invitationCode: "66334455",
    };
    let didCreateClass = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "/api/teaching/courses") {
        if (init?.method === "GET") {
          return Response.json({
            courses: [persistedCourse],
            classes: didCreateClass ? [persistedClass] : [],
            receipt: {
              action: "list-courses",
              actorId: "teacher-kang",
              status: "read",
            },
          });
        }

        expect(init?.method).toBe("POST");
        expect(init?.headers).toEqual({ "content-type": "application/json" });
        return Response.json(
          {
            course: persistedCourse,
            receipt: createPersistedCourseReceipt(persistedCourse.courseId),
            ownershipReceipt: createMergedCourseOwnershipReceipt(persistedCourse.courseId),
          },
          { status: 201 },
        );
      }

      expect(url).toBe(
        "/api/teaching/courses/teacher-course-ai-supported-elementary-math-20260623/classes",
      );
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ "content-type": "application/json" });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        className: "测试班",
        semester: "2025-2026第二学期",
      });
      didCreateClass = true;

      return Response.json(
        {
          classItem: persistedClass,
          receipt: createPersistedClassReceipt(
            persistedCourse.courseId,
            persistedClass.classId,
          ),
        },
        { status: 201 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<TeachingPage />);

    fireEvent.click(screen.getByRole("button", { name: "新增课程" }));
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "智能支持的初等数学研究" },
    });
    fireEvent.click(screen.getByRole("button", { name: "完成" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "新增课程" })).toBeNull();
      expect(screen.getByText("智能支持的初等数学研究")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "为智能支持的初等数学研究新建班级" }));

    expect(screen.getByRole("dialog", { name: "新建班级" })).toBeTruthy();
    expect(screen.getByLabelText("班级名称").getAttribute("placeholder")).toBe("输入班级名称");
    expect(screen.getByRole("button", { name: "完成" }).getAttribute("disabled")).not.toBeNull();

    fireEvent.change(screen.getByLabelText("班级名称"), {
      target: { value: "测试班" },
    });
    expect(screen.getByRole("button", { name: "完成" }).getAttribute("disabled")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "完成" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/courses/teacher-course-ai-supported-elementary-math-20260623/classes",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "新建班级" })).toBeNull();
      expect(screen.getByText("测试班")).toBeTruthy();
      expect(screen.getByText("学生：0")).toBeTruthy();
      expect(screen.getByText("2025-2026第二学期")).toBeTruthy();
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "打开测试班的邀请码",
      }),
    );

    const invitationDialog = screen.getByRole("dialog", {
      name: "测试班邀请码",
    });
    expect(invitationDialog).toBeTruthy();
    expect(screen.getByText("邀请码：")).toBeTruthy();
    expect(screen.getByText("66334455")).toBeTruthy();
    // The dialog now describes the three real paths in, and reports the code's own
    // policy rather than a hardcoded validity claim.
    expect(
      screen.getByText("扫描二维码、打开加入链接，或在课程广场页输入邀请码。"),
    ).toBeTruthy();
    expect(screen.getByText("无过期时间")).toBeTruthy();
    expect(screen.getByText("不限人数")).toBeTruthy();
    expect(screen.queryByText("该邀请码2026年12月17日前有效")).toBeNull();
    expect(invitationDialog.textContent).toContain("测试班");
    expect(container.querySelector('[data-uais-class-invitation-qr="66334455"]')).toBeTruthy();
  });

  it("keeps the new class dialog open while class creation is pending", async () => {
    window.history.replaceState(null, "", "/teaching");
    const persistedCourse = {
      courseId: "teacher-course-pending-class-lock-20260625",
      courseName: "企业级普通教学管理",
      instructor: "康霞",
      unit: "广州大学（404）",
      department: "实验教学中心",
      semester: "2026 春季",
      students: 12,
    };
    const persistedClass = {
      classId: "teacher-course-pending-class-lock-20260625-class-1",
      courseId: "teacher-course-pending-class-lock-20260625",
      className: "待保存班",
      students: 0,
      semester: "2026 春季",
      invitationCode: "66334455",
    };
    let shouldReadBackClass = false;
    let resolveCreateClass: ((response: Response) => void) | undefined;
    const createClassResponse = new Promise<Response>((resolve) => {
      resolveCreateClass = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teaching/courses") {
        expect(init?.method).toBe("GET");
        return Response.json({
          courses: [persistedCourse],
          classes: shouldReadBackClass ? [persistedClass] : [],
          receipt: {
            action: "list-courses",
            actorId: "teacher-kang",
            status: "read",
          },
        });
      }

      expect(url).toBe(
        "/api/teaching/courses/teacher-course-pending-class-lock-20260625/classes",
      );
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        className: "待保存班",
        semester: "2026 春季",
      });
      return createClassResponse;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-course-pending-class-lock-20260625");

    await waitFor(() => {
      expect(screen.getByText("企业级普通教学管理")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "为企业级普通教学管理新建班级" }));
    fireEvent.change(screen.getByLabelText("班级名称"), {
      target: { value: "待保存班" },
    });
    fireEvent.click(screen.getByRole("button", { name: "完成" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "保存中" })).toBeTruthy();
    });

    expect(screen.getByRole("button", { name: "取消" }).getAttribute("disabled")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "关闭新建班级弹窗" }).getAttribute("disabled"),
    ).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭新建班级弹窗" }));
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.getByRole("dialog", { name: "新建班级" })).toBeTruthy();

    shouldReadBackClass = true;
    resolveCreateClass?.(
      Response.json(
        {
          classItem: persistedClass,
          receipt: createPersistedClassReceipt(
            persistedCourse.courseId,
            persistedClass.classId,
          ),
        },
        { status: 201 },
      ),
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "新建班级" })).toBeNull();
      expect(screen.getByText("待保存班")).toBeTruthy();
    });
  });

  it("requires course list readback before showing a newly posted class as saved", async () => {
    window.history.replaceState(null, "", "/teaching");
    const persistedCourse = {
      courseId: "teacher-course-enterprise-operations-20260623",
      courseName: "企业级普通教学管理",
      instructor: "康霞",
      unit: "广州大学（404）",
      department: "实验教学中心",
      semester: "2026 春季",
      students: 12,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teaching/courses") {
        expect(init?.method).toBe("GET");
        return Response.json({
          courses: [persistedCourse],
          classes: [],
          receipt: {
            action: "list-courses",
            actorId: "teacher-kang",
            status: "read",
          },
        });
      }

      expect(url).toBe(
        "/api/teaching/courses/teacher-course-enterprise-operations-20260623/classes",
      );
      expect(init?.method).toBe("POST");
      return Response.json(
        {
          classItem: {
            classId: "teacher-course-enterprise-operations-20260623-class-1",
            courseId: "teacher-course-enterprise-operations-20260623",
            className: "读回缺失班",
            students: 0,
            semester: "2026 春季",
            invitationCode: "66334455",
          },
          receipt: createPersistedClassReceipt(
            "teacher-course-enterprise-operations-20260623",
            "teacher-course-enterprise-operations-20260623-class-1",
          ),
        },
        { status: 201 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-course-enterprise-operations-20260623");

    await waitFor(() => {
      expect(screen.getByText("企业级普通教学管理")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "为企业级普通教学管理新建班级" }));
    fireEvent.change(screen.getByLabelText("班级名称"), {
      target: { value: "读回缺失班" },
    });
    fireEvent.click(screen.getByRole("button", { name: "完成" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/courses",
        expect.objectContaining({ method: "GET" }),
      );
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("服务端列表尚未读回该班级");
    expect(screen.getByRole("dialog", { name: "新建班级" })).toBeTruthy();
    expect(screen.queryByText("读回缺失班")).toBeNull();
  });

  it("requires a class create receipt before showing a newly posted class as saved", async () => {
    window.history.replaceState(null, "", "/teaching");
    const persistedCourse = {
      courseId: "teacher-course-class-receipt-required-20260628",
      courseName: "企业级普通教学管理",
      instructor: "康霞",
      unit: "广州大学（404）",
      department: "实验教学中心",
      semester: "2026 春季",
      students: 12,
    };
    const persistedClass = {
      classId: "teacher-course-class-receipt-required-20260628-class-1",
      courseId: "teacher-course-class-receipt-required-20260628",
      className: "回执缺失班",
      students: 0,
      semester: "2026 春季",
      invitationCode: "66334455",
    };
    let didCreateClass = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teaching/courses") {
        expect(init?.method).toBe("GET");
        return Response.json({
          courses: [persistedCourse],
          classes: didCreateClass ? [persistedClass] : [],
          receipt: {
            action: "list-courses",
            actorId: "teacher-kang",
            status: "read",
          },
        });
      }

      expect(url).toBe(
        "/api/teaching/courses/teacher-course-class-receipt-required-20260628/classes",
      );
      expect(init?.method).toBe("POST");
      didCreateClass = true;
      return Response.json(
        {
          classItem: persistedClass,
          traceId: "trace-class-create-receipt-missing",
        },
        { status: 201 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-course-class-receipt-required-20260628");

    await waitFor(() => {
      expect(screen.getByText("企业级普通教学管理")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "为企业级普通教学管理新建班级" }));
    fireEvent.change(screen.getByLabelText("班级名称"), {
      target: { value: "回执缺失班" },
    });
    fireEvent.click(screen.getByRole("button", { name: "完成" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("班级服务端回执缺失");
    expect(alert.textContent).toContain("trace-class-create-receipt-missing");
    expect(screen.getByRole("dialog", { name: "新建班级" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "打开回执缺失班的邀请码" })).toBeNull();
  });

  it("requires a signed teacher session in the class create receipt before showing a newly posted class as saved", async () => {
    window.history.replaceState(null, "", "/teaching");
    const persistedCourse = {
      courseId: "teacher-course-class-session-required-20260630",
      courseName: "企业级普通教学管理",
      instructor: "康霞",
      unit: "广州大学（404）",
      department: "实验教学中心",
      semester: "2026 春季",
      students: 12,
    };
    const persistedClass = {
      classId: "teacher-course-class-session-required-20260630-class-1",
      courseId: "teacher-course-class-session-required-20260630",
      className: "会话回执班",
      students: 0,
      semester: "2026 春季",
      invitationCode: "66334455",
    };
    let didCreateClass = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teaching/courses") {
        expect(init?.method).toBe("GET");
        return Response.json({
          courses: [persistedCourse],
          classes: didCreateClass ? [persistedClass] : [],
          receipt: {
            action: "list-courses",
            actorId: "teacher-kang",
            status: "read",
          },
        });
      }

      expect(url).toBe(
        "/api/teaching/courses/teacher-course-class-session-required-20260630/classes",
      );
      expect(init?.method).toBe("POST");
      didCreateClass = true;
      return Response.json(
        {
          classItem: persistedClass,
          receipt: {
            action: "create-class",
            actorId: "teacher-kang",
            courseId: persistedCourse.courseId,
            classId: persistedClass.classId,
            traceId: "trace-class-create-session-missing",
            status: "persisted",
            audit: createSignedInlineOperationReceiptAudit(),
          },
          traceId: "trace-class-create-session-missing",
        },
        { status: 201 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-course-class-session-required-20260630");

    await waitFor(() => {
      expect(screen.getByText("企业级普通教学管理")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "为企业级普通教学管理新建班级" }));
    fireEvent.change(screen.getByLabelText("班级名称"), {
      target: { value: "会话回执班" },
    });
    fireEvent.click(screen.getByRole("button", { name: "完成" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("班级服务端回执缺失");
    expect(alert.textContent).toContain("trace-class-create-session-missing");
    expect(screen.getByRole("dialog", { name: "新建班级" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "打开会话回执班的邀请码" })).toBeNull();
  });

  it("rejects a class create readback when the saved class name does not match the submitted draft", async () => {
    window.history.replaceState(null, "", "/teaching");
    const persistedCourse = {
      courseId: "teacher-course-enterprise-operations-20260625",
      courseName: "企业级普通教学管理",
      instructor: "康霞",
      unit: "广州大学（404）",
      department: "实验教学中心",
      semester: "2026 春季",
      students: 12,
    };
    let classPostCompleted = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teaching/courses") {
        expect(init?.method).toBe("GET");
        return Response.json({
          courses: [persistedCourse],
          classes: classPostCompleted
            ? [
                {
                  classId: "teacher-course-enterprise-operations-20260625-class-1",
                  courseId: "teacher-course-enterprise-operations-20260625",
                  className: "旧班级名称",
                  students: 0,
                  semester: "2026 春季",
                  invitationCode: "66334455",
                },
              ]
            : [],
          receipt: {
            action: "list-courses",
            actorId: "teacher-kang",
            status: "read",
          },
        });
      }

      expect(url).toBe(
        "/api/teaching/courses/teacher-course-enterprise-operations-20260625/classes",
      );
      expect(init?.method).toBe("POST");
      classPostCompleted = true;
      return Response.json(
        {
          classItem: {
            classId: "teacher-course-enterprise-operations-20260625-class-1",
            courseId: "teacher-course-enterprise-operations-20260625",
            className: "语义校验班",
            students: 0,
            semester: "2026 春季",
            invitationCode: "66334455",
          },
          receipt: createPersistedClassReceipt(
            "teacher-course-enterprise-operations-20260625",
            "teacher-course-enterprise-operations-20260625-class-1",
          ),
        },
        { status: 201 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-course-enterprise-operations-20260625");

    await waitFor(() => {
      expect(screen.getByText("企业级普通教学管理")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "为企业级普通教学管理新建班级" }));
    fireEvent.change(screen.getByLabelText("班级名称"), {
      target: { value: "语义校验班" },
    });
    fireEvent.click(screen.getByRole("button", { name: "完成" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("服务端读回的班级内容与本次提交不一致");
    expect(screen.getByRole("dialog", { name: "新建班级" })).toBeTruthy();
    expect(screen.queryByText("旧班级名称")).toBeNull();
  });

  it("rejects a class create readback when the saved class belongs to another course", async () => {
    window.history.replaceState(null, "", "/teaching");
    const targetCourse = {
      courseId: "teacher-course-enterprise-operations-20260626",
      courseName: "企业级普通教学管理",
      instructor: "康霞",
      unit: "广州大学（404）",
      department: "实验教学中心",
      semester: "2026 春季",
      students: 12,
    };
    const otherCourse = {
      courseId: "teacher-course-other-operations-20260626",
      courseName: "其他课程",
      instructor: "康霞",
      unit: "广州大学（404）",
      department: "实验教学中心",
      semester: "2026 春季",
      students: 3,
    };
    let classPostCompleted = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teaching/courses") {
        expect(init?.method).toBe("GET");
        return Response.json({
          courses: [targetCourse, otherCourse],
          classes: classPostCompleted
            ? [
                {
                  classId: "teacher-course-other-operations-20260626-class-1",
                  courseId: "teacher-course-other-operations-20260626",
                  className: "跨课程错配班",
                  students: 0,
                  semester: "2026 春季",
                  invitationCode: "66334455",
                },
              ]
            : [],
          receipt: {
            action: "list-courses",
            actorId: "teacher-kang",
            status: "read",
          },
        });
      }

      expect(url).toBe(
        "/api/teaching/courses/teacher-course-enterprise-operations-20260626/classes",
      );
      expect(init?.method).toBe("POST");
      classPostCompleted = true;
      return Response.json(
        {
          classItem: {
            classId: "teacher-course-other-operations-20260626-class-1",
            courseId: "teacher-course-other-operations-20260626",
            className: "跨课程错配班",
            students: 0,
            semester: "2026 春季",
            invitationCode: "66334455",
          },
          receipt: createPersistedClassReceipt(
            "teacher-course-enterprise-operations-20260626",
            "teacher-course-other-operations-20260626-class-1",
          ),
        },
        { status: 201 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-course-enterprise-operations-20260626");

    await waitFor(() => {
      expect(screen.getByText("企业级普通教学管理")).toBeTruthy();
      expect(screen.getByText("其他课程")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "为企业级普通教学管理新建班级" }));
    fireEvent.change(screen.getByLabelText("班级名称"), {
      target: { value: "跨课程错配班" },
    });
    fireEvent.click(screen.getByRole("button", { name: "完成" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("服务端读回的班级内容与本次提交不一致");
    expect(screen.getByRole("dialog", { name: "新建班级" })).toBeTruthy();
    expect(screen.queryByText("跨课程错配班")).toBeNull();
  });

  it("rejects a class create readback when the saved class semester does not match the submitted course semester", async () => {
    window.history.replaceState(null, "", "/teaching");
    const persistedCourse = {
      courseId: "teacher-course-enterprise-semester-20260627",
      courseName: "企业级普通教学管理",
      instructor: "康霞",
      unit: "广州大学（404）",
      department: "实验教学中心",
      semester: "2025-2026第二学期",
      students: 12,
    };
    let classPostCompleted = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teaching/courses") {
        expect(init?.method).toBe("GET");
        return Response.json({
          courses: [persistedCourse],
          classes: classPostCompleted
            ? [
                {
                  classId: "teacher-course-enterprise-semester-20260627-class-1",
                  courseId: "teacher-course-enterprise-semester-20260627",
                  className: "学期错配班",
                  students: 0,
                  semester: "2026-2027第一学期",
                  invitationCode: "66334455",
                },
              ]
            : [],
          receipt: {
            action: "list-courses",
            actorId: "teacher-kang",
            status: "read",
          },
        });
      }

      expect(url).toBe(
        "/api/teaching/courses/teacher-course-enterprise-semester-20260627/classes",
      );
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        className: "学期错配班",
        semester: "2025-2026第二学期",
      });
      classPostCompleted = true;
      return Response.json(
        {
          classItem: {
            classId: "teacher-course-enterprise-semester-20260627-class-1",
            courseId: "teacher-course-enterprise-semester-20260627",
            className: "学期错配班",
            students: 0,
            semester: "2026-2027第一学期",
            invitationCode: "66334455",
          },
          receipt: createPersistedClassReceipt(
            "teacher-course-enterprise-semester-20260627",
            "teacher-course-enterprise-semester-20260627-class-1",
          ),
        },
        { status: 201 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-course-enterprise-semester-20260627");

    await waitFor(() => {
      expect(screen.getByText("企业级普通教学管理")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "为企业级普通教学管理新建班级" }));
    fireEvent.change(screen.getByLabelText("班级名称"), {
      target: { value: "学期错配班" },
    });
    fireEvent.click(screen.getByRole("button", { name: "完成" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("服务端读回的班级内容与本次提交不一致");
    expect(screen.getByRole("dialog", { name: "新建班级" })).toBeTruthy();
    expect(screen.queryByText("学期错配班")).toBeNull();
  });

  it("keeps failed class creation visible as an alert until the teacher edits the class name", async () => {
    const persistedCourse = {
      courseId: "teacher-course-ai-supported-elementary-math-20260623",
      courseName: "智能支持的初等数学研究",
      instructor: "康霞",
      unit: "广州大学（404）",
      department: "实验教学中心",
      semester: "2025-2026第二学期",
      description: "",
      students: 0,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "/api/teaching/courses") {
        if (init?.method === "GET") {
          return Response.json({
            courses: [persistedCourse],
            classes: [],
            receipt: {
              action: "list-courses",
              actorId: "teacher-kang",
              status: "read",
            },
          });
        }

        expect(init?.method).toBe("POST");
        return Response.json(
          {
            course: persistedCourse,
            receipt: createPersistedCourseReceipt(persistedCourse.courseId),
            ownershipReceipt: createMergedCourseOwnershipReceipt(persistedCourse.courseId),
          },
          { status: 201 },
        );
      }

      expect(url).toBe(
        "/api/teaching/courses/teacher-course-ai-supported-elementary-math-20260623/classes",
      );
      expect(init?.method).toBe("POST");
      return Response.json(
        { error: "UAIS teacher class permission is required." },
        { status: 403 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);

    fireEvent.click(screen.getByRole("button", { name: "新增课程" }));
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "智能支持的初等数学研究" },
    });
    fireEvent.click(screen.getByRole("button", { name: "完成" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "新增课程" })).toBeNull();
      expect(screen.getByText("智能支持的初等数学研究")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "为智能支持的初等数学研究新建班级" }));
    fireEvent.change(screen.getByLabelText("班级名称"), {
      target: { value: "服务端失败班" },
    });
    fireEvent.click(screen.getByRole("button", { name: "完成" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/courses/teacher-course-ai-supported-elementary-math-20260623/classes",
        expect.objectContaining({ method: "POST" }),
      );
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("UAIS teacher class permission is required.");
    expect(screen.getByRole("dialog", { name: "新建班级" })).toBeTruthy();
    expect(screen.queryByText("服务端失败班")).toBeNull();

    fireEvent.change(screen.getByLabelText("班级名称"), {
      target: { value: "服务端恢复班" },
    });

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("surfaces class creation authorization failure details and trace id", async () => {
    window.history.replaceState(null, "", "/teaching");
    const persistedCourse = {
      courseId: "teacher-course-enterprise-rbac-20260625",
      courseName: "企业级 RBAC 教学管理",
      instructor: "康霞",
      unit: "广州大学（404）",
      department: "实验教学中心",
      semester: "2026 春季",
      students: 12,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teaching/courses") {
        expect(init?.method).toBe("GET");
        return Response.json({
          courses: [persistedCourse],
          classes: [],
          receipt: {
            action: "list-courses",
            actorId: "teacher-kang",
            status: "read",
          },
        });
      }

      expect(url).toBe(
        "/api/teaching/courses/teacher-course-enterprise-rbac-20260625/classes",
      );
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        className: "权限拒绝班",
      });
      return Response.json(
        {
          traceId: "trace-class-create-course-denied",
          error: "Current teacher cannot create classes for this course.",
          access: {
            status: "denied",
            reasonCode: "teacher-course-ownership-required",
            responsibleSession: "S12",
          },
        },
        { status: 403 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-course-enterprise-rbac-20260625");

    await waitFor(() => {
      expect(screen.getByText("企业级 RBAC 教学管理")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "为企业级 RBAC 教学管理新建班级" }));
    fireEvent.change(screen.getByLabelText("班级名称"), {
      target: { value: "权限拒绝班" },
    });
    fireEvent.click(screen.getByRole("button", { name: "完成" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/courses/teacher-course-enterprise-rbac-20260625/classes",
        expect.objectContaining({ method: "POST" }),
      );
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "班级未保存到服务器：当前教师无权操作该课程。追踪编号：trace-class-create-course-denied",
    );
    expect(screen.getByRole("dialog", { name: "新建班级" })).toBeTruthy();
    expect(screen.queryByText("权限拒绝班")).toBeNull();
  });

  it("surfaces the enterprise AI provider split and PPT voice contract", () => {
    const { container } = render(<TeachingPage />);
    openAgentWorkspace();

    expect(screen.getByText("企业级智能编排")).toBeTruthy();
    expect(screen.getByText("深度求索")).toBeTruthy();
    expect(screen.getByText("阿里千问 / 百炼")).toBeTruthy();
    expect(screen.getByText("10 秒教师声音复刻")).toBeTruthy();
    expect(screen.getByText("课件配音合同已就绪")).toBeTruthy();
    expect(screen.getByText("配置检查接口已就绪")).toBeTruthy();
    expect(screen.getByRole("button", { name: "使用康霞 10 秒声音" })).toBeTruthy();
    expect(screen.getByText("康霞课件 19 页")).toBeTruthy();
    expect(container.querySelector('[data-uais-voice-sample-select="file-input"]')).toBeTruthy();
    expect(
      container.querySelector('[data-uais-selected-sample-identity="sampleAssetId voiceRefId"]'),
    ).toBeTruthy();
    expect(
      container.querySelector(
        '[data-uais-server-workflow-progress="auth-provider-storage-route"]',
      ),
    ).toBeTruthy();
  });

  it("loads signed server workflow state and existing PPT narration downloads", async () => {
    window.history.replaceState(null, "", "/teaching");
    let objectUrlSequence = 0;
    const createObjectUrlSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation(() => `blob:uais-narration-download-${(objectUrlSequence += 1)}`);
    const revokeObjectUrlSpy = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const clickedDownloads: Array<{
      connectedAtClick: boolean;
      element: HTMLAnchorElement;
      fileName: string;
      href: string;
    }> = [];
    const anchorClickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        clickedDownloads.push({
          connectedAtClick: this.isConnected,
          element: this,
          fileName: this.download,
          href: this.href,
        });
      });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teaching/courses" && (!init?.method || init.method === "GET")) {
        return createSignedTeachingCourseListReadback();
      }
      if (url === "/api/ai/session" && init?.method === "POST") {
        return createRedactedTeacherAiSessionResponse(init);
      }
      if (url === "/api/ai/teacher-ppt-workflow" && (!init?.method || init.method === "GET")) {
        return Response.json({
          workflow: {
            teacherId: "teacher-kang",
            courseId: "research-methods",
            pptAssetId: "kang-xia-ppt-19",
            status: "ready-for-downloads",
            nextAction: "review-and-download-ppt-narration",
            steps: [
              {
                id: "voice-sample",
                status: "ready",
                sampleAssetId: "teacher-kang-10s-sample",
              },
              {
                id: "voice-clone",
                status: "ready",
                voiceRefId: "qwen-voice-ref-teacher-kang-teacher-kang-10s-sample",
              },
              {
                id: "ppt-material",
                status: "ready",
                pptAssetId: "kang-xia-ppt-19",
              },
              {
                id: "ppt-narration",
                status: "ready",
                audioManifestId: "audio-manifest-kang-xia-ppt-19",
              },
            ],
            downloads: {
              audioManifestId: "audio-manifest-kang-xia-ppt-19",
              exportDownloadUrl:
                "/api/ai/ppt-narration/export/audio-manifest-kang-xia-ppt-19",
              audioDownloadPattern:
                "/api/ai/ppt-narration/audio/audio-manifest-kang-xia-ppt-19/{audioId}",
            },
            redaction: { secrets: "omitted", localFiles: "omitted", assets: "ids-only" },
          },
          agentHandoffPlan: {
            framework: "openmaic-style-teacher-ppt-narration",
            status: "ready-for-teacher-review",
            nextAgent: {
              responsibleSession: "S24",
              action: "review-and-download-ppt-narration",
            },
          },
        });
      }
      if (
        url === "/api/ai/ppt-narration/export/audio-manifest-kang-xia-ppt-19" &&
        init?.method === "GET"
      ) {
        return new Response(
          new TextEncoder().encode("zip-download-bytes"),
          { status: 200, headers: { "content-type": "application/zip" } },
        );
      }
      if (
        url ===
          "/api/ai/ppt-narration/audio/audio-manifest-kang-xia-ppt-19/audio-slide-01" &&
        init?.method === "GET"
      ) {
        return new Response(new TextEncoder().encode("wav-download-bytes"), {
          status: 200,
          headers: { "content-type": "audio/wav" },
        });
      }
      return Response.json({ error: "unexpected" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    openAgentWorkspace();
    await waitForSignedTeachingCourseListReadback(fetchMock);

    fireEvent.click(screen.getByRole("button", { name: "刷新服务端工作流" }));

    await waitFor(() => {
      expect(
        screen.getByText("服务端工作流可下载：复核并下载课件配音"),
      ).toBeTruthy();
      expect(screen.getByText("下一步：复核并下载课件配音")).toBeTruthy();
      expect(screen.getByText("声音样本就绪")).toBeTruthy();
      expect(screen.getByText("课件配音就绪")).toBeTruthy();
      // Buttons, not links. These download routes require the signed
      // AI-access headers, which a browser cannot attach to an anchor
      // navigation, so every one of these anchors answered 403 and downloaded
      // nothing. Asserting the href only ever proved the url was spelled
      // correctly — the download itself is covered by the click test below.
      expect(screen.getByRole("button", { name: "下载完整课件配音包" })).toBeTruthy();
      expect(
        screen.getAllByRole("button", { name: /下载服务器第 \d+ 页音频/ }),
      ).toHaveLength(19);
      expect(screen.getByRole("button", { name: "下载服务器第 1 页音频" })).toBeTruthy();
    });
    expect(fetchMock.mock.calls).toHaveLength(3);
    const workflowCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === "/api/ai/teacher-ppt-workflow",
    );
    expect(workflowCall?.[1]?.headers).toEqual(
      expect.objectContaining({
        "x-uais-access-claims": "redacted-claims-teacher-ppt-workflow-read",
        "x-uais-access-signature": "redacted-signature-teacher-ppt-workflow-read",
      }),
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("API_KEY");

    // The download regression: these controls used to be anchors, so clicking
    // one navigated to a route that only accepts the signed access headers and
    // came back 403 having downloaded nothing. Exercise the complete replacement
    // path: mint a resource-scoped session, fetch a successful Blob without
    // following redirects, click a temporary download anchor, then revoke it.
    fireEvent.click(screen.getByRole("button", { name: "下载完整课件配音包" }));
    await waitFor(() => {
      expect(anchorClickSpy).toHaveBeenCalledTimes(1);
      expect(revokeObjectUrlSpy).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "下载服务器第 1 页音频" }));
    await waitFor(() => {
      expect(anchorClickSpy).toHaveBeenCalledTimes(2);
      expect(revokeObjectUrlSpy).toHaveBeenCalledTimes(2);
    });

    const exportCall = fetchMock.mock.calls.find(
      ([url]) =>
        String(url) ===
        "/api/ai/ppt-narration/export/audio-manifest-kang-xia-ppt-19",
    );
    const audioCall = fetchMock.mock.calls.find(
      ([url]) =>
        String(url) ===
        "/api/ai/ppt-narration/audio/audio-manifest-kang-xia-ppt-19/audio-slide-01",
    );
    expect(exportCall?.[1]).toEqual(
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        redirect: "error",
        headers: expect.objectContaining({
          "x-uais-access-claims": "redacted-claims-ppt-narration-export-download",
          "x-uais-access-signature":
            "redacted-signature-ppt-narration-export-download",
        }),
      }),
    );
    expect(audioCall?.[1]).toEqual(
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        redirect: "error",
        headers: expect.objectContaining({
          "x-uais-access-claims": "redacted-claims-ppt-narration-audio-download",
          "x-uais-access-signature": "redacted-signature-ppt-narration-audio-download",
        }),
      }),
    );

    const sessionBodies = fetchMock.mock.calls
      .filter(([url]) => String(url) === "/api/ai/session")
      .map(([, init]) => JSON.parse(String(init?.body)) as {
        action: string;
        resource: Record<string, string>;
        ttlSeconds: number;
      });
    expect(
      sessionBodies.find(({ action }) => action === "ppt-narration-export-download"),
    ).toEqual({
      action: "ppt-narration-export-download",
      ttlSeconds: 300,
      resource: {
        teacherId: "teacher-kang",
        courseId: "research-methods",
        audioManifestId: "audio-manifest-kang-xia-ppt-19",
      },
    });
    expect(
      sessionBodies.find(({ action }) => action === "ppt-narration-audio-download"),
    ).toEqual({
      action: "ppt-narration-audio-download",
      ttlSeconds: 300,
      resource: {
        teacherId: "teacher-kang",
        courseId: "research-methods",
        audioManifestId: "audio-manifest-kang-xia-ppt-19",
        audioId: "audio-slide-01",
      },
    });

    expect(createObjectUrlSpy).toHaveBeenCalledTimes(2);
    const exportBlob = createObjectUrlSpy.mock.calls[0]?.[0] as Blob;
    const audioBlob = createObjectUrlSpy.mock.calls[1]?.[0] as Blob;
    expect(exportBlob).toBeInstanceOf(Blob);
    expect(exportBlob.type).toBe("application/zip");
    expect(await exportBlob.text()).toBe("zip-download-bytes");
    expect(audioBlob).toBeInstanceOf(Blob);
    expect(audioBlob.type).toBe("audio/wav");
    expect(await audioBlob.text()).toBe("wav-download-bytes");
    expect(clickedDownloads).toMatchObject([
      {
        connectedAtClick: true,
        fileName: "ppt-narration-export.zip",
        href: "blob:uais-narration-download-1",
      },
      {
        connectedAtClick: true,
        fileName: "audio-slide-01.wav",
        href: "blob:uais-narration-download-2",
      },
    ]);
    expect(clickedDownloads.every(({ element }) => !element.isConnected)).toBe(true);
    expect(revokeObjectUrlSpy.mock.calls).toEqual([
      ["blob:uais-narration-download-1"],
      ["blob:uais-narration-download-2"],
    ]);
    expect(screen.queryByText(/\u4e0b\u8f7d\u5931\u8d25/)).toBeNull();

    if (process.env.UAIS_TEACHER_WORKFLOW_FEATURE_EVIDENCE === "1") {
      process.stdout.write(
        `UAIS_TEACHER_WORKFLOW_FEATURES ${JSON.stringify({
          serverWorkflowStatus: true,
        })}\n`,
      );
    }
  });

  it.each([
    [
      "an absolute external URL",
      "https://attacker.example/api/ai/ppt-narration/export/audio-manifest-kang-xia-ppt-19",
    ],
    [
      "a protocol-relative external URL",
      "//attacker.example/api/ai/ppt-narration/export/audio-manifest-kang-xia-ppt-19",
    ],
    [
      "malformed percent encoding",
      "/api/ai/ppt-narration/export/audio-manifest-%E0%A4%A",
    ],
  ])(
    "rejects %s before minting a download session or making a download request",
    async (_caseName, unsafeExportDownloadUrl) => {
      window.history.replaceState(null, "", "/teaching");
      const createObjectUrlSpy = vi.spyOn(URL, "createObjectURL");
      const anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click");
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/teaching/courses" && (!init?.method || init.method === "GET")) {
          return createSignedTeachingCourseListReadback();
        }
        if (url === "/api/ai/session" && init?.method === "POST") {
          return createRedactedTeacherAiSessionResponse(init);
        }
        if (
          url === "/api/ai/teacher-ppt-workflow" &&
          (!init?.method || init.method === "GET")
        ) {
          return Response.json({
            workflow: {
              teacherId: "teacher-kang",
              courseId: "research-methods",
              pptAssetId: "kang-xia-ppt-19",
              status: "ready-for-downloads",
              nextAction: "review-and-download-ppt-narration",
              downloads: {
                audioManifestId: "audio-manifest-kang-xia-ppt-19",
                exportDownloadUrl: unsafeExportDownloadUrl,
                audioDownloadPattern:
                  "/api/ai/ppt-narration/audio/audio-manifest-kang-xia-ppt-19/{audioId}",
              },
            },
          });
        }
        return Response.json({ error: "unexpected download request" }, { status: 500 });
      });
      vi.stubGlobal("fetch", fetchMock);

      render(<TeachingPage />);
      openAgentWorkspace();
      await waitForSignedTeachingCourseListReadback(fetchMock);
      fireEvent.click(screen.getByRole("button", { name: "刷新服务端工作流" }));
      await screen.findByRole("button", { name: "下载完整课件配音包" });

      const callCountBeforeRejectedClick = fetchMock.mock.calls.length;
      fireEvent.click(screen.getByRole("button", { name: "下载完整课件配音包" }));

      await waitFor(() => {
        expect(screen.getByText("无法识别的下载地址。")).toBeTruthy();
      });
      expect(fetchMock.mock.calls).toHaveLength(callCountBeforeRejectedClick);
      expect(fetchMock.mock.calls.some(([url]) => String(url) === unsafeExportDownloadUrl)).toBe(
        false,
      );
      const issuedActions = fetchMock.mock.calls
        .filter(([url]) => String(url) === "/api/ai/session")
        .map(([, init]) => (JSON.parse(String(init?.body)) as { action: string }).action);
      expect(issuedActions).toEqual(["teacher-ppt-workflow-read"]);
      expect(createObjectUrlSpy).not.toHaveBeenCalled();
      expect(anchorClickSpy).not.toHaveBeenCalled();
    },
  );

  it("keeps partial server workflow status usable before steps and downloads are ready", async () => {
    window.history.replaceState(null, "", "/teaching");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teaching/courses" && (!init?.method || init.method === "GET")) {
        return createSignedTeachingCourseListReadback();
      }
      if (url === "/api/ai/session" && init?.method === "POST") {
        return createRedactedTeacherAiSessionResponse(init);
      }
      if (url === "/api/ai/teacher-ppt-workflow" && (!init?.method || init.method === "GET")) {
        return Response.json({
          workflow: {
            teacherId: "teacher-kang",
            courseId: "research-methods",
            pptAssetId: "kang-xia-ppt-19",
            status: "waiting-for-storage",
            nextAction: "wait-for-external-storage",
          },
          progress: [
            {
              id: "progress-storage",
              status: "pending",
              responsibleSession: "S22",
              responsibleAgent: {
                name: "S22 Build Quality",
                providerRole: "ppt-narration",
              },
              progressText:
                "S22 Build Quality is waiting for production storage smoke evidence.",
            },
          ],
        });
      }
      return Response.json({ error: "unexpected" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    openAgentWorkspace();
    await waitForSignedTeachingCourseListReadback(fetchMock);

    fireEvent.click(screen.getByRole("button", { name: "刷新服务端工作流" }));

    await waitFor(() => {
      expect(
        screen.getByText("服务端工作流等待存储：等待外部存储"),
      ).toBeTruthy();
      expect(screen.getByText("构建质量 / 待处理")).toBeTruthy();
      expect(screen.getByText("服务端步骤尚未返回。")).toBeTruthy();
      expect(screen.getByText("服务端下载入口尚未生成。")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "下载完整课件配音包" })).toBeNull();
    expect(fetchMock.mock.calls).toHaveLength(3);
    const workflowCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === "/api/ai/teacher-ppt-workflow",
    );
    expect(workflowCall?.[1]?.headers).toEqual(
      expect.objectContaining({
        "x-uais-access-claims": "redacted-claims-teacher-ppt-workflow-read",
        "x-uais-access-signature": "redacted-signature-teacher-ppt-workflow-read",
      }),
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("API_KEY");
  });

  it("surfaces signed teacher session and production readiness progress from the server workflow", async () => {
    window.history.replaceState(null, "", "/teaching");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teaching/courses" && (!init?.method || init.method === "GET")) {
        return createSignedTeachingCourseListReadback();
      }
      if (url === "/api/ai/session" && init?.method === "POST") {
        return createRedactedTeacherAiSessionResponse(init);
      }
      if (url === "/api/ai/teacher-ppt-workflow" && (!init?.method || init.method === "GET")) {
        return Response.json({
          workflow: {
            teacherId: "teacher-kang",
            courseId: "research-methods",
            pptAssetId: "kang-xia-ppt-19",
            status: "ready-for-downloads",
            nextAction: "review-and-download-ppt-narration",
            steps: [
              { id: "voice-sample", status: "ready", sampleAssetId: "teacher-kang-10s-sample" },
              {
                id: "voice-clone",
                status: "ready",
                voiceRefId: "qwen-voice-ref-teacher-kang-teacher-kang-10s-sample",
              },
              { id: "ppt-material", status: "ready", pptAssetId: "kang-xia-ppt-19" },
              {
                id: "ppt-narration",
                status: "ready",
                audioManifestId: "audio-manifest-kang-xia-ppt-19",
              },
            ],
          },
          progress: [
            {
              id: "progress-1",
              type: "s12-teacher-ppt-workflow-auth-boundary",
              status: "authorized",
              responsibleSession: "S12",
              responsibleAgent: {
                id: "s12-backend-api-platform",
                name: "S12 Backend/API Platform",
                providerRole: "ppt-narration",
              },
              progressText:
                "S12 Backend/API Platform verified the signed teacher auth cookie before assembling the PPT narration workflow status.",
            },
            {
              id: "progress-4",
              type: "s19-qwen-provider-env-readiness",
              status: "present",
              responsibleSession: "S19",
              responsibleAgent: {
                id: "s19-api-configuration",
                name: "S19 API Configuration",
                providerRole: "ppt-narration",
              },
              progressText:
                "S19 API Configuration confirmed Qwen provider environment readiness without exposing provider credentials.",
            },
            {
              id: "progress-5",
              type: "s22-teacher-workflow-route-smoke",
              status: "pending",
              responsibleSession: "S22",
              responsibleAgent: {
                id: "s22-build-quality",
                name: "S22 Build Quality",
                providerRole: "ppt-narration",
              },
              progressText:
                "S22 Build Quality is responsible for deployed route smoke of the signed teacher PPT workflow before release.",
            },
          ],
        });
      }
      return Response.json({ error: "unexpected" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<TeachingPage />);
    openAgentWorkspace();
    await waitForSignedTeachingCourseListReadback(fetchMock);

    fireEvent.click(screen.getByRole("button", { name: "刷新服务端工作流" }));

    await waitFor(() => {
      expect(screen.getByText("教师工作流就绪度")).toBeTruthy();
      expect(screen.getByText("后端接口 / 已授权")).toBeTruthy();
      expect(screen.getByText("环境配置 / 已配置")).toBeTruthy();
      expect(screen.getByText("构建质量 / 待处理")).toBeTruthy();
      expect(
        screen.getByText("已确认签名教师会话可用于组装课件配音工作流。"),
      ).toBeTruthy();
    });
    expect(
      container.querySelector(
        '[data-uais-server-workflow-progress="auth-provider-storage-route"]',
      ),
    ).toBeTruthy();
    const workflowCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === "/api/ai/teacher-ppt-workflow",
    );
    expect(workflowCall?.[1]?.headers).toEqual(
      expect.objectContaining({
        "x-uais-access-claims": "redacted-claims-teacher-ppt-workflow-read",
        "x-uais-access-signature": "redacted-signature-teacher-ppt-workflow-read",
      }),
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("API_KEY");
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("DASHSCOPE");
  });

  // Readiness and smoke-plan were dropped from this test with the two buttons that
  // drove them. They were never teacher-runnable: `/api/ai/readiness` and
  // `/api/ai/smoke-plan` assert `assertUaisAiAdminAccess`, no admin session is
  // minted anywhere in the running system, and the production release gate asserts
  // both routes DENY. This test passed only because the mock answered 200 where the
  // real routes answer 403 — it proved the button was wired, not that it worked.
  it("lets teachers run redacted AI chat and PPT contract checks", async () => {
    window.history.replaceState(null, "", "/teaching");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teaching/courses" && (!init?.method || init.method === "GET")) {
        return createSignedTeachingCourseListReadback();
      }
      if (url === "/api/ai/session" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { action: string };
        return Response.json({
          accessSession: {
            headers: {
              "x-uais-access-claims": `redacted-claims-${body.action}`,
              "x-uais-access-signature": `redacted-signature-${body.action}`,
            },
          },
        });
      }
      if (url === "/api/ai/chat" && init?.method === "POST") {
        return Response.json({
          status: "cue-user",
          turns: [{ agentId: "methods", content: "方法顾问 已通过 UAIS multi-agent contract 响应。" }],
        });
      }
      if (url === "/api/ai/voice-sample" && init?.method === "POST") {
        return Response.json({
          sample: {
            provider: "qwen",
            status: "ready-for-clone",
            sampleDurationSeconds: 10,
          },
          nextAction: "submit-qwen-voice-clone",
        });
      }
      if (url === "/api/ai/voice-clone/preflight" && init?.method === "POST") {
        return Response.json({
          preflight: {
            status: "blocked",
            nextAction: "resolve-preflight-blockers",
            checks: [
              { responsibleSession: "S07", status: "ready" },
              { responsibleSession: "S12", status: "blocked" },
              { responsibleSession: "S19", status: "blocked" },
              { responsibleSession: "S24", status: "ready" },
            ],
          },
        });
      }
      if (url === "/api/ai/voice-clone/status" && init?.method === "POST") {
        return Response.json({
          voiceClone: {
            provider: "qwen",
            status: "ready",
            clonedVoiceId: "voice-qwen-redacted",
            nextAction: "create-ppt-narration",
          },
        });
      }
      if (url === "/api/ai/ppt-narration" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as {
          pptNarration?: { slideScripts?: Array<{ slideId: string; narrationText: string }> };
        };
        const slideScripts = body.pptNarration?.slideScripts ?? [];
        expect(slideScripts).toHaveLength(19);
        expect(slideScripts[0]?.slideId).toBe("slide-01");
        expect(slideScripts.at(-1)?.slideId).toBe("slide-19");
        return Response.json({
          voiceCloneJob: { provider: "qwen", status: "queued" },
          pptNarrationJob: { provider: "qwen", status: "queued", slideCount: slideScripts.length },
        });
      }
      return Response.json({ error: "unexpected" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    openAgentWorkspace();
    await waitForSignedTeachingCourseListReadback(fetchMock);

    expect(screen.queryByRole("button", { name: "刷新配置检查" })).toBeNull();
    expect(screen.queryByRole("button", { name: "运行试测" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "试跑智能体合同" }));
    fireEvent.click(screen.getByRole("button", { name: "登记声音样本合同" }));
    fireEvent.click(screen.getByRole("button", { name: "声音克隆实时预检" }));
    fireEvent.click(screen.getByRole("button", { name: "检查声音克隆状态" }));
    fireEvent.click(screen.getByRole("button", { name: "生成课件配音合同" }));

    await waitFor(() => {
      expect(screen.getByText("方法顾问已通过多智能体合同响应。")).toBeTruthy();
      expect(screen.getByText("声音样本合同可用于复刻：10 秒")).toBeTruthy();
      expect(
        screen.getByText("声音克隆预检受阻：智能体定义就绪，后端接口受阻，环境配置受阻，导出质检就绪"),
      ).toBeTruthy();
      expect(screen.getByText("声音克隆就绪：创建课件配音")).toBeTruthy();
      expect(screen.getByText("课件配音合同已排队：19 页")).toBeTruthy();
    });
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("API_KEY");
    expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/ai/readiness")).toBe(
      false,
    );
    expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/ai/smoke-plan")).toBe(
      false,
    );
  });

  it("uses the signed teacher actor for uploaded voice sample ids instead of the default teacher", async () => {
    window.history.replaceState(null, "", "/teaching");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teaching/courses" && (!init?.method || init.method === "GET")) {
        return createSignedTeachingCourseListReadback("teacher-lin");
      }
      if (url === "/api/ai/session" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { action: string };
        return Response.json({
          accessSession: {
            headers: {
              "x-uais-access-claims": `redacted-claims-${body.action}`,
              "x-uais-access-signature": `redacted-signature-${body.action}`,
            },
          },
        });
      }
      if (url === "/api/ai/voice-sample" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { sampleAssetId: string };
        return Response.json({
          sample: {
            provider: "qwen",
            status: "ready-for-clone",
            sampleDurationSeconds: 10,
          },
          sampleAsset: {
            sampleAssetId: body.sampleAssetId,
            storagePolicy: "server-side-redacted-teacher-voice-sample",
          },
        });
      }
      return Response.json({ error: "unexpected" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<TeachingPage />);
    openAgentWorkspace();
    await waitForSignedTeachingCourseListReadback(fetchMock);

    fireEvent.change(screen.getByLabelText("上传/选择 10 秒教师声音"), {
      target: {
        files: [new File(["voice"], "lin-voice-10s.wav", { type: "audio/wav" })],
      },
    });
    const audioProbe = container.querySelector(
      '[data-uais-selected-audio-probe="metadata"]',
    ) as HTMLAudioElement | null;
    if (audioProbe) {
      Object.defineProperty(audioProbe, "duration", {
        configurable: true,
        value: 10,
      });
      fireEvent.loadedMetadata(audioProbe);
    }

    fireEvent.click(screen.getByRole("button", { name: "登记教师声音" }));

    await waitFor(() => {
      expect(screen.getByText("声音样本可用于复刻：10 秒")).toBeTruthy();
    });

    const sessionCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === "/api/ai/session",
    );
    const voiceSampleCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === "/api/ai/voice-sample",
    );
    const sessionBody = JSON.parse(String(sessionCall?.[1]?.body));
    const voiceSampleBody = JSON.parse(String(voiceSampleCall?.[1]?.body));

    expect(sessionBody.resource).toEqual(
      expect.objectContaining({
        teacherId: "teacher-lin",
        sampleAssetId: "teacher-lin-upload-lin-voice-10s-wav",
      }),
    );
    expect(voiceSampleBody).toEqual(
      expect.objectContaining({
        teacherId: "teacher-lin",
        sampleAssetId: "teacher-lin-upload-lin-voice-10s-wav",
        sourceKind: "upload",
        selectedFileName: "lin-voice-10s.wav",
      }),
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("teacher-kang-upload");
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("API_KEY");
  });

  it("walks teachers through voice sample, preflight, voiceRef, and per-slide PPT WAV downloads", async () => {
    window.history.replaceState(null, "", "/teaching");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teaching/courses" && (!init?.method || init.method === "GET")) {
        return createSignedTeachingCourseListReadback();
      }
      if (url === "/api/ai/session" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { action: string };
        return Response.json({
          accessSession: {
            headers: {
              "x-uais-access-claims": `redacted-claims-${body.action}`,
              "x-uais-access-signature": `redacted-signature-${body.action}`,
            },
          },
          accessPlan: {
            action: body.action,
            redaction: { secrets: "omitted", localFiles: "omitted", assets: "ids-only" },
          },
        });
      }
      if (url === "/api/ai/voice-sample" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { sampleAssetId: string };
        return Response.json({
          sample: {
            provider: "qwen",
            status: "ready-for-clone",
            sampleDurationSeconds: 10,
          },
          sampleAsset: {
            sampleAssetId: body.sampleAssetId,
            storagePolicy: "server-side-redacted-teacher-voice-sample",
          },
          nextAction: "submit-qwen-voice-clone",
        });
      }
      if (url === "/api/ai/voice-clone/preflight" && init?.method === "POST") {
        return Response.json({
          preflight: {
            status: "ready",
            nextAction: "submit-qwen-voice-clone",
            checks: [
              { responsibleSession: "S07", status: "ready" },
              { responsibleSession: "S12", status: "ready" },
              { responsibleSession: "S19", status: "ready" },
              { responsibleSession: "S24", status: "ready" },
            ],
          },
        });
      }
      if (url === "/api/ai/voice-clone/status" && init?.method === "POST") {
        const sessionCall = fetchMock.mock.calls.find(
          ([sessionUrl, sessionInit]) =>
            String(sessionUrl) === "/api/ai/session" &&
            JSON.parse(String(sessionInit?.body)).action === "voice-clone-status",
        );
        const sampleAssetId =
          JSON.parse(String(sessionCall?.[1]?.body)).resource.sampleAssetId ??
          "teacher-kang-10s-sample";
        return Response.json({
          voiceClone: {
            provider: "qwen",
            status: "ready",
            voiceRef: "server-side-cloned-qwen-voice",
            nextAction: "create-ppt-narration",
          },
          voiceCloneReference: {
            voiceRefId: `qwen-voice-ref-teacher-kang-${sampleAssetId}`,
            provider: "qwen",
            providerRole: "voice-clone",
            status: "ready",
            voiceRef: "server-side-cloned-qwen-voice",
          },
        });
      }
      if (url === "/api/ai/ppt-narration" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as {
          pptNarration?: {
            slideScripts?: Array<{ slideId: string; narrationText: string }>;
          };
        };
        const slideScripts = body.pptNarration?.slideScripts ?? [];
        expect(slideScripts).toHaveLength(19);
        expect(slideScripts[0]).toEqual(
          expect.objectContaining({
            slideId: "slide-01",
            narrationText: expect.stringContaining("康霞"),
          }),
        );
        expect(slideScripts.at(-1)).toEqual(
          expect.objectContaining({
            slideId: "slide-19",
          }),
        );
        return Response.json({
          pptNarrationJob: {
            provider: "qwen",
            status: "queued",
            slideCount: slideScripts.length,
            audioManifestId: "audio-manifest-kang-xia-ppt-19",
            voiceRef: "server-side-cloned-qwen-voice",
          },
          pptNarrationAssets: {
            id: "audio-manifest-kang-xia-ppt-19",
            assets: slideScripts.map((script) => ({
              slideId: script.slideId,
              audioId: `audio-${script.slideId}`,
              format: "wav",
              downloadUrl:
                `/api/ai/ppt-narration/audio/audio-manifest-kang-xia-ppt-19/audio-${script.slideId}`,
            })),
          },
        });
      }
      return Response.json({ error: "unexpected" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<TeachingPage />);
    openAgentWorkspace();
    await waitForSignedTeachingCourseListReadback(fetchMock);

    const voiceInput = screen.getByLabelText("上传/选择 10 秒教师声音");
    fireEvent.change(voiceInput, {
      target: {
        files: [new File(["voice"], "kang-voice-10s.wav", { type: "audio/wav" })],
      },
    });
    const audioProbe = container.querySelector(
      '[data-uais-selected-audio-probe="metadata"]',
    ) as HTMLAudioElement | null;
    if (audioProbe) {
      Object.defineProperty(audioProbe, "duration", {
        configurable: true,
        value: 10,
      });
      fireEvent.loadedMetadata(audioProbe);
      await waitFor(() => {
        expect(screen.getByText("已选择音频 10.0 秒，可以登记。")).toBeTruthy();
      });
    }
    fireEvent.click(screen.getByRole("button", { name: "登记教师声音" }));

    await waitFor(() => {
      expect(
        screen.getByText("声音样本可用于复刻：10 秒"),
      ).toBeTruthy();
    });

    const voiceSampleCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === "/api/ai/voice-sample",
    );
    const voiceSampleBody = JSON.parse(String(voiceSampleCall?.[1]?.body));
    expect(voiceSampleBody).toEqual(
      expect.objectContaining({
        sampleAssetId: "teacher-kang-upload-kang-voice-10s-wav",
        sourceKind: "upload",
        selectedFileName: "kang-voice-10s.wav",
        sampleAudioBase64: "dm9pY2U=",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "运行工作流预检" }));

    await waitFor(() => {
      expect(
        screen.getByText("预检就绪：智能体定义就绪，后端接口就绪，环境配置就绪，导出质检就绪"),
      ).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "保存声音引用" }));

    await waitFor(() => {
      expect(screen.getByText("声音引用就绪")).toBeTruthy();
      expect(screen.getByText("声音引用已在服务端保存，教师端不显示原始值。")).toBeTruthy();
    });
    expect(screen.queryByText("server-side-cloned-qwen-voice")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "生成课件配音" }));

    await waitFor(() => {
      expect(screen.getByText("课件配音已排队：19 页音频")).toBeTruthy();
      // Buttons rather than anchors, for the same reason as the server set: the
      // audio route requires signed access headers an anchor cannot carry.
      expect(screen.getAllByRole("button", { name: /下载第 \d+ 页音频/ })).toHaveLength(19);
      expect(screen.getByRole("button", { name: "下载第 1 页音频" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "下载第 19 页音频" })).toBeTruthy();
    });

    const pptNarrationCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === "/api/ai/ppt-narration",
    );
    const sessionCalls = fetchMock.mock.calls.filter(
      ([url]) => String(url) === "/api/ai/session",
    );
    expect(sessionCalls.map(([, init]) => JSON.parse(String(init?.body)).action)).toEqual([
      "voice-sample-submit",
      "voice-clone-preflight",
      "voice-clone-status",
      "ppt-narration-submit",
    ]);
    expect(JSON.parse(String(sessionCalls[0]?.[1]?.body)).resource).toEqual(
      expect.objectContaining({
        teacherId: "teacher-kang",
        courseId: "research-methods",
        sampleAssetId: "teacher-kang-upload-kang-voice-10s-wav",
      }),
    );
    expect(JSON.parse(String(sessionCalls.at(-1)?.[1]?.body)).resource).toEqual(
      expect.objectContaining({
        teacherId: "teacher-kang",
        courseId: "research-methods",
        sampleAssetId: "teacher-kang-upload-kang-voice-10s-wav",
        pptAssetId: "kang-xia-ppt-19",
        voiceRefId: "qwen-voice-ref-teacher-kang-teacher-kang-upload-kang-voice-10s-wav",
      }),
    );
    expect(pptNarrationCall?.[1]?.headers).toEqual(
      expect.objectContaining({
        "x-uais-access-claims": "redacted-claims-ppt-narration-submit",
        "x-uais-access-signature": "redacted-signature-ppt-narration-submit",
      }),
    );
    expect(String(pptNarrationCall?.[1]?.body)).toContain(
      '"clonedVoiceRef":"qwen-voice-ref-teacher-kang-teacher-kang-upload-kang-voice-10s-wav"',
    );
    expect(String(pptNarrationCall?.[1]?.body)).not.toContain("clonedVoiceId");
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("API_KEY");
    if (process.env.UAIS_TEACHER_WORKFLOW_FEATURE_EVIDENCE === "1") {
      process.stdout.write(
        `UAIS_TEACHER_WORKFLOW_FEATURES ${JSON.stringify({
          voiceSampleUpload: true,
          uploadedSampleAudioPayload: true,
          voiceSampleDurationGate: true,
          voiceSampleSelect: true,
          selectedSampleIdentity: true,
          preflight: true,
          voiceRefDisplay: true,
          pptNarrationGenerate: true,
          perSlideWavDownloads: true,
          workflowStepGating: true,
          signedSessionBootstrap: true,
          authFailClosed: true,
        })}\n`,
      );
    }
  });

  it("blocks uploaded teacher audio before registration when browser metadata is shorter than 10 seconds", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:short-teacher-voice"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });

    try {
      const { container } = render(<TeachingPage />);
      openAgentWorkspace();
      const voiceInput = screen.getByLabelText("上传/选择 10 秒教师声音");

      fireEvent.change(voiceInput, {
        target: {
          files: [new File(["short voice"], "short-voice.wav", { type: "audio/wav" })],
        },
      });

      const registerButton = screen.getByRole("button", {
        name: "登记教师声音",
      }) as HTMLButtonElement;
      expect(registerButton.disabled).toBe(true);

      const audioProbe = container.querySelector(
        '[data-uais-selected-audio-probe="metadata"]',
      ) as HTMLAudioElement;
      Object.defineProperty(audioProbe, "duration", {
        configurable: true,
        value: 1,
      });
      fireEvent.loadedMetadata(audioProbe);

      await waitFor(() => {
        expect(screen.getByText("已选择音频 1.0 秒，至少需要 10 秒。")).toBeTruthy();
      });
      expect(registerButton.disabled).toBe(true);

      fireEvent.click(registerButton);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      if (originalCreateObjectUrl) {
        Object.defineProperty(URL, "createObjectURL", {
          configurable: true,
          value: originalCreateObjectUrl,
        });
      } else {
        delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
      }
      if (originalRevokeObjectUrl) {
        Object.defineProperty(URL, "revokeObjectURL", {
          configurable: true,
          value: originalRevokeObjectUrl,
        });
      } else {
        delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
      }
    }
  });

  it("fails closed before signed AI session bootstrap when no teacher actor is read back", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    openAgentWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "登记教师声音" }));

    await waitFor(() => {
      expect(screen.getByText("教师登录会话缺失，无法签发智能访问权限。")).toBeTruthy();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed before protected workflow calls when signed AI session bootstrap is denied", async () => {
    window.history.replaceState(null, "", "/teaching");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teaching/courses" && (!init?.method || init.method === "GET")) {
        return createSignedTeachingCourseListReadback();
      }
      if (url === "/api/ai/session" && init?.method === "POST") {
        return Response.json(
          {
            error: "UAIS teacher authentication is required.",
            access: {
              status: "denied",
              reasonCode: "authenticated-session-required",
            },
          },
          { status: 401 },
        );
      }
      if (url === "/api/ai/voice-sample") {
        return Response.json({ error: "should not be called" }, { status: 500 });
      }
      return Response.json({ error: "unexpected" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    openAgentWorkspace();
    await waitForSignedTeachingCourseListReadback(fetchMock);

    fireEvent.click(screen.getByRole("button", { name: "登记教师声音" }));

    await waitFor(() => {
      expect(screen.getByText("教师登录会话缺失，无法签发智能访问权限。")).toBeTruthy();
    });
    expect(
      fetchMock.mock.calls
        .filter(([url]) => String(url) === "/api/ai/session")
        .map(([url]) => String(url)),
    ).toEqual(["/api/ai/session"]);
    expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/ai/voice-sample")).toBe(
      false,
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("API_KEY");
  });

  it("checks signed teacher AI session readiness before protected workflow actions", async () => {
    window.history.replaceState(null, "", "/teaching");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teaching/courses" && (!init?.method || init.method === "GET")) {
        return createSignedTeachingCourseListReadback();
      }
      if (url === "/api/ai/session" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { action: string };
        return Response.json({
          accessSession: {
            headers: {
              "x-uais-access-claims": `redacted-claims-${body.action}`,
              "x-uais-access-signature": `redacted-signature-${body.action}`,
            },
          },
          accessPlan: {
            action: body.action,
            redaction: { secrets: "omitted", localFiles: "omitted", assets: "ids-only" },
          },
        });
      }
      return Response.json({ error: "unexpected protected workflow call" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<TeachingPage />);
    openAgentWorkspace();
    await waitForSignedTeachingCourseListReadback(fetchMock);

    fireEvent.click(screen.getByRole("button", { name: "检查教师登录会话" }));

    await waitFor(() => {
      expect(screen.getByText("签名智能访问会话就绪：声音样本提交")).toBeTruthy();
    });
    expect(
      container.querySelector('[data-uais-session-readiness="signed-ai-access-ready"]'),
    ).toBeTruthy();
    expect(
      fetchMock.mock.calls
        .filter(([url]) => String(url) === "/api/ai/session")
        .map(([url]) => String(url)),
    ).toEqual(["/api/ai/session"]);
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("API_KEY");
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("redacted-signature");
    if (process.env.UAIS_TEACHER_WORKFLOW_FEATURE_EVIDENCE === "1") {
      process.stdout.write(
        `UAIS_TEACHER_WORKFLOW_FEATURES ${JSON.stringify({
          signedSessionReadiness: true,
        })}\n`,
      );
    }
  });

  it("clears stale workflow errors when the teacher restarts voice sample selection", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/ai/session" && init?.method === "POST") {
        return Response.json(
          {
            error: "UAIS teacher authentication is required.",
            access: {
              status: "denied",
              reasonCode: "authenticated-session-required",
            },
          },
          { status: 401 },
        );
      }
      return Response.json({ error: "unexpected" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    openAgentWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "登记教师声音" }));

    await waitFor(() => {
      expect(screen.getByText("教师登录会话缺失，无法签发智能访问权限。")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "使用康霞 10 秒声音" }));

    expect(screen.queryByText("教师登录会话缺失，无法签发智能访问权限。")).toBeNull();
    expect(screen.getByText("康霞 10 秒声音已选择。")).toBeTruthy();
  });

  it("clears stale workflow errors when the teacher uploads a new voice sample", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/ai/session" && init?.method === "POST") {
        return Response.json(
          {
            error: "UAIS teacher authentication is required.",
            access: {
              status: "denied",
              reasonCode: "authenticated-session-required",
            },
          },
          { status: 401 },
        );
      }
      return Response.json({ error: "unexpected" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    openAgentWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "登记教师声音" }));

    await waitFor(() => {
      expect(screen.getByText("教师登录会话缺失，无法签发智能访问权限。")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("上传/选择 10 秒教师声音"), {
      target: {
        files: [new File(["new voice"], "kang-new-voice.wav", { type: "audio/wav" })],
      },
    });

    expect(screen.queryByText("教师登录会话缺失，无法签发智能访问权限。")).toBeNull();
    expect(screen.getByText("kang-new-voice.wav")).toBeTruthy();
  });

  it("gates the teacher PPT narration workflow until each prior step is ready", async () => {
    window.history.replaceState(null, "", "/teaching");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teaching/courses" && (!init?.method || init.method === "GET")) {
        return createSignedTeachingCourseListReadback();
      }
      if (url === "/api/ai/session" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { action: string };
        return Response.json({
          accessSession: {
            headers: {
              "x-uais-access-claims": `redacted-claims-${body.action}`,
              "x-uais-access-signature": `redacted-signature-${body.action}`,
            },
          },
        });
      }
      if (url === "/api/ai/voice-sample" && init?.method === "POST") {
        return Response.json({
          sample: {
            status: "ready-for-clone",
            sampleDurationSeconds: 10,
          },
          sampleAsset: {
            sampleAssetId: "teacher-kang-10s-sample",
          },
        });
      }
      if (url === "/api/ai/voice-clone/preflight" && init?.method === "POST") {
        return Response.json({
          preflight: {
            status: "ready",
            checks: [
              { responsibleSession: "S07", status: "ready" },
              { responsibleSession: "S12", status: "ready" },
              { responsibleSession: "S19", status: "ready" },
              { responsibleSession: "S24", status: "ready" },
            ],
          },
        });
      }
      if (url === "/api/ai/voice-clone/status" && init?.method === "POST") {
        return Response.json({
          voiceCloneReference: {
            voiceRefId: "qwen-voice-ref-teacher-kang-teacher-kang-10s-sample",
            status: "ready",
            voiceRef: "server-side-cloned-qwen-voice",
          },
        });
      }
      return Response.json({ error: "unexpected" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    openAgentWorkspace();
    await waitForSignedTeachingCourseListReadback(fetchMock);

    const preflightButton = screen.getByRole("button", { name: "运行工作流预检" });
    const voiceRefButton = screen.getByRole("button", { name: "保存声音引用" });
    const narrationButton = screen.getByRole("button", { name: "生成课件配音" });

    expect((preflightButton as HTMLButtonElement).disabled).toBe(true);
    expect((voiceRefButton as HTMLButtonElement).disabled).toBe(true);
    expect((narrationButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("先登记 10 秒教师声音样本。")).toBeTruthy();
    expect(screen.getByText("预检就绪后保存声音引用。")).toBeTruthy();
    expect(screen.getByText("保存声音引用后生成逐页音频。")).toBeTruthy();
    expect(screen.getByText("生成后显示每页音频下载。")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "登记教师声音" }));

    await waitFor(() => {
      expect((preflightButton as HTMLButtonElement).disabled).toBe(false);
    });
    expect((voiceRefButton as HTMLButtonElement).disabled).toBe(true);
    expect((narrationButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(preflightButton);

    await waitFor(() => {
      expect((voiceRefButton as HTMLButtonElement).disabled).toBe(false);
    });
    expect((narrationButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(voiceRefButton);

    await waitFor(() => {
      expect((narrationButton as HTMLButtonElement).disabled).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Plan E9 (PKG-5): enrolment and group operations UI.
  // ---------------------------------------------------------------------------

  it("approves every waiting join request in one bulk request after a counted confirmation", async () => {
    window.history.replaceState(null, "", "/teaching");
    let approvedAll = false;
    const pendingStudents = ["Peter", "Amy", "Chen"];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teaching/courses") {
        return createBulkRosterCourseListReadback(pendingStudents, approvedAll);
      }
      expect(url).toBe(
        "/api/teaching/classes/teacher-course-enterprise-operations-20260623-class-1/memberships/approve",
      );
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        membershipIds: pendingStudents.map((student) => `membership-${student}`),
      });
      approvedAll = true;
      return Response.json({
        memberships: [],
        approvedMembershipIds: pendingStudents.map((student) => `membership-${student}`),
        alreadyApprovedMembershipIds: [],
        ineligibleMembershipIds: [],
        approvedCount: pendingStudents.length,
        receipt: {
          action: "approve-class-memberships",
          actorId: "teacher-kang",
          courseId: "teacher-course-enterprise-operations-20260623",
          classId: "teacher-course-enterprise-operations-20260623-class-1",
          status: "persisted",
          traceId: "trace-bulk-approve",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);

    const approveAll = await screen.findByRole("button", {
      name: "批准企业管理实验班的全部 3 条待审批申请",
    });
    expect(approveAll.textContent).toContain("全部批准 (3)");
    // Nothing is sent until the count has been confirmed.
    fireEvent.click(approveAll);
    expect(
      fetchMock.mock.calls.filter(([request]) => String(request).endsWith("/memberships/approve")),
    ).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "确认批准" }));

    await waitFor(() => {
      expect(screen.getByText("已批准 3 人加入企业管理实验班。")).toBeTruthy();
    });
    // One request for the whole class, not one per student.
    expect(
      fetchMock.mock.calls.filter(([request]) => String(request).endsWith("/memberships/approve")),
    ).toHaveLength(1);
    expect(screen.getByText("待审批: 0")).toBeTruthy();
    expect(screen.getByText("已批准: 3")).toBeTruthy();
  });

  it("rejects a waiting join request through the membership status route", async () => {
    window.history.replaceState(null, "", "/teaching");
    let rejected = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teaching/courses") {
        return createBulkRosterCourseListReadback(["Peter"], false, rejected ? ["Peter"] : []);
      }
      expect(url).toBe(
        "/api/teaching/classes/teacher-course-enterprise-operations-20260623-class-1/memberships/membership-Peter",
      );
      expect(init?.method).toBe("PATCH");
      expect(JSON.parse(String(init?.body))).toEqual({ membershipStatus: "rejected" });
      rejected = true;
      return Response.json({
        membership: { membershipId: "membership-Peter", membershipStatus: "rejected" },
        releasedGroupIds: [],
        receipt: {
          action: "reject-class-membership",
          actorId: "teacher-kang",
          courseId: "teacher-course-enterprise-operations-20260623",
          classId: "teacher-course-enterprise-operations-20260623-class-1",
          status: "persisted",
          traceId: "trace-reject",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "拒绝Peter加入企业管理实验班" }),
    );

    await waitFor(() => {
      expect(screen.getByText("已拒绝 Peter 的加入申请。")).toBeTruthy();
    });
    expect(screen.getByText("已拒绝")).toBeTruthy();
    expect(screen.queryByText("Peter 等待加入")).toBeNull();
  });

  it("removes an approved student and reports the learning-group seats that were freed", async () => {
    window.history.replaceState(null, "", "/teaching");
    let removed = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teaching/courses") {
        return createBulkRosterCourseListReadback([], true, removed ? ["Peter"] : [], ["Peter"]);
      }
      expect(url).toBe(
        "/api/teaching/classes/teacher-course-enterprise-operations-20260623-class-1/memberships/membership-Peter",
      );
      expect(init?.method).toBe("PATCH");
      expect(JSON.parse(String(init?.body))).toEqual({ membershipStatus: "removed" });
      removed = true;
      return Response.json({
        membership: { membershipId: "membership-Peter", membershipStatus: "removed" },
        releasedGroupIds: ["group-alpha"],
        receipt: {
          action: "remove-class-membership",
          actorId: "teacher-kang",
          courseId: "teacher-course-enterprise-operations-20260623",
          classId: "teacher-course-enterprise-operations-20260623-class-1",
          status: "persisted",
          traceId: "trace-remove",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "将Peter移出企业管理实验班" }),
    );
    // Removal confirms in place before anything is sent.
    expect(
      fetchMock.mock.calls.filter(([request]) => String(request).includes("membership-Peter")),
    ).toHaveLength(0);
    fireEvent.click(
      screen.getByRole("button", { name: "确认将Peter移出企业管理实验班" }),
    );

    await waitFor(() => {
      expect(
        screen.getByText("已将 Peter 移出企业管理实验班。同时退出了 1 个小组。"),
      ).toBeTruthy();
    });
    expect(screen.getByText("已移出")).toBeTruthy();
  });

  it("keeps a class-sized roster usable with a name filter", async () => {
    window.history.replaceState(null, "", "/teaching");
    const students = Array.from({ length: 40 }, (_, index) => `Student${index}`);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createBulkRosterCourseListReadback(students, false)),
    );

    render(<TeachingPage />);
    await screen.findByText("待审批: 40");

    fireEvent.change(screen.getByLabelText("按姓名筛选学生"), {
      target: { value: "Student37" },
    });

    expect(screen.getByText("Student37 等待加入")).toBeTruthy();
    expect(screen.queryByText("Student36 等待加入")).toBeNull();
    // The bulk button still speaks for the whole waiting list, not the filter.
    expect(
      screen.getByRole("button", { name: "批准企业管理实验班的全部 40 条待审批申请" }),
    ).toBeTruthy();
  });

  it("renders a real scannable QR of the absolute join url instead of a seeded pattern", async () => {
    window.history.replaceState(null, "", "/teaching");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createBulkRosterCourseListReadback([], true)),
    );

    const { container } = render(<TeachingPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "打开企业管理实验班的邀请码" }),
    );

    const qr = container.querySelector('[data-uais-class-invitation-qr="66334455"]');
    expect(qr).toBeTruthy();
    // A real QR is a versioned square with a quiet zone: version 1 with border 2
    // is 21 + 4 modules, and every version above it steps by 4. The seeded
    // pattern this replaced was always exactly 29 modules wide with no version.
    const moduleCount = Number(qr?.getAttribute("data-uais-invitation-qr-modules"));
    expect(Number.isInteger(moduleCount)).toBe(true);
    expect((moduleCount - 25) % 4).toBe(0);
    expect(moduleCount).toBeGreaterThanOrEqual(25);
    expect(qr?.tagName.toLowerCase()).toBe("svg");
    expect(qr?.getAttribute("viewBox")).toBe(`0 0 ${moduleCount} ${moduleCount}`);
    // It encodes the join url an absolute-origin camera scan can follow.
    expect(qr?.getAttribute("data-uais-invitation-qr-target")).toBe(
      `${window.location.origin}/courses?invite=66334455`,
    );
    expect(qr?.getAttribute("aria-label")).toContain(
      `${window.location.origin}/courses?invite=66334455`,
    );
    // Dark modules are drawn individually, so a blank grid cannot pass as a code.
    expect(qr?.querySelectorAll("rect").length).toBeGreaterThan(50);
  });

  it("reports the invite code's real expiry, join limit and disabled state", async () => {
    window.history.replaceState(null, "", "/teaching");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        createBulkRosterCourseListReadback([], true, [], [], {
          inviteExpiresAt: "2027-03-01T00:00:00.000Z",
          inviteMaxJoins: 45,
          inviteDisabled: true,
        }),
      ),
    );

    render(<TeachingPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "打开企业管理实验班的邀请码" }),
    );

    expect(screen.getByText("45 人")).toBeTruthy();
    expect(screen.getByText("已停用")).toBeTruthy();
    expect(screen.queryByText("无过期时间")).toBeNull();
    expect(screen.queryByText("该邀请码2026年12月17日前有效")).toBeNull();
  });

  it("disables every inline workspace action until a course is explicitly chosen", async () => {
    window.history.replaceState(null, "", "/teaching");
    const fetchMock = vi.fn(async () => createBulkRosterCourseListReadback([], true));
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<TeachingPage />);
    await screen.findByText("企业管理实验班");

    const saveButton = screen.getByRole("button", { name: "保存课程设置" });
    expect((saveButton as HTMLButtonElement).disabled).toBe(true);
    expect(
      container
        .querySelector('[data-uais-inline-workspace-actions="course-settings"]')
        ?.getAttribute("data-uais-inline-workspace-course-chosen"),
    ).toBe("false");
    // Clicking it anyway must not reach the operations route with a guessed course.
    fireEvent.click(saveButton);
    expect(
      fetchMock.mock.calls.filter(([request]) => String(request) === "/api/teaching/operations"),
    ).toHaveLength(0);

    await chooseWorkspaceCourse("teacher-course-enterprise-operations-20260623");

    expect((screen.getByRole("button", { name: "保存课程设置" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("refuses invite-code actions until a class inside the course is resolved", async () => {
    window.history.replaceState(null, "", "/teaching");
    const fetchMock = vi.fn(async () =>
      createBulkRosterCourseListReadback([], true, [], [], undefined, [
        {
          classId: "teacher-course-enterprise-operations-20260623-class-2",
          className: "企业管理二班",
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-course-enterprise-operations-20260623");
    fireEvent.click(screen.getByRole("link", { name: "邀请码" }));

    // Two classes, so there is a real choice and no fallback is allowed to make it.
    const generate = screen.getByRole("button", { name: "生成新邀请码" });
    expect((generate as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("请先选择课程和班级，再执行邀请码操作。")).toBeTruthy();
    expect(
      fetchMock.mock.calls.filter(([request]) => String(request) === "/api/teaching/operations"),
    ).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("操作班级"), {
      target: { value: "teacher-course-enterprise-operations-20260623-class-2" },
    });

    expect(
      (screen.getByRole("button", { name: "生成新邀请码" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("sends the teacher's expiry, join limit and disable switch with the invite publish", async () => {
    window.history.replaceState(null, "", "/teaching");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/courses") {
        return createBulkRosterCourseListReadback([], true);
      }
      expect(String(input)).toBe("/api/teaching/operations");
      const body = JSON.parse(String(init?.body)) as {
        invitePolicy?: { expiresAt?: string | null; maxJoins?: number | null; disabled?: boolean };
      };
      expect(body.invitePolicy).toEqual({
        expiresAt: new Date("2027-03-01T09:30").toISOString(),
        maxJoins: 45,
        disabled: true,
      });
      return Response.json({
        receipt: {
          displayMessage: { "zh-CN": "邀请码已发布。", "en-US": "Invite code published." },
          artifacts: [
            {
              kind: "invite-code",
              code: "66334455",
              status: "published",
              joinUrl: "/courses?invite=66334455",
            },
          ],
        },
        classInvitePublicationReceipt: {
          action: "publish-class-invite-code",
          actorId: "teacher-kang",
          courseId: "teacher-course-enterprise-operations-20260623",
          classId: "teacher-course-enterprise-operations-20260623-class-1",
          status: "persisted",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-course-enterprise-operations-20260623");
    fireEvent.click(screen.getByRole("link", { name: "邀请码" }));
    await waitForInviteClassTarget();

    fireEvent.change(screen.getByLabelText("有效期（留空表示不过期）"), {
      target: { value: "2027-03-01T09:30" },
    });
    fireEvent.change(screen.getByLabelText("加入上限（留空表示不限人数）"), {
      target: { value: "45" },
    });
    fireEvent.click(screen.getByLabelText("停用该邀请码"));
    fireEvent.click(screen.getByRole("button", { name: "确认发布邀请码" }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(([request]) => String(request) === "/api/teaching/operations"),
      ).toHaveLength(1);
    });
  });

  it("refuses an invite join limit of zero before the request leaves the workspace", async () => {
    window.history.replaceState(null, "", "/teaching");
    const fetchMock = vi.fn(async () => createBulkRosterCourseListReadback([], true));
    vi.stubGlobal("fetch", fetchMock);

    render(<TeachingPage />);
    await chooseWorkspaceCourse("teacher-course-enterprise-operations-20260623");
    fireEvent.click(screen.getByRole("link", { name: "邀请码" }));
    await waitForInviteClassTarget();

    fireEvent.change(screen.getByLabelText("加入上限（留空表示不限人数）"), {
      target: { value: "0" },
    });

    expect(
      screen.getByText("加入上限需要是大于 0 的整数；如果不限人数，请留空。"),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "确认发布邀请码" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "确认发布邀请码" }));
    expect(
      fetchMock.mock.calls.filter(([request]) => String(request) === "/api/teaching/operations"),
    ).toHaveLength(0);
  });
});
