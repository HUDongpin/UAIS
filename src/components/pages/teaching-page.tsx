"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AiOpsWorkbench, TeacherPptNarrationWorkflow } from "./teacher-ppt-narration-workflow";
import {
  createEnterpriseWorkspaceConfig,
  createInlineWorkspaceActionConfig,
} from "./teaching-page-workspace-config";
import {
  createAlertNotificationFailureStatus,
  createCourseCoverBindingPartialFailureMessage,
  createCourseCoverGenerationFailureMessage,
  createInlineDomainPersistenceFailureStatus,
  createInlineWorkspaceFailureStatus,
  createInvitationQrCells,
  createInviteJoinUrl,
  createInvitePartialFailureStatus,
  createInviteWorkspaceFailureStatus,
  createMembershipApprovalFailureStatus,
  createRollbackFailureStatus,
  createTeachingClassActionHref,
  createTeachingClassCreateFailureMessage,
  createTeachingClassCreateReceiptMissingMessage,
  createTeachingCourseCreateFailureMessage,
  createTeachingCourseCreateOwnershipEvidenceMissingMessage,
  createTeachingCourseCreateReceiptMissingMessage,
  isMergedCourseOwnershipReceipt,
  isPersistedInvitePublicationReceipt,
  isPersistedTeachingClassCreateReceipt,
  isPersistedTeachingCourseCreateReceipt,
  isRecoverableCourseCoverBindingFailure,
  readJsonPayload,
  verifyCourseCoverAssetPersistence,
} from "./teaching-page-helpers";
import {
  agentEnglishName,
  createKangXiaPptSlideScripts,
  formatWorkflowStatus,
} from "./teacher-ppt-narration-workflow-format";
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
import {
  INVITE_CLASS_INVITATION_READBACK_MISMATCH_MESSAGE,
  INVITE_CODE_COPIED_MESSAGE,
  INVITE_CODE_DRAFT_READBACK_MISMATCH_MESSAGE,
  INVITE_COPY_FAILED_MESSAGE,
  INVITE_ENROLLMENT_ACCESS_READBACK_MISMATCH_MESSAGE,
  INVITE_GENERATED_MESSAGE,
  INVITE_LINK_COPIED_MESSAGE,
  INVITE_PUBLICATION_RECEIPT_MISSING_MESSAGE,
  INVITE_PUBLISHED_MESSAGE,
  INVITE_READY_MESSAGE,
  MEMBERSHIP_APPROVAL_FAILED_MESSAGE,
  MEMBERSHIP_APPROVAL_PENDING_MESSAGE,
  MEMBERSHIP_APPROVAL_READBACK_MISMATCH_MESSAGE,
  MEMBERSHIP_APPROVAL_READBACK_MISSING_MESSAGE,
  MEMBERSHIP_APPROVAL_RECEIPT_MISSING_MESSAGE,
  TEACHING_ADMIN_SETTINGS_READBACK_MISMATCH_MESSAGE,
  TEACHING_AGENT_PLAN_READBACK_MISMATCH_MESSAGE,
  TEACHING_AI_FEEDBACK_DRAFT_READBACK_MISMATCH_MESSAGE,
  TEACHING_CLASS_CREATE_READBACK_MISMATCH_MESSAGE,
  TEACHING_CLASS_CREATE_READBACK_MISSING_MESSAGE,
  TEACHING_COLLABORATION_INVITE_NOTIFICATION_READBACK_MISMATCH_MESSAGE,
  TEACHING_COURSE_CONTENT_READBACK_MISMATCH_MESSAGE,
  TEACHING_COURSE_COVER_TEACHER_READBACK_REQUIRED_MESSAGE,
  TEACHING_COURSE_CREATE_READBACK_MISMATCH_MESSAGE,
  TEACHING_COURSE_CREATE_READBACK_MISSING_MESSAGE,
  TEACHING_COURSE_LOAD_FAILED_MESSAGE,
  TEACHING_COURSE_SETTINGS_READBACK_MISMATCH_MESSAGE,
  TEACHING_DASHBOARD_SNAPSHOT_READBACK_MISMATCH_MESSAGE,
  TEACHING_DASHBOARD_STATE_READBACK_MISMATCH_MESSAGE,
  TEACHING_EXPORT_MANIFEST_READBACK_MISMATCH_MESSAGE,
  TEACHING_GRADING_QUEUE_READBACK_MISMATCH_MESSAGE,
  TEACHING_GROUP_SUGGESTIONS_READBACK_MISMATCH_MESSAGE,
  TEACHING_KNOWLEDGE_INDEX_READBACK_MISMATCH_MESSAGE,
  TEACHING_OPERATION_ALERT_FAILED_MESSAGE,
  TEACHING_OPERATION_ALERT_NOTIFICATION_FAILED_MESSAGE,
  TEACHING_OPERATION_ALERT_NOTIFICATION_PENDING_MESSAGE,
  TEACHING_OPERATION_ALERT_PENDING_MESSAGE,
  TEACHING_OPERATION_AUDIT_FAILED_MESSAGE,
  TEACHING_OPERATION_AUDIT_PENDING_MESSAGE,
  TEACHING_OPERATION_RECEIPT_MISMATCH_MESSAGE,
  TEACHING_OPERATION_ROLLBACK_FAILED_MESSAGE,
  TEACHING_OPERATION_ROLLBACK_PENDING_MESSAGE,
  TEACHING_OPERATION_SAVE_FAILED_MESSAGE,
  TEACHING_OPERATION_SAVE_PENDING_MESSAGE,
  TEACHING_PERMISSION_PREFLIGHT_READBACK_MISMATCH_MESSAGE,
  TEACHING_QUIZ_BOARD_STATE_READBACK_MISMATCH_MESSAGE,
  TEACHING_QUIZ_ITEM_REVIEW_READBACK_MISMATCH_MESSAGE,
  TEACHING_REDACTION_VALIDATION_READBACK_MISMATCH_MESSAGE,
  TEACHING_RESOURCE_REVIEW_ITEM_READBACK_MISMATCH_MESSAGE,
  TEACHING_STUDENT_PREVIEW_SESSION_READBACK_MISMATCH_MESSAGE,
  TEACHING_STUDENT_ROSTER_READBACK_MISMATCH_MESSAGE,
  TEACHING_UNIT_DRAFT_READBACK_MISMATCH_MESSAGE,
} from "./teaching-page-messages";
import {
  INLINE_OPERATION_EXPECTED_DOMAIN_OBJECT_TYPES,
  type CourseCoverGenerationResponse,
  type GeneratedCourseCover,
  type InlineInviteBackendArtifact,
  type InlineInviteOperationResponse,
  type InlineTeachingOperationAuditAlertNotificationResponse,
  type InlineTeachingOperationAuditAlertSummaryResponse,
  type InlineTeachingOperationAuditAuthSession,
  type InlineTeachingOperationAuditReadbackResponse,
  type InlineTeachingOperationBackendReceipt,
  type InlineTeachingOperationDomainPersistenceSummary,
  type InlineTeachingOperationDomainProjection,
  type InlineTeachingOperationErrorResponse,
  type InlineTeachingOperationRecord,
  type InlineWorkspaceAlertNotificationStatus,
  type InlineWorkspaceAlertStatus,
  type InlineWorkspaceAuditStatus,
  type InlineWorkspaceRollbackStatus,
  type TeacherCourseAction,
} from "./teaching-page-types";

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

const DEFAULT_INVITE_CODE = "55395057";
const INVITE_VALID_UNTIL = "2026-12-17";
const INVITE_JOIN_LIMIT = 60;

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

