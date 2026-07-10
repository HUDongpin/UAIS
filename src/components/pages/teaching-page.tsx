"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { BellRinging } from "@phosphor-icons/react/dist/ssr/BellRinging";
import { BookOpen } from "@phosphor-icons/react/dist/ssr/BookOpen";
import { Books } from "@phosphor-icons/react/dist/ssr/Books";
import { CaretDown } from "@phosphor-icons/react/dist/ssr/CaretDown";
import { ChartBar } from "@phosphor-icons/react/dist/ssr/ChartBar";
import { ClipboardText } from "@phosphor-icons/react/dist/ssr/ClipboardText";
import { Exam } from "@phosphor-icons/react/dist/ssr/Exam";
import { Export as ExportIcon } from "@phosphor-icons/react/dist/ssr/Export";
import { FileText } from "@phosphor-icons/react/dist/ssr/FileText";
import { GearSix } from "@phosphor-icons/react/dist/ssr/GearSix";
import { MagicWand } from "@phosphor-icons/react/dist/ssr/MagicWand";
import { Package } from "@phosphor-icons/react/dist/ssr/Package";
import { PencilSimple } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import { Plus } from "@phosphor-icons/react/dist/ssr/Plus";
import { QrCode } from "@phosphor-icons/react/dist/ssr/QrCode";
import { Robot } from "@phosphor-icons/react/dist/ssr/Robot";
import { SquaresFour } from "@phosphor-icons/react/dist/ssr/SquaresFour";
import { UserGear } from "@phosphor-icons/react/dist/ssr/UserGear";
import { UsersThree } from "@phosphor-icons/react/dist/ssr/UsersThree";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr/WarningCircle";
import { X } from "@phosphor-icons/react/dist/ssr/X";
import { useAppPreferences } from "@/components/providers/app-preferences";
import {
  getTeachingCourseActionHref,
  getTeachingOperationHref,
  isTeachingOperationId,
  type TeachingOperationId,
} from "@/components/teaching/teaching-operation-data";
import { localizedText } from "@/components/ui/localized-text";
import { teacherCourses, teacherSidebarItems } from "@/data/uais";
import type { TeacherCourse } from "@/data/uais";
import { copy } from "@/i18n/copy";
import type { Locale, LocalizedText } from "@/i18n/copy";
import { getProviderForRole } from "@/lib/ai/providers/registry";
import {
  createPptNarrationJob,
  createTeacherVoiceCloneJob,
} from "@/lib/ai/voice/ppt-narration";
import {
  applyCourseSettingsPatchToTeacherCourse,
  createCourseSettingsDraft,
  createDefaultNewCourseDraft,
  createPersistedCourseLoadErrorMessage,
  createTeacherClassesByCourseFromPersistedClasses,
  createTeacherCourseFromPersistedCourse,
  createTeacherMembershipFromPersistedMembership,
  createTeacherMembershipsByClassFromPersistedMemberships,
  extractCourseSemester,
  isMatchingMembershipApprovalResult,
  isPersistedMembershipApprovalReceipt,
  mergeTeacherClassesByCourseId,
  mergeTeacherCoursesById,
  mergeTeacherMembershipsByClassId,
  normalizeTeachingActorId,
  readTeachingCourseListTeacherActorId,
  shouldLoadPersistedTeachingCourses,
  type CourseSettingsDraft,
  type CourseSettingsPatchPayload,
  type NewCourseDraft,
  type PersistedTeachingCourseReadback,
  type TeacherClassItem,
  type TeacherClassMembershipItem,
  type TeachingClassCreateResponse,
  type TeachingClassMembershipApproveResponse,
  type TeachingCourseCreateResponse,
  type TeachingCourseListResponse,
} from "@/lib/teaching/course-readback";
import { createProvisionalTeachingCourseId } from "@/lib/teaching-course-id";
import { createTeachingOperationIdempotencyKey } from "@/lib/teaching-operation-idempotency";

const dashboardIcons = {
  courses: BookOpen,
  "course-settings": GearSix,
  content: FileText,
  agents: Robot,
  "knowledge-base": Books,
  admins: UserGear,
  students: UsersThree,
  "data-export": ExportIcon,
  dashboard: ChartBar,
  "quiz-board": Exam,
  grading: ClipboardText,
  "invite-code": QrCode,
};

type GeneratedCourseCover = {
  imageUrl: string;
  assetId?: string;
  provider?: string;
  model?: string;
  requestId?: string;
};

type CourseCoverGenerationResponse = {
  cover?: {
    imageUrl?: string;
    model?: string;
    requestId?: string;
  };
  asset?: {
    assetId?: string;
    courseId?: string;
  };
  assetPersistence?: {
    status?: string;
    responsibleSession?: string;
  };
  audit?: {
    eventType?: string;
    assetId?: string;
    courseId?: string;
    authMode?: string;
    authSession?: {
      sessionId?: string;
      authenticatedAt?: string;
      expiresAt?: string;
    };
  };
  partialFailure?: {
    status?: string;
    failedStep?: string;
    courseId?: string;
    assetId?: string;
    recoveryAction?: string;
  };
  error?: string;
  traceId?: string;
  access?: {
    reasonCode?: string;
  };
};

type TeacherCourseAction = "manage" | "continue";

type WorkspaceMetric = {
  label: string;
  value: string;
  note: string;
};

type WorkspaceLane = {
  title: string;
  items: string[];
};

type EnterpriseWorkspaceConfig = {
  id: TeachingOperationId;
  title: string;
  subtitle: string;
  description: string;
  metrics: WorkspaceMetric[];
  lanes: WorkspaceLane[];
  records: string[];
};

type InlineWorkspaceActionConfig = {
  readyMessage: string;
  primaryAction: string;
  primaryMessage: string;
  secondaryAction: string;
  secondaryMessage: string;
};

type InlineInviteBackendArtifact = {
  kind?: string;
  code?: string;
  joinUrl?: string;
};

type InlineInviteBackendReceipt = {
  displayMessage?: LocalizedText;
  receiptId?: string;
  courseId?: string;
  artifacts?: InlineInviteBackendArtifact[];
};

type InlineInvitePublicationReceipt = {
  action?: string;
  actorId?: string;
  courseId?: string;
  classId?: string;
  status?: string;
  traceId?: string;
};

type InlineInvitePartialFailure = {
  operationReceiptId?: string;
  rollbackRoute?: string;
  compensation?: {
    status?: string;
    rollbackReason?: string;
    receipt?: {
      receiptId?: string;
      targetRecordId?: string;
      status?: string;
    };
  };
};

type InlineInviteOperationResponse = {
  receipt?: InlineInviteBackendReceipt;
  classInvitePublicationReceipt?: InlineInvitePublicationReceipt;
  partialFailure?: InlineInvitePartialFailure;
  error?: string;
  traceId?: string;
  access?: {
    reasonCode?: string;
  };
};

type InlineTeachingOperationAuditAuthSession = {
  sessionId?: string;
  authenticatedAt?: string;
  expiresAt?: string;
};

type InlineTeachingOperationBackendReceipt = {
  displayMessage?: LocalizedText;
  receiptId?: string;
  operationId?: string;
  actionSlot?: "primary" | "secondary";
  courseId?: string;
  status?: string;
  audit?: {
    authMode?: string;
    authSession?: InlineTeachingOperationAuditAuthSession;
  };
};

type InlineTeachingOperationDomainPersistenceSummary = {
  status?: "persisted" | "missing-domain-objects" | "not-required";
  required?: boolean;
  operationReceiptId?: string;
  expectedObjectTypes?: string[];
  persistedObjectTypes?: string[];
  missingObjectTypes?: string[];
};

type InlineTeachingOperationErrorResponse = {
  error?: string;
  traceId?: string;
  access?: {
    reasonCode?: string;
  };
  partialFailure?: InlineInvitePartialFailure;
};

type InlineTeachingOperationAuditEvent = {
  traceId?: string;
  actorId?: string;
  authSession?: InlineTeachingOperationAuditAuthSession;
  courseId?: string;
};

type InlineTeachingOperationRecord = {
  recordId?: string;
  courseId?: string;
  operationId?: TeachingOperationId;
  actionSlot?: "primary" | "secondary";
};

type InlineTeachingOperationDomainProjection = {
  objectId?: string;
  objectType?: string;
  courseId?: string;
  operationRecordId?: string;
  status?: string;
  inviteCode?: string;
  joinUrl?: string;
  previewedBy?: string;
  previewStatus?: string;
  previewId?: string;
  previewUrl?: string;
  previewScope?: string;
  previewPolicy?: string;
  courseName?: string;
  semester?: string;
  description?: string;
  syncedBy?: string;
  syncStatus?: string;
  sourceSystems?: string[];
  pendingTeacherReviewCount?: number;
  syncedAt?: string;
  suggestionStatus?: string;
  groupingBasis?: string[];
  feedbackStatus?: string;
  feedbackScope?: string;
  refreshedBy?: string;
  refreshStatus?: string;
  visibleMetrics?: string[];
  refreshedAt?: string;
  flaggedBy?: string;
  flaggedSignals?: string[];
  flaggedAt?: string;
  lockedBy?: string;
  snapshotStatus?: string;
  snapshotId?: string;
  snapshotScope?: string;
  retentionPolicy?: string;
  lockedAt?: string;
  publishedBy?: string;
  publicationStatus?: string;
  releaseScope?: string;
  publishedAt?: string;
  generatedBy?: string;
  draftStatus?: string;
  artifactId?: string;
  generatedAt?: string;
  savedBy?: string;
  planStatus?: string;
  enabledAgents?: string[];
  governancePolicy?: string;
  savedAt?: string;
  checkedBy?: string;
  preflightStatus?: string;
  checkedPermissions?: string[];
  preflightPolicy?: string;
  checkedAt?: string;
  settingsStatus?: string;
  adminScopes?: string[];
  queueStatus?: string;
  queuedBy?: string;
  notificationStatus?: string;
  deliveryChannel?: string;
  outboxId?: string;
  deliveryPolicy?: string;
  reviewStatus?: string;
  resourceSource?: string;
  reviewPolicy?: string;
  queuedAt?: string;
  updateStatus?: string;
  updatedBy?: string;
  releasePolicy?: string;
  updatedAt?: string;
  createdBy?: string;
  exportStatus?: string;
  manifestId?: string;
  datasetScopes?: string[];
  exportPolicy?: string;
  createdAt?: string;
  validatedBy?: string;
  validationStatus?: string;
  checkedScopes?: string[];
  validationPolicy?: string;
  validatedAt?: string;
  invitePolicy?: string;
  enrollmentPolicy?: string;
};

const INLINE_OPERATION_EXPECTED_DOMAIN_OBJECT_TYPES = {
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
} satisfies Record<TeachingOperationId, Record<"primary" | "secondary", readonly string[]>>;

type InlineTeachingOperationAuditReadbackResponse = {
  actorId?: string;
  auditEventCount?: number;
  records?: InlineTeachingOperationRecord[];
  auditEvents?: InlineTeachingOperationAuditEvent[];
  domainProjections?: InlineTeachingOperationDomainProjection[];
};

type InlineTeachingOperationAuditAlert = {
  alertId?: string;
  severity?: "high";
  reason?: "missing-course-context";
  traceId?: string;
  actorId?: string;
  operationId?: string;
  actionSlot?: "primary" | "secondary";
  actionId?: string;
};

type InlineTeachingOperationAuditAlertSummaryResponse = {
  traceId?: string;
  status?: "attention-required" | "clear";
  alertCount?: number;
  alerts?: InlineTeachingOperationAuditAlert[];
  notificationRoute?: string;
};

type InlineTeachingOperationAuditAlertNotificationResponse = {
  traceId?: string;
  status?: "queued" | "clear";
  notificationCount?: number;
  recordCount?: number;
  notifications?: {
    notificationId?: string;
    deliveryStatus?: "queued";
    alertId?: string;
  }[];
};

type InlineWorkspaceAuditStatus = {
  status: "pending" | "verified" | "failed";
  traceId?: string;
  actorId?: string;
  authSession?: InlineTeachingOperationAuditAuthSession;
  auditEventCount?: number;
  recordId?: string;
  courseId?: string;
  domainObjectId?: string;
  domainObjectType?: string;
};

type InlineWorkspaceAlertStatus = {
  status: "pending" | "attention-required" | "clear" | "failed";
  traceId?: string;
  alertCount?: number;
  alerts?: InlineTeachingOperationAuditAlert[];
  notificationRoute?: string;
};

type InlineWorkspaceAlertNotificationStatus = {
  status: "pending" | "queued" | "verified" | "clear" | "failed";
  notificationCount?: number;
  message?: string;
};

type InlineWorkspaceRollbackStatus = {
  status: "pending" | "rolled-back" | "failed";
  targetRecordId: string;
  message?: string;
};

const DEFAULT_INVITE_CODE = "55395057";
const INVITE_VALID_UNTIL = "2026-12-17";
const INVITE_JOIN_LIMIT = 60;
const INVITE_READY_MESSAGE: LocalizedText = {
  "zh-CN": "当前邀请码可用于班级加入预览。",
  "en-US": "Current invite code is ready for class join preview.",
};
const INVITE_GENERATED_MESSAGE: LocalizedText = {
  "zh-CN": "邀请码已更新并等待教师确认发布。",
  "en-US": "Invite code updated and waiting for teacher publish confirmation.",
};
const INVITE_PUBLISHED_MESSAGE: LocalizedText = {
  "zh-CN": "邀请码已发布到班级加入入口。",
  "en-US": "Invite code published to the class join entry.",
};
const INVITE_PUBLICATION_RECEIPT_MISSING_MESSAGE: LocalizedText = {
  "zh-CN": "邀请码发布回执缺失，请稍后刷新。",
  "en-US": "Invite publication receipt is missing. Please refresh shortly.",
};
const INVITE_CODE_DRAFT_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "邀请码草稿读回未匹配生成结果，请稍后刷新。",
  "en-US":
    "Invite code draft readback did not match the generation result. Please refresh shortly.",
};
const INVITE_ENROLLMENT_ACCESS_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "邀请码发布读回未匹配发布结果，请稍后刷新。",
  "en-US":
    "Invite enrollment access readback did not match the publication result. Please refresh shortly.",
};
const INVITE_CLASS_INVITATION_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "班级邀请码读回未匹配发布结果，请稍后刷新。",
  "en-US": "Class invite-code readback did not match the publication result. Please refresh shortly.",
};
const INVITE_CODE_COPIED_MESSAGE: LocalizedText = {
  "zh-CN": "邀请码已复制。",
  "en-US": "Invite code copied.",
};
const INVITE_LINK_COPIED_MESSAGE: LocalizedText = {
  "zh-CN": "加入链接已复制。",
  "en-US": "Join link copied.",
};
const INVITE_COPY_FAILED_MESSAGE: LocalizedText = {
  "zh-CN": "复制不可用，请手动复制页面中的邀请码或链接。",
  "en-US": "Copy is unavailable. Please copy the code or link manually.",
};
const TEACHING_OPERATION_SAVE_FAILED_MESSAGE: LocalizedText = {
  "zh-CN": "未保存到服务器，请重新登录或检查课程权限。",
  "en-US": "Not saved to the server. Please sign in again or check course access.",
};
const TEACHING_OPERATION_RECEIPT_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "服务端回执未匹配当前操作，请稍后重试。",
  "en-US": "The server receipt did not match the current operation. Please retry later.",
};
const TEACHING_OPERATION_SAVE_PENDING_MESSAGE: LocalizedText = {
  "zh-CN": "正在保存到服务器，请稍候。",
  "en-US": "Saving to the server. Please wait.",
};
const TEACHING_COURSE_LOAD_FAILED_MESSAGE: LocalizedText = {
  "zh-CN": "服务端课程数据未读回。当前显示本地演示课程，请重新登录或检查课程权限。",
  "en-US":
    "Server course data was not read back. Local demo courses remain visible; sign in again or check course access.",
};
const TEACHING_COURSE_COVER_TEACHER_READBACK_REQUIRED_MESSAGE: LocalizedText = {
  "zh-CN": "教师身份未读回，请重新登录或等待课程数据读回后再生成封面。",
  "en-US":
    "Teacher identity was not read back. Please sign in again or wait for course data readback before generating a cover.",
};
const TEACHING_COURSE_COVER_ASSET_PERSISTENCE_REQUIRED_MESSAGE: LocalizedText = {
  "zh-CN": "封面未保存到课程资产库，请稍后重试。",
  "en-US": "The cover was not persisted to the course asset library. Please retry shortly.",
};
const TEACHING_COURSE_COVER_AUDIT_REQUIRED_MESSAGE: LocalizedText = {
  "zh-CN": "封面审计回执缺失，请稍后重试。",
  "en-US": "The cover audit receipt is missing. Please retry shortly.",
};
const TEACHING_COURSE_CREATE_READBACK_MISSING_MESSAGE: LocalizedText = {
  "zh-CN": "新课程已提交，但服务端列表尚未读回该课程，请稍后刷新。",
  "en-US":
    "The new course was submitted, but the server list has not read it back yet. Please refresh shortly.",
};
const TEACHING_COURSE_CREATE_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "新课程已提交，但服务端读回的课程内容与本次提交不一致，请稍后刷新。",
  "en-US":
    "The new course was submitted, but the server readback does not match this submission. Please refresh shortly.",
};
const TEACHING_COURSE_CREATE_OWNERSHIP_EVIDENCE_MISSING_MESSAGE: LocalizedText = {
  "zh-CN": "课程所有权合并证据缺失，请稍后刷新。",
  "en-US": "Course ownership merge evidence is missing. Please refresh shortly.",
};
const TEACHING_COURSE_CREATE_RECEIPT_MISSING_MESSAGE: LocalizedText = {
  "zh-CN": "课程服务端回执缺失，请稍后刷新。",
  "en-US": "Course server receipt is missing. Please refresh shortly.",
};
const TEACHING_CLASS_CREATE_READBACK_MISSING_MESSAGE: LocalizedText = {
  "zh-CN": "新班级已提交，但服务端列表尚未读回该班级，请稍后刷新。",
  "en-US":
    "The new class was submitted, but the server list has not read it back yet. Please refresh shortly.",
};
const TEACHING_CLASS_CREATE_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "新班级已提交，但服务端读回的班级内容与本次提交不一致，请稍后刷新。",
  "en-US":
    "The new class was submitted, but the server readback does not match this submission. Please refresh shortly.",
};
const TEACHING_CLASS_CREATE_RECEIPT_MISSING_MESSAGE: LocalizedText = {
  "zh-CN": "班级服务端回执缺失，请稍后刷新。",
  "en-US": "Class server receipt is missing. Please refresh shortly.",
};
const TEACHING_OPERATION_AUDIT_PENDING_MESSAGE: LocalizedText = {
  "zh-CN": "正在读取审计证据。",
  "en-US": "Reading audit evidence.",
};
const TEACHING_OPERATION_AUDIT_FAILED_MESSAGE: LocalizedText = {
  "zh-CN": "审计读回未完成，请稍后刷新。",
  "en-US": "Audit readback is not complete. Please refresh later.",
};
const TEACHING_COURSE_SETTINGS_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "课程设置读回未匹配本次提交，请稍后刷新。",
  "en-US": "Course settings readback did not match this submission. Please refresh shortly.",
};
const TEACHING_STUDENT_PREVIEW_SESSION_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "学生端预览读回未匹配生成结果，请稍后刷新。",
  "en-US":
    "Student preview readback did not match the generation result. Please refresh shortly.",
};
const TEACHING_STUDENT_ROSTER_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "学生名单读回未匹配同步结果，请稍后刷新。",
  "en-US": "Student roster readback did not match the sync result. Please refresh shortly.",
};
const TEACHING_GROUP_SUGGESTIONS_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "分组建议读回未匹配生成结果，请稍后刷新。",
  "en-US": "Group suggestions readback did not match the generation result. Please refresh shortly.",
};
const TEACHING_KNOWLEDGE_INDEX_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "知识库索引读回未匹配同步结果，请稍后刷新。",
  "en-US": "Knowledge index readback did not match the sync result. Please refresh shortly.",
};
const TEACHING_RESOURCE_REVIEW_ITEM_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "资源复核项读回未匹配入队结果，请稍后刷新。",
  "en-US":
    "Resource review item readback did not match the queue result. Please refresh shortly.",
};
const TEACHING_DASHBOARD_STATE_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "数据看板读回未匹配刷新结果，请稍后刷新。",
  "en-US": "Dashboard readback did not match the refresh result. Please refresh shortly.",
};
const TEACHING_DASHBOARD_SNAPSHOT_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "日报快照读回未匹配锁定结果，请稍后刷新。",
  "en-US":
    "Dashboard snapshot readback did not match the lock result. Please refresh shortly.",
};
const TEACHING_COURSE_CONTENT_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "课程内容读回未匹配发布结果，请稍后刷新。",
  "en-US": "Course content readback did not match the publish result. Please refresh shortly.",
};
const TEACHING_UNIT_DRAFT_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "单元草稿读回未匹配生成结果，请稍后刷新。",
  "en-US": "Unit draft readback did not match the generation result. Please refresh shortly.",
};
const TEACHING_AGENT_PLAN_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "智能体方案读回未匹配保存结果，请稍后刷新。",
  "en-US": "Agent plan readback did not match the save result. Please refresh shortly.",
};
const TEACHING_PERMISSION_PREFLIGHT_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "权限预检读回未匹配检查结果，请稍后刷新。",
  "en-US":
    "Permission preflight readback did not match the check result. Please refresh shortly.",
};
const TEACHING_ADMIN_SETTINGS_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "管理员设置读回未匹配保存结果，请稍后刷新。",
  "en-US": "Admin settings readback did not match the save result. Please refresh shortly.",
};
const TEACHING_COLLABORATION_INVITE_NOTIFICATION_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "协作邀请通知读回未匹配入队结果，请稍后刷新。",
  "en-US":
    "Collaboration invite notification readback did not match the queue result. Please refresh shortly.",
};
const TEACHING_QUIZ_BOARD_STATE_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "测验看板读回未匹配刷新结果，请稍后刷新。",
  "en-US": "Quiz board readback did not match the refresh result. Please refresh shortly.",
};
const TEACHING_QUIZ_ITEM_REVIEW_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "低质题复核读回未匹配标记结果，请稍后刷新。",
  "en-US":
    "Low-quality item review readback did not match the flag result. Please refresh shortly.",
};
const TEACHING_GRADING_QUEUE_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "批改队列与成绩册读回未匹配保存结果，请稍后刷新。",
  "en-US":
    "Grading queue and gradebook readback did not match the save result. Please refresh shortly.",
};
const TEACHING_AI_FEEDBACK_DRAFT_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "AI 反馈草稿读回未匹配生成结果，请稍后刷新。",
  "en-US":
    "AI feedback draft readback did not match the generation result. Please refresh shortly.",
};
const TEACHING_EXPORT_MANIFEST_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "导出清单读回未匹配生成结果，请稍后刷新。",
  "en-US": "Export manifest readback did not match the generation result. Please refresh shortly.",
};
const TEACHING_REDACTION_VALIDATION_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "脱敏范围读回未匹配校验结果，请稍后刷新。",
  "en-US":
    "Redaction scope readback did not match the validation result. Please refresh shortly.",
};
const TEACHING_OPERATION_ROLLBACK_PENDING_MESSAGE: LocalizedText = {
  "zh-CN": "正在撤回本次操作。",
  "en-US": "Rolling back this operation.",
};
const TEACHING_OPERATION_ROLLBACK_FAILED_MESSAGE: LocalizedText = {
  "zh-CN": "撤回未保存到服务器，请稍后重试。",
  "en-US": "Rollback was not saved to the server. Please retry later.",
};
const TEACHING_OPERATION_ALERT_PENDING_MESSAGE: LocalizedText = {
  "zh-CN": "正在读取教学操作告警。",
  "en-US": "Reading teaching operation alerts.",
};
const TEACHING_OPERATION_ALERT_FAILED_MESSAGE: LocalizedText = {
  "zh-CN": "教学操作告警读取失败，请稍后重试。",
  "en-US": "Teaching operation alert readback failed. Please retry later.",
};
const TEACHING_OPERATION_ALERT_NOTIFICATION_PENDING_MESSAGE: LocalizedText = {
  "zh-CN": "正在通知管理员。",
  "en-US": "Notifying the administrator.",
};
const TEACHING_OPERATION_ALERT_NOTIFICATION_FAILED_MESSAGE: LocalizedText = {
  "zh-CN": "告警通知未入队，请稍后重试。",
  "en-US": "Alert notification was not queued. Please retry later.",
};
const MEMBERSHIP_APPROVAL_PENDING_MESSAGE: LocalizedText = {
  "zh-CN": "正在审批加入申请，请稍候。",
  "en-US": "Approving the join request. Please wait.",
};
const MEMBERSHIP_APPROVAL_FAILED_MESSAGE: LocalizedText = {
  "zh-CN": "审批未保存到服务器，请重新登录或检查班级权限。",
  "en-US": "Approval was not saved. Please sign in again or check class access.",
};
const MEMBERSHIP_APPROVAL_RECEIPT_MISSING_MESSAGE: LocalizedText = {
  "zh-CN": "审批服务端回执缺失，请稍后重试。",
  "en-US": "Approval server receipt is missing. Please retry later.",
};
const MEMBERSHIP_APPROVAL_READBACK_MISSING_MESSAGE: LocalizedText = {
  "zh-CN": "成员审批已提交，但服务端列表尚未读回该成员，请稍后刷新。",
  "en-US":
    "The membership approval was submitted, but the server list has not read back that member yet. Please refresh shortly.",
};
const MEMBERSHIP_APPROVAL_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "成员审批读回未匹配本次提交，请稍后刷新。",
  "en-US": "Membership approval readback did not match this submission. Please refresh shortly.",
};

function createInlineWorkspaceActionConfig(
  id: TeachingOperationId,
  locale: Locale,
): InlineWorkspaceActionConfig {
  const zh = locale === "zh-CN";
  const configs: Record<TeachingOperationId, InlineWorkspaceActionConfig> = {
    "course-settings": {
      readyMessage: zh
        ? "课程设置等待教师确认。"
        : "Course settings are waiting for teacher confirmation.",
      primaryAction: zh ? "保存课程设置" : "Save Course Settings",
      primaryMessage: zh
        ? "课程设置已由服务端持久化，等待审计读回。"
        : "Course settings persisted by the server and awaiting audit readback.",
      secondaryAction: zh ? "预览学生端" : "Preview Student View",
      secondaryMessage: zh ? "学生端预览已生成。" : "Student preview generated.",
    },
    agents: {
      readyMessage: zh
        ? "智能体方案已载入，等待预检。"
        : "Agent plan loaded and waiting for preflight.",
      primaryAction: zh ? "保存智能体方案" : "Save Agent Plan",
      primaryMessage: zh
        ? "智能体方案已保存，服务端密钥仍保持隔离。"
        : "Agent plan saved while server-side keys remain isolated.",
      secondaryAction: zh ? "运行权限预检" : "Run Permission Preflight",
      secondaryMessage: zh
        ? "权限预检通过：学生端仅能访问课程授权角色。"
        : "Permission preflight passed for course-authorized roles only.",
    },
    "knowledge-base": {
      readyMessage: zh
        ? "知识库索引保持待同步状态。"
        : "Knowledge base index is waiting to sync.",
      primaryAction: zh ? "同步知识库索引" : "Sync Knowledge Index",
      primaryMessage: zh
        ? "知识库索引同步已保存到服务端。"
        : "Knowledge index sync saved on the server.",
      secondaryAction: zh ? "添加资料占位" : "Add Resource Placeholder",
      secondaryMessage: zh
        ? "资料占位已加入待审核队列。"
        : "Resource placeholder added to review queue.",
    },
    content: {
      readyMessage: zh
        ? "课程内容处于草稿检查状态。"
        : "Course content is in draft review.",
      primaryAction: zh ? "发布课程内容" : "Publish Course Content",
      primaryMessage: zh
        ? "课程内容已进入发布前确认。"
        : "Course content moved to pre-publish confirmation.",
      secondaryAction: zh ? "生成单元草稿" : "Generate Unit Draft",
      secondaryMessage: zh
        ? "单元草稿已生成，等待教师校订。"
        : "Unit draft generated and waiting for teacher edits.",
    },
    admins: {
      readyMessage: zh
        ? "管理员设置等待权限复核。"
        : "Admin settings are waiting for permission review.",
      primaryAction: zh ? "保存管理员设置" : "Save Admin Settings",
      primaryMessage: zh
        ? "管理员设置已保存，权限变更进入审计记录。"
        : "Admin settings saved and permission changes logged.",
      secondaryAction: zh ? "发送协作邀请" : "Send Collaboration Invite",
      secondaryMessage: zh
        ? "协作邀请通知已进入服务端邮件队列。"
        : "Collaboration invite notification queued in the server mail outbox.",
    },
    students: {
      readyMessage: zh ? "学生名单已加载。" : "Student roster loaded.",
      primaryAction: zh ? "同步学生名单" : "Sync Roster",
      primaryMessage: zh
        ? "学生名单同步已保存到服务端。"
        : "Roster sync saved on the server.",
      secondaryAction: zh ? "生成分组建议" : "Generate Group Suggestions",
      secondaryMessage: zh
        ? "分组建议已生成，等待教师确认。"
        : "Group suggestions generated for teacher confirmation.",
    },
    "data-export": {
      readyMessage: zh
        ? "导出任务等待范围确认。"
        : "Export job is waiting for scope confirmation.",
      primaryAction: zh ? "生成导出清单" : "Create Export Manifest",
      primaryMessage: zh
        ? "导出清单已生成，可交给服务端导出任务。"
        : "Export manifest created for a server-side export job.",
      secondaryAction: zh ? "校验脱敏范围" : "Validate Redaction Scope",
      secondaryMessage: zh
        ? "脱敏范围校验通过：不包含真实密钥。"
        : "Redaction scope passed with no real secrets included.",
    },
    dashboard: {
      readyMessage: zh
        ? "数据看板已载入最近 7 天摘要。"
        : "Dashboard loaded the latest 7-day summary.",
      primaryAction: zh ? "刷新数据看板" : "Refresh Dashboard",
      primaryMessage: zh ? "数据看板已刷新。" : "Dashboard refreshed.",
      secondaryAction: zh ? "锁定日报快照" : "Lock Daily Snapshot",
      secondaryMessage: zh
        ? "日报快照已锁定到当前视图。"
        : "Daily snapshot locked to current view.",
    },
    "quiz-board": {
      readyMessage: zh
        ? "测验看板等待最新答题数据。"
        : "Quiz board is waiting for latest responses.",
      primaryAction: zh ? "刷新测验看板" : "Refresh Quiz Board",
      primaryMessage: zh
        ? "测验看板已刷新，错因分布可复核。"
        : "Quiz board refreshed with error patterns ready for review.",
      secondaryAction: zh ? "标记低质题复核" : "Flag Low-quality Items",
      secondaryMessage: zh
        ? "低质题已标记为教师复核。"
        : "Low-quality items flagged for teacher review.",
    },
    grading: {
      readyMessage: zh ? "作业批改队列已载入。" : "Assignment review queue loaded.",
      primaryAction: zh ? "保存批改队列" : "Save Review Queue",
      primaryMessage: zh
        ? "批改队列已保存，学生端暂不发布。"
        : "Review queue saved without publishing to students.",
      secondaryAction: zh ? "生成智能反馈建议" : "Generate AI Feedback",
      secondaryMessage: zh
        ? "AI 反馈建议已生成，等待教师逐条确认。"
        : "AI feedback suggestions generated for teacher confirmation.",
    },
    "invite-code": {
      readyMessage: localizedText(INVITE_READY_MESSAGE, locale),
      primaryAction: zh ? "生成新邀请码" : "Generate New Invite Code",
      primaryMessage: localizedText(INVITE_GENERATED_MESSAGE, locale),
      secondaryAction: zh ? "确认发布邀请码" : "Publish Invite Code",
      secondaryMessage: localizedText(INVITE_PUBLISHED_MESSAGE, locale),
    },
  };

  return configs[id];
}

