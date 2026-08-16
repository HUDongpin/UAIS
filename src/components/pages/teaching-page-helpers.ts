// Pure helper functions for the teacher workspace (Phase 3 decomposition of
// teaching-page.tsx): failure/partial-failure status builders, course-cover and
// create-receipt guards, invite URL/QR helpers. No JSX or hooks — shared by the main
// page component and the extracted course/class dialog components.



import { getTeachingOperationHref } from "@/components/teaching/teaching-operation-data";
import type { TeachingOperationId } from "@/components/teaching/teaching-operation-data";
import { localizedText } from "@/components/ui/localized-text";
import type { Locale, LocalizedText } from "@/i18n/copy";
import type {
  TeacherClassItem,
  TeachingClassCreateResponse,
  TeachingClassMembershipApproveResponse,
  TeachingCourseCreateResponse,
} from "@/lib/teaching/course-readback";
import {
  MEMBERSHIP_APPROVAL_FAILED_MESSAGE,
  TEACHING_CLASS_CREATE_RECEIPT_MISSING_MESSAGE,
  TEACHING_COURSE_COVER_ASSET_PERSISTENCE_REQUIRED_MESSAGE,
  TEACHING_COURSE_COVER_AUDIT_REQUIRED_MESSAGE,
  TEACHING_COURSE_CREATE_OWNERSHIP_EVIDENCE_MISSING_MESSAGE,
  TEACHING_COURSE_CREATE_RECEIPT_MISSING_MESSAGE,
  TEACHING_OPERATION_ALERT_NOTIFICATION_FAILED_MESSAGE,
  TEACHING_OPERATION_ROLLBACK_FAILED_MESSAGE,
  TEACHING_OPERATION_SAVE_FAILED_MESSAGE,
} from "./teaching-page-messages";
import type {
  CourseCoverGenerationResponse,
  InlineInviteOperationResponse,
  InlineInvitePartialFailure,
  InlineInvitePublicationReceipt,
  InlineTeachingOperationAuditAuthSession,
  InlineTeachingOperationBackendReceipt,
  InlineTeachingOperationDomainPersistenceSummary,
  InlineTeachingOperationErrorResponse,
} from "./teaching-page-types";

export function isPersistedInvitePublicationReceipt(
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

export function createInviteJoinUrl(inviteCode: string) {
  return `/courses?invite=${inviteCode}`;
}

type TeachingClassAction = "enter-class" | "activity-list";

export function createTeachingClassActionHref(
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

export async function readJsonPayload<T>(response: Response): Promise<T | undefined> {
  try {
    return (await response.json()) as T;
  } catch {
    return undefined;
  }
}

export function createInlineWorkspaceFailureStatus(
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

export function createInlineDomainPersistenceFailureStatus(
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

export function createInlineOperationPartialFailureStatus(
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

export function filterNonEmptyStrings(values: string[] | undefined) {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

export function createAlertNotificationFailureStatus(
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

export function createRollbackFailureStatus(
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

export function createInviteWorkspaceFailureStatus(
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

export function createTeachingCourseCreateFailureMessage(
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

export function createTeachingCourseCreateOwnershipEvidenceMissingMessage(
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

export function createTeachingCourseCreateReceiptMissingMessage(
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

export function isMergedCourseOwnershipReceipt(
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

export function isPersistedTeachingCourseCreateReceipt(
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

export function createCourseCoverGenerationFailureMessage(
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

export function verifyCourseCoverAssetPersistence(input: {
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

export function hasSignedCourseCoverAuditReceipt(
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

export function isRecoverableCourseCoverBindingFailure(
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

export function createCourseCoverBindingPartialFailureMessage(
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

export function createTeachingClassCreateFailureMessage(
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

export function createTeachingClassCreateReceiptMissingMessage(
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

export function isPersistedTeachingClassCreateReceipt(
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

export function isVerifiedTeachingCreateAuthSession(
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

export function createMembershipApprovalFailureStatus(
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

export function createInvitePartialFailureStatus(
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


