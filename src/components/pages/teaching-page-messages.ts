import type { Locale, LocalizedText } from "@/i18n/copy";

// Bilingual UI status/error copy for the teacher workspace (Phase 3 decomposition
// of teaching-page.tsx). Pure LocalizedText data — no component or hook coupling —
// so the page and its extracted sub-components import a single shared source of
// truth. Keep zh-CN as the default locale and en-US paired, per project i18n rules.

export const INVITE_READY_MESSAGE: LocalizedText = {
  "zh-CN": "当前邀请码可用于班级加入预览。",
  "en-US": "Current invite code is ready for class join preview.",
};
// Plan E9: the invite and inline operations no longer fall through to the first
// course (and its first class) when nothing is selected. They refuse and say so.
export const INVITE_TARGET_REQUIRED_MESSAGE: LocalizedText = {
  "zh-CN": "请先选择课程和班级，再执行邀请码操作。",
  "en-US": "Choose a course and a class before running an invite-code action.",
};
export const TEACHING_OPERATION_COURSE_REQUIRED_MESSAGE: LocalizedText = {
  "zh-CN": "请先选择要操作的课程。",
  "en-US": "Choose the course these actions apply to first.",
};
export const INVITE_GENERATED_MESSAGE: LocalizedText = {
  "zh-CN": "邀请码已更新并等待教师确认发布。",
  "en-US": "Invite code updated and waiting for teacher publish confirmation.",
};
export const INVITE_PUBLISHED_MESSAGE: LocalizedText = {
  "zh-CN": "邀请码已发布到班级加入入口。",
  "en-US": "Invite code published to the class join entry.",
};
export const INVITE_PUBLICATION_RECEIPT_MISSING_MESSAGE: LocalizedText = {
  "zh-CN": "邀请码发布回执缺失，请稍后刷新。",
  "en-US": "Invite publication receipt is missing. Please refresh shortly.",
};
export const INVITE_CODE_DRAFT_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "邀请码草稿读回未匹配生成结果，请稍后刷新。",
  "en-US":
    "Invite code draft readback did not match the generation result. Please refresh shortly.",
};
export const INVITE_ENROLLMENT_ACCESS_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "邀请码发布读回未匹配发布结果，请稍后刷新。",
  "en-US":
    "Invite enrollment access readback did not match the publication result. Please refresh shortly.",
};
export const INVITE_CLASS_INVITATION_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "班级邀请码读回未匹配发布结果，请稍后刷新。",
  "en-US": "Class invite-code readback did not match the publication result. Please refresh shortly.",
};
export const INVITE_CODE_COPIED_MESSAGE: LocalizedText = {
  "zh-CN": "邀请码已复制。",
  "en-US": "Invite code copied.",
};
export const INVITE_LINK_COPIED_MESSAGE: LocalizedText = {
  "zh-CN": "加入链接已复制。",
  "en-US": "Join link copied.",
};
export const INVITE_COPY_FAILED_MESSAGE: LocalizedText = {
  "zh-CN": "复制不可用，请手动复制页面中的邀请码或链接。",
  "en-US": "Copy is unavailable. Please copy the code or link manually.",
};
export const TEACHING_OPERATION_SAVE_FAILED_MESSAGE: LocalizedText = {
  "zh-CN": "未保存到服务器，请重新登录或检查课程权限。",
  "en-US": "Not saved to the server. Please sign in again or check course access.",
};
export const TEACHING_OPERATION_RECEIPT_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "服务端回执未匹配当前操作，请稍后重试。",
  "en-US": "The server receipt did not match the current operation. Please retry later.",
};
export const TEACHING_OPERATION_SAVE_PENDING_MESSAGE: LocalizedText = {
  "zh-CN": "正在保存到服务器，请稍候。",
  "en-US": "Saving to the server. Please wait.",
};
export const TEACHING_COURSE_LOAD_FAILED_MESSAGE: LocalizedText = {
  "zh-CN": "服务端课程数据未读回。当前显示本地演示课程，请重新登录或检查课程权限。",
  "en-US":
    "Server course data was not read back. Local demo courses remain visible; sign in again or check course access.",
};
export const TEACHING_COURSE_COVER_TEACHER_READBACK_REQUIRED_MESSAGE: LocalizedText = {
  "zh-CN": "教师身份未读回，请重新登录或等待课程数据读回后再生成封面。",
  "en-US":
    "Teacher identity was not read back. Please sign in again or wait for course data readback before generating a cover.",
};
export const TEACHING_COURSE_COVER_ASSET_PERSISTENCE_REQUIRED_MESSAGE: LocalizedText = {
  "zh-CN": "封面未保存到课程资产库，请稍后重试。",
  "en-US": "The cover was not persisted to the course asset library. Please retry shortly.",
};
export const TEACHING_COURSE_COVER_AUDIT_REQUIRED_MESSAGE: LocalizedText = {
  "zh-CN": "封面审计回执缺失，请稍后重试。",
  "en-US": "The cover audit receipt is missing. Please retry shortly.",
};
export const TEACHING_COURSE_CREATE_READBACK_MISSING_MESSAGE: LocalizedText = {
  "zh-CN": "新课程已提交，但服务端列表尚未读回该课程，请稍后刷新。",
  "en-US":
    "The new course was submitted, but the server list has not read it back yet. Please refresh shortly.",
};
export const TEACHING_COURSE_CREATE_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "新课程已提交，但服务端读回的课程内容与本次提交不一致，请稍后刷新。",
  "en-US":
    "The new course was submitted, but the server readback does not match this submission. Please refresh shortly.",
};
export const TEACHING_COURSE_CREATE_OWNERSHIP_EVIDENCE_MISSING_MESSAGE: LocalizedText = {
  "zh-CN": "课程所有权合并证据缺失，请稍后刷新。",
  "en-US": "Course ownership merge evidence is missing. Please refresh shortly.",
};
export const TEACHING_COURSE_CREATE_RECEIPT_MISSING_MESSAGE: LocalizedText = {
  "zh-CN": "课程服务端回执缺失，请稍后刷新。",
  "en-US": "Course server receipt is missing. Please refresh shortly.",
};
export const TEACHING_CLASS_CREATE_READBACK_MISSING_MESSAGE: LocalizedText = {
  "zh-CN": "新班级已提交，但服务端列表尚未读回该班级，请稍后刷新。",
  "en-US":
    "The new class was submitted, but the server list has not read it back yet. Please refresh shortly.",
};
export const TEACHING_CLASS_CREATE_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "新班级已提交，但服务端读回的班级内容与本次提交不一致，请稍后刷新。",
  "en-US":
    "The new class was submitted, but the server readback does not match this submission. Please refresh shortly.",
};
export const TEACHING_CLASS_CREATE_RECEIPT_MISSING_MESSAGE: LocalizedText = {
  "zh-CN": "班级服务端回执缺失，请稍后刷新。",
  "en-US": "Class server receipt is missing. Please refresh shortly.",
};
export const TEACHING_OPERATION_AUDIT_PENDING_MESSAGE: LocalizedText = {
  "zh-CN": "正在读取审计证据。",
  "en-US": "Reading audit evidence.",
};
export const TEACHING_OPERATION_AUDIT_FAILED_MESSAGE: LocalizedText = {
  "zh-CN": "审计读回未完成，请稍后刷新。",
  "en-US": "Audit readback is not complete. Please refresh later.",
};
export const TEACHING_COURSE_SETTINGS_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "课程设置读回未匹配本次提交，请稍后刷新。",
  "en-US": "Course settings readback did not match this submission. Please refresh shortly.",
};
export const TEACHING_STUDENT_PREVIEW_SESSION_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "学生端预览读回未匹配生成结果，请稍后刷新。",
  "en-US":
    "Student preview readback did not match the generation result. Please refresh shortly.",
};
export const TEACHING_STUDENT_ROSTER_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "学生名单读回未匹配同步结果，请稍后刷新。",
  "en-US": "Student roster readback did not match the sync result. Please refresh shortly.",
};
export const TEACHING_GROUP_SUGGESTIONS_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "分组建议读回未匹配生成结果，请稍后刷新。",
  "en-US": "Group suggestions readback did not match the generation result. Please refresh shortly.",
};
export const TEACHING_KNOWLEDGE_INDEX_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "知识库索引读回未匹配同步结果，请稍后刷新。",
  "en-US": "Knowledge index readback did not match the sync result. Please refresh shortly.",
};
export const TEACHING_RESOURCE_REVIEW_ITEM_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "资源复核项读回未匹配入队结果，请稍后刷新。",
  "en-US":
    "Resource review item readback did not match the queue result. Please refresh shortly.",
};
export const TEACHING_DASHBOARD_STATE_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "数据看板读回未匹配刷新结果，请稍后刷新。",
  "en-US": "Dashboard readback did not match the refresh result. Please refresh shortly.",
};
export const TEACHING_DASHBOARD_SNAPSHOT_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "日报快照读回未匹配锁定结果，请稍后刷新。",
  "en-US":
    "Dashboard snapshot readback did not match the lock result. Please refresh shortly.",
};
export const TEACHING_COURSE_CONTENT_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "课程内容读回未匹配发布结果，请稍后刷新。",
  "en-US": "Course content readback did not match the publish result. Please refresh shortly.",
};
export const TEACHING_UNIT_DRAFT_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "单元草稿读回未匹配生成结果，请稍后刷新。",
  "en-US": "Unit draft readback did not match the generation result. Please refresh shortly.",
};
export const TEACHING_AGENT_PLAN_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "智能体方案读回未匹配保存结果，请稍后刷新。",
  "en-US": "Agent plan readback did not match the save result. Please refresh shortly.",
};
export const TEACHING_PERMISSION_PREFLIGHT_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "权限预检读回未匹配检查结果，请稍后刷新。",
  "en-US":
    "Permission preflight readback did not match the check result. Please refresh shortly.",
};
export const TEACHING_ADMIN_SETTINGS_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "管理员设置读回未匹配保存结果，请稍后刷新。",
  "en-US": "Admin settings readback did not match the save result. Please refresh shortly.",
};
export const TEACHING_COLLABORATION_INVITE_NOTIFICATION_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "协作邀请通知读回未匹配入队结果，请稍后刷新。",
  "en-US":
    "Collaboration invite notification readback did not match the queue result. Please refresh shortly.",
};
export const TEACHING_QUIZ_BOARD_STATE_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "测验看板读回未匹配刷新结果，请稍后刷新。",
  "en-US": "Quiz board readback did not match the refresh result. Please refresh shortly.",
};
export const TEACHING_QUIZ_ITEM_REVIEW_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "低质题复核读回未匹配标记结果，请稍后刷新。",
  "en-US":
    "Low-quality item review readback did not match the flag result. Please refresh shortly.",
};
export const TEACHING_GRADING_QUEUE_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "批改队列与成绩册读回未匹配保存结果，请稍后刷新。",
  "en-US":
    "Grading queue and gradebook readback did not match the save result. Please refresh shortly.",
};
export const TEACHING_AI_FEEDBACK_DRAFT_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "AI 反馈草稿读回未匹配生成结果，请稍后刷新。",
  "en-US":
    "AI feedback draft readback did not match the generation result. Please refresh shortly.",
};
export const TEACHING_EXPORT_MANIFEST_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "导出清单读回未匹配生成结果，请稍后刷新。",
  "en-US": "Export manifest readback did not match the generation result. Please refresh shortly.",
};
export const TEACHING_REDACTION_VALIDATION_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "脱敏范围读回未匹配校验结果，请稍后刷新。",
  "en-US":
    "Redaction scope readback did not match the validation result. Please refresh shortly.",
};
export const TEACHING_OPERATION_ROLLBACK_PENDING_MESSAGE: LocalizedText = {
  "zh-CN": "正在撤回本次操作。",
  "en-US": "Rolling back this operation.",
};
export const TEACHING_OPERATION_ROLLBACK_FAILED_MESSAGE: LocalizedText = {
  "zh-CN": "撤回未保存到服务器，请稍后重试。",
  "en-US": "Rollback was not saved to the server. Please retry later.",
};
export const TEACHING_OPERATION_ALERT_PENDING_MESSAGE: LocalizedText = {
  "zh-CN": "正在读取教学操作告警。",
  "en-US": "Reading teaching operation alerts.",
};
export const TEACHING_OPERATION_ALERT_FAILED_MESSAGE: LocalizedText = {
  "zh-CN": "教学操作告警读取失败，请稍后重试。",
  "en-US": "Teaching operation alert readback failed. Please retry later.",
};
export const TEACHING_OPERATION_ALERT_NOTIFICATION_PENDING_MESSAGE: LocalizedText = {
  "zh-CN": "正在通知管理员。",
  "en-US": "Notifying the administrator.",
};
export const TEACHING_OPERATION_ALERT_NOTIFICATION_FAILED_MESSAGE: LocalizedText = {
  "zh-CN": "告警通知未入队，请稍后重试。",
  "en-US": "Alert notification was not queued. Please retry later.",
};
export const MEMBERSHIP_APPROVAL_PENDING_MESSAGE: LocalizedText = {
  "zh-CN": "正在审批加入申请，请稍候。",
  "en-US": "Approving the join request. Please wait.",
};
export const MEMBERSHIP_APPROVAL_FAILED_MESSAGE: LocalizedText = {
  "zh-CN": "审批未保存到服务器，请重新登录或检查班级权限。",
  "en-US": "Approval was not saved. Please sign in again or check class access.",
};
export const MEMBERSHIP_APPROVAL_RECEIPT_MISSING_MESSAGE: LocalizedText = {
  "zh-CN": "审批服务端回执缺失，请稍后重试。",
  "en-US": "Approval server receipt is missing. Please retry later.",
};
export const MEMBERSHIP_APPROVAL_READBACK_MISSING_MESSAGE: LocalizedText = {
  "zh-CN": "成员审批已提交，但服务端列表尚未读回该成员，请稍后刷新。",
  "en-US":
    "The membership approval was submitted, but the server list has not read back that member yet. Please refresh shortly.",
};
export const MEMBERSHIP_APPROVAL_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "成员审批读回未匹配本次提交，请稍后刷新。",
  "en-US": "Membership approval readback did not match this submission. Please refresh shortly.",
};