function createEnterpriseWorkspaceConfig(
  id: TeachingOperationId,
  locale: Locale,
): EnterpriseWorkspaceConfig {
  const zh = locale === "zh-CN";
  const configs: Record<TeachingOperationId, EnterpriseWorkspaceConfig> = {
    "course-settings": {
      id: "course-settings",
      title: zh ? "课程设置工作台" : "Course Settings Workspace",
      subtitle: zh ? "课程治理" : "Course Governance",
      description: zh
        ? "集中维护课程档案、学期节奏、学生端发布状态和班级基础设置。"
        : "Maintain course profile, term cadence, student-facing status, and class setup in one workspace.",
      metrics: [
        { label: zh ? "课程档案" : "Profiles", value: "2", note: zh ? "2 门课程已进入本学期维护" : "2 courses are active this term" },
        { label: zh ? "班级结构" : "Class Structure", value: "4", note: zh ? "班级邀请码与学生端入口同步" : "Invite codes and student entry points are aligned" },
        { label: zh ? "发布检查" : "Release Checks", value: "96%", note: zh ? "学生端预览项已通过" : "Student preview checks passed" },
      ],
      lanes: [
        {
          title: zh ? "课程档案" : "Course Profile",
          items: zh
            ? ["课程名称、教师、院系和学期信息", "课堂偏好、可见范围和封面素材"]
            : ["Course name, instructor, department, and term", "Class preferences, visibility, and cover assets"],
        },
        {
          title: zh ? "学生端预览" : "Student Preview",
          items: zh
            ? ["检查学习路径、入口链接和移动端布局", "生成预览快照供发布前复核"]
            : ["Check learning path, entry links, and mobile layout", "Create preview snapshot before release"],
        },
      ],
      records: zh
        ? ["大学研究方法完成学生端预览", "智能支持的初等数学研究已同步课堂偏好", "下次建议复核班级邀请码有效期"]
        : ["Research Methods completed student preview", "AI-supported Elementary Math synced class preferences", "Next check should review invite-code expiry"],
    },
    agents: {
      id: "agents",
      title: zh ? "智能体配置工作台" : "Agent Setup Workspace",
      subtitle: zh ? "智能编排" : "AI Orchestration",
      description: zh
        ? "配置课程智能体方案、模型权限、教师声音样本和课件配音工作流。"
        : "Configure course agent plans, model permissions, teacher voice samples, and PPT narration workflows.",
      metrics: [
        { label: zh ? "智能体角色" : "Agent Roles", value: "4", note: zh ? "研究、方法、数学、写作已配置" : "Research, methods, math, and writing are configured" },
        { label: zh ? "权限预检" : "Permission Check", value: zh ? "待验证" : "S12", note: zh ? "后端签名会话边界待部署验证" : "Signed backend session boundary awaits deploy proof" },
        { label: zh ? "课件语音" : "Courseware Voice", value: "19", note: zh ? "课件逐页配音脚本已生成" : "Per-slide PPT narration scripts are ready" },
      ],
      lanes: [
        {
          title: zh ? "智能体方案" : "Agent Plan",
          items: zh
            ? ["按课程启用智能体职责和话术边界", "保存模型角色、提示模板和审计标签"]
            : ["Enable agent duties and discourse boundaries by course", "Save model roles, prompt templates, and audit tags"],
        },
        {
          title: zh ? "权限预检" : "Permission Preflight",
          items: zh
            ? ["检查服务端会话、供应商环境和存储合同", "输出分工会话的阻塞状态"]
            : ["Check server session, provider env, and storage contract", "Report blockers across S07/S12/S19/S24"],
        },
      ],
      records: zh
        ? ["文字推理合同已可测试", "课件配音流程等待部署烟测", "教师声音样本仅显示脱敏引用"]
        : ["DeepSeek text reasoning contract is testable", "Qwen PPT narration awaits deploy smoke", "Teacher voice sample only exposes redacted references"],
    },
    "knowledge-base": {
      id: "knowledge-base",
      title: zh ? "课程知识库工作台" : "Course Knowledge Base Workspace",
      subtitle: zh ? "材料索引" : "Material Index",
      description: zh
        ? "管理课件、阅读、案例、课堂记录和知识库索引，支持课程内检索与智能体引用。"
        : "Manage slides, readings, cases, class records, and indexes for course search and agent grounding.",
      metrics: [
        { label: zh ? "资料包" : "Resource Packs", value: "18", note: zh ? "课件、案例和阅读材料已登记" : "Slides, cases, and readings are registered" },
        { label: zh ? "索引状态" : "Index Status", value: "92%", note: zh ? "可检索片段完成同步" : "Searchable chunks are synchronized" },
        { label: zh ? "占位资料" : "Placeholders", value: "5", note: zh ? "等待教师上传原文或链接" : "Awaiting teacher uploads or links" },
      ],
      lanes: [
        {
          title: zh ? "索引同步" : "Index Sync",
          items: zh
            ? ["扫描新增课件和阅读材料", "生成课程内可检索片段和来源标签"]
            : ["Scan new slides and readings", "Create searchable chunks and source tags"],
        },
        {
          title: zh ? "资料占位" : "Resource Placeholders",
          items: zh
            ? ["登记待补充案例、视频和实验数据", "为每项资料标注版权和可见范围"]
            : ["Register pending cases, videos, and lab data", "Tag rights and visibility for every item"],
        },
      ],
      records: zh
        ? ["研究方法第三单元索引已同步", "初等数学案例库新增 2 个占位", "下一轮需补齐视频材料来源"]
        : ["Research Methods unit 3 index synced", "Elementary math case library added 2 placeholders", "Next pass should complete video provenance"],
    },
    content: {
      id: "content",
      title: zh ? "课程内容工作台" : "Course Content Workspace",
      subtitle: zh ? "单元生产" : "Unit Production",
      description: zh
        ? "组织单元、课件、活动、测验和发布节奏，支持先生成草稿再审核发布。"
        : "Organize units, slides, activities, quizzes, and release cadence with draft-first review.",
      metrics: [
        { label: zh ? "可发布单元" : "Publishable Units", value: "7", note: zh ? "已通过课堂材料检查" : "Passed material checks" },
        { label: zh ? "草稿队列" : "Draft Queue", value: "3", note: zh ? "智能辅助单元草稿待教师审阅" : "AI-assisted unit drafts await review" },
        { label: zh ? "活动覆盖" : "Activity Coverage", value: "84%", note: zh ? "课堂活动覆盖核心目标" : "Activities cover core objectives" },
      ],
      lanes: [
        {
          title: zh ? "发布课程内容" : "Publish Content",
          items: zh
            ? ["锁定单元目标、材料和学习活动", "发布前检查学生端顺序与可见范围"]
            : ["Lock unit goals, materials, and learning activities", "Check student sequence and visibility before publishing"],
        },
        {
          title: zh ? "生成单元草稿" : "Generate Unit Draft",
          items: zh
            ? ["从课程知识库抽取主题和案例", "生成教师可编辑的目标、活动和测验草案"]
            : ["Extract themes and cases from the knowledge base", "Generate editable goals, activities, and quiz drafts"],
        },
      ],
      records: zh
        ? ["第三单元课堂活动已进入发布检查", "生成第六单元草稿供教师复核", "建议补齐测验题质量说明"]
        : ["Unit 3 activities entered release check", "Unit 6 draft generated for teacher review", "Quiz item quality notes should be completed"],
    },
    admins: {
      id: "admins",
      title: zh ? "管理员设置工作台" : "Admin Settings Workspace",
      subtitle: zh ? "角色权限" : "Role Access",
      description: zh
        ? "管理课程协作者、助教、审核人和权限分层，支持邀请与审批记录。"
        : "Manage collaborators, TAs, reviewers, and permission tiers with invitation and approval records.",
      metrics: [
        { label: zh ? "管理员" : "Admins", value: "6", note: zh ? "课程级协作者已登记" : "Course collaborators are registered" },
        { label: zh ? "待确认邀请" : "Pending Invites", value: "2", note: zh ? "协作邀请等待收件人确认" : "Collaboration invites await confirmation" },
        { label: zh ? "权限模板" : "Access Templates", value: "4", note: zh ? "教师、助教、审核、只读" : "Teacher, TA, reviewer, read-only" },
      ],
      lanes: [
        {
          title: zh ? "保存管理员设置" : "Save Admin Settings",
          items: zh
            ? ["配置课程角色、权限模板和审批链", "记录每次权限变更的操作原因"]
            : ["Configure course roles, access templates, and approval chain", "Record reason for every permission change"],
        },
        {
          title: zh ? "发送协作邀请" : "Send Collaboration Invite",
          items: zh
            ? ["选择协作角色和课程范围", "发送邀请并跟踪确认状态"]
            : ["Select collaboration role and course scope", "Send invite and track confirmation status"],
        },
      ],
      records: zh
        ? ["助教权限模板完成复核", "2 封协作邀请待确认", "建议启用课程发布前二次审批"]
        : ["TA access template reviewed", "2 collaboration invites are pending", "Recommend second approval before publishing"],
    },
    students: {
      id: "students",
      title: zh ? "学生管理工作台" : "Student Management Workspace",
      subtitle: zh ? "班级运营" : "Class Operations",
      description: zh
        ? "维护学生名单、分组、加入记录和协作状态，支持名单同步与分组建议。"
        : "Maintain rosters, groups, join records, and collaboration status with roster sync and grouping suggestions.",
      metrics: [
        { label: zh ? "学生总数" : "Students", value: "156", note: zh ? "跨 4 个教学班" : "Across 4 teaching classes" },
        { label: zh ? "名单同步" : "Roster Sync", value: "10m", note: zh ? "最近同步于 10 分钟前" : "Last synced 10 minutes ago" },
        { label: zh ? "分组建议" : "Group Suggestions", value: "12", note: zh ? "基于活跃度和能力互补" : "Based on activity and complementary skills" },
      ],
      lanes: [
        {
          title: zh ? "同步学生名单" : "Sync Roster",
          items: zh
            ? ["比对教务名单、邀请码加入记录和退课状态", "标记异常账号并生成教师确认列表"]
            : ["Compare SIS roster, invite-code joins, and withdrawals", "Flag anomalies for teacher confirmation"],
        },
        {
          title: zh ? "生成分组建议" : "Generate Groups",
          items: zh
            ? ["综合学习进度、发言频率和角色偏好", "输出可编辑的小组建议与冲突说明"]
            : ["Combine progress, participation, and role preferences", "Return editable group suggestions and conflict notes"],
        },
      ],
      records: zh
        ? ["研究方法一班名单已同步", "12 个分组建议等待教师确认", "3 名学生需要邀请码加入复核"]
        : ["Research Methods class 1 roster synced", "12 grouping suggestions await teacher confirmation", "3 students need invite-code join review"],
    },
    "data-export": {
      id: "data-export",
      title: zh ? "数据导出工作台" : "Data Export Workspace",
      subtitle: zh ? "数据治理" : "Data Governance",
      description: zh
        ? "生成学习、聊天、测验、成绩和课堂记录导出清单，发布前校验脱敏范围。"
        : "Generate export manifests for learning, chat, quiz, grade, and class records with de-identification checks.",
      metrics: [
        { label: zh ? "导出清单" : "Export Manifest", value: "5", note: zh ? "覆盖学习、聊天、成绩、测验、课堂" : "Covers learning, chat, grades, quizzes, and class data" },
        { label: zh ? "脱敏规则" : "Redaction Rules", value: "14", note: zh ? "姓名、学号、语音引用和原始聊天" : "Names, IDs, voice references, and raw chats" },
        { label: zh ? "待审批" : "Pending Approval", value: "2", note: zh ? "研究用途导出需要二次确认" : "Research exports need secondary approval" },
      ],
      lanes: [
        {
          title: zh ? "生成导出清单" : "Generate Manifest",
          items: zh
            ? ["选择课程、班级、时间窗和数据域", "生成文件清单、字段说明和审计编号"]
            : ["Select course, class, time window, and data domains", "Create file manifest, field notes, and audit ID"],
        },
        {
          title: zh ? "校验脱敏范围" : "Validate Redaction",
          items: zh
            ? ["检查身份字段、智能对话和语音引用", "输出脱敏差异和不可导出原因"]
            : ["Check identity fields, AI chats, and voice references", "Report redaction diffs and blocked export reasons"],
        },
      ],
      records: zh
        ? ["学习记录导出清单已生成", "聊天内容需补充脱敏审批", "测验成绩可进入下载队列"]
        : ["Learning-record manifest generated", "Chat export needs redaction approval", "Quiz grades can enter download queue"],
    },
    dashboard: {
      id: "dashboard",
      title: zh ? "数据看板工作台" : "Data Dashboard Workspace",
      subtitle: zh ? "教学洞察" : "Teaching Insight",
      description: zh
        ? "汇总参与度、进度、协作和风险信号，支持刷新实时看板与锁定日报快照。"
        : "Aggregate engagement, progress, collaboration, and risk signals with refresh and daily snapshot lock.",
      metrics: [
        { label: zh ? "活跃率" : "Active Rate", value: "88%", note: zh ? "最近 7 天学生活跃情况" : "Student activity over the last 7 days" },
        { label: zh ? "进度中位数" : "Median Progress", value: "71%", note: zh ? "按单元完成度统计" : "Calculated from unit completion" },
        { label: zh ? "风险提醒" : "Risk Alerts", value: "9", note: zh ? "需要教师关注的学生或小组" : "Students or groups needing attention" },
      ],
      lanes: [
        {
          title: zh ? "刷新数据看板" : "Refresh Dashboard",
          items: zh
            ? ["更新参与度、进度和协作趋势", "同步最新低活跃学生和小组状态"]
            : ["Update engagement, progress, and collaboration trends", "Sync latest low-activity student and group states"],
        },
        {
          title: zh ? "锁定日报快照" : "Lock Daily Snapshot",
          items: zh
            ? ["生成当天教师日报和班级摘要", "冻结数据口径供后续复盘引用"]
            : ["Generate daily teacher report and class summary", "Freeze metric definitions for later review"],
        },
      ],
      records: zh
        ? ["今日看板已刷新", "日报快照等待教师锁定", "协作趋势较上周提升 6%"]
        : ["Today dashboard refreshed", "Daily snapshot awaits teacher lock", "Collaboration trend is up 6% from last week"],
    },
    "quiz-board": {
      id: "quiz-board",
      title: zh ? "测验看板工作台" : "Quiz Board Workspace",
      subtitle: zh ? "测验质量" : "Quiz Quality",
      description: zh
        ? "分析测验完成、得分、错因和题目质量，支持低质题复核与课堂补救。"
        : "Analyze quiz completion, scores, error patterns, and item quality for review and remediation.",
      metrics: [
        { label: zh ? "完成率" : "Completion", value: "91%", note: zh ? "本周测验提交情况" : "Quiz submissions this week" },
        { label: zh ? "低质题" : "Low-Quality Items", value: "4", note: zh ? "区分度或通过率异常" : "Abnormal discrimination or pass rate" },
        { label: zh ? "错因簇" : "Error Clusters", value: "7", note: zh ? "按知识点和思维过程归类" : "Grouped by concept and reasoning process" },
      ],
      lanes: [
        {
          title: zh ? "刷新测验看板" : "Refresh Quiz Board",
          items: zh
            ? ["同步提交、得分分布和题目统计", "更新错因标签与班级薄弱点"]
            : ["Sync submissions, score distribution, and item stats", "Update error tags and class weak points"],
        },
        {
          title: zh ? "标记低质题复核" : "Mark Item Review",
          items: zh
            ? ["识别低区分度、歧义题和异常通过率", "推送给教师进行题干和选项修订"]
            : ["Identify low-discrimination, ambiguous, or abnormal items", "Send to teacher for stem and option revision"],
        },
      ],
      records: zh
        ? ["第 3 次测验看板已刷新", "4 道题进入低质题复核", "建议补充函数图像概念讲解"]
        : ["Quiz 3 board refreshed", "4 items entered low-quality review", "Recommend extra function graph explanation"],
    },
    grading: {
      id: "grading",
      title: zh ? "作业批改工作台" : "Assignment Review Workspace",
      subtitle: zh ? "反馈队列" : "Feedback Queue",
      description: zh
        ? "集中处理作业提交、评分标准、智能反馈建议和教师最终批注。"
        : "Handle submissions, rubrics, AI feedback suggestions, and final teacher comments in one queue.",
      metrics: [
        { label: zh ? "待批改" : "Pending", value: "42", note: zh ? "按截止时间和风险等级排序" : "Sorted by deadline and risk level" },
        { label: zh ? "智能建议" : "AI Suggestions", value: "36", note: zh ? "需要教师确认后发布" : "Requires teacher confirmation before release" },
        { label: zh ? "返修作业" : "Revisions", value: "8", note: zh ? "学生已提交二次版本" : "Students submitted second versions" },
      ],
      lanes: [
        {
          title: zh ? "保存批改队列" : "Save Review Queue",
          items: zh
            ? ["按班级、作业和截止时间组织队列", "保存评分状态、评语和返修标记"]
            : ["Organize queue by class, assignment, and deadline", "Save scoring status, comments, and revision marks"],
        },
        {
          title: zh ? "生成智能反馈建议" : "Generate AI Feedback",
          items: zh
            ? ["依据评分标准生成可编辑反馈", "标记不确定判断和需要人工复核的证据"]
            : ["Generate editable feedback from rubric", "Flag uncertain judgments and evidence needing review"],
        },
      ],
      records: zh
        ? ["42 份作业进入批改队列", "36 条智能反馈建议等待确认", "8 份返修作业需要优先处理"]
        : ["42 submissions entered review queue", "36 AI feedback suggestions await confirmation", "8 revisions need priority handling"],
    },
    "invite-code": {
      id: "invite-code",
      title: zh ? "邀请码工作台" : "Invite Code Workspace",
      subtitle: zh ? "入课授权" : "Enrollment Access",
      description: zh
        ? "生成、预览、发布和跟踪班级邀请码，控制学生加入课程的有效期与范围。"
        : "Generate, preview, publish, and track class invite codes with expiry and scope controls.",
      metrics: [
        { label: zh ? "可用邀请码" : "Active Codes", value: "4", note: zh ? "对应 4 个教学班" : "Mapped to 4 teaching classes" },
        { label: zh ? "待发布" : "Pending Publish", value: "1", note: zh ? "等待教师确认后开放" : "Awaiting teacher confirmation" },
        { label: zh ? "加入记录" : "Join Records", value: "128", note: zh ? "已通过邀请码加入课程" : "Students joined through invite codes" },
      ],
      lanes: [
        {
          title: zh ? "生成新邀请码" : "Generate New Code",
          items: zh
            ? ["选择课程、班级、有效期和加入上限", "生成可复制邀请码与二维码预览"]
            : ["Select course, class, expiry, and join limit", "Create copyable code and QR preview"],
        },
        {
          title: zh ? "确认发布邀请码" : "Confirm Publish",
          items: zh
            ? ["教师确认班级范围和有效期", "发布后记录加入日志和异常提醒"]
            : ["Teacher confirms class scope and expiry", "After publish, record joins and anomaly alerts"],
        },
      ],
      records: zh
        ? ["研究方法一班邀请码仍有效", "新邀请码等待教师确认发布", "3 条加入记录需要名单复核"]
        : ["Research Methods class 1 code remains active", "New invite code awaits teacher publish", "3 join records need roster review"],
    },
  };

  return configs[id];
}

