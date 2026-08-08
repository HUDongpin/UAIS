"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  hasCompleteInlineTeachingAuthSession,
  hasSignedInlineTeachingOperationReceiptAudit,
  isMismatchedOrIncompleteInlineTeachingOperationReceipt,
  isPersistedInlineTeachingOperationReceipt,
} from "./teaching-page-inline-receipt-guards";
import {
  createInlineWorkspaceActionConfig,
} from "./teaching-page-workspace-config";
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
} from "./teaching-page-dialogs";
import {
  createKangXiaPptSlideScripts,
} from "./teacher-ppt-narration-workflow-format";
import { useAppPreferences } from "@/components/providers/app-preferences";
import {
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
  createCourseSettingsDraftEntries,
  createCourseSettingsPatchFromDraft,
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
  resolveCourseSettingsDraftValues,
  shouldLoadPersistedTeachingCourses,
  type CourseSettingsDraft,
  type CourseSettingsDraftFieldInput,
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
  INVITE_CODE_DRAFT_READBACK_MISMATCH_MESSAGE,
  INVITE_COPY_FAILED_MESSAGE,
  INVITE_ENROLLMENT_ACCESS_READBACK_MISMATCH_MESSAGE,
  INVITE_GENERATED_MESSAGE,
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


// Learning-group (chatroom group) workspace handlers. They live in a sibling
// module because this file already sits at the 1500-code-line source cap; they
// are re-exported here so the teacher workspace keeps one handler entry point.
export {
  createLearningGroupFailureMessage,
  createLearningGroupsByCourse,
  learningGroupMaxMembers,
  learningGroupMinMembers,
  useTeachingLearningGroupsWorkspace,
  type TeachingLearningGroupDraft,
  type TeachingLearningGroupItem,
  type TeachingLearningGroupMemberItem,
  type TeachingLearningGroupPatch,
} from "@/components/teaching/use-teaching-learning-groups";

const DEFAULT_INVITE_CODE = "55395057";

// Teacher-workspace state + operation handlers hook (Phase 3 decomposition of
// teaching-page.tsx). Owns all workspace useState/useEffect and the create/approve/
// inline-operation/invite handlers; returns them for the TeachingPage shell to render.
// Handler bodies are moved verbatim from the component, so behavior is unchanged.
export function useTeachingWorkspace() {
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
  // Chatroom-groups feature gate (plan D9). Starts false so a workspace that has
  // not heard from the server — or a deployment with the flag off — shows no
  // group surface at all.
  const [learningChatroomGroupsEnabled, setLearningChatroomGroupsEnabled] = useState(false);
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
        // Chatroom-groups plan D9: the group surface is hidden until the server
        // says the feature is live. Only an explicit `true` counts, and it rides
        // this existing read so the workspace issues no extra request for it.
        learningChatroomGroupsEnabled: body.features?.learningChatroomGroups === true,
      };
    }, [locale]);

  const applyPersistedTeachingCourseReadback = useCallback(
    (readback: PersistedTeachingCourseReadback) => {
      setLearningChatroomGroupsEnabled(readback.learningChatroomGroupsEnabled);
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
    ? resolveCourseSettingsDraftValues(
        activeCourseSettingsCourse,
        courseSettingsDrafts[activeCourseSettingsCourse.id],
        locale,
      )
    : undefined;

  function openWorkspaceItem(itemId: string) {
    if (isTeachingOperationId(itemId)) {
      setActiveWorkspaceItemId(itemId);
    }
  }

  function updateCourseSettingsDraft(course: TeacherCourse, patch: CourseSettingsDraftFieldInput) {
    // Merge only the edited field(s): the stored draft stays sparse so untouched
    // fields keep tracking the persisted value at the current locale. Each written
    // field is stamped with the locale it was typed under, so a later language
    // toggle cannot change whether it counts as an edit.
    const touchedEntries = createCourseSettingsDraftEntries(patch, locale);
    setCourseSettingsDrafts((currentDrafts) => ({
      ...currentDrafts,
      [course.id]: {
        ...currentDrafts[course.id],
        ...touchedEntries,
      },
    }));
  }

  function createCourseSettingsPatch(courseId: string): CourseSettingsPatchPayload | undefined {
    const course = courseCards.find((courseCard) => courseCard.id === courseId);
    if (!course) {
      return undefined;
    }

    // Shares one "is this field actually edited?" rule with the form display, so a
    // touched-then-reverted field cannot ship the pre-switch locale's string.
    return createCourseSettingsPatchFromDraft(course, courseSettingsDrafts[course.id]);
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


  return {
    locale,
    t,
    courseCards,
    setCourseCards,
    activeWorkspaceItemId,
    setActiveWorkspaceItemId,
    selectedCourseAction,
    isNewCourseOpen,
    setIsNewCourseOpen,
    newClassCourseId,
    setNewClassCourseId,
    courseClasses,
    setCourseClasses,
    classMemberships,
    setClassMemberships,
    authenticatedTeacherActorId,
    setAuthenticatedTeacherActorId,
    learningChatroomGroupsEnabled,
    persistedCourseLoadError,
    setPersistedCourseLoadError,
    membershipApprovalStatuses,
    setMembershipApprovalStatuses,
    selectedClassInvitation,
    setSelectedClassInvitation,
    inviteWorkspaceCode,
    setInviteWorkspaceCode,
    inviteWorkspaceJoinUrl,
    setInviteWorkspaceJoinUrl,
    inviteWorkspaceStatus,
    setInviteWorkspaceStatus,
    inlineWorkspaceStatuses,
    setInlineWorkspaceStatuses,
    inlineWorkspaceAuditStatuses,
    setInlineWorkspaceAuditStatuses,
    inlineWorkspaceAlertStatuses,
    setInlineWorkspaceAlertStatuses,
    inlineWorkspaceAlertNotificationStatuses,
    setInlineWorkspaceAlertNotificationStatuses,
    inlineWorkspaceRollbackStatuses,
    setInlineWorkspaceRollbackStatuses,
    inlineWorkspaceAttemptIdsRef,
    courseSettingsDrafts,
    setCourseSettingsDrafts,
    textReasoningProvider,
    multimodalProvider,
    kangXiaPptSlideScripts,
    voiceCloneJob,
    pptNarrationJob,
    readPersistedTeachingCourseState,
    applyPersistedTeachingCourseReadback,
    createCourseFromDraft,
    createClassForCourse,
    approveClassMembership,
    newClassCourse,
    activeWorkspaceItem,
    selectedActionCourse,
    selectedCourseActionLabel,
    activeCourseSettingsCourse,
    activeCourseSettingsDraft,
    openWorkspaceItem,
    updateCourseSettingsDraft,
    createCourseSettingsPatch,
    applyVerifiedCourseSettingsPatch,
    runInlineWorkspaceAction,
    readInlineWorkspaceAuditEvidence,
    readInlineWorkspaceAuditAlerts,
    createInlineWorkspaceAttemptId,
    isCurrentInlineWorkspaceAttempt,
    isInlineAuditRecordForAction,
    isVerifiedInlineAuditAuthSession,
    queueInlineWorkspaceAuditAlertNotifications,
    runInlineWorkspaceRollback,
    runInviteWorkspaceAction,
    readInviteWorkspaceAuditEvidence,
    applyInviteWorkspaceReceiptWithPublicationReadback,
    applyInviteWorkspaceReceipt,
    resolveInviteWorkspaceTargetClassId,
    copyInviteWorkspaceValue,
  };
}
