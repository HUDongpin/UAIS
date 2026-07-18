// Inline workspace-action config and enterprise workspace config builders for the
// teacher page (Phase 3 decomposition). Pure config assembly — no JSX or hooks — so
// the main TeachingPage component imports these instead of carrying ~480 lines of
// per-operation copy and lane/metric wiring inline.



import { localizedText } from "@/components/ui/localized-text";
import type { TeachingOperationId } from "@/components/teaching/teaching-operation-data";
import type { Locale } from "@/i18n/copy";
import {
  INVITE_GENERATED_MESSAGE,
  INVITE_PUBLISHED_MESSAGE,
  INVITE_READY_MESSAGE,
} from "./teaching-page-messages";
import type {
  EnterpriseWorkspaceConfig,
  InlineWorkspaceActionConfig,
} from "./teaching-page-types";

export function createInlineWorkspaceActionConfig(
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

export function createEnterpriseWorkspaceConfig(
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