export function TeachingPage() {
  const { locale } = useAppPreferences();
  const t = copy[locale];
  const [courseCards, setCourseCards] = useState<TeacherCourse[]>(() => [...teacherCourses]);
  const [activeWorkspaceItemId, setActiveWorkspaceItemId] =
    useState<TeachingOperationId>("course-settings");
  const [selectedCourseAction] = useState<{
    courseId: string;
    action: TeacherCourseAction;
  }>();
  const [isNewCourseOpen, setIsNewCourseOpen] = useState(false);
  const [newClassCourseId, setNewClassCourseId] = useState<string>();
  const [courseClasses, setCourseClasses] = useState<Record<string, TeacherClassItem[]>>({});
  const [classMemberships, setClassMemberships] = useState<
    Record<string, TeacherClassMembershipItem[]>
  >({});
  const [authenticatedTeacherActorId, setAuthenticatedTeacherActorId] =
    useState<string>();
  const [persistedCourseLoadError, setPersistedCourseLoadError] = useState<string>();
  const [membershipApprovalStatuses, setMembershipApprovalStatuses] = useState<
    Record<string, string>
  >({});
  const [selectedClassInvitation, setSelectedClassInvitation] = useState<TeacherClassItem>();
  const [inviteWorkspaceCode, setInviteWorkspaceCode] = useState(DEFAULT_INVITE_CODE);
  const [inviteWorkspaceJoinUrl, setInviteWorkspaceJoinUrl] = useState(
    createInviteJoinUrl(DEFAULT_INVITE_CODE),
  );
  const [inviteWorkspaceStatus, setInviteWorkspaceStatus] =
    useState<LocalizedText>(INVITE_READY_MESSAGE);
  const [inlineWorkspaceStatuses, setInlineWorkspaceStatuses] = useState<
    Partial<Record<TeachingOperationId, string>>
  >({});
  const [inlineWorkspaceAuditStatuses, setInlineWorkspaceAuditStatuses] = useState<
    Partial<Record<TeachingOperationId, InlineWorkspaceAuditStatus>>
  >({});
  const [inlineWorkspaceAlertStatuses, setInlineWorkspaceAlertStatuses] = useState<
    Partial<Record<TeachingOperationId, InlineWorkspaceAlertStatus>>
  >({});
  const [inlineWorkspaceAlertNotificationStatuses, setInlineWorkspaceAlertNotificationStatuses] =
    useState<Partial<Record<TeachingOperationId, InlineWorkspaceAlertNotificationStatus>>>({});
  const [inlineWorkspaceRollbackStatuses, setInlineWorkspaceRollbackStatuses] = useState<
    Partial<Record<TeachingOperationId, InlineWorkspaceRollbackStatus>>
  >({});
  const inlineWorkspaceAttemptIdsRef = useRef<Partial<Record<TeachingOperationId, number>>>({});
  const [courseSettingsDrafts, setCourseSettingsDrafts] = useState<
    Record<string, CourseSettingsDraft>
  >({});
  const textReasoningProvider = getProviderForRole("text-reasoning");
  const multimodalProvider = getProviderForRole("multimodal");
  const kangXiaPptSlideScripts = createKangXiaPptSlideScripts(locale);
  const voiceCloneJob = createTeacherVoiceCloneJob({
    teacherId: "teacher-kang",
    consentConfirmed: true,
    sampleAssetId: "teacher-kang-10s-sample",
    sampleDurationSeconds: 10,
    language: locale,
    targetVoiceLabel: "Kang teacher PPT voice",
  });
  const pptNarrationJob = createPptNarrationJob({
    courseId: "research-methods",
    pptAssetId: "research-methods-unit-3",
    clonedVoiceId: "voice-qwen-redacted",
    language: locale,
    slideScripts: kangXiaPptSlideScripts,
  });

  const readPersistedTeachingCourseState =
    useCallback(async (): Promise<PersistedTeachingCourseReadback> => {
      let response: Response;
      let body: TeachingCourseListResponse | null;
      try {
        response = await fetch("/api/teaching/courses", {
          method: "GET",
          headers: { accept: "application/json" },
        });
        body = (await response.json().catch(() => null)) as TeachingCourseListResponse | null;
      } catch {
        throw new Error(createPersistedCourseLoadErrorMessage(undefined, locale));
      }

      if (!response.ok || !body) {
        throw new Error(createPersistedCourseLoadErrorMessage(body?.error, locale));
      }

      return {
        courses: (body.courses ?? [])
          .map((course) => createTeacherCourseFromPersistedCourse(course))
          .filter((course): course is TeacherCourse => Boolean(course)),
        classesByCourse: createTeacherClassesByCourseFromPersistedClasses(body.classes ?? []),
        membershipsByClass: createTeacherMembershipsByClassFromPersistedMemberships(
          body.memberships ?? [],
        ),
        authenticatedTeacherActorId: readTeachingCourseListTeacherActorId(body.receipt),
      };
    }, [locale]);

  const applyPersistedTeachingCourseReadback = useCallback(
    (readback: PersistedTeachingCourseReadback) => {
      if (readback.authenticatedTeacherActorId) {
        setAuthenticatedTeacherActorId(readback.authenticatedTeacherActorId);
      }
      if (readback.courses.length > 0) {
        setCourseCards((currentCourses) =>
          mergeTeacherCoursesById(readback.courses, currentCourses),
        );
      }
      if (Object.keys(readback.classesByCourse).length > 0) {
        setCourseClasses((currentClasses) =>
          mergeTeacherClassesByCourseId(readback.classesByCourse, currentClasses),
        );
      }
      if (Object.keys(readback.membershipsByClass).length > 0) {
        setClassMemberships((currentMemberships) =>
          mergeTeacherMembershipsByClassId(readback.membershipsByClass, currentMemberships),
        );
      }
    },
    [],
  );

  useEffect(() => {
    if (!shouldLoadPersistedTeachingCourses() || typeof fetch !== "function") {
      return;
    }

    let isCancelled = false;

    async function loadPersistedTeachingCourses() {
      try {
        const readback = await readPersistedTeachingCourseState();
        if (isCancelled) {
          return;
        }
        applyPersistedTeachingCourseReadback(readback);
        setPersistedCourseLoadError(undefined);
      } catch (error) {
        if (!isCancelled) {
          setPersistedCourseLoadError(
            error instanceof Error
              ? error.message
              : createPersistedCourseLoadErrorMessage(undefined, locale),
          );
        }
      }
    }

    void loadPersistedTeachingCourses();

    return () => {
      isCancelled = true;
    };
  }, [applyPersistedTeachingCourseReadback, locale, readPersistedTeachingCourseState]);

  async function createCourseFromDraft(draft: NewCourseDraft) {
    const courseName = draft.name.trim();
    const expectedCourseSemester = draft.semester.trim();
    if (!courseName) {
      return;
    }

    const response = await fetch("/api/teaching/courses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(draft.courseId ? { courseId: draft.courseId } : {}),
        name: courseName,
        instructor: draft.instructor,
        unit: draft.unit,
        department: draft.department,
        semester: draft.semester,
        description: draft.description,
        ...(draft.coverAssetId ? { coverAssetId: draft.coverAssetId } : {}),
      }),
    });
    const body = (await response.json().catch(() => null)) as TeachingCourseCreateResponse | null;
    if (!response.ok || !body?.course?.courseId || !body.course.courseName) {
      throw new Error(createTeachingCourseCreateFailureMessage(body, locale));
    }
    if (!isMergedCourseOwnershipReceipt(body.ownershipReceipt, body.course.courseId)) {
      throw new Error(createTeachingCourseCreateOwnershipEvidenceMissingMessage(body, locale));
    }
    if (!isPersistedTeachingCourseCreateReceipt(body.receipt, body.course.courseId)) {
      throw new Error(createTeachingCourseCreateReceiptMissingMessage(body, locale));
    }
    if (body.course.semester?.trim() !== expectedCourseSemester) {
      throw new Error(localizedText(TEACHING_COURSE_CREATE_READBACK_MISMATCH_MESSAGE, locale));
    }

    const readback = await readPersistedTeachingCourseState();
    const createdCourse = readback.courses.find(
      (course) => course.id === body.course?.courseId,
    );
    if (!createdCourse) {
      throw new Error(localizedText(TEACHING_COURSE_CREATE_READBACK_MISSING_MESSAGE, locale));
    }
    if (localizedText(createdCourse.title, locale).trim() !== courseName) {
      throw new Error(localizedText(TEACHING_COURSE_CREATE_READBACK_MISMATCH_MESSAGE, locale));
    }
    if (extractCourseSemester(createdCourse, locale) !== expectedCourseSemester) {
      throw new Error(localizedText(TEACHING_COURSE_CREATE_READBACK_MISMATCH_MESSAGE, locale));
    }

    applyPersistedTeachingCourseReadback(readback);
    setIsNewCourseOpen(false);
  }

  async function createClassForCourse(courseId: string, className: string) {
    const course = courseCards.find((courseCard) => courseCard.id === courseId);
    const trimmedClassName = className.trim();
    if (!course || !trimmedClassName) {
      return;
    }

    const semester = extractCourseSemester(course, locale);
    const expectedClassSemester = semester.trim();
    const response = await fetch(`/api/teaching/courses/${courseId}/classes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        className: trimmedClassName,
        semester,
      }),
    });
    const body = (await response.json().catch(() => null)) as TeachingClassCreateResponse | null;
    const persistedClass = body?.classItem;
    const persistedClassId = persistedClass?.classId;
    const persistedClassName = persistedClass?.className;
    if (!response.ok || !persistedClassId || !persistedClassName) {
      throw new Error(createTeachingClassCreateFailureMessage(body, locale));
    }
    if (!isPersistedTeachingClassCreateReceipt(body?.receipt, courseId, persistedClassId)) {
      throw new Error(createTeachingClassCreateReceiptMissingMessage(body, locale));
    }

    const readback = await readPersistedTeachingCourseState();
    const persistedClassCourseId = persistedClass.courseId ?? courseId;
    if (persistedClassCourseId !== courseId) {
      throw new Error(localizedText(TEACHING_CLASS_CREATE_READBACK_MISMATCH_MESSAGE, locale));
    }
    if (persistedClass.semester?.trim() !== expectedClassSemester) {
      throw new Error(localizedText(TEACHING_CLASS_CREATE_READBACK_MISMATCH_MESSAGE, locale));
    }
    const createdClass = (readback.classesByCourse[courseId] ?? []).find(
      (classItem) => classItem.id === persistedClassId,
    );
    if (!createdClass) {
      throw new Error(localizedText(TEACHING_CLASS_CREATE_READBACK_MISSING_MESSAGE, locale));
    }
    if (createdClass.name.trim() !== trimmedClassName) {
      throw new Error(localizedText(TEACHING_CLASS_CREATE_READBACK_MISMATCH_MESSAGE, locale));
    }
    if (createdClass.semester.trim() !== expectedClassSemester) {
      throw new Error(localizedText(TEACHING_CLASS_CREATE_READBACK_MISMATCH_MESSAGE, locale));
    }

    applyPersistedTeachingCourseReadback(readback);
    setNewClassCourseId(undefined);
  }

  async function approveClassMembership(
    classItem: TeacherClassItem,
    membership: TeacherClassMembershipItem,
  ) {
    setMembershipApprovalStatuses((currentStatuses) => ({
      ...currentStatuses,
      [membership.id]: localizedText(MEMBERSHIP_APPROVAL_PENDING_MESSAGE, locale),
    }));

    try {
      const response = await fetch(
        `/api/teaching/classes/${encodeURIComponent(classItem.id)}/memberships/${encodeURIComponent(
          membership.id,
        )}/approve`,
        {
          method: "POST",
          headers: { accept: "application/json" },
        },
      );
      const body = (await response.json().catch(() => null)) as
        | TeachingClassMembershipApproveResponse
        | null;
      if (!response.ok) {
        setMembershipApprovalStatuses((currentStatuses) => ({
          ...currentStatuses,
          [membership.id]: createMembershipApprovalFailureStatus(body, locale),
        }));
        return;
      }
      if (!body?.membership) {
        throw new Error(localizedText(MEMBERSHIP_APPROVAL_FAILED_MESSAGE, locale));
      }

      const approvedMembership = createTeacherMembershipFromPersistedMembership(body.membership);
      if (!approvedMembership) {
        throw new Error(localizedText(MEMBERSHIP_APPROVAL_FAILED_MESSAGE, locale));
      }
      if (
        !isMatchingMembershipApprovalResult({
          approvedMembership,
          requestedMembership: membership,
          requestedClass: classItem,
        })
      ) {
        throw new Error(localizedText(MEMBERSHIP_APPROVAL_FAILED_MESSAGE, locale));
      }
      if (!isPersistedMembershipApprovalReceipt(body.receipt, classItem)) {
        throw new Error(localizedText(MEMBERSHIP_APPROVAL_RECEIPT_MISSING_MESSAGE, locale));
      }

      const readback = await readPersistedTeachingCourseState();
      const readbackMembership = (readback.membershipsByClass[classItem.id] ?? []).find(
        (persistedMembership) => persistedMembership.id === approvedMembership.id,
      );
      if (!readbackMembership) {
        throw new Error(localizedText(MEMBERSHIP_APPROVAL_READBACK_MISSING_MESSAGE, locale));
      }
      if (
        !isMatchingMembershipApprovalResult({
          approvedMembership: readbackMembership,
          requestedMembership: membership,
          requestedClass: classItem,
        })
      ) {
        throw new Error(localizedText(MEMBERSHIP_APPROVAL_READBACK_MISMATCH_MESSAGE, locale));
      }

      applyPersistedTeachingCourseReadback(readback);
      setMembershipApprovalStatuses((currentStatuses) => ({
        ...currentStatuses,
        [membership.id]:
          locale === "zh-CN"
            ? `${readbackMembership.studentDisplayName} 已加入${classItem.name}。`
            : `${readbackMembership.studentDisplayName} joined ${classItem.name}.`,
      }));
    } catch (error) {
      setMembershipApprovalStatuses((currentStatuses) => ({
        ...currentStatuses,
        [membership.id]:
          error instanceof Error && error.message
            ? error.message
            : localizedText(MEMBERSHIP_APPROVAL_FAILED_MESSAGE, locale),
      }));
    }
  }

  const newClassCourse = newClassCourseId
    ? courseCards.find((course) => course.id === newClassCourseId)
    : undefined;
  const activeWorkspaceItem =
    teacherSidebarItems.find((item) => item.id === activeWorkspaceItemId) ??
    teacherSidebarItems[0];
  const selectedActionCourse = selectedCourseAction
    ? courseCards.find((course) => course.id === selectedCourseAction.courseId)
    : undefined;
  const selectedCourseActionLabel = selectedCourseAction
    ? selectedCourseAction.action === "manage"
      ? t.common.manageCourse
      : t.teaching.continue
    : undefined;
  const activeCourseSettingsCourse = selectedActionCourse ?? courseCards[0];
  const activeCourseSettingsDraft = activeCourseSettingsCourse
    ? courseSettingsDrafts[activeCourseSettingsCourse.id] ??
      createCourseSettingsDraft(activeCourseSettingsCourse, locale)
    : undefined;

  function openWorkspaceItem(itemId: string) {
    if (isTeachingOperationId(itemId)) {
      setActiveWorkspaceItemId(itemId);
    }
  }

  function updateCourseSettingsDraft(
    course: TeacherCourse,
    patch: Partial<CourseSettingsDraft>,
  ) {
    setCourseSettingsDrafts((currentDrafts) => ({
      ...currentDrafts,
      [course.id]: {
        ...(currentDrafts[course.id] ?? createCourseSettingsDraft(course, locale)),
        ...patch,
      },
    }));
  }

  function createCourseSettingsPatch(courseId: string): CourseSettingsPatchPayload | undefined {
    const course = courseCards.find((courseCard) => courseCard.id === courseId);
    if (!course) {
      return undefined;
    }

    const draft = courseSettingsDrafts[course.id] ?? createCourseSettingsDraft(course, locale);
    const patch: CourseSettingsPatchPayload = {};
    const courseName = draft.courseName.trim();
    const semester = draft.semester.trim();
    const description = draft.description.trim();
    const persistedCourseName = localizedText(course.title, locale).trim();
    const persistedSemester = extractCourseSemester(course, locale).trim();
    if (courseName && courseName !== persistedCourseName) {
      patch.courseName = courseName;
    }
    if (semester && semester !== persistedSemester) {
      patch.semester = semester;
    }
    if (description) {
      patch.description = description;
    }
    return Object.keys(patch).length > 0 ? patch : undefined;
  }

  function applyVerifiedCourseSettingsPatch(
    courseId?: string,
    courseSettingsPatch?: CourseSettingsPatchPayload,
  ) {
    if (!courseId || !courseSettingsPatch) {
      return;
    }
    setCourseCards((currentCourses) =>
      currentCourses.map((course) =>
        course.id === courseId
          ? applyCourseSettingsPatchToTeacherCourse(course, courseSettingsPatch)
          : course,
      ),
    );
  }

  async function runInlineWorkspaceAction(
    operationId: TeachingOperationId,
    actionSlot: "primary" | "secondary",
  ) {
    const attemptId = createInlineWorkspaceAttemptId(operationId);
    const actionConfig = createInlineWorkspaceActionConfig(operationId, locale);
    setInlineWorkspaceStatuses((currentStatuses) => ({
      ...currentStatuses,
      [operationId]: localizedText(TEACHING_OPERATION_SAVE_PENDING_MESSAGE, locale),
    }));
    setInlineWorkspaceAuditStatuses((currentStatuses) => {
      const nextStatuses = { ...currentStatuses };
      delete nextStatuses[operationId];
      return nextStatuses;
    });
    setInlineWorkspaceRollbackStatuses((currentStatuses) => {
      const nextStatuses = { ...currentStatuses };
      delete nextStatuses[operationId];
      return nextStatuses;
    });
    setInlineWorkspaceAlertStatuses((currentStatuses) => {
      const nextStatuses = { ...currentStatuses };
      delete nextStatuses[operationId];
      return nextStatuses;
    });
    setInlineWorkspaceAlertNotificationStatuses((currentStatuses) => {
      const nextStatuses = { ...currentStatuses };
      delete nextStatuses[operationId];
      return nextStatuses;
    });

    try {
      const courseId = selectedCourseAction?.courseId ?? courseCards[0]?.id;
      const sourceAction = "inline-teaching-workspace";
      const courseSettingsPatch =
        operationId === "course-settings" && actionSlot === "primary" && courseId
          ? createCourseSettingsPatch(courseId)
          : undefined;
      const response = await fetch("/api/teaching/operations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operationId,
          actionSlot,
          courseId,
          sourceAction,
          ...(courseSettingsPatch ? { courseSettingsPatch } : {}),
          idempotencyKey: createTeachingOperationIdempotencyKey({
            operationId,
            actionSlot,
            courseId,
            sourceAction,
          }),
        }),
      });

      if (!response.ok) {
        const errorPayload = await readJsonPayload<InlineTeachingOperationErrorResponse>(response);
        if (!isCurrentInlineWorkspaceAttempt(operationId, attemptId)) {
          return;
        }
        setInlineWorkspaceStatuses((currentStatuses) => ({
          ...currentStatuses,
          [operationId]: createInlineWorkspaceFailureStatus(errorPayload, locale),
        }));
        return;
      }

      const payload = (await response.json()) as {
        receipt?: InlineTeachingOperationBackendReceipt;
        domainPersistenceSummary?: InlineTeachingOperationDomainPersistenceSummary;
        traceId?: string;
      };
      if (!isCurrentInlineWorkspaceAttempt(operationId, attemptId)) {
        return;
      }
      if (!isPersistedInlineTeachingOperationReceipt(payload.receipt)) {
        setInlineWorkspaceStatuses((currentStatuses) => ({
          ...currentStatuses,
          [operationId]: localizedText(TEACHING_OPERATION_SAVE_FAILED_MESSAGE, locale),
        }));
        return;
      }
      if (
        isMismatchedOrIncompleteInlineTeachingOperationReceipt(payload.receipt, {
          operationId,
          actionSlot,
        })
      ) {
        setInlineWorkspaceStatuses((currentStatuses) => ({
          ...currentStatuses,
          [operationId]: localizedText(
            TEACHING_OPERATION_RECEIPT_MISMATCH_MESSAGE,
            locale,
          ),
        }));
        return;
      }
      if (!hasSignedInlineTeachingOperationReceiptAudit(payload.receipt)) {
        setInlineWorkspaceStatuses((currentStatuses) => ({
          ...currentStatuses,
          [operationId]: localizedText(TEACHING_OPERATION_SAVE_FAILED_MESSAGE, locale),
        }));
        return;
      }
      const domainPersistenceFailureStatus = createInlineDomainPersistenceFailureStatus(
        payload.domainPersistenceSummary,
        payload.receipt,
        locale,
      );
      if (domainPersistenceFailureStatus) {
        setInlineWorkspaceStatuses((currentStatuses) => ({
          ...currentStatuses,
          [operationId]: domainPersistenceFailureStatus,
        }));
        return;
      }
      if (
        payload.receipt?.operationId &&
        payload.receipt?.actionSlot &&
        !payload.traceId
      ) {
        setInlineWorkspaceStatuses((currentStatuses) => ({
          ...currentStatuses,
          [operationId]: localizedText(TEACHING_OPERATION_AUDIT_FAILED_MESSAGE, locale),
        }));
        setInlineWorkspaceAuditStatuses((currentStatuses) => ({
          ...currentStatuses,
          [operationId]: {
            status: "failed",
          },
        }));
        return;
      }
      const receiptDisplayMessage = payload.receipt?.displayMessage;
      const verifiedStatusMessage = receiptDisplayMessage
        ? localizedText(receiptDisplayMessage, locale)
        : actionSlot === "primary"
          ? actionConfig.primaryMessage
          : actionConfig.secondaryMessage;
      if (payload.traceId) {
        const recordId = payload.receipt?.receiptId;
        if (!recordId) {
          setInlineWorkspaceAuditStatuses((currentStatuses) => ({
            ...currentStatuses,
            [operationId]: {
              status: "failed",
              traceId: payload.traceId as string,
            },
          }));
          return;
        }
        setInlineWorkspaceStatuses((currentStatuses) => ({
          ...currentStatuses,
          [operationId]: localizedText(TEACHING_OPERATION_AUDIT_PENDING_MESSAGE, locale),
        }));
        void readInlineWorkspaceAuditEvidence({
          operationId,
          courseId: payload.receipt?.courseId ?? selectedCourseAction?.courseId ?? courseCards[0]?.id,
          recordId,
          traceId: payload.traceId,
          verifiedStatusMessage,
          attemptId,
          actionSlot,
          courseSettingsPatch,
        });
      } else {
        if (
          isMismatchedOrIncompleteInlineTeachingOperationReceipt(payload.receipt, {
            operationId,
            actionSlot,
          })
        ) {
          setInlineWorkspaceStatuses((currentStatuses) => ({
            ...currentStatuses,
            [operationId]: localizedText(
              TEACHING_OPERATION_RECEIPT_MISMATCH_MESSAGE,
              locale,
            ),
          }));
          return;
        }
        applyVerifiedCourseSettingsPatch(courseId, courseSettingsPatch);
        setInlineWorkspaceStatuses((currentStatuses) => ({
          ...currentStatuses,
          [operationId]: verifiedStatusMessage,
        }));
      }
    } catch {
      if (!isCurrentInlineWorkspaceAttempt(operationId, attemptId)) {
        return;
      }
      setInlineWorkspaceStatuses((currentStatuses) => ({
        ...currentStatuses,
        [operationId]: localizedText(TEACHING_OPERATION_SAVE_FAILED_MESSAGE, locale),
      }));
    }
  }

  async function readInlineWorkspaceAuditEvidence(input: {
    operationId: TeachingOperationId;
    courseId?: string;
    recordId: string;
    traceId: string;
    verifiedStatusMessage?: string;
    attemptId: number;
    actionSlot: "primary" | "secondary";
    courseSettingsPatch?: CourseSettingsPatchPayload;
  }) {
    if (!isCurrentInlineWorkspaceAttempt(input.operationId, input.attemptId)) {
      return;
    }
    setInlineWorkspaceAuditStatuses((currentStatuses) => ({
      ...currentStatuses,
      [input.operationId]: {
        status: "pending",
        traceId: input.traceId,
      },
    }));

    try {
      const response = await fetch("/api/teaching/operations/audit", {
        method: "GET",
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error("Teaching operation audit readback failed.");
      }
      const audit = (await response.json()) as InlineTeachingOperationAuditReadbackResponse;
      if (!isCurrentInlineWorkspaceAttempt(input.operationId, input.attemptId)) {
        return;
      }
      const matchingAuditEvent = audit.auditEvents?.find((event) => {
        if (event.traceId !== input.traceId) {
          return false;
        }
        return input.courseId ? event.courseId === input.courseId : true;
      });
      const matchingRecord = input.recordId
        ? audit.records?.find((record) => {
            if (record.recordId !== input.recordId) {
              return false;
            }
            return isInlineAuditRecordForAction(record, {
              courseId: input.courseId,
              operationId: input.operationId,
              actionSlot: input.actionSlot,
            });
          })
        : undefined;
      if (!matchingAuditEvent) {
        throw new Error("Teaching operation audit readback did not include the saved trace.");
      }
      if (input.recordId && !matchingRecord) {
        throw new Error("Teaching operation audit readback did not include the saved record.");
      }
      const matchingDomainProjection = findMatchingInlineDomainProjection(
        audit.domainProjections,
        {
          courseId: input.courseId,
          operationId: input.operationId,
          actionSlot: input.actionSlot,
          recordId: input.recordId,
        },
      );
      if (!matchingDomainProjection?.objectId || !matchingDomainProjection.objectType) {
        throw new Error(
          "Teaching operation audit readback did not include the saved domain projection.",
        );
      }
      const matchingDomainProjections = findMatchingInlineDomainProjections(
        audit.domainProjections,
        {
          courseId: input.courseId,
          operationId: input.operationId,
          actionSlot: input.actionSlot,
          recordId: input.recordId,
        },
      );
      if (
        !doesInlineCourseSettingsProjectionMatchPatch(
          matchingDomainProjection,
          input.courseSettingsPatch,
        )
      ) {
        setInlineWorkspaceStatuses((currentStatuses) => ({
          ...currentStatuses,
          [input.operationId]: localizedText(
            TEACHING_COURSE_SETTINGS_READBACK_MISMATCH_MESSAGE,
            locale,
          ),
        }));
        setInlineWorkspaceAuditStatuses((currentStatuses) => ({
          ...currentStatuses,
          [input.operationId]: {
            status: "failed",
            traceId: input.traceId,
          },
        }));
        return;
      }
      if (
        !doesInlineDomainReadbackMatchBusinessSemantics(matchingDomainProjections, {
          operationId: input.operationId,
          actionSlot: input.actionSlot,
        })
      ) {
        setInlineWorkspaceStatuses((currentStatuses) => ({
          ...currentStatuses,
          [input.operationId]: getInlineDomainProjectionSemanticMismatchMessage(
            input.operationId,
            input.actionSlot,
            locale,
          ),
        }));
        setInlineWorkspaceAuditStatuses((currentStatuses) => ({
          ...currentStatuses,
          [input.operationId]: {
            status: "failed",
            traceId: input.traceId,
          },
        }));
        return;
      }
      if (!isVerifiedInlineAuditAuthSession(matchingAuditEvent.authSession)) {
        throw new Error(
          "Teaching operation audit readback did not include the signed teacher session.",
        );
      }

      applyVerifiedCourseSettingsPatch(
        matchingRecord?.courseId ?? input.courseId,
        input.courseSettingsPatch,
      );
      setInlineWorkspaceAuditStatuses((currentStatuses) => ({
        ...currentStatuses,
        [input.operationId]: {
          status: "verified",
          traceId: input.traceId,
          actorId: matchingAuditEvent.actorId ?? audit.actorId,
          authSession: matchingAuditEvent.authSession,
          auditEventCount: audit.auditEventCount,
          recordId: matchingRecord?.recordId,
          courseId: matchingRecord?.courseId ?? input.courseId,
          domainObjectId: matchingDomainProjection.objectId,
          domainObjectType: matchingDomainProjection.objectType,
        },
      }));
      if (matchingRecord?.recordId) {
        void readInlineWorkspaceAuditAlerts(
          input.operationId,
          input.verifiedStatusMessage,
          input.attemptId,
        );
      } else if (input.verifiedStatusMessage) {
        setInlineWorkspaceStatuses((currentStatuses) => ({
          ...currentStatuses,
          [input.operationId]: input.verifiedStatusMessage as string,
        }));
      }
    } catch {
      if (!isCurrentInlineWorkspaceAttempt(input.operationId, input.attemptId)) {
        return;
      }
      setInlineWorkspaceStatuses((currentStatuses) => ({
        ...currentStatuses,
        [input.operationId]: localizedText(TEACHING_OPERATION_AUDIT_FAILED_MESSAGE, locale),
      }));
      setInlineWorkspaceAuditStatuses((currentStatuses) => ({
        ...currentStatuses,
        [input.operationId]: {
          status: "failed",
          traceId: input.traceId,
        },
      }));
    }
  }

  async function readInlineWorkspaceAuditAlerts(
    operationId: TeachingOperationId,
    verifiedStatusMessage?: string,
    attemptId?: number,
  ) {
    if (
      typeof attemptId === "number" &&
      !isCurrentInlineWorkspaceAttempt(operationId, attemptId)
    ) {
      return;
    }
    setInlineWorkspaceAlertStatuses((currentStatuses) => ({
      ...currentStatuses,
      [operationId]: {
        status: "pending",
      },
    }));
    if (verifiedStatusMessage) {
      setInlineWorkspaceStatuses((currentStatuses) => ({
        ...currentStatuses,
        [operationId]: localizedText(TEACHING_OPERATION_ALERT_PENDING_MESSAGE, locale),
      }));
    }

    try {
      const response = await fetch("/api/teaching/operations/audit/alerts", {
        method: "GET",
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error("Teaching operation audit alert readback failed.");
      }
      const summary = (await response.json()) as InlineTeachingOperationAuditAlertSummaryResponse;
      if (
        typeof attemptId === "number" &&
        !isCurrentInlineWorkspaceAttempt(operationId, attemptId)
      ) {
        return;
      }
      const alertCount = summary.alertCount ?? summary.alerts?.length ?? 0;
      setInlineWorkspaceAlertStatuses((currentStatuses) => ({
        ...currentStatuses,
        [operationId]: {
          status: alertCount > 0 ? "attention-required" : "clear",
          traceId: summary.traceId,
          alertCount,
          alerts: summary.alerts ?? [],
          notificationRoute: summary.notificationRoute,
        },
      }));
      if (verifiedStatusMessage) {
        setInlineWorkspaceStatuses((currentStatuses) => ({
          ...currentStatuses,
        [operationId]: verifiedStatusMessage,
        }));
      }
    } catch {
      if (
        typeof attemptId === "number" &&
        !isCurrentInlineWorkspaceAttempt(operationId, attemptId)
      ) {
        return;
      }
      setInlineWorkspaceStatuses((currentStatuses) => ({
        ...currentStatuses,
        [operationId]: localizedText(TEACHING_OPERATION_ALERT_FAILED_MESSAGE, locale),
      }));
      setInlineWorkspaceAlertStatuses((currentStatuses) => ({
        ...currentStatuses,
        [operationId]: {
          status: "failed",
        },
      }));
    }
  }

  function createInlineWorkspaceAttemptId(operationId: TeachingOperationId) {
    const nextAttemptId = (inlineWorkspaceAttemptIdsRef.current[operationId] ?? 0) + 1;
    inlineWorkspaceAttemptIdsRef.current[operationId] = nextAttemptId;
    return nextAttemptId;
  }

  function isCurrentInlineWorkspaceAttempt(
    operationId: TeachingOperationId,
    attemptId: number,
  ) {
    return inlineWorkspaceAttemptIdsRef.current[operationId] === attemptId;
  }

  function isInlineAuditRecordForAction(
    record: InlineTeachingOperationRecord,
    input: {
      courseId?: string;
      operationId: TeachingOperationId;
      actionSlot: "primary" | "secondary";
    },
  ) {
    if (input.courseId && record.courseId !== input.courseId) {
      return false;
    }
    if (record.operationId && record.operationId !== input.operationId) {
      return false;
    }
    if (record.actionSlot && record.actionSlot !== input.actionSlot) {
      return false;
    }
    return true;
  }

  function isVerifiedInlineAuditAuthSession(
    authSession: InlineTeachingOperationAuditAuthSession | undefined,
  ) {
    return hasCompleteInlineTeachingAuthSession(authSession);
  }

function findMatchingInlineDomainProjection(
  projections: InlineTeachingOperationDomainProjection[] | undefined,
  input: {
    courseId?: string;
    operationId: TeachingOperationId;
      actionSlot: "primary" | "secondary";
      recordId: string;
    },
  ) {
    const expectedObjectTypes =
      INLINE_OPERATION_EXPECTED_DOMAIN_OBJECT_TYPES[input.operationId][input.actionSlot];
    return projections?.find((projection) => {
      if (projection.operationRecordId !== input.recordId) {
        return false;
      }
      if (input.courseId && projection.courseId !== input.courseId) {
        return false;
      }
      if (!projection.objectType) {
        return false;
      }
      return expectedObjectTypes.includes(projection.objectType);
    });
  }

  function findMatchingInlineDomainProjections(
    projections: InlineTeachingOperationDomainProjection[] | undefined,
    input: {
      courseId?: string;
      operationId: TeachingOperationId;
      actionSlot: "primary" | "secondary";
      recordId: string;
    },
  ) {
    const expectedObjectTypes =
      INLINE_OPERATION_EXPECTED_DOMAIN_OBJECT_TYPES[input.operationId][input.actionSlot];
    return expectedObjectTypes
      .map((objectType) =>
        projections?.find((projection) => {
          if (projection.operationRecordId !== input.recordId) {
            return false;
          }
          if (input.courseId && projection.courseId !== input.courseId) {
            return false;
          }
          return projection.objectType === objectType && typeof projection.objectId === "string";
        }),
      )
      .filter(
        (projection): projection is InlineTeachingOperationDomainProjection =>
          Boolean(projection),
      );
  }

  function doesInlineCourseSettingsProjectionMatchPatch(
    projection: InlineTeachingOperationDomainProjection,
    courseSettingsPatch?: CourseSettingsPatchPayload,
  ) {
    if (!courseSettingsPatch || Object.keys(courseSettingsPatch).length === 0) {
      return true;
    }
    if (projection.objectType !== "course-settings") {
      return false;
    }
    return (["courseName", "semester", "description"] as const).every((field) => {
      const expectedValue = courseSettingsPatch[field]?.trim();
      if (!expectedValue) {
        return true;
      }
      return projection[field]?.trim() === expectedValue;
    });
  }

  function doesInlineDomainProjectionMatchBusinessSemantics(
    projection: InlineTeachingOperationDomainProjection,
    input: {
      operationId: TeachingOperationId;
      actionSlot: "primary" | "secondary";
    },
  ) {
    if (input.operationId === "course-settings" && input.actionSlot === "primary") {
      return isVerifiedCourseSettingsProjection(projection);
    }
    if (input.operationId === "course-settings" && input.actionSlot === "secondary") {
      return isVerifiedStudentPreviewSessionProjection(projection);
    }
    if (input.operationId === "students" && input.actionSlot === "primary") {
      return isVerifiedStudentRosterProjection(projection);
    }
    if (input.operationId === "students" && input.actionSlot === "secondary") {
      return isVerifiedGroupSuggestionsProjection(projection);
    }
    if (input.operationId === "knowledge-base" && input.actionSlot === "primary") {
      return isVerifiedKnowledgeIndexProjection(projection);
    }
    if (input.operationId === "knowledge-base" && input.actionSlot === "secondary") {
      return isVerifiedResourceReviewItemProjection(projection);
    }
    if (input.operationId === "dashboard" && input.actionSlot === "primary") {
      return isVerifiedDashboardStateProjection(projection);
    }
    if (input.operationId === "dashboard" && input.actionSlot === "secondary") {
      return isVerifiedDashboardSnapshotProjection(projection);
    }
    if (input.operationId === "content" && input.actionSlot === "primary") {
      return isVerifiedCourseContentProjection(projection);
    }
    if (input.operationId === "content" && input.actionSlot === "secondary") {
      return isVerifiedUnitDraftProjection(projection);
    }
    if (input.operationId === "agents" && input.actionSlot === "primary") {
      return isVerifiedAgentPlanProjection(projection);
    }
    if (input.operationId === "agents" && input.actionSlot === "secondary") {
      return isVerifiedPermissionPreflightProjection(projection);
    }
    if (input.operationId === "admins" && input.actionSlot === "primary") {
      return isVerifiedAdminSettingsProjection(projection);
    }
    if (input.operationId === "admins" && input.actionSlot === "secondary") {
      return isVerifiedCollaborationInviteNotificationProjection(projection);
    }
    if (input.operationId === "quiz-board" && input.actionSlot === "primary") {
      return isVerifiedQuizBoardStateProjection(projection);
    }
    if (input.operationId === "quiz-board" && input.actionSlot === "secondary") {
      return isVerifiedQuizItemReviewProjection(projection);
    }
    if (input.operationId === "grading" && input.actionSlot === "primary") {
      if (projection.objectType === "grading-queue") {
        return isVerifiedGradingQueueProjection(projection);
      }
      if (projection.objectType === "gradebook-update") {
        return isVerifiedGradebookUpdateProjection(projection);
      }
      return false;
    }
    if (input.operationId === "grading" && input.actionSlot === "secondary") {
      return isVerifiedAiFeedbackDraftProjection(projection);
    }
    if (input.operationId === "invite-code" && input.actionSlot === "primary") {
      return isVerifiedInviteCodeDraftProjection(projection);
    }
    if (input.operationId === "invite-code" && input.actionSlot === "secondary") {
      return isVerifiedEnrollmentAccessProjection(projection);
    }
    if (input.operationId === "data-export" && input.actionSlot === "primary") {
      return isVerifiedExportManifestProjection(projection);
    }
    if (input.operationId === "data-export" && input.actionSlot === "secondary") {
      return isVerifiedRedactionValidationProjection(projection);
    }
    return true;
  }

  function doesInlineDomainReadbackMatchBusinessSemantics(
    projections: InlineTeachingOperationDomainProjection[],
    input: {
      operationId: TeachingOperationId;
      actionSlot: "primary" | "secondary";
    },
  ) {
    const expectedObjectTypes =
      INLINE_OPERATION_EXPECTED_DOMAIN_OBJECT_TYPES[input.operationId][input.actionSlot];
    if (projections.length < expectedObjectTypes.length) {
      return false;
    }
    return expectedObjectTypes.every((objectType) => {
      const projection = projections.find(
        (candidateProjection) => candidateProjection.objectType === objectType,
      );
      return projection
        ? doesInlineDomainProjectionMatchBusinessSemantics(projection, input)
        : false;
    });
  }

  function isVerifiedCourseSettingsProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    return (
      projection.objectType === "course-settings" &&
      projection.status === "saved" &&
      typeof projection.updatedBy === "string" &&
      projection.updatedBy.trim().length > 0 &&
      typeof projection.updatedAt === "string" &&
      projection.updatedAt.trim().length > 0
    );
  }

  function isVerifiedStudentPreviewSessionProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    return (
      projection.objectType === "student-preview-session" &&
      projection.previewStatus === "generated" &&
      projection.previewScope === "teacher-course-preview" &&
      projection.previewPolicy === "teacher-visible-preview-only" &&
      typeof projection.previewedBy === "string" &&
      projection.previewedBy.trim().length > 0 &&
      typeof projection.previewId === "string" &&
      projection.previewId.trim().length > 0 &&
      typeof projection.previewUrl === "string" &&
      projection.previewUrl.trim().length > 0 &&
      typeof projection.generatedAt === "string" &&
      projection.generatedAt.trim().length > 0
    );
  }

  function isVerifiedStudentRosterProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    const expectedSourceSystems = ["sis-roster", "invite-code-joins", "withdrawals"];
    return (
      projection.objectType === "student-roster" &&
      projection.syncStatus === "synced" &&
      typeof projection.syncedBy === "string" &&
      projection.syncedBy.trim().length > 0 &&
      typeof projection.syncedAt === "string" &&
      projection.syncedAt.trim().length > 0 &&
      typeof projection.pendingTeacherReviewCount === "number" &&
      Number.isFinite(projection.pendingTeacherReviewCount) &&
      projection.pendingTeacherReviewCount >= 0 &&
      Array.isArray(projection.sourceSystems) &&
      expectedSourceSystems.every((sourceSystem) =>
        projection.sourceSystems?.includes(sourceSystem),
      )
    );
  }

  function isVerifiedKnowledgeIndexProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    const expectedSourceSystems = [
      "course-files",
      "teacher-resources",
      "agent-grounding-index",
    ];
    return (
      projection.objectType === "knowledge-index" &&
      projection.syncStatus === "synced" &&
      typeof projection.syncedBy === "string" &&
      projection.syncedBy.trim().length > 0 &&
      typeof projection.syncedAt === "string" &&
      projection.syncedAt.trim().length > 0 &&
      Array.isArray(projection.sourceSystems) &&
      expectedSourceSystems.every((sourceSystem) =>
        projection.sourceSystems?.includes(sourceSystem),
      )
    );
  }

  function isVerifiedGroupSuggestionsProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    const expectedGroupingBasis = [
      "participation",
      "progress",
      "collaboration-balance",
    ];
    return (
      projection.objectType === "group-suggestions" &&
      projection.suggestionStatus === "ready-for-teacher-review" &&
      projection.reviewPolicy === "teacher-review-before-group-assignment" &&
      typeof projection.generatedBy === "string" &&
      projection.generatedBy.trim().length > 0 &&
      typeof projection.artifactId === "string" &&
      projection.artifactId.trim().length > 0 &&
      typeof projection.generatedAt === "string" &&
      projection.generatedAt.trim().length > 0 &&
      Array.isArray(projection.groupingBasis) &&
      expectedGroupingBasis.every((basis) => projection.groupingBasis?.includes(basis))
    );
  }

  function isVerifiedResourceReviewItemProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    return (
      projection.objectType === "resource-review-item" &&
      projection.reviewStatus === "pending-teacher-review" &&
      projection.resourceSource === "teacher-placeholder" &&
      projection.reviewPolicy === "teacher-review-before-knowledge-index" &&
      typeof projection.queuedBy === "string" &&
      projection.queuedBy.trim().length > 0 &&
      typeof projection.queuedAt === "string" &&
      projection.queuedAt.trim().length > 0
    );
  }

  function isVerifiedDashboardStateProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    const expectedVisibleMetrics = ["engagement", "progress", "assessment-quality"];
    return (
      projection.objectType === "dashboard-state" &&
      projection.refreshStatus === "refreshed" &&
      typeof projection.refreshedBy === "string" &&
      projection.refreshedBy.trim().length > 0 &&
      typeof projection.refreshedAt === "string" &&
      projection.refreshedAt.trim().length > 0 &&
      Array.isArray(projection.visibleMetrics) &&
      expectedVisibleMetrics.every((metric) => projection.visibleMetrics?.includes(metric))
    );
  }

  function isVerifiedDashboardSnapshotProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    return (
      projection.objectType === "dashboard-snapshot" &&
      projection.snapshotStatus === "locked" &&
      projection.snapshotScope === "daily-course-dashboard" &&
      projection.retentionPolicy === "teacher-locked-dashboard-snapshot" &&
      typeof projection.lockedBy === "string" &&
      projection.lockedBy.trim().length > 0 &&
      typeof projection.snapshotId === "string" &&
      projection.snapshotId.trim().length > 0 &&
      typeof projection.lockedAt === "string" &&
      projection.lockedAt.trim().length > 0
    );
  }

  function isVerifiedCourseContentProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    return (
      projection.objectType === "course-content" &&
      projection.publicationStatus === "published" &&
      projection.releaseScope === "course-visible-content" &&
      typeof projection.publishedBy === "string" &&
      projection.publishedBy.trim().length > 0 &&
      typeof projection.publishedAt === "string" &&
      projection.publishedAt.trim().length > 0
    );
  }

  function isVerifiedUnitDraftProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    return (
      projection.objectType === "unit-draft" &&
      projection.draftStatus === "ready-for-teacher-review" &&
      projection.reviewPolicy === "teacher-review-before-course-publish" &&
      typeof projection.generatedBy === "string" &&
      projection.generatedBy.trim().length > 0 &&
      typeof projection.artifactId === "string" &&
      projection.artifactId.trim().length > 0 &&
      typeof projection.generatedAt === "string" &&
      projection.generatedAt.trim().length > 0
    );
  }

  function isVerifiedAgentPlanProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    const expectedEnabledAgents = [
      "research-assistant",
      "math-coach",
      "writing-mentor",
    ];
    return (
      projection.objectType === "agent-plan" &&
      projection.planStatus === "saved" &&
      projection.governancePolicy === "teacher-reviewed-agent-plan" &&
      typeof projection.savedBy === "string" &&
      projection.savedBy.trim().length > 0 &&
      typeof projection.savedAt === "string" &&
      projection.savedAt.trim().length > 0 &&
      Array.isArray(projection.enabledAgents) &&
      expectedEnabledAgents.every((agent) => projection.enabledAgents?.includes(agent))
    );
  }

  function isVerifiedPermissionPreflightProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    const expectedCheckedPermissions = [
      "course-bindings",
      "agent-roles",
      "student-access",
    ];
    return (
      projection.objectType === "permission-preflight" &&
      projection.preflightStatus === "passed" &&
      projection.preflightPolicy === "teacher-agent-permission-gate" &&
      typeof projection.checkedBy === "string" &&
      projection.checkedBy.trim().length > 0 &&
      typeof projection.checkedAt === "string" &&
      projection.checkedAt.trim().length > 0 &&
      Array.isArray(projection.checkedPermissions) &&
      expectedCheckedPermissions.every((permission) =>
        projection.checkedPermissions?.includes(permission),
      )
    );
  }

  function isVerifiedAdminSettingsProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    const expectedAdminScopes = [
      "course-collaborators",
      "permission-boundary",
      "audit-routing",
    ];
    return (
      projection.objectType === "admin-settings" &&
      projection.settingsStatus === "saved" &&
      projection.governancePolicy === "teacher-controlled-admin-settings" &&
      typeof projection.savedBy === "string" &&
      projection.savedBy.trim().length > 0 &&
      typeof projection.savedAt === "string" &&
      projection.savedAt.trim().length > 0 &&
      Array.isArray(projection.adminScopes) &&
      expectedAdminScopes.every((scope) => projection.adminScopes?.includes(scope))
    );
  }

  function isVerifiedCollaborationInviteNotificationProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    return (
      projection.objectType === "email-notification" &&
      projection.notificationStatus === "queued" &&
      projection.deliveryChannel === "collaboration-invite-email" &&
      projection.deliveryPolicy === "server-outbox-before-smtp-provider" &&
      typeof projection.queuedBy === "string" &&
      projection.queuedBy.trim().length > 0 &&
      typeof projection.outboxId === "string" &&
      projection.outboxId.trim().length > 0 &&
      typeof projection.queuedAt === "string" &&
      projection.queuedAt.trim().length > 0
    );
  }

  function isVerifiedQuizBoardStateProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    const expectedVisibleMetrics = [
      "completion-rate",
      "item-quality",
      "misconception-clusters",
    ];
    return (
      projection.objectType === "quiz-board-state" &&
      projection.refreshStatus === "refreshed" &&
      projection.reviewPolicy === "teacher-visible-quiz-quality-board" &&
      typeof projection.refreshedBy === "string" &&
      projection.refreshedBy.trim().length > 0 &&
      typeof projection.refreshedAt === "string" &&
      projection.refreshedAt.trim().length > 0 &&
      Array.isArray(projection.visibleMetrics) &&
      expectedVisibleMetrics.every((metric) =>
        projection.visibleMetrics?.includes(metric),
      )
    );
  }

  function isVerifiedQuizItemReviewProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    const expectedFlaggedSignals = [
      "low-discrimination",
      "high-error-rate",
      "teacher-review-needed",
    ];
    return (
      projection.objectType === "quiz-item-review" &&
      projection.reviewStatus === "flagged-for-review" &&
      projection.reviewPolicy === "teacher-review-before-quiz-reuse" &&
      typeof projection.flaggedBy === "string" &&
      projection.flaggedBy.trim().length > 0 &&
      typeof projection.flaggedAt === "string" &&
      projection.flaggedAt.trim().length > 0 &&
      Array.isArray(projection.flaggedSignals) &&
      expectedFlaggedSignals.every((signal) =>
        projection.flaggedSignals?.includes(signal),
      )
    );
  }

  function isVerifiedGradingQueueProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    return (
      projection.objectType === "grading-queue" &&
      projection.queueStatus === "saved" &&
      projection.reviewPolicy === "teacher-review-before-release" &&
      typeof projection.savedBy === "string" &&
      projection.savedBy.trim().length > 0 &&
      typeof projection.savedAt === "string" &&
      projection.savedAt.trim().length > 0
    );
  }

  function isVerifiedGradebookUpdateProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    return (
      projection.objectType === "gradebook-update" &&
      projection.updateStatus === "pending-release" &&
      projection.releasePolicy === "teacher-confirmed-grade-release" &&
      typeof projection.updatedBy === "string" &&
      projection.updatedBy.trim().length > 0 &&
      typeof projection.updatedAt === "string" &&
      projection.updatedAt.trim().length > 0
    );
  }

  function isVerifiedAiFeedbackDraftProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    return (
      projection.objectType === "ai-feedback-draft" &&
      projection.feedbackStatus === "ready-for-teacher-review" &&
      projection.feedbackScope === "grading-review-queue" &&
      projection.reviewPolicy === "teacher-review-before-student-release" &&
      typeof projection.generatedBy === "string" &&
      projection.generatedBy.trim().length > 0 &&
      typeof projection.artifactId === "string" &&
      projection.artifactId.trim().length > 0 &&
      typeof projection.generatedAt === "string" &&
      projection.generatedAt.trim().length > 0
    );
  }

  function isVerifiedInviteCodeDraftProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    return (
      projection.objectType === "invite-code-draft" &&
      projection.draftStatus === "generated" &&
      projection.invitePolicy === "teacher-review-before-publication" &&
      typeof projection.inviteCode === "string" &&
      projection.inviteCode.trim().length > 0 &&
      typeof projection.joinUrl === "string" &&
      projection.joinUrl.trim().length > 0 &&
      typeof projection.generatedBy === "string" &&
      projection.generatedBy.trim().length > 0 &&
      typeof projection.generatedAt === "string" &&
      projection.generatedAt.trim().length > 0
    );
  }

  function isVerifiedEnrollmentAccessProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    return (
      projection.objectType === "enrollment-access" &&
      projection.publicationStatus === "published" &&
      projection.enrollmentPolicy === "teacher-confirmed-course-scope" &&
      typeof projection.inviteCode === "string" &&
      projection.inviteCode.trim().length > 0 &&
      typeof projection.joinUrl === "string" &&
      projection.joinUrl.trim().length > 0 &&
      typeof projection.publishedBy === "string" &&
      projection.publishedBy.trim().length > 0 &&
      typeof projection.publishedAt === "string" &&
      projection.publishedAt.trim().length > 0
    );
  }

  function isVerifiedExportManifestProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    const expectedDatasetScopes = [
      "learning-records",
      "chat-threads",
      "grades",
      "activities",
    ];
    return (
      projection.objectType === "export-manifest" &&
      projection.exportStatus === "generated" &&
      projection.exportPolicy === "redacted-teacher-export-manifest" &&
      typeof projection.createdBy === "string" &&
      projection.createdBy.trim().length > 0 &&
      typeof projection.manifestId === "string" &&
      projection.manifestId.trim().length > 0 &&
      typeof projection.createdAt === "string" &&
      projection.createdAt.trim().length > 0 &&
      Array.isArray(projection.datasetScopes) &&
      expectedDatasetScopes.every((scope) => projection.datasetScopes?.includes(scope))
    );
  }

  function isVerifiedRedactionValidationProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    const expectedCheckedScopes = [
      "student-private-notes",
      "credentials",
      "local-paths",
    ];
    return (
      projection.objectType === "redaction-validation" &&
      projection.validationStatus === "passed" &&
      projection.validationPolicy === "exclude-private-and-secret-fields" &&
      typeof projection.validatedBy === "string" &&
      projection.validatedBy.trim().length > 0 &&
      typeof projection.validatedAt === "string" &&
      projection.validatedAt.trim().length > 0 &&
      Array.isArray(projection.checkedScopes) &&
      expectedCheckedScopes.every((scope) => projection.checkedScopes?.includes(scope))
    );
  }

  function getInlineDomainProjectionSemanticMismatchMessage(
    operationId: TeachingOperationId,
    actionSlot: "primary" | "secondary",
    locale: Locale,
  ) {
    if (operationId === "course-settings" && actionSlot === "primary") {
      return localizedText(TEACHING_COURSE_SETTINGS_READBACK_MISMATCH_MESSAGE, locale);
    }
    if (operationId === "course-settings" && actionSlot === "secondary") {
      return localizedText(
        TEACHING_STUDENT_PREVIEW_SESSION_READBACK_MISMATCH_MESSAGE,
        locale,
      );
    }
    if (operationId === "students" && actionSlot === "primary") {
      return localizedText(TEACHING_STUDENT_ROSTER_READBACK_MISMATCH_MESSAGE, locale);
    }
    if (operationId === "students" && actionSlot === "secondary") {
      return localizedText(TEACHING_GROUP_SUGGESTIONS_READBACK_MISMATCH_MESSAGE, locale);
    }
    if (operationId === "knowledge-base" && actionSlot === "primary") {
      return localizedText(TEACHING_KNOWLEDGE_INDEX_READBACK_MISMATCH_MESSAGE, locale);
    }
    if (operationId === "knowledge-base" && actionSlot === "secondary") {
      return localizedText(
        TEACHING_RESOURCE_REVIEW_ITEM_READBACK_MISMATCH_MESSAGE,
        locale,
      );
    }
    if (operationId === "dashboard" && actionSlot === "primary") {
      return localizedText(TEACHING_DASHBOARD_STATE_READBACK_MISMATCH_MESSAGE, locale);
    }
    if (operationId === "dashboard" && actionSlot === "secondary") {
      return localizedText(
        TEACHING_DASHBOARD_SNAPSHOT_READBACK_MISMATCH_MESSAGE,
        locale,
      );
    }
    if (operationId === "content" && actionSlot === "primary") {
      return localizedText(TEACHING_COURSE_CONTENT_READBACK_MISMATCH_MESSAGE, locale);
    }
    if (operationId === "content" && actionSlot === "secondary") {
      return localizedText(TEACHING_UNIT_DRAFT_READBACK_MISMATCH_MESSAGE, locale);
    }
    if (operationId === "agents" && actionSlot === "primary") {
      return localizedText(TEACHING_AGENT_PLAN_READBACK_MISMATCH_MESSAGE, locale);
    }
    if (operationId === "agents" && actionSlot === "secondary") {
      return localizedText(
        TEACHING_PERMISSION_PREFLIGHT_READBACK_MISMATCH_MESSAGE,
        locale,
      );
    }
    if (operationId === "admins" && actionSlot === "primary") {
      return localizedText(TEACHING_ADMIN_SETTINGS_READBACK_MISMATCH_MESSAGE, locale);
    }
    if (operationId === "admins" && actionSlot === "secondary") {
      return localizedText(
        TEACHING_COLLABORATION_INVITE_NOTIFICATION_READBACK_MISMATCH_MESSAGE,
        locale,
      );
    }
    if (operationId === "quiz-board" && actionSlot === "primary") {
      return localizedText(TEACHING_QUIZ_BOARD_STATE_READBACK_MISMATCH_MESSAGE, locale);
    }
    if (operationId === "quiz-board" && actionSlot === "secondary") {
      return localizedText(
        TEACHING_QUIZ_ITEM_REVIEW_READBACK_MISMATCH_MESSAGE,
        locale,
      );
    }
    if (operationId === "grading" && actionSlot === "primary") {
      return localizedText(TEACHING_GRADING_QUEUE_READBACK_MISMATCH_MESSAGE, locale);
    }
    if (operationId === "grading" && actionSlot === "secondary") {
      return localizedText(
        TEACHING_AI_FEEDBACK_DRAFT_READBACK_MISMATCH_MESSAGE,
        locale,
      );
    }
    if (operationId === "data-export" && actionSlot === "primary") {
      return localizedText(TEACHING_EXPORT_MANIFEST_READBACK_MISMATCH_MESSAGE, locale);
    }
    if (operationId === "data-export" && actionSlot === "secondary") {
      return localizedText(
        TEACHING_REDACTION_VALIDATION_READBACK_MISMATCH_MESSAGE,
        locale,
      );
    }
    return localizedText(TEACHING_OPERATION_AUDIT_FAILED_MESSAGE, locale);
  }

  async function queueInlineWorkspaceAuditAlertNotifications(
    operationId: TeachingOperationId,
    notificationRoute?: string,
  ) {
    const route = notificationRoute ?? "/api/teaching/operations/audit/alerts/notifications";
    setInlineWorkspaceAlertNotificationStatuses((currentStatuses) => ({
      ...currentStatuses,
      [operationId]: {
        status: "pending",
      },
    }));

    try {
      const response = await fetch(route, {
        method: "POST",
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        const payload = await readJsonPayload<InlineTeachingOperationErrorResponse>(response);
        setInlineWorkspaceAlertNotificationStatuses((currentStatuses) => ({
          ...currentStatuses,
          [operationId]: {
            status: "failed",
            message: createAlertNotificationFailureStatus(payload, locale),
          },
        }));
        return;
      }
      const dispatch =
        (await response.json()) as InlineTeachingOperationAuditAlertNotificationResponse;
      const notificationCount = dispatch.notificationCount ?? 0;
      const readbackResponse = await fetch(route, {
        method: "GET",
        headers: { accept: "application/json" },
      });
      if (!readbackResponse.ok) {
        const payload =
          await readJsonPayload<InlineTeachingOperationErrorResponse>(readbackResponse);
        setInlineWorkspaceAlertNotificationStatuses((currentStatuses) => ({
          ...currentStatuses,
          [operationId]: {
            status: "failed",
            message: createAlertNotificationFailureStatus(payload, locale),
          },
        }));
        return;
      }
      const readback =
        (await readbackResponse.json()) as InlineTeachingOperationAuditAlertNotificationResponse;
      const readbackCount = readback.recordCount ?? readback.notifications?.length ?? 0;
      if (notificationCount > 0 && readbackCount <= 0) {
        throw new Error("Teaching operation alert notification readback was empty.");
      }
      setInlineWorkspaceAlertNotificationStatuses((currentStatuses) => ({
        ...currentStatuses,
        [operationId]: {
          status: readbackCount > 0 ? "verified" : "clear",
          notificationCount: readbackCount,
        },
      }));
    } catch {
      setInlineWorkspaceAlertNotificationStatuses((currentStatuses) => ({
        ...currentStatuses,
        [operationId]: {
          status: "failed",
          message: localizedText(TEACHING_OPERATION_ALERT_NOTIFICATION_FAILED_MESSAGE, locale),
        },
      }));
    }
  }

  async function runInlineWorkspaceRollback(input: {
    operationId: TeachingOperationId;
    recordId: string;
    courseId?: string;
  }) {
    setInlineWorkspaceRollbackStatuses((currentStatuses) => ({
      ...currentStatuses,
      [input.operationId]: {
        status: "pending",
        targetRecordId: input.recordId,
      },
    }));

    try {
      const response = await fetch(
        `/api/teaching/operations/records/${encodeURIComponent(input.recordId)}/rollback`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-inline-teaching-operation-rollback",
          },
          body: JSON.stringify({
            action: "rollback-teaching-operation-record",
            rollbackReason: "teacher-inline-workspace-rollback",
            ...(input.courseId ? { courseId: input.courseId } : {}),
          }),
        },
      );
      if (!response.ok) {
        const payload = await readJsonPayload<InlineTeachingOperationErrorResponse>(response);
        setInlineWorkspaceRollbackStatuses((currentStatuses) => ({
          ...currentStatuses,
          [input.operationId]: {
            status: "failed",
            targetRecordId: input.recordId,
            message: createRollbackFailureStatus(payload, locale),
          },
        }));
        return;
      }
      const payload = (await response.json()) as {
        receipt?: {
          targetRecordId?: string;
          status?: string;
        };
      };
      if (payload.receipt?.status !== "persisted") {
        throw new Error("Teaching operation rollback receipt was not persisted.");
      }
      setInlineWorkspaceRollbackStatuses((currentStatuses) => ({
        ...currentStatuses,
        [input.operationId]: {
          status: "rolled-back",
          targetRecordId: payload.receipt?.targetRecordId ?? input.recordId,
        },
      }));
    } catch {
      setInlineWorkspaceRollbackStatuses((currentStatuses) => ({
        ...currentStatuses,
        [input.operationId]: {
          status: "failed",
          targetRecordId: input.recordId,
          message: localizedText(TEACHING_OPERATION_ROLLBACK_FAILED_MESSAGE, locale),
        },
      }));
    }
  }

  async function runInviteWorkspaceAction(actionSlot: "primary" | "secondary") {
    const operationId: TeachingOperationId = "invite-code";
    const attemptId = createInlineWorkspaceAttemptId(operationId);
    setInviteWorkspaceStatus(TEACHING_OPERATION_SAVE_PENDING_MESSAGE);

    try {
      const courseId = selectedCourseAction?.courseId ?? courseCards[0]?.id;
      const sourceAction = "inline-teaching-workspace";
      const targetClassId = resolveInviteWorkspaceTargetClassId(courseId);
      const response = await fetch("/api/teaching/operations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operationId,
          actionSlot,
          courseId,
          ...(targetClassId ? { targetClassId } : {}),
          sourceAction,
          idempotencyKey: createTeachingOperationIdempotencyKey({
            operationId,
            actionSlot,
            courseId,
            sourceAction,
          }),
        }),
      });

      if (!response.ok) {
        const payload = await readJsonPayload<InlineInviteOperationResponse>(response);
        if (!isCurrentInlineWorkspaceAttempt(operationId, attemptId)) {
          return;
        }
        setInviteWorkspaceStatus(
          createInvitePartialFailureStatus(payload?.partialFailure) ??
            createInviteWorkspaceFailureStatus(payload),
        );
        return;
      }

      const payload = (await response.json()) as InlineInviteOperationResponse;
      if (!isCurrentInlineWorkspaceAttempt(operationId, attemptId)) {
        return;
      }
      const receipt = payload.receipt;
      if (!receipt) {
        setInviteWorkspaceStatus(TEACHING_OPERATION_SAVE_FAILED_MESSAGE);
        return;
      }
      if (
        actionSlot === "secondary" &&
        !isPersistedInvitePublicationReceipt(payload.classInvitePublicationReceipt, {
          courseId,
          targetClassId,
        })
      ) {
        setInviteWorkspaceStatus(INVITE_PUBLICATION_RECEIPT_MISSING_MESSAGE);
        return;
      }
      const publishedClassId =
        actionSlot === "secondary"
          ? payload.classInvitePublicationReceipt?.classId?.trim() || targetClassId
          : targetClassId;

      const verifiedStatusMessage =
        receipt.displayMessage ??
        (actionSlot === "primary" ? INVITE_GENERATED_MESSAGE : INVITE_PUBLISHED_MESSAGE);
      const inviteArtifact = receipt.artifacts?.find(
        (artifact) => artifact.kind === "invite-code" && typeof artifact.code === "string",
      );

      if (payload.traceId) {
        const recordId = receipt.receiptId;
        if (!recordId) {
          setInviteWorkspaceStatus(TEACHING_OPERATION_AUDIT_FAILED_MESSAGE);
          return;
        }
        setInviteWorkspaceStatus(TEACHING_OPERATION_AUDIT_PENDING_MESSAGE);
        void readInviteWorkspaceAuditEvidence({
          courseId: receipt.courseId ?? courseId,
          recordId,
          traceId: payload.traceId,
          verifiedStatusMessage,
          inviteArtifact,
          attemptId,
          actionSlot,
          targetClassId: publishedClassId,
        });
        return;
      }

      await applyInviteWorkspaceReceiptWithPublicationReadback({
        actionSlot,
        courseId,
        targetClassId: publishedClassId,
        inviteArtifact,
        verifiedStatusMessage,
        attemptId,
      });
    } catch {
      if (!isCurrentInlineWorkspaceAttempt(operationId, attemptId)) {
        return;
      }
      setInviteWorkspaceStatus(TEACHING_OPERATION_SAVE_FAILED_MESSAGE);
    }
  }

  async function readInviteWorkspaceAuditEvidence(input: {
    courseId?: string;
    recordId: string;
    traceId: string;
    verifiedStatusMessage: LocalizedText;
    inviteArtifact?: InlineInviteBackendArtifact;
    attemptId: number;
    actionSlot: "primary" | "secondary";
    targetClassId?: string;
  }) {
    try {
      const response = await fetch("/api/teaching/operations/audit", {
        method: "GET",
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error("Invite code audit readback failed.");
      }
      const audit = (await response.json()) as InlineTeachingOperationAuditReadbackResponse;
      if (!isCurrentInlineWorkspaceAttempt("invite-code", input.attemptId)) {
        return;
      }
      const matchingAuditEvent = audit.auditEvents?.find((event) => {
        if (event.traceId !== input.traceId) {
          return false;
        }
        return input.courseId ? event.courseId === input.courseId : true;
      });
      const matchingRecord = audit.records?.find((record) => {
        if (record.recordId !== input.recordId) {
          return false;
        }
        return isInlineAuditRecordForAction(record, {
          courseId: input.courseId,
          operationId: "invite-code",
          actionSlot: input.actionSlot,
        });
      });
      const matchingDomainProjection = findMatchingInlineDomainProjection(
        audit.domainProjections,
        {
          courseId: input.courseId,
          operationId: "invite-code",
          actionSlot: input.actionSlot,
          recordId: input.recordId,
        },
      );
      if (!matchingAuditEvent || !matchingRecord) {
        throw new Error("Invite code audit readback did not include the saved operation.");
      }
      if (!matchingDomainProjection?.objectId || !matchingDomainProjection.objectType) {
        throw new Error("Invite code audit readback did not include the saved domain projection.");
      }
      if (
        !doesInlineDomainProjectionMatchBusinessSemantics(matchingDomainProjection, {
          operationId: "invite-code",
          actionSlot: input.actionSlot,
        })
      ) {
        setInviteWorkspaceStatus(
          input.actionSlot === "primary"
            ? INVITE_CODE_DRAFT_READBACK_MISMATCH_MESSAGE
            : INVITE_ENROLLMENT_ACCESS_READBACK_MISMATCH_MESSAGE,
        );
        return;
      }

      await applyInviteWorkspaceReceiptWithPublicationReadback({
        actionSlot: input.actionSlot,
        courseId: input.courseId,
        targetClassId: input.targetClassId,
        inviteArtifact: input.inviteArtifact,
        verifiedStatusMessage: input.verifiedStatusMessage,
        attemptId: input.attemptId,
      });
    } catch {
      if (!isCurrentInlineWorkspaceAttempt("invite-code", input.attemptId)) {
        return;
      }
      setInviteWorkspaceStatus(TEACHING_OPERATION_AUDIT_FAILED_MESSAGE);
    }
  }

  async function applyInviteWorkspaceReceiptWithPublicationReadback(input: {
    actionSlot: "primary" | "secondary";
    courseId?: string;
    targetClassId?: string;
    verifiedStatusMessage: LocalizedText;
    inviteArtifact?: InlineInviteBackendArtifact;
    attemptId: number;
  }) {
    if (input.actionSlot !== "secondary") {
      applyInviteWorkspaceReceipt({
        inviteArtifact: input.inviteArtifact,
        verifiedStatusMessage: input.verifiedStatusMessage,
      });
      return;
    }

    const publishedInviteCode = input.inviteArtifact?.code?.trim();
    if (!input.courseId || !input.targetClassId || !publishedInviteCode) {
      setInviteWorkspaceStatus(INVITE_CLASS_INVITATION_READBACK_MISMATCH_MESSAGE);
      return;
    }

    try {
      const readback = await readPersistedTeachingCourseState();
      if (!isCurrentInlineWorkspaceAttempt("invite-code", input.attemptId)) {
        return;
      }

      const readbackClass = (readback.classesByCourse[input.courseId] ?? []).find(
        (classItem) => classItem.id === input.targetClassId,
      );
      if (readbackClass?.invitationCode !== publishedInviteCode) {
        setInviteWorkspaceStatus(INVITE_CLASS_INVITATION_READBACK_MISMATCH_MESSAGE);
        return;
      }

      applyPersistedTeachingCourseReadback(readback);
      setSelectedClassInvitation(readbackClass);
      applyInviteWorkspaceReceipt({
        inviteArtifact: input.inviteArtifact,
        verifiedStatusMessage: input.verifiedStatusMessage,
      });
    } catch {
      if (isCurrentInlineWorkspaceAttempt("invite-code", input.attemptId)) {
        setInviteWorkspaceStatus(INVITE_CLASS_INVITATION_READBACK_MISMATCH_MESSAGE);
      }
    }
  }

  function applyInviteWorkspaceReceipt(input: {
    verifiedStatusMessage: LocalizedText;
    inviteArtifact?: InlineInviteBackendArtifact;
  }) {
    setInviteWorkspaceStatus(input.verifiedStatusMessage);
    if (!input.inviteArtifact?.code) {
      return;
    }
    setInviteWorkspaceCode(input.inviteArtifact.code);
    setInviteWorkspaceJoinUrl(
      typeof input.inviteArtifact.joinUrl === "string"
        ? input.inviteArtifact.joinUrl
        : createInviteJoinUrl(input.inviteArtifact.code),
    );
  }

  function resolveInviteWorkspaceTargetClassId(courseId?: string) {
    if (!courseId) {
      return undefined;
    }
    if (selectedClassInvitation?.courseId === courseId) {
      return selectedClassInvitation.id;
    }
    return courseClasses[courseId]?.[0]?.id;
  }

  async function copyInviteWorkspaceValue(value: string, successMessage: LocalizedText) {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable.");
      }
      await navigator.clipboard.writeText(value);
      setInviteWorkspaceStatus(successMessage);
    } catch {
      setInviteWorkspaceStatus(INVITE_COPY_FAILED_MESSAGE);
    }
  }

  function renderWorkspaceContext() {
    return (
      <div
        id="teacher-workspace-entry-panel"
        className="rounded-2xl border border-[var(--accent-border)] bg-[var(--accent-soft)] p-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[var(--accent)]">
              {locale === "zh-CN" ? "当前入口" : "Current entry"}：
              {localizedText(activeWorkspaceItem.title, locale)}
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              {localizedText(activeWorkspaceItem.description, locale)}
            </p>
          </div>
          {selectedCourseAction && selectedActionCourse && selectedCourseActionLabel ? (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)]">
              <p className="font-semibold">
                {locale === "zh-CN" ? "已选择课程" : "Selected course"}：
                {localizedText(selectedActionCourse.title, locale)}
              </p>
              <p className="mt-1 text-[var(--muted)]">
                {locale === "zh-CN" ? "课程操作" : "Course action"}：
                {selectedCourseActionLabel}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  function renderInlineWorkspaceActionButtons(operationId: TeachingOperationId) {
    const actionConfig = createInlineWorkspaceActionConfig(operationId, locale);
    const isSaving =
      inlineWorkspaceStatuses[operationId] ===
      localizedText(TEACHING_OPERATION_SAVE_PENDING_MESSAGE, locale);

    return (
      <div
        className="flex flex-wrap gap-2"
        data-uais-inline-workspace-actions={operationId}
      >
        <button
          type="button"
          className="inline-flex h-10 items-center gap-2 rounded-full bg-[var(--accent)] px-4 text-sm font-semibold text-white outline-none transition hover:bg-[var(--accent-strong)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-[var(--accent)] disabled:active:translate-y-0"
          disabled={isSaving}
          onClick={() => runInlineWorkspaceAction(operationId, "primary")}
        >
          <ClipboardText size={17} weight="bold" />
          {actionConfig.primaryAction}
        </button>
        <button
          type="button"
          className="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--foreground)] outline-none transition hover:bg-[var(--surface-soft)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-[var(--surface)] disabled:active:translate-y-0"
          disabled={isSaving}
          onClick={() => runInlineWorkspaceAction(operationId, "secondary")}
        >
          <ArrowRight size={16} weight="bold" />
          {actionConfig.secondaryAction}
        </button>
      </div>
    );
  }

  function renderInlineWorkspaceStatus(operationId: TeachingOperationId) {
    const actionConfig = createInlineWorkspaceActionConfig(operationId, locale);
    const message = inlineWorkspaceStatuses[operationId] ?? actionConfig.readyMessage;
    const auditStatus = inlineWorkspaceAuditStatuses[operationId];
    const alertStatus = inlineWorkspaceAlertStatuses[operationId];
    const alertNotificationStatus = inlineWorkspaceAlertNotificationStatuses[operationId];
    const rollbackStatus = inlineWorkspaceRollbackStatuses[operationId];
    const firstAlert = alertStatus?.alerts?.[0];

    return (
      <div className="mt-4 space-y-2">
        <p
          aria-live="polite"
          data-uais-inline-workspace-status={operationId}
          className="rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)] px-4 py-3 text-sm font-semibold text-[var(--accent)]"
        >
          {message}
        </p>
        {auditStatus ? (
          <div
            aria-live="polite"
            data-uais-inline-workspace-audit-status={operationId}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-3 text-sm text-[var(--muted)]"
          >
            {auditStatus.status === "verified" ? (
              <>
                <p className="font-semibold text-[var(--foreground)]">
                  {locale === "zh-CN" ? "审计读回已验证" : "Audit readback verified"}：
                  {auditStatus.traceId}
                </p>
                <p className="mt-1">
                  {locale === "zh-CN" ? "操作者" : "Actor"}：
                  {auditStatus.actorId ?? "unknown"} ·{" "}
                  {locale === "zh-CN" ? "审计事件" : "Audit events"}：
                  {auditStatus.auditEventCount ?? 0}
                </p>
                {auditStatus.authSession?.sessionId ? (
                  <p className="mt-1">
                    {locale === "zh-CN"
                      ? "签名会话已验证"
                      : "Signed session verified"}
                    ：{auditStatus.authSession.sessionId}
                  </p>
                ) : null}
                {auditStatus.domainObjectId && auditStatus.domainObjectType ? (
                  <p className="mt-1">
                    {locale === "zh-CN"
                      ? "领域对象已验证"
                      : "Domain object verified"}
                    ：{auditStatus.domainObjectType} / {auditStatus.domainObjectId}
                  </p>
                ) : null}
                {auditStatus.recordId ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="inline-flex h-9 items-center gap-2 rounded-full border border-[var(--accent-border)] bg-[var(--surface)] px-3 text-xs font-semibold text-[var(--accent)] outline-none transition hover:bg-[var(--accent-soft)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={rollbackStatus?.status === "pending" || rollbackStatus?.status === "rolled-back"}
                      onClick={() =>
                        runInlineWorkspaceRollback({
                          operationId,
                          recordId: auditStatus.recordId as string,
                          courseId: auditStatus.courseId,
                        })
                      }
                    >
                      <ArrowRight size={14} weight="bold" />
                      {locale === "zh-CN" ? "撤回本次操作" : "Roll Back This Operation"}
                    </button>
                    {rollbackStatus ? (
                      <span className="text-xs font-semibold text-[var(--muted)]">
                        {rollbackStatus.status === "rolled-back"
                          ? `${locale === "zh-CN" ? "已撤回" : "Rolled back"}：${rollbackStatus.targetRecordId}`
                          : rollbackStatus.status === "pending"
                            ? localizedText(TEACHING_OPERATION_ROLLBACK_PENDING_MESSAGE, locale)
                            : (rollbackStatus.message ??
                              localizedText(TEACHING_OPERATION_ROLLBACK_FAILED_MESSAGE, locale))}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="font-semibold">
                {auditStatus.status === "pending"
                  ? localizedText(TEACHING_OPERATION_AUDIT_PENDING_MESSAGE, locale)
                  : localizedText(TEACHING_OPERATION_AUDIT_FAILED_MESSAGE, locale)}
              </p>
            )}
          </div>
        ) : null}
        {alertStatus ? (
          <div
            aria-live="polite"
            data-uais-inline-workspace-alert-status={operationId}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-3 text-sm text-[var(--muted)]"
          >
            {alertStatus.status === "pending" ? (
              <p className="font-semibold">
                {localizedText(TEACHING_OPERATION_ALERT_PENDING_MESSAGE, locale)}
              </p>
            ) : alertStatus.status === "failed" ? (
              <p className="font-semibold text-[var(--foreground)]">
                {localizedText(TEACHING_OPERATION_ALERT_FAILED_MESSAGE, locale)}
              </p>
            ) : (
              <>
                <p className="flex items-center gap-2 font-semibold text-[var(--foreground)]">
                  <WarningCircle size={16} weight="bold" className="text-[var(--accent)]" />
                  {locale === "zh-CN" ? "教学操作告警" : "Teaching Operation Alerts"}：
                  {alertStatus.alertCount ?? 0}
                </p>
                {alertStatus.status === "attention-required" && firstAlert ? (
                  <p className="mt-1">
                    {firstAlert.reason === "missing-course-context"
                      ? locale === "zh-CN"
                        ? "缺少课程上下文"
                        : "Missing course context"
                      : locale === "zh-CN"
                        ? "告警"
                        : "Alert"}
                    ：{firstAlert.traceId ?? firstAlert.alertId ?? "unknown"}
                  </p>
                ) : null}
                {alertStatus.status === "attention-required" ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="inline-flex h-9 items-center gap-2 rounded-full border border-[var(--accent-border)] bg-[var(--surface)] px-3 text-xs font-semibold text-[var(--accent)] outline-none transition hover:bg-[var(--accent-soft)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={alertNotificationStatus?.status === "pending"}
                      onClick={() =>
                        queueInlineWorkspaceAuditAlertNotifications(
                          operationId,
                          alertStatus.notificationRoute,
                        )
                      }
                    >
                      <BellRinging size={14} weight="bold" />
                      {locale === "zh-CN" ? "通知管理员" : "Notify Admin"}
                    </button>
                    {alertNotificationStatus ? (
                      <span className="text-xs font-semibold text-[var(--muted)]">
                        {alertNotificationStatus.status === "queued"
                          ? `${locale === "zh-CN" ? "告警通知已入队" : "Alert notification queued"}：${alertNotificationStatus.notificationCount ?? 0}`
                          : alertNotificationStatus.status === "verified"
                            ? `${locale === "zh-CN" ? "告警通知读回已验证" : "Alert notification readback verified"}：${alertNotificationStatus.notificationCount ?? 0}`
                          : alertNotificationStatus.status === "pending"
                            ? localizedText(
                                TEACHING_OPERATION_ALERT_NOTIFICATION_PENDING_MESSAGE,
                                locale,
                              )
                            : alertNotificationStatus.status === "clear"
                              ? `${locale === "zh-CN" ? "告警通知已入队" : "Alert notification queued"}：0`
                              : (alertNotificationStatus.message ??
                                localizedText(
                                  TEACHING_OPERATION_ALERT_NOTIFICATION_FAILED_MESSAGE,
                                  locale,
                                ))}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  function renderCourseSettingsWorkspace() {
    return (
      <div
        className="space-y-5"
        data-uais-active-teaching-workspace="course-settings"
        data-uais-teaching-workspace-panel
      >
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_18px_42px_var(--shadow)]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-[var(--foreground)]">
                {locale === "zh-CN" ? "课程设置工作台" : "Course Settings Workspace"}
              </h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {locale === "zh-CN"
                  ? "维护课程档案、班级结构、学期节奏和学生端发布前检查。"
                  : "Maintain course profiles, class structures, term cadence, and student-facing release checks."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex h-10 items-center gap-2 rounded-full bg-[var(--accent)] px-4 text-sm font-semibold text-white outline-none transition hover:bg-[var(--accent-strong)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
                onClick={() => setIsNewCourseOpen(true)}
              >
                <Plus size={17} weight="bold" />
                {locale === "zh-CN" ? "新增课程" : "New Course"}
              </button>
              {renderInlineWorkspaceActionButtons("course-settings")}
            </div>
          </div>

          {renderWorkspaceContext()}
          {activeCourseSettingsCourse && activeCourseSettingsDraft ? (
            <div
              className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4"
              data-uais-course-settings-patch-form={activeCourseSettingsCourse.id}
            >
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
                <div className="min-w-0">
                  <label
                    htmlFor={`course-settings-name-${activeCourseSettingsCourse.id}`}
                    className="block text-sm font-semibold text-[var(--foreground)]"
                  >
                    {locale === "zh-CN" ? "课程名称" : "Course Name"}
                  </label>
                  <input
                    id={`course-settings-name-${activeCourseSettingsCourse.id}`}
                    value={activeCourseSettingsDraft.courseName}
                    className="mt-2 h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-medium text-[var(--foreground)] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
                    onChange={(event) =>
                      updateCourseSettingsDraft(activeCourseSettingsCourse, {
                        courseName: event.target.value,
                      })
                    }
                  />
                </div>
                <div className="min-w-0">
                  <label
                    htmlFor={`course-settings-semester-${activeCourseSettingsCourse.id}`}
                    className="block text-sm font-semibold text-[var(--foreground)]"
                  >
                    {locale === "zh-CN" ? "学期安排" : "Semester"}
                  </label>
                  <input
                    id={`course-settings-semester-${activeCourseSettingsCourse.id}`}
                    value={activeCourseSettingsDraft.semester}
                    className="mt-2 h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-medium text-[var(--foreground)] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
                    onChange={(event) =>
                      updateCourseSettingsDraft(activeCourseSettingsCourse, {
                        semester: event.target.value,
                      })
                    }
                  />
                </div>
                <div className="min-w-0 lg:col-span-2">
                  <label
                    htmlFor={`course-settings-description-${activeCourseSettingsCourse.id}`}
                    className="block text-sm font-semibold text-[var(--foreground)]"
                  >
                    {locale === "zh-CN" ? "课程说明" : "Course Description"}
                  </label>
                  <textarea
                    id={`course-settings-description-${activeCourseSettingsCourse.id}`}
                    value={activeCourseSettingsDraft.description}
                    rows={3}
                    className="mt-2 w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-medium leading-6 text-[var(--foreground)] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
                    onChange={(event) =>
                      updateCourseSettingsDraft(activeCourseSettingsCourse, {
                        description: event.target.value,
                      })
                    }
                  />
                </div>
              </div>
            </div>
          ) : null}
          {renderInlineWorkspaceStatus("course-settings")}

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {courseCards.map((course) => (
              <article
                key={course.id}
                className={[
                  "rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4",
                  course.id.startsWith("teacher-new-") ? "md:col-span-2" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-semibold text-[var(--foreground)]">
                      {localizedText(course.title, locale)}
                    </h3>
                    <p className="mt-1 text-sm font-medium text-[var(--accent)]">
                      {localizedText(course.status, locale)}
                    </p>
                  </div>
                  <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-sm font-semibold text-[var(--foreground)]">
                    {course.students}
                  </span>
                </div>
                <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
                  {localizedText(course.currentFocus, locale)}
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Link
                    href={getTeachingCourseActionHref(
                      "course-settings",
                      course.id,
                      "manage",
                    )}
                    className="inline-flex h-10 items-center gap-2 rounded-full bg-[var(--accent)] px-4 text-sm font-semibold text-white outline-none transition hover:bg-[var(--accent-strong)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-elevated)]"
                  >
                    {t.common.manageCourse}
                    <ArrowRight size={16} weight="bold" />
                  </Link>
                  <Link
                    href={getTeachingCourseActionHref("content", course.id, "continue")}
                    className="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--foreground)] outline-none transition hover:bg-[var(--surface-soft)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  >
                    {t.teaching.continue}
                  </Link>
                </div>
                <CourseClassManager
                  classes={courseClasses[course.id] ?? []}
                  membershipsByClass={classMemberships}
                  membershipApprovalStatuses={membershipApprovalStatuses}
                  course={course}
                  locale={locale}
                  onApproveMembership={approveClassMembership}
                  onNewClass={() => setNewClassCourseId(course.id)}
                  onOpenInvitation={setSelectedClassInvitation}
                />
              </article>
            ))}
          </div>
        </section>
      </div>
    );
  }

  function renderAgentWorkspace() {
    return (
      <div
        className="space-y-5"
        data-uais-active-teaching-workspace="agents"
        data-uais-teaching-workspace-panel
      >
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_18px_42px_var(--shadow)]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-[var(--foreground)]">
                {locale === "zh-CN" ? "智能体配置工作台" : "Agent Setup Workspace"}
              </h2>
              <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                {locale === "zh-CN"
                  ? "集中配置课程智能体、服务端权限、教师声音样本和课件配音工作流。"
                  : "Configure course agents, server permissions, teacher voice samples, and PPT narration workflows."}
              </p>
            </div>
            {renderInlineWorkspaceActionButtons("agents")}
          </div>

          <div className="mt-5">
            {renderWorkspaceContext()}
          </div>
          {renderInlineWorkspaceStatus("agents")}

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {["研究助教", "方法顾问", "数学助教", "写作助手"].map((name) => (
              <div
                key={name}
                className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4"
              >
                <p className="font-semibold text-[var(--foreground)]">
                  {locale === "zh-CN" ? name : agentEnglishName(name)}
                </p>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                  {t.common.templateReady}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_18px_42px_var(--shadow)]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-[var(--foreground)]">
                {locale === "zh-CN" ? "企业级智能编排" : "Enterprise AI Orchestration"}
              </h2>
              <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                {locale === "zh-CN"
                  ? "采用开放课堂智能系统风格的导演式智能体循环，按能力隔离模型与凭据。"
                  : "Uses an OpenMAIC-style director-agent loop with model and credential boundaries by capability."}
              </p>
            </div>
            <span className="inline-flex h-9 items-center rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 text-sm font-semibold text-[var(--accent)]">
              {locale === "zh-CN" ? "服务端密钥边界" : "Server-side key boundary"}
            </span>
          </div>

          <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-3 text-sm font-medium text-[var(--foreground)]">
            {locale === "zh-CN" ? "配置检查接口已就绪" : "Readiness API contract is ready"}
          </div>

          <TeacherPptNarrationWorkflow
            locale={locale}
            teacherActorId={authenticatedTeacherActorId}
          />

          <AiOpsWorkbench locale={locale} teacherActorId={authenticatedTeacherActorId} />

          <div className="mt-5 grid gap-3 lg:grid-cols-3">
            <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
              <p className="text-xs font-semibold uppercase text-[var(--muted)]">
                {locale === "zh-CN" ? "文字推理" : "Text reasoning"}
              </p>
              <h3 className="mt-2 text-base font-semibold text-[var(--foreground)]">
                {locale === "zh-CN" ? "深度求索" : "DeepSeek"}
              </h3>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                {locale === "zh-CN" ? "文本推理模型" : textReasoningProvider.defaultModel}
              </p>
            </article>

            <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
              <p className="text-xs font-semibold uppercase text-[var(--muted)]">
                {locale === "zh-CN" ? "多模态生成" : "Multimodal generation"}
              </p>
              <h3 className="mt-2 text-base font-semibold text-[var(--foreground)]">
                {locale === "zh-CN" ? "阿里千问 / 百炼" : "Alibaba Qwen / Model Studio"}
              </h3>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                {locale === "zh-CN" ? "多模态生成模型" : multimodalProvider.defaultModel}
              </p>
            </article>

            <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
              <p className="text-xs font-semibold uppercase text-[var(--muted)]">
                {locale === "zh-CN" ? "课件语音" : "Courseware voice"}
              </p>
              <h3 className="mt-2 text-base font-semibold text-[var(--foreground)]">
                {locale === "zh-CN" ? "10 秒教师声音复刻" : "10-second teacher voice clone"}
              </h3>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                {locale === "zh-CN" ? "课件配音合同已就绪" : "PPT narration contract ready"}
              </p>
            </article>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-3 text-sm text-[var(--muted)]">
              <span className="font-semibold text-[var(--foreground)]">
                {locale === "zh-CN" ? "声音任务" : "Voice job"}
              </span>
              <span className="ml-2">
                {locale === "zh-CN"
                  ? formatWorkflowStatus(voiceCloneJob.status, locale)
                  : voiceCloneJob.status}
              </span>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-3 text-sm text-[var(--muted)]">
              <span className="font-semibold text-[var(--foreground)]">
                {locale === "zh-CN" ? "课件配音" : "PPT narration"}
              </span>
              <span className="ml-2">
                {pptNarrationJob.slideCount}
                {locale === "zh-CN" ? " 页脚本" : " slide script"}
              </span>
            </div>
          </div>
        </section>
      </div>
    );
  }

  function renderEnterpriseWorkspace() {
    const config = createEnterpriseWorkspaceConfig(
      activeWorkspaceItemId as TeachingOperationId,
      locale,
    );
    const Icon = dashboardIcons[config.id as keyof typeof dashboardIcons] ?? SquaresFour;

    return (
      <div
        className="space-y-5"
        data-uais-active-teaching-workspace={config.id}
        data-uais-teaching-workspace-panel
      >
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_18px_42px_var(--shadow)]">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
                <Icon size={23} weight="duotone" />
              </span>
              <div>
                <p className="text-sm font-semibold text-[var(--accent)]">{config.subtitle}</p>
                <h2 className="mt-1 text-xl font-semibold text-[var(--foreground)]">
                  {config.title}
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
                  {config.description}
                </p>
              </div>
            </div>
            {config.id === "invite-code" ? (
              <span className="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-4 text-sm font-semibold text-[var(--accent)]">
                <QrCode size={17} weight="duotone" />
                {locale === "zh-CN" ? "当前页可操作" : "Operable here"}
              </span>
            ) : (
              renderInlineWorkspaceActionButtons(config.id)
            )}
          </div>

          <div className="mt-5">
            {renderWorkspaceContext()}
          </div>
          {config.id === "invite-code" ? null : renderInlineWorkspaceStatus(config.id)}

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {config.metrics.map((metric) => (
              <article
                key={metric.label}
                className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4"
              >
                <p className="text-xs font-semibold uppercase text-[var(--muted)]">
                  {metric.label}
                </p>
                <p className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
                  {metric.value}
                </p>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{metric.note}</p>
              </article>
            ))}
          </div>

          {config.id === "invite-code" ? renderInviteCodeWorkspaceTools() : null}
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_18px_42px_var(--shadow)]">
            <h3 className="text-lg font-semibold text-[var(--foreground)]">
              {locale === "zh-CN" ? "业务流程" : "Workflow"}
            </h3>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {config.lanes.map((lane) => (
                <article
                  key={lane.title}
                  className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4"
                >
                  <h4 className="font-semibold text-[var(--foreground)]">{lane.title}</h4>
                  <div className="mt-3 space-y-2">
                    {lane.items.map((item) => (
                      <p
                        key={item}
                        className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-sm text-[var(--muted)]"
                      >
                        {item}
                      </p>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>

          <aside className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_18px_42px_var(--shadow)]">
            <h3 className="text-lg font-semibold text-[var(--foreground)]">
              {locale === "zh-CN" ? "最近记录" : "Recent Records"}
            </h3>
            <div className="mt-4 space-y-3">
              {config.records.map((record) => (
                <p
                  key={record}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-3 text-sm leading-6 text-[var(--muted)]"
                >
                  {record}
                </p>
              ))}
            </div>
          </aside>
        </section>
      </div>
    );
  }

  function renderInviteCodeWorkspaceTools() {
    const metadata = [
      {
        label: locale === "zh-CN" ? "有效期" : "Valid Until",
        value: INVITE_VALID_UNTIL,
        note: locale === "zh-CN" ? "到期后自动停止加入" : "Joining stops automatically after expiry",
      },
      {
        label: locale === "zh-CN" ? "班级范围" : "Class Scope",
        value: locale === "zh-CN" ? "班级" : "Class",
        note: locale === "zh-CN" ? "仅开放给当前教学班" : "Limited to the selected teaching class",
      },
      {
        label: locale === "zh-CN" ? "加入上限" : "Join Limit",
        value: locale === "zh-CN" ? `${INVITE_JOIN_LIMIT} 人` : `${INVITE_JOIN_LIMIT} students`,
        note: locale === "zh-CN" ? "超过上限需教师确认" : "Teacher confirmation required beyond the limit",
      },
    ];

    return (
      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <QrCode size={24} weight="duotone" className="text-[var(--accent)]" />
                <p className="text-sm font-semibold text-[var(--muted)]">
                  {locale === "zh-CN" ? "当前班级邀请码" : "Current class invite code"}
                </p>
              </div>
              <p className="mt-3 text-4xl font-semibold tracking-normal text-[var(--foreground)]">
                {inviteWorkspaceCode}
              </p>
              <p className="mt-2 break-all text-sm leading-6 text-[var(--muted)]">
                {inviteWorkspaceJoinUrl}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex h-10 items-center gap-2 rounded-full bg-[var(--accent)] px-4 text-sm font-semibold text-white outline-none transition hover:bg-[var(--accent-strong)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-elevated)]"
                onClick={() => void runInviteWorkspaceAction("primary")}
              >
                <QrCode size={17} weight="bold" />
                {locale === "zh-CN" ? "生成新邀请码" : "Generate New Invite Code"}
              </button>
              <button
                type="button"
                className="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--foreground)] outline-none transition hover:bg-[var(--surface-soft)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                onClick={() => void runInviteWorkspaceAction("secondary")}
              >
                <ClipboardText size={17} weight="duotone" />
                {locale === "zh-CN" ? "确认发布邀请码" : "Publish Invite Code"}
              </button>
              <button
                type="button"
                className="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--foreground)] outline-none transition hover:bg-[var(--surface-soft)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                onClick={() =>
                  void copyInviteWorkspaceValue(inviteWorkspaceCode, INVITE_CODE_COPIED_MESSAGE)
                }
              >
                <ClipboardText size={17} weight="duotone" />
                {locale === "zh-CN" ? "复制邀请码" : "Copy Invite Code"}
              </button>
              <button
                type="button"
                className="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--foreground)] outline-none transition hover:bg-[var(--surface-soft)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                onClick={() =>
                  void copyInviteWorkspaceValue(inviteWorkspaceJoinUrl, INVITE_LINK_COPIED_MESSAGE)
                }
              >
                <ArrowRight size={17} weight="bold" />
                {locale === "zh-CN" ? "复制加入链接" : "Copy Join Link"}
              </button>
            </div>
          </div>

          <p
            aria-live="polite"
            className="mt-4 rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)] px-4 py-3 text-sm font-semibold text-[var(--accent)]"
          >
            {localizedText(inviteWorkspaceStatus, locale)}
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {metadata.map((item) => (
              <article
                key={item.label}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"
              >
                <p className="text-xs font-semibold uppercase text-[var(--muted)]">
                  {item.label}
                </p>
                <p className="mt-2 text-lg font-semibold text-[var(--foreground)]">
                  {item.value}
                </p>
                <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{item.note}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
          <InlineInvitationQrPattern
            invitationCode={inviteWorkspaceCode}
            seed={`${inviteWorkspaceCode}-${inviteWorkspaceJoinUrl}`}
          />
        </div>
      </div>
    );
  }

  function renderActiveWorkspacePanel() {
    if (activeWorkspaceItemId === "course-settings") {
      return renderCourseSettingsWorkspace();
    }

    if (activeWorkspaceItemId === "agents") {
      return renderAgentWorkspace();
    }

    return renderEnterpriseWorkspace();
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_18px_48px_var(--shadow)] md:p-7">
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--foreground)] sm:text-4xl">
          {t.teaching.title}
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--muted)]">
          {t.teaching.summary}
        </p>
      </section>

      {persistedCourseLoadError ? (
        <section
          role="alert"
          className="rounded-2xl border border-[var(--accent-border)] bg-[var(--accent-soft)] p-4 text-sm font-semibold leading-6 text-[var(--accent)]"
        >
          <p>{localizedText(TEACHING_COURSE_LOAD_FAILED_MESSAGE, locale)}</p>
          <p className="mt-1 text-[var(--foreground)]">{persistedCourseLoadError}</p>
        </section>
      ) : null}

      <section className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <aside className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[0_18px_42px_var(--shadow)]">
          <h2 className="px-2 text-sm font-semibold text-[var(--muted)]">
            {t.teaching.operations}
          </h2>
          <div className="mt-3 space-y-2">
            {teacherSidebarItems.map((item) => {
              const Icon =
                dashboardIcons[item.id as keyof typeof dashboardIcons] ?? SquaresFour;
              const active = item.id === activeWorkspaceItemId;
              return (
                <Link
                  key={item.id}
                  href={getTeachingOperationHref(item.id)}
                  aria-controls="teacher-workspace-entry-panel"
                  aria-current={active ? "page" : undefined}
                  className={[
                    "flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left outline-none transition active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                    active
                      ? "border-[var(--accent-border)] bg-[var(--accent-soft)]"
                      : "border-transparent hover:border-[var(--border)] hover:bg-[var(--surface-soft)]",
                  ].join(" ")}
                  onClick={(event) => {
                    event.preventDefault();
                    openWorkspaceItem(item.id);
                  }}
                >
                  <span
                    className={[
                      "flex size-9 shrink-0 items-center justify-center rounded-2xl",
                      active
                        ? "bg-[var(--surface)] text-[var(--accent)]"
                        : "bg-[var(--accent-soft)] text-[var(--foreground)]",
                    ].join(" ")}
                  >
                    <Icon size={18} weight="duotone" />
                  </span>
                  <span
                    className={[
                      "block text-base font-semibold",
                      active ? "text-[var(--accent)]" : "text-[var(--foreground)]",
                    ].join(" ")}
                  >
                    {localizedText(item.title, locale)}
                  </span>
                </Link>
              );
            })}
          </div>
        </aside>

        {renderActiveWorkspacePanel()}
      </section>

      {isNewCourseOpen ? (
        <NewCourseDialog
          locale={locale}
          teacherActorId={authenticatedTeacherActorId}
          onCancel={() => setIsNewCourseOpen(false)}
          onCreate={createCourseFromDraft}
        />
      ) : null}
      {newClassCourse ? (
        <NewClassDialog
          course={newClassCourse}
          locale={locale}
          onCancel={() => setNewClassCourseId(undefined)}
          onCreate={(className) => createClassForCourse(newClassCourse.id, className)}
        />
      ) : null}
      {selectedClassInvitation ? (
        <ClassInvitationDialog
          classItem={selectedClassInvitation}
          locale={locale}
          onClose={() => setSelectedClassInvitation(undefined)}
        />
      ) : null}
    </div>
  );
}

function CourseClassManager({
  course,
  classes,
  membershipsByClass,
  membershipApprovalStatuses,
  locale,
  onApproveMembership,
  onNewClass,
  onOpenInvitation,
}: {
  course: TeacherCourse;
  classes: TeacherClassItem[];
  membershipsByClass: Record<string, TeacherClassMembershipItem[]>;
  membershipApprovalStatuses: Record<string, string>;
  locale: Locale;
  onApproveMembership: (
    classItem: TeacherClassItem,
    membership: TeacherClassMembershipItem,
  ) => void;
  onNewClass: () => void;
  onOpenInvitation: (classItem: TeacherClassItem) => void;
}) {
  const courseTitle = localizedText(course.title, locale);

  return (
    <div className="mt-5 border-t border-[var(--border)] pt-4">
      <button
        type="button"
        aria-label={
          locale === "zh-CN" ? `为${courseTitle}新建班级` : `New class for ${courseTitle}`
        }
        className="inline-flex h-11 items-center gap-2 rounded-full bg-gradient-to-r from-[#5db1ff] to-[#635bff] px-5 text-base font-semibold text-white shadow-[0_12px_28px_rgba(83,115,255,0.24)] outline-none transition hover:shadow-[0_16px_34px_rgba(83,115,255,0.32)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[#2f7cff] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-elevated)]"
        onClick={onNewClass}
      >
        <Plus size={21} weight="bold" />
        {locale === "zh-CN" ? "新建班级" : "New class"}
      </button>

      {classes.length > 0 ? (
        <div className="mt-4 space-y-3">
          {classes.map((classItem) => {
            const pendingMemberships = (membershipsByClass[classItem.id] ?? []).filter(
              (membership) => membership.membershipStatus === "pending-teacher-review",
            );
            const visibleApprovalMessages = (membershipsByClass[classItem.id] ?? [])
              .map((membership) => membershipApprovalStatuses[membership.id])
              .filter((message): message is string => Boolean(message));

            return (
              <div key={classItem.id} className="space-y-2">
                <div className="flex min-h-[82px] w-full flex-col gap-4 rounded-xl border border-[#e6eaf2] bg-white px-4 py-3 text-left text-[#1d2433] shadow-[0_12px_28px_rgba(46,58,91,0.06)] sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="text-[#aab2c4]" aria-hidden="true">
                      ⋮⋮
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-base font-semibold text-[#252a3a]">
                        <span className="truncate">{classItem.name}</span>
                        <QrCode size={18} weight="duotone" className="shrink-0 text-[#c4cad8]" />
                      </span>
                      <span className="mt-2 flex flex-wrap gap-x-7 gap-y-1 text-sm font-medium text-[#8b92a4]">
                        <span>
                          {locale === "zh-CN" ? "学生：" : "Students:"}
                          {classItem.students}
                        </span>
                        <span>{classItem.semester}</span>
                      </span>
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-3">
                    <Link
                      href={createTeachingClassActionHref("students", classItem, "enter-class")}
                      aria-label={
                        locale === "zh-CN"
                          ? `进入${classItem.name}`
                          : `Enter ${classItem.name}`
                      }
                      className="inline-flex h-9 items-center gap-2 rounded-full border border-[#7eb1ff] px-4 text-sm font-medium text-[#2f7cff] outline-none transition hover:bg-[#f4f8ff] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[#2f7cff]"
                    >
                      <UsersThree size={16} weight="bold" />
                      {locale === "zh-CN" ? "进入班级" : "Take class"}
                    </Link>
                    <Link
                      href={createTeachingClassActionHref(
                        "quiz-board",
                        classItem,
                        "activity-list",
                      )}
                      aria-label={
                        locale === "zh-CN"
                          ? `查看${classItem.name}活动列表`
                          : `View activity list for ${classItem.name}`
                      }
                      className="inline-flex h-9 items-center gap-2 rounded-full bg-gradient-to-r from-[#78b7ff] to-[#635bff] px-4 text-sm font-medium text-white shadow-[0_8px_18px_rgba(83,115,255,0.24)] outline-none transition hover:shadow-[0_10px_22px_rgba(83,115,255,0.3)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[#2f7cff]"
                    >
                      <ClipboardText size={16} weight="bold" />
                      {locale === "zh-CN" ? "活动列表" : "Activity List"}
                    </Link>
                    <button
                      type="button"
                      aria-label={
                        locale === "zh-CN"
                          ? `打开${classItem.name}的邀请码`
                          : `Open invitation QR for ${classItem.name}`
                      }
                      title={
                        locale === "zh-CN"
                          ? `打开${classItem.name}的邀请码`
                          : `Open invitation QR for ${classItem.name}`
                      }
                      className="grid size-9 place-items-center rounded-full border border-[#e1e7f2] text-[#7b8499] outline-none transition hover:border-[#7eb1ff] hover:bg-[#f4f8ff] hover:text-[#2f7cff] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[#2f7cff]"
                      onClick={() => onOpenInvitation(classItem)}
                    >
                      <QrCode size={18} weight="duotone" />
                    </button>
                  </div>
                </div>

                {pendingMemberships.length > 0 || visibleApprovalMessages.length > 0 ? (
                  <div className="rounded-xl border border-[#f5d38a] bg-[#fff9ec] px-4 py-3 text-sm text-[#6f4c12]">
                    {pendingMemberships.length > 0 ? (
                      <div className="space-y-2">
                        {pendingMemberships.map((membership) => {
                          const approvalStatus = membershipApprovalStatuses[membership.id];
                          const isApproving =
                            approvalStatus ===
                            localizedText(MEMBERSHIP_APPROVAL_PENDING_MESSAGE, locale);

                          return (
                            <div
                              key={membership.id}
                              className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <span className="font-semibold">
                                {locale === "zh-CN"
                                  ? `${membership.studentDisplayName} 等待加入`
                                  : `${membership.studentDisplayName} is waiting to join`}
                              </span>
                              <button
                                type="button"
                                aria-label={
                                  locale === "zh-CN"
                                    ? `审批${membership.studentDisplayName}加入${classItem.name}`
                                    : `Approve ${membership.studentDisplayName} for ${classItem.name}`
                                }
                                disabled={isApproving}
                                className="inline-flex h-9 items-center justify-center rounded-full bg-[#2f7cff] px-4 text-sm font-semibold text-white outline-none transition hover:bg-[#2364d9] focus-visible:ring-2 focus-visible:ring-[#2f7cff] disabled:cursor-not-allowed disabled:opacity-70"
                                onClick={() => onApproveMembership(classItem, membership)}
                              >
                                {locale === "zh-CN" ? "批准加入" : "Approve"}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                    {visibleApprovalMessages.length > 0 ? (
                      <div className="mt-2 space-y-1">
                        {visibleApprovalMessages.map((message) => (
                          <p key={message}>{message}</p>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-3 text-sm text-[var(--muted)]">
          {locale === "zh-CN"
            ? "还没有班级，先为这门课程新建一个班级。"
            : "No classes yet. Create a class for this course first."}
        </p>
      )}
    </div>
  );
}

function NewClassDialog({
  course,
  locale,
  onCancel,
  onCreate,
}: {
  course: TeacherCourse;
  locale: Locale;
  onCancel: () => void;
  onCreate: (className: string) => Promise<void> | void;
}) {
  const [className, setClassName] = useState("");
  const [formError, setFormError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isReady = className.trim().length > 0;

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !isSubmitting) {
        onCancel();
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isSubmitting, onCancel]);

  async function submitNewClass(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isReady || isSubmitting) {
      return;
    }

    setFormError(undefined);
    setIsSubmitting(true);
    try {
      await onCreate(className);
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : localizedText(TEACHING_OPERATION_SAVE_FAILED_MESSAGE, locale),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/35 px-4 py-10 backdrop-blur-sm">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-class-title"
        className="w-full max-w-3xl overflow-hidden rounded-[14px] border border-[#dfe4ee] bg-white text-[#111827] shadow-[0_28px_80px_rgba(36,53,90,0.22)]"
        onSubmit={submitNewClass}
      >
        <header className="flex min-h-20 items-center justify-between border-b border-[#edf0f5] px-7">
          <div>
            <h2 id="new-class-title" className="text-3xl font-semibold tracking-normal">
              {locale === "zh-CN" ? "新建班级" : "New class"}
            </h2>
            <p className="sr-only">{localizedText(course.title, locale)}</p>
          </div>
          <button
            type="button"
            aria-label={locale === "zh-CN" ? "关闭新建班级弹窗" : "Close new class dialog"}
            disabled={isSubmitting}
            className="inline-flex size-11 items-center justify-center rounded-full text-[#c4ccda] outline-none transition hover:bg-[#f4f7fb] hover:text-[#7c879a] focus-visible:ring-2 focus-visible:ring-[#2f7cff] disabled:cursor-not-allowed disabled:opacity-55"
            onClick={onCancel}
          >
            <X size={32} weight="bold" />
          </button>
        </header>
        <div className="px-7 py-12">
          <label htmlFor="new-class-name" className="sr-only">
            {locale === "zh-CN" ? "班级名称" : "Class name"}
          </label>
          <input
            id="new-class-name"
            aria-label={locale === "zh-CN" ? "班级名称" : "Class name"}
            value={className}
            placeholder={locale === "zh-CN" ? "输入班级名称" : "Enter class name"}
            className="h-16 w-full rounded-lg border border-[#d8dde6] bg-white px-5 text-xl font-medium text-[#111827] outline-none transition placeholder:text-[#aab3c2] focus:border-[#2f7cff] focus:ring-4 focus:ring-[#2f7cff]/12"
            onChange={(event) => {
              setFormError(undefined);
              setClassName(event.target.value);
            }}
          />
          {formError ? (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700"
            >
              {formError}
            </p>
          ) : null}
        </div>
        <footer className="flex justify-end gap-6 px-7 pb-8">
          <button
            type="button"
            disabled={isSubmitting}
            className="inline-flex h-14 min-w-36 items-center justify-center rounded-full border border-[#7eb1ff] bg-white px-8 text-lg font-medium text-[#2f7cff] outline-none transition hover:bg-[#f4f8ff] focus-visible:ring-2 focus-visible:ring-[#2f7cff] disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onCancel}
          >
            {locale === "zh-CN" ? "取消" : "Cancel"}
          </button>
          <button
            type="submit"
            disabled={!isReady || isSubmitting}
            className="inline-flex h-14 min-w-36 items-center justify-center rounded-full bg-gradient-to-r from-[#71b8ff] to-[#635bff] px-8 text-lg font-medium text-white shadow-[0_14px_28px_rgba(92,129,255,0.24)] outline-none transition focus-visible:ring-2 focus-visible:ring-[#2f7cff] disabled:cursor-not-allowed disabled:opacity-70 disabled:shadow-none"
          >
            {isSubmitting
              ? locale === "zh-CN"
                ? "保存中"
                : "Saving"
              : locale === "zh-CN"
                ? "完成"
                : "Done"}
          </button>
        </footer>
      </form>
    </div>
  );
}

function ClassInvitationDialog({
  classItem,
  locale,
  onClose,
}: {
  classItem: TeacherClassItem;
  locale: Locale;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/35 px-4 py-8 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={
          locale === "zh-CN"
            ? `${classItem.name}邀请码`
            : `${classItem.name} invitation QR`
        }
        className="relative w-full max-w-[760px] rounded-[10px] bg-white px-10 pb-9 pt-14 text-center text-[#151b2d] shadow-[0_28px_80px_rgba(36,53,90,0.22)]"
      >
        <button
          type="button"
          aria-label={locale === "zh-CN" ? "关闭班级邀请码" : "Close class invitation QR"}
          className="absolute right-6 top-5 inline-flex size-11 items-center justify-center rounded-full text-[#c4ccda] outline-none transition hover:bg-[#f4f7fb] hover:text-[#7c879a] focus-visible:ring-2 focus-visible:ring-[#2f7cff]"
          onClick={onClose}
        >
          <X size={30} weight="bold" />
        </button>
        <div className="flex flex-wrap items-end justify-center gap-4">
          <p className="pb-2 text-2xl font-medium text-[#5f6675]">
            {locale === "zh-CN" ? "邀请码：" : "Invitation code:"}
          </p>
          <p className="text-6xl font-semibold leading-none text-[#6375ff]">
            {classItem.invitationCode}
          </p>
          <ClipboardText size={28} weight="duotone" className="mb-3 text-[#9ab4d6]" />
        </div>
        <p className="mt-5 text-2xl font-medium text-[#a1a6b4]">
          {locale === "zh-CN"
            ? "请在首页右上角输入邀请码。"
            : "Enter code at top right of App homepage."}
        </p>
        <div className="mt-8 rounded-lg border border-[#eceff4] bg-white p-7">
          <InvitationQrPattern
            className={classItem.name}
            invitationCode={classItem.invitationCode}
          />
        </div>
        <p className="mt-7 text-2xl font-medium text-[#848b9e]">
          {locale === "zh-CN"
            ? "该邀请码2026年12月17日前有效"
            : "This invitation code is valid until December 17, 2026."}
        </p>
        <p className="mt-10 text-3xl font-medium text-[#141b2d]">{classItem.name}</p>
      </section>
    </div>
  );
}

function InvitationQrPattern({
  className,
  invitationCode,
}: {
  className: string;
  invitationCode: string;
}) {
  const cells = createInvitationQrCells(`${invitationCode}-${className}`);

  return (
    <div
      aria-label={`QR code for invitation code ${invitationCode}`}
      data-uais-class-invitation-qr={invitationCode}
      className="mx-auto grid aspect-square w-full max-w-[560px] grid-cols-[repeat(29,minmax(0,1fr))] bg-white"
    >
      {cells.map((active, index) => (
        <span
          key={`${invitationCode}-${index}`}
          className={active ? "bg-black" : "bg-white"}
        />
      ))}
    </div>
  );
}

function InlineInvitationQrPattern({
  invitationCode,
  seed,
}: {
  invitationCode: string;
  seed: string;
}) {
  const cells = createInvitationQrCells(seed);

  return (
    <div
      aria-label={`QR code for inline invitation code ${invitationCode}`}
      data-uais-inline-invitation-qr={invitationCode}
      className="mx-auto grid aspect-square w-full grid-cols-[repeat(29,minmax(0,1fr))] bg-white"
    >
      {cells.map((active, index) => (
        <span
          key={`${invitationCode}-inline-${index}`}
          className={active ? "bg-black" : "bg-white"}
        />
      ))}
    </div>
  );
}

function NewCourseDialog({
  locale,
  teacherActorId,
  onCancel,
  onCreate,
}: {
  locale: Locale;
  teacherActorId?: string;
  onCancel: () => void;
  onCreate: (draft: NewCourseDraft) => Promise<void> | void;
}) {
  const [draft, setDraft] = useState<NewCourseDraft>(() =>
    createDefaultNewCourseDraft(locale),
  );
  const [draftCourseId, setDraftCourseId] = useState<string>();
  const [generatedCover, setGeneratedCover] = useState<GeneratedCourseCover>();
  const [coverError, setCoverError] = useState<string>();
  const [isGeneratingCover, setIsGeneratingCover] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isReady = draft.name.trim().length > 0;

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !isSubmitting) {
        onCancel();
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isSubmitting, onCancel]);

  function updateDraft<Field extends keyof NewCourseDraft>(
    field: Field,
    value: NewCourseDraft[Field],
  ) {
    setFormError(undefined);
    if (draft[field] !== value) {
      setCoverError(undefined);
      setGeneratedCover(undefined);
      setDraftCourseId(undefined);
    }
    setDraft((currentDraft) => ({
      ...currentDraft,
      [field]: value,
    }));
  }

  async function submitNewCourse(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isReady || isSubmitting || isGeneratingCover) {
      return;
    }

    setFormError(undefined);
    setIsSubmitting(true);
    try {
      await onCreate({
        ...draft,
        name: draft.name.trim(),
        ...(draftCourseId ? { courseId: draftCourseId } : {}),
        ...(generatedCover?.assetId ? { coverAssetId: generatedCover.assetId } : {}),
      });
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : localizedText(TEACHING_OPERATION_SAVE_FAILED_MESSAGE, locale),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function generateCourseCover() {
    if (!isReady || isGeneratingCover) {
      return;
    }

    setCoverError(undefined);
    setGeneratedCover(undefined);
    const normalizedTeacherActorId = normalizeTeachingActorId(teacherActorId);
    if (!normalizedTeacherActorId) {
      setCoverError(
        localizedText(TEACHING_COURSE_COVER_TEACHER_READBACK_REQUIRED_MESSAGE, locale),
      );
      return;
    }

    setIsGeneratingCover(true);
    const nextDraftCourseId =
      draftCourseId ??
      createProvisionalTeachingCourseId({
        actorId: normalizedTeacherActorId,
        courseName: draft.name.trim(),
        now: new Date(),
      });

    try {
      const response = await fetch("/api/teaching/course-cover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId: nextDraftCourseId,
          name: draft.name.trim(),
          instructor: draft.instructor,
          unit: draft.unit,
          department: draft.department,
          semester: draft.semester,
          description: draft.description,
        }),
      });
      const body = (await response.json()) as CourseCoverGenerationResponse;
      const recoverableBindingFailure =
        !response.ok && isRecoverableCourseCoverBindingFailure(body);

      if (!response.ok && !recoverableBindingFailure) {
        throw new Error(createCourseCoverGenerationFailureMessage(body, locale));
      }
      if (recoverableBindingFailure) {
        setDraftCourseId(undefined);
        setCoverError(createCourseCoverBindingPartialFailureMessage(body, locale));
        return;
      }
      if (!body.cover?.imageUrl) {
        throw new Error("Course cover generation returned no image.");
      }
      const coverAssetId = verifyCourseCoverAssetPersistence({
        payload: body,
        courseId: nextDraftCourseId,
        locale,
      });

      setDraftCourseId(nextDraftCourseId);
      setGeneratedCover({
        imageUrl: body.cover.imageUrl,
        assetId: coverAssetId,
        model: body.cover.model,
        requestId: body.cover.requestId,
      });
    } catch (error) {
      setDraftCourseId(undefined);
      setCoverError(error instanceof Error ? error.message : "Course cover generation failed.");
    } finally {
      setIsGeneratingCover(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/35 px-3 py-4 backdrop-blur-sm md:py-6">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-course-title"
        className="flex max-h-[calc(100dvh-32px)] w-full max-w-6xl flex-col overflow-hidden rounded-[22px] border border-[#d8e0ec] bg-white text-[#1b2433] shadow-[0_26px_80px_rgba(36,53,90,0.28)]"
        onSubmit={submitNewCourse}
      >
        <header className="flex min-h-18 items-center justify-between border-b border-[#edf0f5] px-6 md:px-9">
          <h2 id="new-course-title" className="text-2xl font-semibold tracking-normal text-[#1b2433]">
            {locale === "zh-CN" ? "新增课程" : "New course"}
          </h2>
          <button
            type="button"
            aria-label={locale === "zh-CN" ? "关闭新增课程弹窗" : "Close new course dialog"}
            disabled={isSubmitting}
            className="inline-flex size-11 items-center justify-center rounded-full text-[#c4ccda] outline-none transition hover:bg-[#f4f7fb] hover:text-[#7c879a] focus-visible:ring-2 focus-visible:ring-[#2f7cff] disabled:cursor-not-allowed disabled:opacity-55"
            onClick={onCancel}
          >
            <X size={32} weight="bold" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6 md:px-9 md:py-7">
          <div className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="grid gap-x-7 gap-y-5 md:grid-cols-[110px_minmax(0,1fr)]">
              <label
                htmlFor="new-course-name"
                className="self-center text-base font-medium text-[#1f2937]"
              >
                {locale === "zh-CN" ? "名称" : "Name"}
              </label>
              <input
                id="new-course-name"
                value={draft.name}
                placeholder={
                  locale === "zh-CN"
                    ? "输入课程名称后，可一键生成课程封面"
                    : "Enter the course name, then generate the course cover with one click"
                }
                className="h-[52px] rounded-lg border border-[#d8dde6] bg-white px-4 text-base font-medium text-[#111827] outline-none transition placeholder:text-[#aab3c2] focus:border-[#2f7cff] focus:ring-4 focus:ring-[#2f7cff]/12"
                onChange={(event) => updateDraft("name", event.target.value)}
              />

              <label
                htmlFor="new-course-instructor"
                className="self-center text-base font-medium text-[#1f2937]"
              >
                {locale === "zh-CN" ? "讲师" : "Instructor"}
              </label>
              <input
                id="new-course-instructor"
                value={draft.instructor}
                className="h-[52px] rounded-lg border border-[#d8dde6] bg-white px-4 text-base font-medium text-[#111827] outline-none transition focus:border-[#2f7cff] focus:ring-4 focus:ring-[#2f7cff]/12"
                onChange={(event) => updateDraft("instructor", event.target.value)}
              />

              <label
                htmlFor="new-course-unit"
                className="self-start pt-7 text-base font-medium text-[#1f2937]"
              >
                {locale === "zh-CN" ? "单位" : "Unit"}
              </label>
              <div
                data-uais-new-course-field-row="unit-description"
                className="grid gap-3 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,0.95fr)_minmax(0,1.2fr)]"
              >
                <div className="min-w-0 space-y-2">
                  <span className="block text-sm font-medium text-[#6b7280]">
                    {locale === "zh-CN" ? "学校" : "University"}
                  </span>
                  <NewCourseSelect
                    id="new-course-unit"
                    value={draft.unit}
                    options={
                      locale === "zh-CN"
                        ? ["广州大学（404）", "优爱思"]
                        : ["Guangzhou University (404)", "University AI System (UAIS)"]
                    }
                    onChange={(value) => updateDraft("unit", value)}
                  />
                </div>
                <div className="min-w-0 space-y-2">
                  <label
                    htmlFor="new-course-department"
                    className="block text-sm font-medium text-[#6b7280]"
                  >
                    {locale === "zh-CN" ? "院系" : "Department"}
                  </label>
                  <NewCourseSelect
                    id="new-course-department"
                    value={draft.department}
                    options={
                      locale === "zh-CN"
                        ? ["实验教学中心", "初等数学研究团队", "教师教育学院"]
                        : [
                            "Experimental Teaching Center",
                            "Elementary Mathematics Research Team",
                            "Faculty of Teacher Education",
                          ]
                    }
                    onChange={(value) => updateDraft("department", value)}
                  />
                </div>
                <div className="min-w-0 space-y-2">
                  <label
                    htmlFor="new-course-description"
                    className="block text-sm font-medium text-[#111827]"
                  >
                    {locale === "zh-CN" ? "描述" : "Description"}
                  </label>
                  <textarea
                    id="new-course-description"
                    value={draft.description}
                    rows={2}
                    placeholder={locale === "zh-CN" ? "简要课程重点" : "Brief course focus"}
                    className="min-h-[52px] w-full resize-none rounded-lg border border-[#d8dde6] bg-white px-4 py-3 text-base font-medium leading-6 text-[#111827] outline-none transition placeholder:text-[#aab3c2] focus:border-[#2f7cff] focus:ring-4 focus:ring-[#2f7cff]/12"
                    onChange={(event) => updateDraft("description", event.target.value)}
                  />
                </div>
              </div>

              <label
                htmlFor="new-course-semester"
                className="self-center text-base font-medium text-[#1f2937]"
              >
                {locale === "zh-CN" ? "学期" : "Semester"}
              </label>
              <NewCourseSelect
                id="new-course-semester"
                value={draft.semester}
                options={
                  locale === "zh-CN"
                    ? ["2025-2026第二学期", "2025-2026第一学期", "2026暑期"]
                    : ["Spring 2026", "Fall 2025", "Summer 2026"]
                }
                className="max-w-[430px]"
                onChange={(value) => updateDraft("semester", value)}
              />
            </div>

            <div
              data-uais-new-course-cover-panel="compact"
              className="rounded-2xl border border-[#edf0f5] bg-[#f8fbff] p-4"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-base font-medium text-[#1f2937]">
                  {locale === "zh-CN" ? "封面" : "Cover"}
                </p>
                {generatedCover?.model ? (
                  <p className="text-sm font-medium text-[#6777ff]">
                    {locale === "zh-CN" ? "封面已生成" : "Qwen cover generated"}
                  </p>
                ) : null}
              </div>
              <NewCourseCoverPreview
                courseName={draft.name}
                imageUrl={generatedCover?.imageUrl}
                locale={locale}
              />
              <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-2">
                <button
                  type="button"
                  className="inline-flex min-h-10 items-center gap-2 text-base font-medium text-[#2f7cff] outline-none transition hover:text-[#1f5fe5] focus-visible:ring-2 focus-visible:ring-[#2f7cff]"
                >
                  <PencilSimple size={22} weight="bold" />
                  {locale === "zh-CN" ? "修改封面" : "Modify the cover"}
                </button>
                <button
                  type="button"
                  disabled={!isReady || isGeneratingCover}
                  className="inline-flex min-h-10 items-center gap-2 text-base font-semibold italic text-[#6777ff] outline-none transition hover:text-[#4058f2] focus-visible:ring-2 focus-visible:ring-[#2f7cff] disabled:cursor-not-allowed disabled:text-[#aab3c2]"
                  onClick={generateCourseCover}
                >
                  <MagicWand size={22} weight="fill" />
                  {isGeneratingCover
                    ? locale === "zh-CN"
                      ? "正在生成封面"
                      : "Generating cover"
                    : locale === "zh-CN"
                      ? "生成封面"
                      : "Generate Cover"}
                </button>
              </div>
              <p className="mt-3 text-sm leading-6 text-[#8b95a6]">
                {locale === "zh-CN"
                  ? "支持常见图片格式，推荐分辨率 800*480。"
                  : "Supports jpg/jpeg/gif/png. Recommended resolution: 800*480."}
              </p>
              {coverError ? (
                <p
                  role="alert"
                  className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700"
                >
                  {coverError}
                </p>
              ) : null}
              {formError ? (
                <p
                  role="alert"
                  className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700"
                >
                  {formError}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <footer className="flex flex-col gap-4 border-t border-[#edf0f5] bg-white px-7 py-5 shadow-[0_-18px_40px_rgba(30,45,75,0.06)] sm:flex-row sm:items-center sm:justify-between md:px-10">
          <div className="inline-flex items-center gap-3 text-lg font-medium text-[#2f7cff]">
            <Package size={25} weight="duotone" />
            {locale === "zh-CN" ? "正在使用演示教学包" : "Using Demonstration Teaching Package"}
          </div>
          <div className="flex flex-wrap justify-end gap-4">
            <button
              type="button"
              disabled={isSubmitting}
              className="inline-flex h-14 min-w-36 items-center justify-center rounded-full border border-[#7eb1ff] bg-white px-8 text-lg font-medium text-[#2f7cff] outline-none transition hover:bg-[#f4f8ff] focus-visible:ring-2 focus-visible:ring-[#2f7cff] disabled:cursor-not-allowed disabled:opacity-60"
              onClick={onCancel}
            >
              {locale === "zh-CN" ? "取消" : "Cancel"}
            </button>
            <button
              type="submit"
              disabled={!isReady || isSubmitting || isGeneratingCover}
              className="inline-flex h-14 min-w-36 items-center justify-center rounded-full bg-gradient-to-r from-[#a9ddff] to-[#9fa9ff] px-8 text-lg font-medium text-white outline-none transition hover:shadow-[0_14px_28px_rgba(92,129,255,0.24)] focus-visible:ring-2 focus-visible:ring-[#2f7cff] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:shadow-none"
            >
              {isSubmitting
                ? locale === "zh-CN"
                  ? "保存中"
                  : "Saving"
                : locale === "zh-CN"
                  ? "完成"
                  : "Done"}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}

function NewCourseSelect({
  id,
  ariaLabel,
  value,
  options,
  className = "",
  onChange,
}: {
  id: string;
  ariaLabel?: string;
  value: string;
  options: string[];
  className?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className={["relative min-w-0", className].filter(Boolean).join(" ")}>
      <select
        id={id}
        aria-label={ariaLabel}
        value={value}
        className="h-[52px] w-full min-w-0 appearance-none rounded-lg border border-[#d8dde6] bg-white px-4 pr-11 text-base font-medium text-[#111827] outline-none transition focus:border-[#2f7cff] focus:ring-4 focus:ring-[#2f7cff]/12"
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <CaretDown
        size={20}
        weight="fill"
        className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[#c8d1df]"
      />
    </div>
  );
}

function NewCourseCoverPreview({
  imageUrl,
  courseName,
  locale,
}: {
  imageUrl?: string;
  courseName: string;
  locale: Locale;
}) {
  const coverLabel =
    locale === "zh-CN"
      ? `为${courseName.trim() || "新课程"}生成的课程封面`
      : `Generated course cover for ${courseName.trim() || "new course"}`;

  if (imageUrl) {
    return (
      <div
        aria-label="Course cover preview"
        className="relative aspect-[5/3] w-full overflow-hidden rounded-lg bg-[#e8eef9] shadow-[0_16px_32px_rgba(39,78,160,0.14)]"
      >
        <div
          role="img"
          aria-label={coverLabel}
          className="h-full w-full bg-cover bg-center"
          style={{ backgroundImage: `url(${imageUrl})` }}
        />
      </div>
    );
  }

  return (
    <div
      aria-label="Course cover preview"
      className="relative aspect-[5/3] w-full overflow-hidden rounded-lg bg-[#356bd8] shadow-[0_16px_32px_rgba(39,78,160,0.14)]"
    >
      <div className="absolute -left-6 top-16 h-24 w-24 rotate-[-28deg] border-[14px] border-[#8ed9ff] border-t-transparent bg-transparent opacity-95" />
      <BookOpen
        size={142}
        weight="duotone"
        className="absolute right-2 top-5 rotate-[-18deg] text-[#cae8ff]"
      />
      <FileText
        size={78}
        weight="duotone"
        className="absolute right-24 top-12 rotate-[18deg] text-[#9ed5ff]"
      />
      <PencilSimple
        size={132}
        weight="fill"
        className="absolute left-28 top-10 rotate-[-20deg] text-[#ffcf46]"
      />
      <span className="absolute right-5 bottom-7 h-12 w-24 rotate-[18deg] rounded-full border-[7px] border-[#f2bf26]" />
      <span className="absolute right-16 bottom-5 h-12 w-24 rotate-[18deg] rounded-full border-[7px] border-[#f2bf26]" />
      <span className="absolute bottom-0 left-0 h-16 w-full bg-gradient-to-t from-[#285cc8]/70 to-transparent" />
    </div>
  );
}

function isPersistedInvitePublicationReceipt(
  receipt: InlineInvitePublicationReceipt | undefined,
  input: { courseId?: string; targetClassId?: string },
) {
  const classId = receipt?.classId?.trim();
  return (
    receipt?.action === "publish-class-invite-code" &&
    receipt.status === "persisted" &&
    typeof receipt.actorId === "string" &&
    receipt.actorId.trim().length > 0 &&
    typeof receipt.courseId === "string" &&
    receipt.courseId.trim().length > 0 &&
    (!input.courseId || receipt.courseId === input.courseId) &&
    typeof classId === "string" &&
    classId.length > 0 &&
    (!input.targetClassId || classId === input.targetClassId)
  );
}

function createInviteJoinUrl(inviteCode: string) {
  return `/courses?invite=${inviteCode}`;
}

type TeachingClassAction = "enter-class" | "activity-list";

function createTeachingClassActionHref(
  operationId: TeachingOperationId,
  classItem: TeacherClassItem,
  action: TeachingClassAction,
) {
  const params = new URLSearchParams({
    course: classItem.courseId,
    class: classItem.id,
    action,
  });
  return `${getTeachingOperationHref(operationId)}?${params.toString()}`;
}

async function readJsonPayload<T>(response: Response): Promise<T | undefined> {
  try {
    return (await response.json()) as T;
  } catch {
    return undefined;
  }
}

function createInlineWorkspaceFailureStatus(
  payload: InlineTeachingOperationErrorResponse | undefined,
  locale: Locale,
) {
  const partialFailureStatus = createInlineOperationPartialFailureStatus(
    payload?.partialFailure,
    locale,
  );
  if (partialFailureStatus) {
    return partialFailureStatus;
  }

  const reasonCode = payload?.access?.reasonCode;
  const detail =
    reasonCode === "authenticated-session-required"
      ? {
          "zh-CN": "需要重新登录教师账号。",
          "en-US": "Teacher sign-in is required.",
        }
      : reasonCode === "teacher-role-required"
        ? {
            "zh-CN": "当前账号没有教师权限。",
            "en-US": "Current account does not have teacher permission.",
          }
        : reasonCode === "course-id-required"
          ? {
              "zh-CN": "缺少课程上下文。",
              "en-US": "Course context is missing.",
            }
          : reasonCode === "teacher-course-ownership-required" ||
              reasonCode === "course-scope-denied"
            ? {
                "zh-CN": "当前教师无权操作该课程。",
                "en-US": "Current teacher cannot operate this course.",
              }
            : reasonCode === "teacher-course-cover-asset-ownership-required"
              ? {
                  "zh-CN": "当前教师无权使用该课程封面。",
                  "en-US": "Current teacher cannot use this course cover.",
                }
            : undefined;
  const localizedDetail = detail ? localizedText(detail, locale) : payload?.error;
  if (!localizedDetail && !payload?.traceId) {
    return localizedText(TEACHING_OPERATION_SAVE_FAILED_MESSAGE, locale);
  }

  const prefix = locale === "zh-CN" ? "未保存到服务器" : "Not saved to the server";
  const baseMessage = localizedDetail
    ? locale === "zh-CN"
      ? `${prefix}：${localizedDetail}`
      : `${prefix}: ${localizedDetail}`
    : localizedText(TEACHING_OPERATION_SAVE_FAILED_MESSAGE, locale);
  if (!payload?.traceId) {
    return baseMessage;
  }

  return locale === "zh-CN"
    ? `${baseMessage}追踪编号：${payload.traceId}`
    : `${baseMessage} Trace ID: ${payload.traceId}`;
}

function createInlineDomainPersistenceFailureStatus(
  summary: InlineTeachingOperationDomainPersistenceSummary | undefined,
  receipt: InlineTeachingOperationBackendReceipt | undefined,
  locale: Locale,
) {
  if (!summary && receipt?.operationId && receipt.actionSlot) {
    return locale === "zh-CN"
      ? "领域对象持久化证据缺失，请稍后重试。"
      : "Domain persistence evidence is missing. Please retry later.";
  }

  if (!summary || summary.required === false || summary.status === "not-required") {
    return undefined;
  }

  const missingObjectTypes = filterNonEmptyStrings(summary.missingObjectTypes);
  const expectedObjectTypes = filterNonEmptyStrings(summary.expectedObjectTypes);
  const persistedObjectTypes = new Set(filterNonEmptyStrings(summary.persistedObjectTypes));
  const unpersistedExpectedObjectTypes = expectedObjectTypes.filter(
    (objectType) => !persistedObjectTypes.has(objectType),
  );
  const receiptMismatch =
    Boolean(summary.operationReceiptId) &&
    Boolean(receipt?.receiptId) &&
    summary.operationReceiptId !== receipt?.receiptId;

  if (
    summary.status === "persisted" &&
    missingObjectTypes.length === 0 &&
    unpersistedExpectedObjectTypes.length === 0 &&
    !receiptMismatch
  ) {
    return undefined;
  }

  const objectTypes =
    missingObjectTypes.length > 0
      ? missingObjectTypes
      : unpersistedExpectedObjectTypes.length > 0
        ? unpersistedExpectedObjectTypes
        : expectedObjectTypes;
  const detail = objectTypes.length > 0 ? objectTypes.join(", ") : (summary.status ?? "unknown");

  return locale === "zh-CN"
    ? `领域对象未保存到服务器：${detail}。请稍后重试。`
    : `Domain objects were not saved to the server: ${detail}. Please retry later.`;
}

function createInlineOperationPartialFailureStatus(
  partialFailure: InlineInvitePartialFailure | undefined,
  locale: Locale,
) {
  if (!partialFailure) {
    return undefined;
  }

  const targetRecordId =
    partialFailure.compensation?.receipt?.targetRecordId ?? partialFailure.operationReceiptId;
  if (partialFailure.compensation?.status === "rolled-back" && targetRecordId) {
    return locale === "zh-CN"
      ? `保存未完成，已自动撤回：${targetRecordId}。`
      : `Save did not complete; the operation was automatically rolled back: ${targetRecordId}.`;
  }

  if (partialFailure.rollbackRoute) {
    return locale === "zh-CN"
      ? "保存未完成，已保留撤回入口，请在审计记录中复核。"
      : "Save did not complete; a rollback route is available for audit review.";
  }

  return undefined;
}

function filterNonEmptyStrings(values: string[] | undefined) {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

function createAlertNotificationFailureStatus(
  payload: InlineTeachingOperationErrorResponse | undefined,
  locale: Locale,
) {
  const localizedDetail = typeof payload?.error === "string" ? payload.error.trim() : "";
  if (!localizedDetail && !payload?.traceId) {
    return localizedText(TEACHING_OPERATION_ALERT_NOTIFICATION_FAILED_MESSAGE, locale);
  }

  const prefix =
    locale === "zh-CN" ? "告警通知未入队" : "Alert notification was not queued";
  const baseMessage = localizedDetail
    ? locale === "zh-CN"
      ? `${prefix}：${localizedDetail}`
      : `${prefix}: ${localizedDetail}`
    : localizedText(TEACHING_OPERATION_ALERT_NOTIFICATION_FAILED_MESSAGE, locale);
  if (!payload?.traceId) {
    return baseMessage;
  }

  return locale === "zh-CN"
    ? `${baseMessage} 追踪编号：${payload.traceId}`
    : `${baseMessage} Trace ID: ${payload.traceId}`;
}

function createRollbackFailureStatus(
  payload: InlineTeachingOperationErrorResponse | undefined,
  locale: Locale,
) {
  const localizedDetail = typeof payload?.error === "string" ? payload.error.trim() : "";
  if (!localizedDetail && !payload?.traceId) {
    return localizedText(TEACHING_OPERATION_ROLLBACK_FAILED_MESSAGE, locale);
  }

  const prefix =
    locale === "zh-CN" ? "撤回未保存到服务器" : "Rollback was not saved to the server";
  const baseMessage = localizedDetail
    ? locale === "zh-CN"
      ? `${prefix}：${localizedDetail}`
      : `${prefix}: ${localizedDetail}`
    : localizedText(TEACHING_OPERATION_ROLLBACK_FAILED_MESSAGE, locale);
  if (!payload?.traceId) {
    return baseMessage;
  }

  return locale === "zh-CN"
    ? `${baseMessage} 追踪编号：${payload.traceId}`
    : `${baseMessage} Trace ID: ${payload.traceId}`;
}

function createInviteWorkspaceFailureStatus(
  payload: InlineInviteOperationResponse | undefined,
): LocalizedText {
  const reasonCode = payload?.access?.reasonCode;
  const detail =
    reasonCode === "authenticated-session-required"
      ? {
          "zh-CN": "需要重新登录教师账号。",
          "en-US": "Teacher sign-in is required.",
        }
      : reasonCode === "teacher-role-required"
        ? {
            "zh-CN": "当前账号没有教师权限。",
            "en-US": "Current account does not have teacher permission.",
          }
        : reasonCode === "course-id-required"
          ? {
              "zh-CN": "缺少课程上下文。",
              "en-US": "Course context is missing.",
            }
          : reasonCode === "teacher-course-ownership-required" ||
              reasonCode === "course-scope-denied"
            ? {
                "zh-CN": "当前教师无权操作该课程。",
                "en-US": "Current teacher cannot operate this course.",
              }
            : reasonCode === "teacher-course-cover-asset-ownership-required"
              ? {
                  "zh-CN": "当前教师无权使用该课程封面。",
                  "en-US": "Current teacher cannot use this course cover.",
                }
            : undefined;
  const zhDetail = detail?.["zh-CN"] ?? payload?.error;
  const enDetail = detail?.["en-US"] ?? payload?.error;
  if (!zhDetail && !enDetail && !payload?.traceId) {
    return TEACHING_OPERATION_SAVE_FAILED_MESSAGE;
  }

  const zhBaseMessage = zhDetail
    ? `邀请码未保存到服务器：${zhDetail}`
    : TEACHING_OPERATION_SAVE_FAILED_MESSAGE["zh-CN"];
  const enBaseMessage = enDetail
    ? `Invite code was not saved: ${enDetail}`
    : TEACHING_OPERATION_SAVE_FAILED_MESSAGE["en-US"];
  if (!payload?.traceId) {
    return {
      "zh-CN": zhBaseMessage,
      "en-US": enBaseMessage,
    };
  }

  return {
    "zh-CN": `${zhBaseMessage}追踪编号：${payload.traceId}`,
    "en-US": `${enBaseMessage} Trace ID: ${payload.traceId}`,
  };
}

function createTeachingCourseCreateFailureMessage(
  payload: TeachingCourseCreateResponse | null | undefined,
  locale: Locale,
) {
  const reasonCode = payload?.access?.reasonCode;
  const detail =
    reasonCode === "authenticated-session-required"
      ? {
          "zh-CN": "需要重新登录教师账号。",
          "en-US": "Teacher sign-in is required.",
        }
      : reasonCode === "teacher-role-required"
        ? {
            "zh-CN": "当前账号没有教师权限。",
            "en-US": "Current account does not have teacher permission.",
          }
        : reasonCode === "course-id-required"
          ? {
              "zh-CN": "缺少课程上下文。",
              "en-US": "Course context is missing.",
            }
          : reasonCode === "teacher-course-ownership-required" ||
              reasonCode === "course-scope-denied"
            ? {
                "zh-CN": "当前教师无权操作该课程。",
                "en-US": "Current teacher cannot operate this course.",
              }
            : reasonCode === "teacher-course-cover-asset-ownership-required"
              ? {
                  "zh-CN": "当前教师无权使用该课程封面。",
                  "en-US": "Current teacher cannot use this course cover.",
                }
            : undefined;
  const localizedDetail = detail ? localizedText(detail, locale) : payload?.error;
  if (!localizedDetail && !payload?.traceId) {
    return localizedText(TEACHING_OPERATION_SAVE_FAILED_MESSAGE, locale);
  }

  const prefix = locale === "zh-CN" ? "课程未保存到服务器" : "Course was not saved to the server";
  const baseMessage = localizedDetail
    ? locale === "zh-CN"
      ? `${prefix}：${localizedDetail}`
      : `${prefix}: ${localizedDetail}`
    : localizedText(TEACHING_OPERATION_SAVE_FAILED_MESSAGE, locale);
  if (!payload?.traceId) {
    return baseMessage;
  }

  return locale === "zh-CN"
    ? `${baseMessage}追踪编号：${payload.traceId}`
    : `${baseMessage} Trace ID: ${payload.traceId}`;
}

function createTeachingCourseCreateOwnershipEvidenceMissingMessage(
  payload: TeachingCourseCreateResponse | null | undefined,
  locale: Locale,
) {
  const baseMessage = localizedText(
    TEACHING_COURSE_CREATE_OWNERSHIP_EVIDENCE_MISSING_MESSAGE,
    locale,
  );
  if (!payload?.traceId) {
    return baseMessage;
  }

  return locale === "zh-CN"
    ? `${baseMessage}追踪编号：${payload.traceId}`
    : `${baseMessage} Trace ID: ${payload.traceId}`;
}

function createTeachingCourseCreateReceiptMissingMessage(
  payload: TeachingCourseCreateResponse | null | undefined,
  locale: Locale,
) {
  const baseMessage = localizedText(TEACHING_COURSE_CREATE_RECEIPT_MISSING_MESSAGE, locale);
  if (!payload?.traceId) {
    return baseMessage;
  }

  return locale === "zh-CN"
    ? `${baseMessage}追踪编号：${payload.traceId}`
    : `${baseMessage} Trace ID: ${payload.traceId}`;
}

function isMergedCourseOwnershipReceipt(
  receipt: TeachingCourseCreateResponse["ownershipReceipt"] | undefined,
  courseId: string,
) {
  const courseIds = receipt?.courseIds ?? [];
  return (
    receipt?.status === "merged" &&
    typeof receipt.teacherId === "string" &&
    receipt.teacherId.trim().length > 0 &&
    courseIds.includes(courseId)
  );
}

function isPersistedTeachingCourseCreateReceipt(
  receipt: TeachingCourseCreateResponse["receipt"] | undefined,
  courseId: string,
) {
  return (
    receipt?.action === "create-course" &&
    typeof receipt.actorId === "string" &&
    receipt.actorId.trim().length > 0 &&
    receipt.courseId === courseId &&
    receipt.status === "persisted" &&
    isVerifiedTeachingCreateAuthSession(receipt.authSession)
  );
}

function createCourseCoverGenerationFailureMessage(
  payload: CourseCoverGenerationResponse | undefined,
  locale: Locale,
) {
  const reasonCode = payload?.access?.reasonCode;
  const detail =
    reasonCode === "authenticated-session-required"
      ? {
          "zh-CN": "需要重新登录教师账号。",
          "en-US": "Teacher sign-in is required.",
        }
      : reasonCode === "teacher-role-required"
        ? {
            "zh-CN": "当前账号没有教师权限。",
            "en-US": "Current account does not have teacher permission.",
          }
        : reasonCode === "course-id-required"
          ? {
              "zh-CN": "缺少课程上下文。",
              "en-US": "Course context is missing.",
            }
          : reasonCode === "teacher-course-ownership-required" ||
              reasonCode === "course-scope-denied"
            ? {
                "zh-CN": "当前教师无权操作该课程。",
                "en-US": "Current teacher cannot operate this course.",
              }
            : reasonCode === "teacher-course-cover-asset-ownership-required"
              ? {
                  "zh-CN": "当前教师无权使用该课程封面。",
                  "en-US": "Current teacher cannot use this course cover.",
                }
            : undefined;
  const localizedDetail = detail ? localizedText(detail, locale) : payload?.error;
  if (!localizedDetail && !payload?.traceId) {
    return "Course cover generation failed.";
  }

  const prefix = locale === "zh-CN" ? "封面未生成" : "Cover was not generated";
  const baseMessage = localizedDetail
    ? locale === "zh-CN"
      ? `${prefix}：${localizedDetail}`
      : `${prefix}: ${localizedDetail}`
    : "Course cover generation failed.";
  if (!payload?.traceId) {
    return baseMessage;
  }

  return locale === "zh-CN"
    ? `${baseMessage}追踪编号：${payload.traceId}`
    : `${baseMessage} Trace ID: ${payload.traceId}`;
}

function verifyCourseCoverAssetPersistence(input: {
  payload: CourseCoverGenerationResponse;
  courseId: string;
  locale: Locale;
}) {
  const assetId = input.payload.asset?.assetId?.trim();
  if (
    !assetId ||
    input.payload.asset?.courseId !== input.courseId ||
    input.payload.assetPersistence?.status !== "persisted" ||
    input.payload.assetPersistence.responsibleSession !== "S12"
  ) {
    throw new Error(
      localizedText(TEACHING_COURSE_COVER_ASSET_PERSISTENCE_REQUIRED_MESSAGE, input.locale),
    );
  }
  if (!hasSignedCourseCoverAuditReceipt(input.payload, assetId, input.courseId)) {
    throw new Error(localizedText(TEACHING_COURSE_COVER_AUDIT_REQUIRED_MESSAGE, input.locale));
  }
  return assetId;
}

function hasSignedCourseCoverAuditReceipt(
  payload: CourseCoverGenerationResponse,
  assetId: string,
  courseId: string,
) {
  return (
    payload.audit?.eventType === "teaching-course-cover.generated" &&
    payload.audit.assetId === assetId &&
    payload.audit.courseId === courseId &&
    payload.audit.authMode === "signed-teacher-session" &&
    typeof payload.audit.authSession?.sessionId === "string" &&
    payload.audit.authSession.sessionId.trim().length > 0 &&
    typeof payload.audit.authSession.authenticatedAt === "string" &&
    payload.audit.authSession.authenticatedAt.trim().length > 0 &&
    typeof payload.audit.authSession.expiresAt === "string" &&
    payload.audit.authSession.expiresAt.trim().length > 0
  );
}

function isRecoverableCourseCoverBindingFailure(
  payload: CourseCoverGenerationResponse | undefined,
) {
  const assetId = payload?.asset?.assetId?.trim();
  return (
    payload?.partialFailure?.status === "cover-asset-persisted-course-binding-failed" &&
    payload.partialFailure.failedStep === "course-cover-binding" &&
    Boolean(payload.cover?.imageUrl) &&
    Boolean(assetId) &&
    payload.asset?.courseId === payload.partialFailure.courseId &&
    payload.assetPersistence?.status === "persisted" &&
    payload.assetPersistence.responsibleSession === "S12" &&
    hasSignedCourseCoverAuditReceipt(payload, assetId ?? "", payload.partialFailure.courseId ?? "")
  );
}

function createCourseCoverBindingPartialFailureMessage(
  payload: CourseCoverGenerationResponse,
  locale: Locale,
) {
  const baseMessage =
    locale === "zh-CN"
      ? "封面已保存，但课程绑定未完成。"
      : "Cover was saved, but course binding did not finish.";
  if (!payload.traceId) {
    return baseMessage;
  }
  return locale === "zh-CN"
    ? `${baseMessage}追踪编号：${payload.traceId}`
    : `${baseMessage} Trace ID: ${payload.traceId}`;
}

function createTeachingClassCreateFailureMessage(
  payload: TeachingClassCreateResponse | null | undefined,
  locale: Locale,
) {
  const reasonCode = payload?.access?.reasonCode;
  const detail =
    reasonCode === "authenticated-session-required"
      ? {
          "zh-CN": "需要重新登录教师账号。",
          "en-US": "Teacher sign-in is required.",
        }
      : reasonCode === "teacher-role-required"
        ? {
            "zh-CN": "当前账号没有教师权限。",
            "en-US": "Current account does not have teacher permission.",
          }
        : reasonCode === "course-id-required"
          ? {
              "zh-CN": "缺少课程上下文。",
              "en-US": "Course context is missing.",
            }
          : reasonCode === "teacher-course-ownership-required" ||
              reasonCode === "course-scope-denied"
            ? {
                "zh-CN": "当前教师无权操作该课程。",
                "en-US": "Current teacher cannot operate this course.",
              }
            : undefined;
  const localizedDetail = detail ? localizedText(detail, locale) : payload?.error;
  if (!localizedDetail && !payload?.traceId) {
    return localizedText(TEACHING_OPERATION_SAVE_FAILED_MESSAGE, locale);
  }

  const prefix = locale === "zh-CN" ? "班级未保存到服务器" : "Class was not saved to the server";
  const baseMessage = localizedDetail
    ? locale === "zh-CN"
      ? `${prefix}：${localizedDetail}`
      : `${prefix}: ${localizedDetail}`
    : localizedText(TEACHING_OPERATION_SAVE_FAILED_MESSAGE, locale);
  if (!payload?.traceId) {
    return baseMessage;
  }

  return locale === "zh-CN"
    ? `${baseMessage}追踪编号：${payload.traceId}`
    : `${baseMessage} Trace ID: ${payload.traceId}`;
}

function createTeachingClassCreateReceiptMissingMessage(
  payload: TeachingClassCreateResponse | null | undefined,
  locale: Locale,
) {
  const baseMessage = localizedText(TEACHING_CLASS_CREATE_RECEIPT_MISSING_MESSAGE, locale);
  if (!payload?.traceId) {
    return baseMessage;
  }

  return locale === "zh-CN"
    ? `${baseMessage}追踪编号：${payload.traceId}`
    : `${baseMessage} Trace ID: ${payload.traceId}`;
}

function isPersistedTeachingClassCreateReceipt(
  receipt: TeachingClassCreateResponse["receipt"] | undefined,
  courseId: string,
  classId: string,
) {
  return (
    receipt?.action === "create-class" &&
    typeof receipt.actorId === "string" &&
    receipt.actorId.trim().length > 0 &&
    receipt.courseId === courseId &&
    receipt.classId === classId &&
    receipt.status === "persisted" &&
    isVerifiedTeachingCreateAuthSession(receipt.authSession)
  );
}

function isVerifiedTeachingCreateAuthSession(
  authSession: InlineTeachingOperationAuditAuthSession | undefined,
) {
  return (
    typeof authSession?.sessionId === "string" &&
    authSession.sessionId.trim().length > 0 &&
    typeof authSession.authenticatedAt === "string" &&
    authSession.authenticatedAt.trim().length > 0 &&
    typeof authSession.expiresAt === "string" &&
    authSession.expiresAt.trim().length > 0
  );
}

function createMembershipApprovalFailureStatus(
  payload: TeachingClassMembershipApproveResponse | null | undefined,
  locale: Locale,
) {
  const reasonCode = payload?.access?.reasonCode;
  const detail =
    reasonCode === "authenticated-session-required"
      ? {
          "zh-CN": "需要重新登录教师账号。",
          "en-US": "Teacher sign-in is required.",
        }
      : reasonCode === "teacher-role-required"
        ? {
            "zh-CN": "当前账号没有教师权限。",
            "en-US": "Current account does not have teacher permission.",
          }
        : reasonCode === "course-id-required"
          ? {
              "zh-CN": "缺少课程上下文。",
              "en-US": "Course context is missing.",
            }
          : reasonCode === "teacher-course-ownership-required" ||
              reasonCode === "course-scope-denied"
            ? {
                "zh-CN": "当前教师无权操作该课程。",
                "en-US": "Current teacher cannot operate this course.",
              }
            : undefined;
  const localizedDetail = detail ? localizedText(detail, locale) : payload?.error;
  if (!localizedDetail && !payload?.traceId) {
    return localizedText(MEMBERSHIP_APPROVAL_FAILED_MESSAGE, locale);
  }

  const prefix = locale === "zh-CN" ? "审批未保存到服务器" : "Approval was not saved";
  const baseMessage = localizedDetail
    ? locale === "zh-CN"
      ? `${prefix}：${localizedDetail}`
      : `${prefix}: ${localizedDetail}`
    : localizedText(MEMBERSHIP_APPROVAL_FAILED_MESSAGE, locale);
  if (!payload?.traceId) {
    return baseMessage;
  }

  return locale === "zh-CN"
    ? `${baseMessage}追踪编号：${payload.traceId}`
    : `${baseMessage} Trace ID: ${payload.traceId}`;
}

function createInvitePartialFailureStatus(
  partialFailure: InlineInvitePartialFailure | undefined,
): LocalizedText | undefined {
  if (!partialFailure) {
    return undefined;
  }

  const targetRecordId =
    partialFailure.compensation?.receipt?.targetRecordId ?? partialFailure.operationReceiptId;
  if (partialFailure.compensation?.status === "rolled-back" && targetRecordId) {
    return {
      "zh-CN": `发布未完成，已自动撤回：${targetRecordId}。`,
      "en-US": `Publish did not complete; the operation was automatically rolled back: ${targetRecordId}.`,
    };
  }

  if (partialFailure.rollbackRoute) {
    return {
      "zh-CN": "发布未完成，已保留撤回入口，请在审计记录中复核。",
      "en-US": "Publish did not complete; a rollback route is available for audit review.",
    };
  }

  return undefined;
}

function createInvitationQrCells(seed: string) {
  const size = 29;
  const cells = Array.from({ length: size * size }, () => false);
  const normalizedSeed = seed || "UAIS";

  function setCell(x: number, y: number, active: boolean) {
    if (x >= 0 && x < size && y >= 0 && y < size) {
      cells[y * size + x] = active;
    }
  }

  function isFinderArea(x: number, y: number, originX: number, originY: number) {
    return x >= originX && x < originX + 7 && y >= originY && y < originY + 7;
  }

  function drawFinder(originX: number, originY: number) {
    for (let y = 0; y < 7; y += 1) {
      for (let x = 0; x < 7; x += 1) {
        const outer = x === 0 || y === 0 || x === 6 || y === 6;
        const inner = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        setCell(originX + x, originY + y, outer || inner);
      }
    }
  }

  drawFinder(0, 0);
  drawFinder(size - 7, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 9, size - 9);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (
        isFinderArea(x, y, 0, 0) ||
        isFinderArea(x, y, size - 7, 0) ||
        isFinderArea(x, y, 0, size - 7) ||
        isFinderArea(x, y, size - 9, size - 9)
      ) {
        continue;
      }

      const seedCode = normalizedSeed.charCodeAt((x * 7 + y * 11) % normalizedSeed.length);
      const active = (seedCode + x * x + y * 13 + x * y) % 5 < 2;
      setCell(x, y, active);
    }
  }

  return cells;
}

type TeacherWorkflowSample = {
  status: string;
  sampleAssetId: string;
  sampleDurationSeconds: number;
};

type TeacherWorkflowPreflight = {
  status: string;
  checks: Array<{ responsibleSession?: string; status?: string }>;
};

type TeacherWorkflowVoiceRef = {
  voiceRefId: string;
  status: string;
  voiceRef: string;
};

type TeacherWorkflowPptAsset = {
  slideId: string;
  audioId: string;
  downloadUrl: string;
};

type TeacherWorkflowNarration = {
  status: string;
  slideCount: number;
  audioManifestId: string;
  assets: TeacherWorkflowPptAsset[];
};

type TeacherServerWorkflowStep = {
  id: "voice-sample" | "voice-clone" | "ppt-material" | "ppt-narration";
  status: string;
  sampleAssetId?: string;
  voiceRefId?: string;
  pptAssetId?: string;
  audioManifestId?: string;
};

type TeacherServerWorkflow = {
  teacherId?: string;
  courseId?: string;
  pptAssetId?: string;
  status: string;
  nextAction: string;
  steps?: TeacherServerWorkflowStep[];
  downloads?: {
    audioManifestId: string;
    exportDownloadUrl: string;
    audioDownloadPattern: string;
  };
};

type TeacherServerWorkflowHandoffPlan = {
  nextAgent?: {
    responsibleSession?: string;
    action?: string;
  };
};

type TeacherServerWorkflowProgressItem = {
  id: string;
  type?: string;
  status: string;
  responsibleSession?: string;
  responsibleAgent?: {
    name?: string;
    providerRole?: string;
  };
  progressText?: string;
};

type SelectedTeacherVoiceSample = {
  fileName: string;
  sampleAssetId: string;
  sourceKind: "owner-provided" | "upload";
  file?: File;
  mimeType?: string;
};

type SelectedVoiceSampleDurationStatus =
  | {
      status: "owner-provided";
      durationSeconds: 10;
    }
  | {
      status: "checking";
    }
  | {
      status: "ready" | "blocked";
      durationSeconds: number;
    }
  | {
      status: "unchecked";
    };

type TeacherWorkflowSessionAction =
  | "live-chat"
  | "teacher-ppt-workflow-read"
  | "voice-sample-submit"
  | "voice-clone-preflight"
  | "voice-clone-status"
  | "ppt-narration-submit";

type TeacherWorkflowSessionReadiness = {
  status: "checking" | "ready" | "blocked";
  action: TeacherWorkflowSessionAction;
};

type TeacherWorkflowSessionResource = {
  teacherId: string;
  courseId?: string;
  sampleAssetId?: string;
  pptAssetId?: string;
  voiceRefId?: string;
  providerTaskId?: string;
};

const DEFAULT_SAMPLE_ASSET_ID = "teacher-kang-10s-sample";
const PENDING_TEACHER_UPLOAD_SAMPLE_ACTOR_ID = "pending-teacher-session";
const DEFAULT_COURSE_ID = "research-methods";
const DEFAULT_PPT_ASSET_ID = "kang-xia-ppt-19";
const SERVER_SIDE_VOICE_REF = "server-side-cloned-qwen-voice";

function TeacherPptNarrationWorkflow({
  locale,
  teacherActorId,
}: {
  locale: Locale;
  teacherActorId?: string;
}) {
  const defaultVoiceSampleLabel =
    locale === "zh-CN" ? "康霞 10 秒声音" : "Kang Xia 10-second voice";
  const [selectedVoiceFileName, setSelectedVoiceFileName] = useState(
    defaultVoiceSampleLabel,
  );
  const [selectedVoiceSample, setSelectedVoiceSample] = useState<SelectedTeacherVoiceSample>({
    fileName: defaultVoiceSampleLabel,
    sampleAssetId: DEFAULT_SAMPLE_ASSET_ID,
    sourceKind: "owner-provided",
  });
  const [selectedVoiceAudioUrl, setSelectedVoiceAudioUrl] = useState<string>();
  const [selectedVoiceDurationStatus, setSelectedVoiceDurationStatus] =
    useState<SelectedVoiceSampleDurationStatus>({
      status: "owner-provided",
      durationSeconds: 10,
    });
  const [sample, setSample] = useState<TeacherWorkflowSample>();
  const [preflight, setPreflight] = useState<TeacherWorkflowPreflight>();
  const [voiceRef, setVoiceRef] = useState<TeacherWorkflowVoiceRef>();
  const [narration, setNarration] = useState<TeacherWorkflowNarration>();
  const [serverWorkflow, setServerWorkflow] = useState<TeacherServerWorkflow>();
  const [serverHandoffPlan, setServerHandoffPlan] =
    useState<TeacherServerWorkflowHandoffPlan>();
  const [serverWorkflowProgress, setServerWorkflowProgress] = useState<
    TeacherServerWorkflowProgressItem[]
  >([]);
  const [sessionReadiness, setSessionReadiness] =
    useState<TeacherWorkflowSessionReadiness>();
  const [workflowError, setWorkflowError] = useState<string>();

  useEffect(() => {
    return () => {
      if (selectedVoiceAudioUrl && typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(selectedVoiceAudioUrl);
      }
    };
  }, [selectedVoiceAudioUrl]);

  async function refreshServerWorkflow() {
    setWorkflowError(undefined);
    try {
      const actorId = requireTeacherWorkflowActorId({
        locale,
        teacherActorId,
        serverWorkflowTeacherId: serverWorkflow?.teacherId,
      });
      const body = await readJson<{
        workflow?: TeacherServerWorkflow;
        agentHandoffPlan?: TeacherServerWorkflowHandoffPlan;
        progress?: TeacherServerWorkflowProgressItem[];
      }>(
        "/api/ai/teacher-ppt-workflow",
        {
          credentials: "same-origin",
          headers: await requestTeacherAiSessionHeaders({
            action: "teacher-ppt-workflow-read",
            resource: {
              teacherId: actorId,
              courseId: DEFAULT_COURSE_ID,
              pptAssetId: DEFAULT_PPT_ASSET_ID,
            },
            locale,
          }),
        },
      );
      setServerWorkflow(body.workflow);
      setServerHandoffPlan(body.agentHandoffPlan);
      setServerWorkflowProgress(body.progress ?? []);
    } catch {
      setServerWorkflowProgress([]);
      throw new Error(
        locale === "zh-CN"
          ? "教师登录会话缺失，无法读取服务端工作流。"
          : "Teacher login session is missing, so the server workflow cannot be read.",
      );
    }
  }

  async function checkTeacherAiSessionReadiness() {
    const action: TeacherWorkflowSessionAction = "voice-sample-submit";
    setWorkflowError(undefined);
    setSessionReadiness({ status: "checking", action });

    try {
      const actorId = requireTeacherWorkflowActorId({
        locale,
        teacherActorId,
        serverWorkflowTeacherId: serverWorkflow?.teacherId,
      });
      await requestTeacherAiSessionHeaders({
        action,
        resource: {
          teacherId: actorId,
          courseId: DEFAULT_COURSE_ID,
          sampleAssetId: resolveSelectedTeacherVoiceSampleAssetId({
            actorId,
            selectedVoiceSample,
          }),
        },
        locale,
      });
      setSessionReadiness({ status: "ready", action });
    } catch (error) {
      setSessionReadiness({ status: "blocked", action });
      setWorkflowError(
        error instanceof Error ? error.message : createTeacherWorkflowAuthErrorMessage(locale),
      );
    }
  }

  async function registerTeacherVoice() {
    setWorkflowError(undefined);
    const actorId = requireTeacherWorkflowActorId({
      locale,
      teacherActorId,
      serverWorkflowTeacherId: serverWorkflow?.teacherId,
    });
    const sampleAssetId = resolveSelectedTeacherVoiceSampleAssetId({
      actorId,
      selectedVoiceSample,
    });
    const uploadedAudio = await readSelectedVoiceSampleAudio(selectedVoiceSample);
    const body = await readProtectedTeacherWorkflowJson<{
      sample?: { status?: string; assetId?: string; sampleDurationSeconds?: number };
      sampleAsset?: { sampleAssetId?: string; assetId?: string };
    }>({
      url: "/api/ai/voice-sample",
      locale,
      action: "voice-sample-submit",
      resource: {
        teacherId: actorId,
        courseId: DEFAULT_COURSE_ID,
        sampleAssetId,
      },
      init: {
        method: "POST",
        body: JSON.stringify({
          executionMode: "contract",
          teacherId: actorId,
          consentConfirmed: true,
          consentScope: "ppt-narration",
          sampleAssetId,
          sampleDurationSeconds: 10,
          mimeType: uploadedAudio.mimeType ?? "audio/wav",
          sourceKind: selectedVoiceSample?.sourceKind ?? "owner-provided",
          ...(selectedVoiceSample?.sourceKind === "upload"
            ? {
                selectedFileName: selectedVoiceSample.fileName,
                ...(uploadedAudio.sampleAudioBase64
                  ? { sampleAudioBase64: uploadedAudio.sampleAudioBase64 }
                  : {}),
              }
            : {}),
          language: locale,
          targetVoiceLabel: "Kang teacher PPT voice",
        }),
      },
    });

    setSample({
      status: body.sample?.status ?? "ready-for-clone",
      sampleAssetId:
        body.sampleAsset?.sampleAssetId ??
        body.sampleAsset?.assetId ??
        body.sample?.assetId ??
        DEFAULT_SAMPLE_ASSET_ID,
      sampleDurationSeconds: body.sample?.sampleDurationSeconds ?? 10,
    });
  }

  async function runWorkflowPreflight() {
    setWorkflowError(undefined);
    const actorId = requireTeacherWorkflowActorId({
      locale,
      teacherActorId,
      serverWorkflowTeacherId: serverWorkflow?.teacherId,
    });
    const sampleAssetId =
      sample?.sampleAssetId ??
      resolveSelectedTeacherVoiceSampleAssetId({
        actorId,
        selectedVoiceSample,
      });
    const body = await readProtectedTeacherWorkflowJson<{
      preflight?: {
        status?: string;
        checks?: Array<{ responsibleSession?: string; status?: string }>;
      };
    }>({
      url: "/api/ai/voice-clone/preflight",
      locale,
      action: "voice-clone-preflight",
      resource: {
        teacherId: actorId,
        courseId: DEFAULT_COURSE_ID,
        sampleAssetId,
      },
      init: {
        method: "POST",
        body: JSON.stringify({
          liveProviderApproved: true,
          teacherId: actorId,
          consentConfirmed: true,
          consentScope: "ppt-narration",
          sampleAssetId,
          sampleDurationSeconds: sample?.sampleDurationSeconds ?? 10,
          mimeType: "audio/wav",
          sourceKind: selectedVoiceSample?.sourceKind ?? "owner-provided",
          language: locale,
          targetVoiceLabel: "Kang teacher PPT voice",
        }),
      },
    });

    setPreflight({
      status: body.preflight?.status ?? "blocked",
      checks: body.preflight?.checks ?? [],
    });
  }

  async function saveVoiceRef() {
    setWorkflowError(undefined);
    const actorId = requireTeacherWorkflowActorId({
      locale,
      teacherActorId,
      serverWorkflowTeacherId: serverWorkflow?.teacherId,
    });
    const sampleAssetId =
      sample?.sampleAssetId ??
      resolveSelectedTeacherVoiceSampleAssetId({
        actorId,
        selectedVoiceSample,
      });
    const body = await readProtectedTeacherWorkflowJson<{
      voiceClone?: { status?: string; voiceRef?: string; nextAction?: string };
      voiceCloneReference?: {
        voiceRefId?: string;
        status?: string;
        voiceRef?: string;
      };
    }>({
      url: "/api/ai/voice-clone/status",
      locale,
      action: "voice-clone-status",
      resource: {
        teacherId: actorId,
        courseId: DEFAULT_COURSE_ID,
        sampleAssetId,
        providerTaskId: "task-voice-redacted",
      },
      init: {
        method: "POST",
        body: JSON.stringify({
          executionMode: "contract",
          teacherId: actorId,
          sampleAssetId,
          providerTaskId: "task-voice-redacted",
          providerStatus: "SUCCEEDED",
          clonedVoiceId: "voice-qwen-redacted",
        }),
      },
    });

    setVoiceRef({
      voiceRefId:
        body.voiceCloneReference?.voiceRefId ??
        buildPublicVoiceRefId(actorId, sampleAssetId),
      status: body.voiceCloneReference?.status ?? body.voiceClone?.status ?? "ready",
      voiceRef:
        body.voiceCloneReference?.voiceRef ??
        body.voiceClone?.voiceRef ??
        SERVER_SIDE_VOICE_REF,
    });
  }

  async function generatePptNarration() {
    setWorkflowError(undefined);
    const actorId = requireTeacherWorkflowActorId({
      locale,
      teacherActorId,
      serverWorkflowTeacherId: serverWorkflow?.teacherId,
    });
    const sampleAssetId =
      sample?.sampleAssetId ??
      resolveSelectedTeacherVoiceSampleAssetId({
        actorId,
        selectedVoiceSample,
      });
    const activeVoiceRefId =
      voiceRef?.voiceRefId ??
      buildPublicVoiceRefId(actorId, sampleAssetId);
    const slideScripts = createKangXiaPptSlideScripts(locale);
    const body = await readProtectedTeacherWorkflowJson<{
      pptNarrationJob?: {
        status?: string;
        slideCount?: number;
        audioManifestId?: string;
      };
      pptNarrationAssets?: {
        id?: string;
        assets?: TeacherWorkflowPptAsset[];
      };
    }>({
      url: "/api/ai/ppt-narration",
      locale,
      action: "ppt-narration-submit",
      resource: {
        teacherId: actorId,
        courseId: DEFAULT_COURSE_ID,
        sampleAssetId,
        pptAssetId: DEFAULT_PPT_ASSET_ID,
        voiceRefId: activeVoiceRefId,
      },
      init: {
        method: "POST",
        body: JSON.stringify({
          executionMode: "contract",
          voiceClone: {
            teacherId: actorId,
            consentConfirmed: true,
            sampleAssetId,
            sampleDurationSeconds: sample?.sampleDurationSeconds ?? 10,
            language: locale,
            targetVoiceLabel: "Kang teacher PPT voice",
          },
          pptNarration: {
            courseId: DEFAULT_COURSE_ID,
            pptAssetId: DEFAULT_PPT_ASSET_ID,
            clonedVoiceRef: activeVoiceRefId,
            language: locale,
            slideScripts,
          },
        }),
      },
    });

    setNarration({
      status: body.pptNarrationJob?.status ?? "queued",
      slideCount: body.pptNarrationJob?.slideCount ?? body.pptNarrationAssets?.assets?.length ?? 0,
      audioManifestId:
        body.pptNarrationAssets?.id ??
        body.pptNarrationJob?.audioManifestId ??
        `audio-manifest-${DEFAULT_COURSE_ID}-${DEFAULT_PPT_ASSET_ID}`,
      assets: body.pptNarrationAssets?.assets ?? [],
    });
  }

  async function runWorkflowAction(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      setWorkflowError(
        error instanceof Error
          ? error.message
          : locale === "zh-CN"
            ? "教师课件配音工作流请求失败。"
            : "Teacher PPT narration workflow request failed.",
      );
    }
  }

  function selectOwnerProvidedVoiceSample() {
    setWorkflowError(undefined);
    setSelectedVoiceFileName(defaultVoiceSampleLabel);
    setSelectedVoiceSample({
      fileName: defaultVoiceSampleLabel,
      sampleAssetId: DEFAULT_SAMPLE_ASSET_ID,
      sourceKind: "owner-provided",
    });
    setSelectedVoiceAudioUrl(undefined);
    setSelectedVoiceDurationStatus({
      status: "owner-provided",
      durationSeconds: 10,
    });
    setSample(undefined);
    setPreflight(undefined);
    setVoiceRef(undefined);
    setNarration(undefined);
  }

  const canRunPreflight = Boolean(sample);
  const canSaveVoiceRef = preflight?.status === "ready";
  const canGenerateNarration = Boolean(voiceRef?.voiceRefId);
  const canRegisterTeacherVoice =
    selectedVoiceDurationStatus.status !== "checking" &&
    selectedVoiceDurationStatus.status !== "blocked";
  const serverWorkflowSteps = serverWorkflow?.steps ?? [];

  return (
    <div
      className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4"
      data-uais-voice-sample-select="file-input"
      data-uais-uploaded-sample-audio-payload="sampleAudioBase64"
      data-uais-voice-sample-duration-gate="browser-metadata"
      data-uais-selected-sample-identity="sampleAssetId voiceRefId"
      data-uais-signed-session-bootstrap="/api/ai/session"
      data-uais-session-readiness={
        sessionReadiness?.status === "ready"
          ? "signed-ai-access-ready"
          : sessionReadiness?.status === "blocked"
            ? "signed-ai-access-blocked"
            : "not-checked"
      }
      data-uais-server-workflow-status="/api/ai/teacher-ppt-workflow"
      data-uais-workflow-session-actions="teacher-ppt-workflow-read voice-sample-submit voice-clone-preflight voice-clone-status ppt-narration-submit"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-[var(--foreground)]">
            {locale === "zh-CN" ? "教师课件配音工作流" : "Teacher PPT Narration Workflow"}
          </h3>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
            {locale === "zh-CN"
              ? "上传或选择 10 秒教师声音，完成分工预检后生成逐页音频。"
              : "Upload or select a 10-second teacher voice, pass S07/S12/S19/S24 preflight, then generate per-slide WAV files."}
          </p>
        </div>
        <span className="inline-flex h-8 items-center rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 text-xs font-semibold text-[var(--muted)]">
          {locale === "zh-CN" ? "分工预检" : "S07 / S12 / S19 / S24"}
        </span>
        <span className="inline-flex h-8 items-center rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 text-xs font-semibold text-[var(--accent)]">
          {locale === "zh-CN" ? "康霞课件 19 页" : "Kang Xia PPT 19 slides"}
        </span>
      </div>

      <div
        className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-3"
        data-uais-server-workflow-progress="auth-provider-storage-route"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-[var(--muted)]">
              {locale === "zh-CN" ? "服务端工作流" : "Server workflow"}
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              {locale === "zh-CN"
                ? "从签名教师会话读取服务端归属、下载入口和下一步交接。"
                : "Read server-side ownership, download entry points, and next handoff from the signed teacher session."}
            </p>
          </div>
          <AiOpsButton
            icon={<ClipboardText size={16} weight="bold" />}
            onClick={() => void runWorkflowAction(refreshServerWorkflow)}
          >
            {locale === "zh-CN" ? "刷新服务端工作流" : "Refresh server workflow"}
          </AiOpsButton>
          <AiOpsButton
            icon={<UserGear size={16} weight="bold" />}
            onClick={() => void checkTeacherAiSessionReadiness()}
          >
            {locale === "zh-CN" ? "检查教师登录会话" : "Check teacher login session"}
          </AiOpsButton>
        </div>

        <p
          className={[
            "mt-3 rounded-xl border px-3 py-2 text-xs font-semibold",
            sessionReadiness?.status === "ready"
              ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)]"
              : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]",
          ].join(" ")}
          aria-live="polite"
        >
          {formatTeacherWorkflowSessionReadiness(sessionReadiness, locale)}
        </p>

        {serverWorkflow ? (
          <div className="mt-3 space-y-3">
            <p className="text-sm font-medium text-[var(--foreground)]">
              {locale === "zh-CN"
                ? formatServerWorkflowStatusLine(serverWorkflow, locale)
                : `Server workflow ${serverWorkflow.status}: ${serverWorkflow.nextAction}`}
            </p>
            {serverHandoffPlan?.nextAgent ? (
              <p className="text-sm font-medium text-[var(--foreground)]">
                {locale === "zh-CN"
                  ? formatServerWorkflowNextAction(serverHandoffPlan, serverWorkflow, locale)
                  : `Next ${serverHandoffPlan.nextAgent.responsibleSession ?? "S24"} / ${
                      serverHandoffPlan.nextAgent.action ?? serverWorkflow.nextAction
                  }`}
              </p>
            ) : null}
            {serverWorkflowProgress.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase text-[var(--muted)]">
                  {locale === "zh-CN"
                    ? "教师工作流就绪度"
                    : "Teacher workflow readiness"}
                </p>
                <div className="grid gap-2 lg:grid-cols-3">
                  {serverWorkflowProgress.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                    >
                      <p className="text-xs font-semibold text-[var(--foreground)]">
                        {formatServerWorkflowProgressOwner(item, locale)}
                      </p>
                      {item.progressText ? (
                        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                          {formatServerWorkflowProgressText(item, locale)}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {serverWorkflowSteps.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {serverWorkflowSteps.map((step) => (
                  <p
                    key={step.id}
                    className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--foreground)]"
                  >
                    {formatServerWorkflowStep(step, locale)}
                  </p>
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--muted)]">
                {locale === "zh-CN"
                  ? "服务端步骤尚未返回。"
                  : "Server workflow steps have not returned yet."}
              </p>
            )}
            {serverWorkflow.downloads ? (
              <div className="space-y-2">
                <a
                  href={serverWorkflow.downloads.exportDownloadUrl}
                  className="inline-flex min-h-9 items-center gap-2 rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 text-xs font-semibold text-[var(--accent)]"
                >
                  <ExportIcon size={14} weight="bold" />
                  {locale === "zh-CN"
                    ? "下载完整课件配音包"
                    : "Download full PPT narration package"}
                </a>
                <div className="flex flex-wrap gap-2">
                  {createServerWorkflowDownloadAssets({
                    locale,
                    audioDownloadPattern: serverWorkflow.downloads.audioDownloadPattern,
                  }).map((asset) => (
                    <a
                      key={asset.audioId}
                      href={asset.downloadUrl}
                      download={`${asset.audioId}.wav`}
                      className="inline-flex min-h-9 items-center gap-2 rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 text-xs font-semibold text-[var(--accent)]"
                    >
                      <ExportIcon size={14} weight="bold" />
                      {locale === "zh-CN"
                        ? formatPptAudioDownloadLabel(asset, locale, "server")
                        : `Download server ${asset.slideId} WAV`}
                    </a>
                  ))}
                </div>
              </div>
            ) : (
              <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--muted)]">
                {locale === "zh-CN"
                  ? "服务端下载入口尚未生成。"
                  : "Server download entry points are not generated yet."}
              </p>
            )}
          </div>
        ) : (
          <p className="mt-3 text-sm text-[var(--muted)]">
            {locale === "zh-CN"
              ? "等待刷新服务端工作流。"
              : "Waiting to refresh the server workflow."}
          </p>
        )}
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-4">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-3">
          <p className="text-xs font-semibold uppercase text-[var(--muted)]">
            {locale === "zh-CN" ? "1 声音样本" : "1 Voice Sample"}
          </p>
          <AiOpsButton
            icon={<UserGear size={16} weight="bold" />}
            onClick={selectOwnerProvidedVoiceSample}
          >
            {locale === "zh-CN"
              ? "使用康霞 10 秒声音"
              : "Use Kang Xia 10-second voice"}
          </AiOpsButton>
          <label
            htmlFor="teacher-voice-sample"
            className="mt-3 inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--foreground)] outline-none transition hover:bg-[var(--surface-soft)]"
          >
            <FileText size={16} weight="bold" />
            {locale === "zh-CN"
              ? "上传/选择 10 秒教师声音"
              : "Upload/select 10-second teacher voice"}
          </label>
          <input
            id="teacher-voice-sample"
            aria-label={
              locale === "zh-CN"
                ? "上传/选择 10 秒教师声音"
                : "Upload/select 10-second teacher voice"
            }
            type="file"
            accept="audio/*"
            className="sr-only"
            onChange={(event) => {
              setWorkflowError(undefined);
              const file = event.currentTarget.files?.[0];
              const fileName = file?.name;
              setSelectedVoiceFileName(
                fileName ?? (locale === "zh-CN" ? "未选择文件" : "No file selected"),
              );
              const audioUrl =
                file && typeof URL.createObjectURL === "function"
                  ? URL.createObjectURL(file)
                  : undefined;
              setSelectedVoiceAudioUrl(audioUrl);
              setSelectedVoiceDurationStatus(
                fileName
                  ? audioUrl
                    ? { status: "checking" }
                    : { status: "unchecked" }
                  : {
                      status: "owner-provided",
                      durationSeconds: 10,
                    },
              );
              setSelectedVoiceSample(
                fileName
                  ? {
                      fileName,
                      sampleAssetId: buildUploadSampleAssetId(
                        readTeacherWorkflowActorId({
                          teacherActorId,
                          serverWorkflowTeacherId: serverWorkflow?.teacherId,
                        }) ?? PENDING_TEACHER_UPLOAD_SAMPLE_ACTOR_ID,
                        fileName,
                      ),
                      sourceKind: "upload",
                      file,
                      mimeType: file.type || "audio/wav",
                    }
                  : {
                      fileName: defaultVoiceSampleLabel,
                      sampleAssetId: DEFAULT_SAMPLE_ASSET_ID,
                      sourceKind: "owner-provided",
                    },
              );
              setSample(undefined);
              setPreflight(undefined);
              setVoiceRef(undefined);
              setNarration(undefined);
            }}
          />
          {selectedVoiceAudioUrl ? (
            <audio
              data-uais-selected-audio-probe="metadata"
              aria-hidden="true"
              className="sr-only"
              preload="metadata"
              src={selectedVoiceAudioUrl}
              onLoadedMetadata={(event) => {
                const durationSeconds = event.currentTarget.duration;
                setSelectedVoiceDurationStatus(
                  Number.isFinite(durationSeconds) && durationSeconds >= 10
                    ? { status: "ready", durationSeconds }
                    : {
                        status: "blocked",
                        durationSeconds: Number.isFinite(durationSeconds)
                          ? durationSeconds
                          : 0,
                      },
                );
              }}
              onError={() => {
                setSelectedVoiceDurationStatus({ status: "unchecked" });
              }}
            />
          ) : null}
          <p className="mt-2 break-words text-xs text-[var(--muted)]">
            {selectedVoiceFileName}
          </p>
          <p className="mt-2 text-xs font-medium text-[var(--muted)]">
            {formatSelectedVoiceDurationStatus(selectedVoiceDurationStatus, locale)}
          </p>
          <AiOpsButton
            icon={<FileText size={16} weight="bold" />}
            onClick={() => void runWorkflowAction(registerTeacherVoice)}
            disabled={!canRegisterTeacherVoice}
          >
            {locale === "zh-CN" ? "登记教师声音" : "Register teacher voice"}
          </AiOpsButton>
          {sample ? (
            <p className="mt-3 text-sm font-medium text-[var(--foreground)]">
              {locale === "zh-CN"
                ? formatTeacherWorkflowSample(sample, locale)
                : `Voice sample ${sample.status}: ${sample.sampleAssetId} / ${sample.sampleDurationSeconds} seconds`}
            </p>
          ) : null}
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-3">
          <p className="text-xs font-semibold uppercase text-[var(--muted)]">
            {locale === "zh-CN" ? "2 实时预检" : "2 Live Preflight"}
          </p>
          <AiOpsButton
            icon={<ChartBar size={16} weight="bold" />}
            onClick={() => void runWorkflowAction(runWorkflowPreflight)}
            disabled={!canRunPreflight}
          >
            {locale === "zh-CN" ? "运行工作流预检" : "Run workflow preflight"}
          </AiOpsButton>
          {preflight ? (
            <p className="mt-3 text-sm font-medium text-[var(--foreground)]">
              {locale === "zh-CN"
                ? `预检${formatWorkflowStatus(preflight.status, locale)}：${summarizePreflightChecks(preflight.checks, locale)}`
                : `Preflight ${preflight.status}: ${summarizePreflightChecks(preflight.checks, locale)}`}
            </p>
          ) : !canRunPreflight ? (
            <p className="mt-3 text-sm text-[var(--muted)]">
              {locale === "zh-CN"
                ? "先登记 10 秒教师声音样本。"
                : "Register a 10-second teacher voice sample first."}
            </p>
          ) : (
            <p className="mt-3 text-sm text-[var(--muted)]">
              {locale === "zh-CN"
                ? "等待分工检查。"
                : "Waiting for S07/S12/S19/S24 checks."}
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-3">
          <p className="text-xs font-semibold uppercase text-[var(--muted)]">
            {locale === "zh-CN" ? "3 声音引用" : "3 VoiceRef"}
          </p>
          <AiOpsButton
            icon={<Robot size={16} weight="bold" />}
            onClick={() => void runWorkflowAction(saveVoiceRef)}
            disabled={!canSaveVoiceRef}
          >
            {locale === "zh-CN" ? "保存声音引用" : "Save voiceRef"}
          </AiOpsButton>
          {voiceRef ? (
            <div className="mt-3 space-y-1 text-sm font-medium text-[var(--foreground)]">
              <p className="break-words">
                {locale === "zh-CN"
                  ? `声音引用${formatWorkflowStatus(voiceRef.status, locale)}`
                  : `voiceRefId: ${voiceRef.voiceRefId}`}
              </p>
              <p>{formatTeacherVoiceRefDisplay(locale)}</p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-[var(--muted)]">
              {locale === "zh-CN"
                ? "预检就绪后保存声音引用。"
                : "Save the voiceRef after preflight is ready."}
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-3">
          <p className="text-xs font-semibold uppercase text-[var(--muted)]">
            {locale === "zh-CN" ? "4 课件音频" : "4 PPT WAV"}
          </p>
          <AiOpsButton
            icon={<ExportIcon size={16} weight="bold" />}
            onClick={() => void runWorkflowAction(generatePptNarration)}
            disabled={!canGenerateNarration}
          >
            {locale === "zh-CN" ? "生成课件配音" : "Generate PPT narration"}
          </AiOpsButton>
          {narration ? (
            <div className="mt-3 space-y-2">
              <p className="text-sm font-medium text-[var(--foreground)]">
                {locale === "zh-CN"
                  ? formatTeacherWorkflowNarration(narration, locale)
                  : `PPT narration ${narration.status}: ${narration.slideCount} slides / ${narration.audioManifestId}`}
              </p>
              <div className="flex flex-wrap gap-2">
                {narration.assets.map((asset) => (
                  <a
                    key={asset.audioId}
                    href={asset.downloadUrl}
                    download={`${asset.audioId}.wav`}
                    className="inline-flex min-h-9 items-center gap-2 rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 text-xs font-semibold text-[var(--accent)]"
                  >
                    <ExportIcon size={14} weight="bold" />
                    {locale === "zh-CN"
                      ? formatPptAudioDownloadLabel(asset, locale, "local")
                      : `Download ${asset.slideId} WAV`}
                  </a>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-3 space-y-1 text-sm text-[var(--muted)]">
              <span className="block">
                {locale === "zh-CN"
                  ? "保存声音引用后生成逐页音频。"
                  : "Generate per-slide WAV after saving the voiceRef."}
              </span>
              <span className="block">
                {locale === "zh-CN"
                  ? "生成后显示每页音频下载。"
                  : "Per-slide WAV downloads appear after generation."}
              </span>
            </p>
          )}
        </div>
      </div>

      {workflowError ? (
        <p className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-sm font-medium text-[var(--foreground)]">
          {workflowError}
        </p>
      ) : null}
    </div>
  );
}

function AiOpsWorkbench({
  locale,
  teacherActorId,
}: {
  locale: Locale;
  teacherActorId?: string;
}) {
  const [results, setResults] = useState<string[]>([]);

  async function runReadiness() {
    const body = await readJson<{ readiness: Array<{ provider: string; status: string }> }>(
      "/api/ai/readiness",
    );
    setResults(
      body.readiness.map((item) =>
        locale === "zh-CN"
          ? `${providerLabel(item.provider, locale)}：${formatWorkflowStatus(item.status, locale)}`
          : `${providerLabel(item.provider, locale)}: ${item.status}`,
      ),
    );
  }

  async function runSmokePlan() {
    const body = await readJson<{ mode: string; network: string }>("/api/ai/smoke-plan");
    appendResult(
      locale === "zh-CN"
        ? `试运行：${formatSmokeMode(body.mode, locale)} / 网络${formatWorkflowStatus(body.network, locale)}`
        : `Smoke: ${body.mode} / network ${body.network}`,
    );
  }

  async function runAgentContract() {
    const actorId = requireTeacherWorkflowActorId({ locale, teacherActorId });
    const body = await readProtectedTeacherWorkflowJson<{ turns?: Array<{ content: string }> }>({
      url: "/api/ai/chat",
      locale,
      action: "live-chat",
      resource: {
        teacherId: actorId,
        courseId: DEFAULT_COURSE_ID,
      },
      init: {
        method: "POST",
        body: JSON.stringify({
          courseId: DEFAULT_COURSE_ID,
          agents: [
            {
              id: "teacher",
              handle: "@教师",
              name: "教师",
              role: "teacher",
              providerRole: "text-reasoning",
              priority: 10,
              allowedActions: ["respond"],
            },
            {
              id: "methods",
              handle: "@方法顾问",
              name: "方法顾问",
              role: "assistant",
              providerRole: "text-reasoning",
              priority: 7,
              allowedActions: ["respond"],
            },
          ],
          messages: [{ id: "m1", role: "student", content: "变量怎么定？@方法顾问" }],
          maxAgentTurns: 2,
        }),
      },
    });
    appendResult(
      locale === "zh-CN"
        ? localizeAgentContractResult(
            body.turns?.[0]?.content ?? "Multi-agent contract ready",
            locale,
          )
        : body.turns?.[0]?.content ?? "Multi-agent contract ready",
    );
  }

  async function runVoiceSampleContract() {
    const actorId = requireTeacherWorkflowActorId({ locale, teacherActorId });
    const body = await readProtectedTeacherWorkflowJson<{
      sample?: { status?: string; sampleDurationSeconds?: number };
    }>({
      url: "/api/ai/voice-sample",
      locale,
      action: "voice-sample-submit",
      resource: {
        teacherId: actorId,
        courseId: DEFAULT_COURSE_ID,
        sampleAssetId: DEFAULT_SAMPLE_ASSET_ID,
      },
      init: {
        method: "POST",
        body: JSON.stringify({
          teacherId: actorId,
          consentConfirmed: true,
          consentScope: "ppt-narration",
          sampleAssetId: DEFAULT_SAMPLE_ASSET_ID,
          sampleDurationSeconds: 10,
          mimeType: "audio/wav",
          sourceKind: "owner-provided",
          language: locale,
        }),
      },
    });
    appendResult(
      locale === "zh-CN"
        ? `声音样本合同${formatWorkflowStatus(body.sample?.status ?? "ready-for-clone", locale)}：${
            body.sample?.sampleDurationSeconds ?? 10
          } 秒`
        : `Voice sample contract ${body.sample?.status ?? "ready-for-clone"}: ${
            body.sample?.sampleDurationSeconds ?? 10
          } seconds`,
    );
  }

  async function runVoiceClonePreflight() {
    const actorId = requireTeacherWorkflowActorId({ locale, teacherActorId });
    const body = await readProtectedTeacherWorkflowJson<{
      preflight?: {
        status?: string;
        checks?: Array<{ responsibleSession?: string; status?: string }>;
      };
    }>({
      url: "/api/ai/voice-clone/preflight",
      locale,
      action: "voice-clone-preflight",
      resource: {
        teacherId: actorId,
        courseId: DEFAULT_COURSE_ID,
        sampleAssetId: DEFAULT_SAMPLE_ASSET_ID,
      },
      init: {
        method: "POST",
        body: JSON.stringify({
          liveProviderApproved: true,
          teacherId: actorId,
          consentConfirmed: true,
          consentScope: "ppt-narration",
          sampleAssetId: DEFAULT_SAMPLE_ASSET_ID,
          sampleDurationSeconds: 10,
          mimeType: "audio/wav",
          sourceKind: "owner-provided",
          language: locale,
          targetVoiceLabel: "Kang teacher PPT voice",
        }),
      },
    });
    const checkSummary = summarizePreflightChecks(body.preflight?.checks ?? [], locale);
    appendResult(
      locale === "zh-CN"
        ? `声音克隆预检${formatWorkflowStatus(body.preflight?.status ?? "blocked", locale)}：${checkSummary}`
        : `Voice clone preflight ${body.preflight?.status ?? "blocked"}: ${checkSummary}`,
    );
  }

  async function runVoiceCloneStatusContract() {
    const actorId = requireTeacherWorkflowActorId({ locale, teacherActorId });
    const body = await readProtectedTeacherWorkflowJson<{
      voiceClone?: { status?: string; clonedVoiceId?: string; nextAction?: string };
    }>({
      url: "/api/ai/voice-clone/status",
      locale,
      action: "voice-clone-status",
      resource: {
        teacherId: actorId,
        courseId: DEFAULT_COURSE_ID,
        sampleAssetId: DEFAULT_SAMPLE_ASSET_ID,
        providerTaskId: "task-voice-redacted",
      },
      init: {
        method: "POST",
        body: JSON.stringify({
          teacherId: actorId,
          sampleAssetId: DEFAULT_SAMPLE_ASSET_ID,
          providerTaskId: "task-voice-redacted",
          providerStatus: "SUCCEEDED",
          clonedVoiceId: "voice-qwen-redacted",
        }),
      },
    });
    appendResult(
      locale === "zh-CN"
        ? `声音克隆${formatWorkflowStatus(body.voiceClone?.status ?? "ready", locale)}：${
            formatWorkflowAction(body.voiceClone?.nextAction ?? "pending", locale)
          }`
        : `Voice clone ${body.voiceClone?.status ?? "ready"}: ${
            body.voiceClone?.clonedVoiceId ?? body.voiceClone?.nextAction ?? "pending"
          }`,
    );
  }

  async function runPptNarrationContract() {
    const actorId = requireTeacherWorkflowActorId({ locale, teacherActorId });
    const slideScripts = createKangXiaPptSlideScripts(locale);
    const body = await readProtectedTeacherWorkflowJson<{
      pptNarrationJob?: { slideCount?: number; status?: string };
    }>({
      url: "/api/ai/ppt-narration",
      locale,
      action: "ppt-narration-submit",
      resource: {
        teacherId: actorId,
        courseId: DEFAULT_COURSE_ID,
        sampleAssetId: DEFAULT_SAMPLE_ASSET_ID,
        pptAssetId: DEFAULT_PPT_ASSET_ID,
        voiceRefId: buildPublicVoiceRefId(actorId, DEFAULT_SAMPLE_ASSET_ID),
      },
      init: {
        method: "POST",
        body: JSON.stringify({
          voiceClone: {
            teacherId: actorId,
            consentConfirmed: true,
            sampleAssetId: DEFAULT_SAMPLE_ASSET_ID,
            sampleDurationSeconds: 10,
            language: locale,
            targetVoiceLabel: "Kang teacher PPT voice",
          },
          pptNarration: {
            courseId: DEFAULT_COURSE_ID,
            pptAssetId: DEFAULT_PPT_ASSET_ID,
            clonedVoiceRef: buildPublicVoiceRefId(actorId, DEFAULT_SAMPLE_ASSET_ID),
            language: locale,
            slideScripts,
          },
        }),
      },
    });
    appendResult(
      locale === "zh-CN"
        ? `课件配音合同${formatWorkflowStatus(body.pptNarrationJob?.status ?? "queued", locale)}：${
            body.pptNarrationJob?.slideCount ?? 0
          } 页`
        : `PPT narration contract ${body.pptNarrationJob?.status ?? "queued"}: ${
            body.pptNarrationJob?.slideCount ?? 0
          } slide`,
    );
  }

  function appendResult(result: string) {
    setResults((current) => [...current, result]);
  }

  async function runAiOpsAction(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      appendResult(
        error instanceof Error ? error.message : createTeacherWorkflowAuthErrorMessage(locale),
      );
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
      <div className="flex flex-wrap gap-2">
        <AiOpsButton
          icon={<ChartBar size={16} weight="bold" />}
          onClick={() => void runAiOpsAction(runReadiness)}
        >
          {locale === "zh-CN" ? "刷新配置检查" : "Refresh readiness"}
        </AiOpsButton>
        <AiOpsButton
          icon={<ChartBar size={16} weight="bold" />}
          onClick={() => void runAiOpsAction(runSmokePlan)}
        >
          {locale === "zh-CN" ? "运行试测" : "Run dry-run smoke"}
        </AiOpsButton>
        <AiOpsButton
          icon={<Robot size={16} weight="bold" />}
          onClick={() => void runAiOpsAction(runAgentContract)}
        >
          {locale === "zh-CN" ? "试跑智能体合同" : "Run agent contract"}
        </AiOpsButton>
        <AiOpsButton
          icon={<FileText size={16} weight="bold" />}
          onClick={() => void runAiOpsAction(runVoiceSampleContract)}
        >
          {locale === "zh-CN" ? "登记声音样本合同" : "Register voice sample contract"}
        </AiOpsButton>
        <AiOpsButton
          icon={<FileText size={16} weight="bold" />}
          onClick={() => void runAiOpsAction(runVoiceClonePreflight)}
        >
          {locale === "zh-CN" ? "声音克隆实时预检" : "Voice clone live preflight"}
        </AiOpsButton>
        <AiOpsButton
          icon={<FileText size={16} weight="bold" />}
          onClick={() => void runAiOpsAction(runVoiceCloneStatusContract)}
        >
          {locale === "zh-CN" ? "检查声音克隆状态" : "Check voice clone status"}
        </AiOpsButton>
        <AiOpsButton
          icon={<FileText size={16} weight="bold" />}
          onClick={() => void runAiOpsAction(runPptNarrationContract)}
        >
          {locale === "zh-CN" ? "生成课件配音合同" : "Create PPT narration contract"}
        </AiOpsButton>
      </div>

      <div className="mt-3 space-y-2" aria-live="polite">
        {results.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            {locale === "zh-CN"
              ? "等待教师发起合同模式检查。"
              : "Waiting for contract-mode checks."}
          </p>
        ) : (
          results.map((result) => (
            <p
              key={result}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-sm font-medium text-[var(--foreground)]"
            >
              {result}
            </p>
          ))
        )}
      </div>
    </div>
  );
}

function AiOpsButton({
  children,
  disabled = false,
  icon,
  onClick,
}: {
  children: string;
  disabled?: boolean;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--foreground)] outline-none transition hover:bg-[var(--surface-soft)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-[var(--surface)] disabled:active:translate-y-0"
    >
      {icon}
      {children}
    </button>
  );
}

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: init?.credentials ?? "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${url}`);
  }

  return (await response.json()) as T;
}