// What the group-suggestion action actually proposed.
//
// The store has computed and persisted a real auto-split partition for a while,
// and the operations route now returns it on `studentGroupSuggestionReceipt`
// instead of dropping it and keeping the bare receipt. Until then the teacher
// was told "suggestions generated" and shown nothing that had been suggested,
// which is why the workspace read as unwired. Group names and sizes only: the
// full roster belongs to student management, and this is one status line.
// Nothing here assigns anybody — the sentence says the partition is a proposal.
export function describeStudentGroupSuggestion(
  suggestion:
    | {
        suggestedGroups?: Array<{ groupName?: string; members?: unknown[] }>;
        ungroupedStudentCount?: number;
      }
    | undefined,
  locale: Locale,
) {
  const groups = suggestion?.suggestedGroups ?? [];
  const ungrouped = suggestion?.ungroupedStudentCount;
  if (groups.length === 0) {
    // A course with too few ungrouped students to split is a real outcome, and
    // it is the one the teacher most needs told plainly rather than as silence.
    if (typeof ungrouped !== "number") {
      return "";
    }
    return locale === "zh-CN"
      ? `当前有 ${ungrouped} 名尚未分组的学生，还不足以给出分组建议。`
      : `${ungrouped} ungrouped student(s) — not enough to propose a split yet.`;
  }
  const partition = groups
    .map((group) => {
      const size = Array.isArray(group.members) ? group.members.length : 0;
      const name = group.groupName?.trim() || (locale === "zh-CN" ? "未命名组" : "Unnamed group");
      return locale === "zh-CN" ? `${name}（${size} 人）` : `${name} (${size})`;
    })
    .join(locale === "zh-CN" ? "、" : ", ");
  return locale === "zh-CN"
    ? `建议分组：${partition}；覆盖 ${ungrouped ?? 0} 名尚未分组的学生，等待教师确认后才会写入。`
    : `Suggested groups: ${partition}. Covers ${ungrouped ?? 0} ungrouped student(s); nothing is assigned until you confirm.`;
}
