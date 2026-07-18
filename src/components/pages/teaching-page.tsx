"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AiOpsWorkbench, TeacherPptNarrationWorkflow } from "./teacher-ppt-narration-workflow";
import {
  createEnterpriseWorkspaceConfig,
  createInlineWorkspaceActionConfig,
} from "./teaching-page-workspace-config";
import { InlineWorkspaceStatus } from "./teaching-page-inline-workspace-status";
import { WorkspaceContext } from "./teaching-page-workspace-context";
import { InlineWorkspaceActionButtons } from "./teaching-page-inline-workspace-action-buttons";
import {
  doesInlineCourseSettingsProjectionMatchPatch,
  doesInlineDomainProjectionMatchBusinessSemantics,
  doesInlineDomainReadbackMatchBusinessSemantics,
  findMatchingInlineDomainProjection,
  findMatchingInlineDomainProjections,
  getInlineDomainProjectionSemanticMismatchMessage,
} from "./teaching-page-projection-verifiers";
import {
  createAlertNotificationFailureStatus,
  createInlineDomainPersistenceFailureStatus,
  createInlineWorkspaceFailureStatus,
  createInviteJoinUrl,
  createInvitePartialFailureStatus,
  createInviteWorkspaceFailureStatus,
  createMembershipApprovalFailureStatus,
  createRollbackFailureStatus,
  createTeachingClassCreateFailureMessage,
  createTeachingClassCreateReceiptMissingMessage,
  createTeachingCourseCreateFailureMessage,
  createTeachingCourseCreateOwnershipEvidenceMissingMessage,
  createTeachingCourseCreateReceiptMissingMessage,
  isMergedCourseOwnershipReceipt,
  isPersistedInvitePublicationReceipt,
  isPersistedTeachingClassCreateReceipt,
  isPersistedTeachingCourseCreateReceipt,
  readJsonPayload,
} from "./teaching-page-helpers";
import {
  ClassInvitationDialog,
  CourseClassManager,
  InlineInvitationQrPattern,
  NewClassDialog,
  NewCourseDialog,
} from "./teaching-page-dialogs";
import {
  agentEnglishName,
  createKangXiaPptSlideScripts,
  formatWorkflowStatus,
} from "./teacher-ppt-narration-workflow-format";
import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { BookOpen } from "@phosphor-icons/react/dist/ssr/BookOpen";
import { Books } from "@phosphor-icons/react/dist/ssr/Books";
import { ChartBar } from "@phosphor-icons/react/dist/ssr/ChartBar";
import { ClipboardText } from "@phosphor-icons/react/dist/ssr/ClipboardText";
import { Exam } from "@phosphor-icons/react/dist/ssr/Exam";
import { Export as ExportIcon } from "@phosphor-icons/react/dist/ssr/Export";
import { FileText } from "@phosphor-icons/react/dist/ssr/FileText";
import { GearSix } from "@phosphor-icons/react/dist/ssr/GearSix";
import { Plus } from "@phosphor-icons/react/dist/ssr/Plus";
import { QrCode } from "@phosphor-icons/react/dist/ssr/QrCode";
import { Robot } from "@phosphor-icons/react/dist/ssr/Robot";
import { SquaresFour } from "@phosphor-icons/react/dist/ssr/SquaresFour";
import { UserGear } from "@phosphor-icons/react/dist/ssr/UserGear";
import { UsersThree } from "@phosphor-icons/react/dist/ssr/UsersThree";
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
import type { LocalizedText } from "@/i18n/copy";
import { getProviderForRole } from "@/lib/ai/providers/registry";
import {
  createPptNarrationJob,
  createTeacherVoiceCloneJob,
} from "@/lib/ai/voice/ppt-narration";
import {
  applyCourseSettingsPatchToTeacherCourse,
  createCourseSettingsDraft,
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
  TEACHING_CLASS_CREATE_READBACK_MISMATCH_MESSAGE,
  TEACHING_CLASS_CREATE_READBACK_MISSING_MESSAGE,
  TEACHING_COURSE_CREATE_READBACK_MISMATCH_MESSAGE,
  TEACHING_COURSE_CREATE_READBACK_MISSING_MESSAGE,
  TEACHING_COURSE_LOAD_FAILED_MESSAGE,
  TEACHING_COURSE_SETTINGS_READBACK_MISMATCH_MESSAGE,
  TEACHING_OPERATION_ALERT_FAILED_MESSAGE,
  TEACHING_OPERATION_ALERT_NOTIFICATION_FAILED_MESSAGE,
  TEACHING_OPERATION_ALERT_PENDING_MESSAGE,
  TEACHING_OPERATION_AUDIT_FAILED_MESSAGE,
  TEACHING_OPERATION_AUDIT_PENDING_MESSAGE,
  TEACHING_OPERATION_RECEIPT_MISMATCH_MESSAGE,
  TEACHING_OPERATION_ROLLBACK_FAILED_MESSAGE,
  TEACHING_OPERATION_SAVE_FAILED_MESSAGE,
  TEACHING_OPERATION_SAVE_PENDING_MESSAGE,
} from "./teaching-page-messages";
import {
  type InlineInviteBackendArtifact,
  type InlineInviteOperationResponse,
  type InlineTeachingOperationAuditAlertNotificationResponse,
  type InlineTeachingOperationAuditAlertSummaryResponse,
  type InlineTeachingOperationAuditAuthSession,
  type InlineTeachingOperationAuditReadbackResponse,
  type InlineTeachingOperationBackendReceipt,
  type InlineTeachingOperationDomainPersistenceSummary,
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
              {<InlineWorkspaceActionButtons
              operationId={"course-settings"}
              locale={locale}
              inlineWorkspaceStatuses={inlineWorkspaceStatuses}
              runInlineWorkspaceAction={runInlineWorkspaceAction}
            />}
            </div>
          </div>

          {<WorkspaceContext
            locale={locale}
            activeWorkspaceItem={activeWorkspaceItem}
            selectedCourseAction={selectedCourseAction}
            selectedActionCourse={selectedActionCourse}
            selectedCourseActionLabel={selectedCourseActionLabel}
          />}
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
          {<InlineWorkspaceStatus
            operationId="course-settings"
            locale={locale}
            inlineWorkspaceStatuses={inlineWorkspaceStatuses}
            inlineWorkspaceAuditStatuses={inlineWorkspaceAuditStatuses}
            inlineWorkspaceAlertStatuses={inlineWorkspaceAlertStatuses}
            inlineWorkspaceAlertNotificationStatuses={inlineWorkspaceAlertNotificationStatuses}
            inlineWorkspaceRollbackStatuses={inlineWorkspaceRollbackStatuses}
            runInlineWorkspaceRollback={runInlineWorkspaceRollback}
            queueInlineWorkspaceAuditAlertNotifications={queueInlineWorkspaceAuditAlertNotifications}
          />}

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
            {<InlineWorkspaceActionButtons
              operationId={"agents"}
              locale={locale}
              inlineWorkspaceStatuses={inlineWorkspaceStatuses}
              runInlineWorkspaceAction={runInlineWorkspaceAction}
            />}
          </div>

          <div className="mt-5">
            {<WorkspaceContext
            locale={locale}
            activeWorkspaceItem={activeWorkspaceItem}
            selectedCourseAction={selectedCourseAction}
            selectedActionCourse={selectedActionCourse}
            selectedCourseActionLabel={selectedCourseActionLabel}
          />}
          </div>
          {<InlineWorkspaceStatus
            operationId="agents"
            locale={locale}
            inlineWorkspaceStatuses={inlineWorkspaceStatuses}
            inlineWorkspaceAuditStatuses={inlineWorkspaceAuditStatuses}
            inlineWorkspaceAlertStatuses={inlineWorkspaceAlertStatuses}
            inlineWorkspaceAlertNotificationStatuses={inlineWorkspaceAlertNotificationStatuses}
            inlineWorkspaceRollbackStatuses={inlineWorkspaceRollbackStatuses}
            runInlineWorkspaceRollback={runInlineWorkspaceRollback}
            queueInlineWorkspaceAuditAlertNotifications={queueInlineWorkspaceAuditAlertNotifications}
          />}

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
              <InlineWorkspaceActionButtons
                operationId={config.id}
                locale={locale}
                inlineWorkspaceStatuses={inlineWorkspaceStatuses}
                runInlineWorkspaceAction={runInlineWorkspaceAction}
              />
            )}
          </div>

          <div className="mt-5">
            {<WorkspaceContext
            locale={locale}
            activeWorkspaceItem={activeWorkspaceItem}
            selectedCourseAction={selectedCourseAction}
            selectedActionCourse={selectedActionCourse}
            selectedCourseActionLabel={selectedCourseActionLabel}
          />}
          </div>
          {config.id === "invite-code" ? null : <InlineWorkspaceStatus
              operationId={config.id}
              locale={locale}
              inlineWorkspaceStatuses={inlineWorkspaceStatuses}
              inlineWorkspaceAuditStatuses={inlineWorkspaceAuditStatuses}
              inlineWorkspaceAlertStatuses={inlineWorkspaceAlertStatuses}
              inlineWorkspaceAlertNotificationStatuses={inlineWorkspaceAlertNotificationStatuses}
              inlineWorkspaceRollbackStatuses={inlineWorkspaceRollbackStatuses}
              runInlineWorkspaceRollback={runInlineWorkspaceRollback}
              queueInlineWorkspaceAuditAlertNotifications={queueInlineWorkspaceAuditAlertNotifications}
            />}

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