async function readProtectedTeacherWorkflowJson<T>(input: {
  url: string;
  locale: Locale;
  action: TeacherWorkflowSessionAction;
  resource: TeacherWorkflowSessionResource;
  init: RequestInit;
}): Promise<T> {
  const accessHeaders = await requestTeacherAiSessionHeaders({
    action: input.action,
    resource: input.resource,
    locale: input.locale,
  });

  return await readJson<T>(input.url, {
    ...input.init,
    credentials: "same-origin",
    headers: {
      ...headersToRecord(input.init.headers),
      ...accessHeaders,
    },
  });
}

async function requestTeacherAiSessionHeaders(input: {
  action: TeacherWorkflowSessionAction;
  resource: TeacherWorkflowSessionResource;
  locale: Locale;
}): Promise<Record<string, string>> {
  try {
    const body = await readJson<{
      accessSession?: {
        headers?: Record<string, string>;
      };
    }>("/api/ai/session", {
      method: "POST",
      body: JSON.stringify({
        action: input.action,
        ttlSeconds: 300,
        resource: input.resource,
      }),
    });
    const headers = pickSignedAiAccessHeaders(body.accessSession?.headers);
    if (!hasSignedAiAccessHeaders(headers)) {
      throw new Error(createTeacherWorkflowAuthErrorMessage(input.locale));
    }
    return headers;
  } catch {
    throw new Error(createTeacherWorkflowAuthErrorMessage(input.locale));
  }
}

function pickSignedAiAccessHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> {
  const claims = headers?.["x-uais-access-claims"];
  const signature = headers?.["x-uais-access-signature"];
  if (!claims || !signature) {
    return {};
  }

  return {
    "x-uais-access-claims": claims,
    "x-uais-access-signature": signature,
  };
}

function hasSignedAiAccessHeaders(headers: Record<string, string>) {
  return Boolean(headers["x-uais-access-claims"] && headers["x-uais-access-signature"]);
}

async function readSelectedVoiceSampleAudio(
  sample: SelectedTeacherVoiceSample | undefined,
): Promise<{ mimeType?: string; sampleAudioBase64?: string }> {
  if (sample?.sourceKind !== "upload" || !sample.file) {
    return {};
  }

  return {
    mimeType: sample.file.type || sample.mimeType || "audio/wav",
    sampleAudioBase64: arrayBufferToBase64(await sample.file.arrayBuffer()),
  };
}

function formatSelectedVoiceDurationStatus(
  status: SelectedVoiceSampleDurationStatus,
  locale: Locale,
) {
  if (status.status === "owner-provided") {
    return locale === "zh-CN"
      ? "康霞 10 秒声音已选择。"
      : "Kang Xia 10-second voice selected.";
  }
  if (status.status === "checking") {
    return locale === "zh-CN" ? "正在读取音频时长。" : "Reading audio duration.";
  }
  if (status.status === "unchecked") {
    return locale === "zh-CN"
      ? "提交时将由服务端校验音频时长。"
      : "The server will verify audio duration on submit.";
  }

  const durationText = status.durationSeconds.toFixed(1);
  if (status.status === "blocked") {
    return locale === "zh-CN"
      ? `已选择音频 ${durationText} 秒，至少需要 10 秒。`
      : `Selected audio is ${durationText} seconds; at least 10 seconds is required.`;
  }

  return locale === "zh-CN"
    ? `已选择音频 ${durationText} 秒，可以登记。`
    : `Selected audio is ${durationText} seconds and can be registered.`;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    for (let index = 0; index < chunk.length; index += 1) {
      binary += String.fromCharCode(chunk[index]);
    }
  }

  return btoa(binary);
}

function createTeacherWorkflowAuthErrorMessage(locale: Locale) {
  return locale === "zh-CN"
    ? "教师登录会话缺失，无法签发智能访问权限。"
    : "Teacher login session is missing, so AI access cannot be issued.";
}

function readTeacherWorkflowActorId(input: {
  teacherActorId?: string;
  serverWorkflowTeacherId?: string;
}) {
  return (
    normalizeTeachingActorId(input.teacherActorId) ??
    normalizeTeachingActorId(input.serverWorkflowTeacherId)
  );
}

function requireTeacherWorkflowActorId(input: {
  locale: Locale;
  teacherActorId?: string;
  serverWorkflowTeacherId?: string;
}) {
  const actorId = readTeacherWorkflowActorId(input);
  if (!actorId) {
    throw new Error(createTeacherWorkflowAuthErrorMessage(input.locale));
  }
  return actorId;
}

function formatTeacherWorkflowSessionReadiness(
  readiness: TeacherWorkflowSessionReadiness | undefined,
  locale: Locale,
) {
  if (!readiness) {
    return locale === "zh-CN"
      ? "先检查教师登录会话，再运行受保护的声音与课件操作。"
      : "Check the teacher login session before protected voice and PPT actions.";
  }

  if (readiness.status === "checking") {
    return locale === "zh-CN"
      ? "正在检查签名智能访问会话。"
      : "Checking signed AI access session.";
  }

  if (readiness.status === "blocked") {
    return locale === "zh-CN"
      ? `签名智能访问会话受阻：${formatTeacherWorkflowAction(readiness.action, locale)}`
      : `Signed AI access session blocked: ${readiness.action}`;
  }

  return locale === "zh-CN"
    ? `签名智能访问会话就绪：${formatTeacherWorkflowAction(readiness.action, locale)}`
    : `Signed AI access session ready: ${readiness.action}`;
}

function formatTeacherWorkflowAction(action: string, locale: Locale) {
  if (locale !== "zh-CN") {
    return action;
  }

  return formatWorkflowAction(action, locale);
}

function formatTeacherVoiceRefDisplay(locale: Locale) {
  return locale === "zh-CN"
    ? "声音引用已在服务端保存，教师端不显示原始值。"
    : "voiceRef: saved server-side; raw value is not shown in the teacher UI";
}

function formatWorkflowStatus(status: string | undefined, locale: Locale) {
  const value = status ?? "pending";
  if (locale !== "zh-CN") {
    return value;
  }

  const statusLabels: Record<string, string> = {
    authorized: "已授权",
    blocked: "受阻",
    disabled: "关闭",
    missing: "缺失",
    pending: "待处理",
    present: "已配置",
    queued: "已排队",
    ready: "就绪",
    "ready-for-clone": "可用于复刻",
    "ready-for-downloads": "可下载",
    "ready-for-teacher-review": "待教师复核",
    "waiting-for-storage": "等待存储",
  };

  return statusLabels[value] ?? "待处理";
}

function formatSmokeMode(mode: string, locale: Locale) {
  if (locale !== "zh-CN") {
    return mode;
  }

  if (mode === "dry-run") {
    return "试运行";
  }

  return "检查";
}

function formatWorkflowAction(action: string | undefined, locale: Locale) {
  const value = action ?? "pending";
  if (locale !== "zh-CN") {
    return value;
  }

  const actionLabels: Record<string, string> = {
    "create-ppt-narration": "创建课件配音",
    pending: "待处理",
    "ppt-narration-submit": "课件配音提交",
    "resolve-preflight-blockers": "处理预检阻塞项",
    "review-and-download-ppt-narration": "复核并下载课件配音",
    "submit-qwen-voice-clone": "提交声音克隆",
    "voice-clone-preflight": "声音克隆预检",
    "voice-clone-status": "声音克隆状态",
    "voice-sample-submit": "声音样本提交",
    "wait-for-external-storage": "等待外部存储",
  };

  if (actionLabels[value]) {
    return actionLabels[value];
  }

  if (value.includes("voice")) {
    return "声音操作";
  }

  if (value.includes("ppt") || value.includes("narration")) {
    return "课件配音操作";
  }

  return "受保护操作";
}

function formatServerWorkflowStatusLine(workflow: TeacherServerWorkflow, locale: Locale) {
  if (locale !== "zh-CN") {
    return `Server workflow ${workflow.status}: ${workflow.nextAction}`;
  }

  return `服务端工作流${formatWorkflowStatus(workflow.status, locale)}：${formatWorkflowAction(
    workflow.nextAction,
    locale,
  )}`;
}

function formatServerWorkflowNextAction(
  handoffPlan: TeacherServerWorkflowHandoffPlan,
  workflow: TeacherServerWorkflow,
  locale: Locale,
) {
  const action = handoffPlan.nextAgent?.action ?? workflow.nextAction;
  if (locale !== "zh-CN") {
    return `Next ${handoffPlan.nextAgent?.responsibleSession ?? "S24"} / ${action}`;
  }

  return `下一步：${formatWorkflowAction(action, locale)}`;
}

function formatTeacherWorkflowSample(sample: TeacherWorkflowSample, locale: Locale) {
  if (locale !== "zh-CN") {
    return `Voice sample ${sample.status}: ${sample.sampleAssetId} / ${sample.sampleDurationSeconds} seconds`;
  }

  return `声音样本${formatWorkflowStatus(sample.status, locale)}：${sample.sampleDurationSeconds} 秒`;
}

function formatTeacherWorkflowNarration(narration: TeacherWorkflowNarration, locale: Locale) {
  if (locale !== "zh-CN") {
    return `PPT narration ${narration.status}: ${narration.slideCount} slides / ${narration.audioManifestId}`;
  }

  return `课件配音${formatWorkflowStatus(narration.status, locale)}：${narration.slideCount} 页音频`;
}

function formatPptAudioDownloadLabel(
  asset: TeacherWorkflowPptAsset,
  locale: Locale,
  source: "local" | "server",
) {
  if (locale !== "zh-CN") {
    return source === "server"
      ? `Download server ${asset.slideId} WAV`
      : `Download ${asset.slideId} WAV`;
  }

  const slideNumber = Number.parseInt(asset.slideId.replace(/\D/g, ""), 10);
  const slideLabel = Number.isFinite(slideNumber) ? `第 ${slideNumber} 页` : "单页";
  return source === "server" ? `下载服务器${slideLabel}音频` : `下载${slideLabel}音频`;
}

function formatAgentSessionName(session: string | undefined, locale: Locale) {
  const value = session ?? "";
  if (locale !== "zh-CN") {
    return value || "Owner";
  }

  const sessionLabels: Record<string, string> = {
    S07: "智能体定义",
    S12: "后端接口",
    S19: "环境配置",
    S22: "构建质量",
    S24: "导出质检",
  };

  return sessionLabels[value] ?? "责任分工";
}

function localizeAgentContractResult(result: string, locale: Locale) {
  if (locale !== "zh-CN") {
    return result;
  }

  if (result.includes("multi-agent") || result.includes("contract")) {
    return "方法顾问已通过多智能体合同响应。";
  }

  return result;
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return headers;
}

function providerLabel(provider: string, locale: Locale) {
  if (provider === "deepseek") {
    return locale === "zh-CN" ? "深度求索" : "DeepSeek";
  }

  if (provider === "qwen") {
    return locale === "zh-CN" ? "阿里千问" : "Qwen";
  }

  return locale === "zh-CN" ? "服务商" : provider;
}

function summarizePreflightChecks(
  checks: Array<{ responsibleSession?: string; status?: string }>,
  locale: Locale,
) {
  const sessionOrder = ["S07", "S12", "S19", "S24"];
  const summaries = sessionOrder.map((session) => {
    const check = checks.find((candidate) => candidate.responsibleSession === session);
    return locale === "zh-CN"
      ? `${formatAgentSessionName(session, locale)}${formatWorkflowStatus(check?.status ?? "blocked", locale)}`
      : `${session} ${check?.status ?? "blocked"}`;
  });

  return summaries.join(locale === "zh-CN" ? "，" : ", ");
}

function formatServerWorkflowStep(step: TeacherServerWorkflowStep, locale: Locale) {
  if (locale === "zh-CN") {
    const stepLabels: Record<TeacherServerWorkflowStep["id"], string> = {
      "ppt-material": "课件材料",
      "ppt-narration": "课件配音",
      "voice-clone": "声音克隆",
      "voice-sample": "声音样本",
    };

    return `${stepLabels[step.id]}${formatWorkflowStatus(step.status, locale)}`;
  }

  return `${step.id} ${step.status}: ${
    step.sampleAssetId ??
    step.voiceRefId ??
    step.pptAssetId ??
    step.audioManifestId ??
    "pending"
  }`;
}

function formatServerWorkflowProgressOwner(
  item: TeacherServerWorkflowProgressItem,
  locale: Locale,
) {
  if (locale === "zh-CN") {
    return `${formatAgentSessionName(item.responsibleSession, locale)} / ${formatWorkflowStatus(
      item.status,
      locale,
    )}`;
  }

  return `${item.responsibleAgent?.name ?? item.responsibleSession ?? item.id} / ${item.status}`;
}

function formatServerWorkflowProgressText(
  item: TeacherServerWorkflowProgressItem,
  locale: Locale,
) {
  if (locale !== "zh-CN") {
    return item.progressText ?? "";
  }

  if (item.type?.includes("auth-boundary")) {
    return "已确认签名教师会话可用于组装课件配音工作流。";
  }

  if (item.type?.includes("provider-env")) {
    return "已确认配音服务环境配置状态，未暴露凭据。";
  }

  if (item.type?.includes("route-smoke")) {
    return "发布前仍需完成部署路由冒烟检查。";
  }

  if (item.responsibleSession === "S22") {
    return "正在等待生产存储冒烟证据。";
  }

  return "进度状态已同步。";
}

function createServerWorkflowDownloadAssets(input: {
  locale: Locale;
  audioDownloadPattern: string;
}): TeacherWorkflowPptAsset[] {
  return createKangXiaPptSlideScripts(input.locale).map((script) => {
    const audioId = `audio-${script.slideId}`;
    return {
      slideId: script.slideId,
      audioId,
      downloadUrl: input.audioDownloadPattern.replace("{audioId}", audioId),
    };
  });
}

function buildPublicVoiceRefId(teacherId: string, sampleAssetId: string) {
  return `qwen-voice-ref-${teacherId}-${sampleAssetId}`;
}

function resolveSelectedTeacherVoiceSampleAssetId(input: {
  actorId: string;
  selectedVoiceSample: SelectedTeacherVoiceSample | undefined;
}) {
  if (input.selectedVoiceSample?.sourceKind === "upload") {
    return buildUploadSampleAssetId(input.actorId, input.selectedVoiceSample.fileName);
  }
  return input.selectedVoiceSample?.sampleAssetId ?? DEFAULT_SAMPLE_ASSET_ID;
}

function buildUploadSampleAssetId(teacherId: string, fileName: string) {
  return `${teacherId}-upload-${slugifyPublicId(fileName)}`;
}

function slugifyPublicId(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "selected-voice";
}

function isPersistedInlineTeachingOperationReceipt(
  receipt: InlineTeachingOperationBackendReceipt | undefined,
) {
  return Boolean(receipt?.receiptId && receipt.status === "persisted");
}

function hasSignedInlineTeachingOperationReceiptAudit(
  receipt: InlineTeachingOperationBackendReceipt | undefined,
) {
  return (
    receipt?.audit?.authMode === "signed-teacher-session" &&
    hasCompleteInlineTeachingAuthSession(receipt.audit.authSession)
  );
}

function hasCompleteInlineTeachingAuthSession(
  authSession: InlineTeachingOperationAuditAuthSession | undefined,
) {
  return (
    typeof authSession?.sessionId === "string" &&
    authSession.sessionId.trim().length > 0 &&
    typeof authSession.authenticatedAt === "string" &&
    authSession.authenticatedAt.trim().length > 0 &&
    typeof authSession.expiresAt === "string" &&
    authSession.expiresAt.trim().length > 0
  );
}

function isMismatchedInlineTeachingOperationReceipt(
  receipt: InlineTeachingOperationBackendReceipt | undefined,
  expected: {
    operationId: TeachingOperationId;
    actionSlot: "primary" | "secondary";
  },
) {
  if (!receipt) {
    return false;
  }
  if (receipt.operationId && receipt.operationId !== expected.operationId) {
    return true;
  }
  if (receipt.actionSlot && receipt.actionSlot !== expected.actionSlot) {
    return true;
  }
  return false;
}

function isMismatchedOrIncompleteInlineTeachingOperationReceipt(
  receipt: InlineTeachingOperationBackendReceipt | undefined,
  expected: {
    operationId: TeachingOperationId;
    actionSlot: "primary" | "secondary";
  },
) {
  return (
    !receipt?.operationId ||
    !receipt.actionSlot ||
    isMismatchedInlineTeachingOperationReceipt(receipt, expected)
  );
}

function createKangXiaPptSlideScripts(locale: Locale) {
  const zhTopics = [
    "课程目标与学习路径",
    "核心概念导入",
    "研究问题定位",
    "变量与情境关系",
    "案例观察任务",
    "学生小组讨论",
    "智能助教提示边界",
    "证据收集方式",
    "课堂即时反馈",
    "方法选择理由",
    "数据解释规范",
    "常见误区澄清",
    "学习过程记录",
    "同伴互评安排",
    "教师总结提示",
    "作业衔接说明",
    "后续阅读建议",
    "课堂产出检查",
    "结束与下一步",
  ];
  const enTopics = [
    "course goals and learning path",
    "core concept opening",
    "research question framing",
    "variables and context",
    "case observation task",
    "student group discussion",
    "AI tutor boundary",
    "evidence collection",
    "classroom feedback",
    "method selection rationale",
    "data interpretation norms",
    "common misconception check",
    "learning process record",
    "peer review plan",
    "teacher summary cue",
    "assignment handoff",
    "further reading",
    "class output check",
    "closing and next step",
  ];

  return zhTopics.map((topic, index) => {
    const slideNumber = index + 1;
    const slideId = `slide-${String(slideNumber).padStart(2, "0")}`;
    return {
      slideId,
      narrationText:
        locale === "zh-CN"
          ? `康霞课件第 ${slideNumber} 页：${topic}。`
          : `Kang Xia PPT slide ${slideNumber}: ${enTopics[index]}.`,
    };
  });
}

function agentEnglishName(name: string) {
  const names: Record<string, string> = {
    研究助教: "Research TA",
    方法顾问: "Methods Advisor",
    数学助教: "Math TA",
    写作助手: "Writing Helper",
  };
  return names[name] ?? name;
}
