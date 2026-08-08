// OpenMAIC-informed static catalog data and per-operation config for the teacher
// operation page (Phase 3 decomposition): operation menu icons, export packages,
// manifest checklist, agent plans, course scenes, the operationConfigs map, and the
// OperationConfig/OperationMetric shapes plus the metric/localText builders they use.
// Pure data/builders — no JSX or hooks — imported by the page component and previews.

import { Books } from "@phosphor-icons/react/dist/ssr/Books";
import { ChartBar } from "@phosphor-icons/react/dist/ssr/ChartBar";
import { ClipboardText } from "@phosphor-icons/react/dist/ssr/ClipboardText";
import { Exam } from "@phosphor-icons/react/dist/ssr/Exam";
import { Export as ExportIcon } from "@phosphor-icons/react/dist/ssr/Export";
import { FileText } from "@phosphor-icons/react/dist/ssr/FileText";
import { GearSix } from "@phosphor-icons/react/dist/ssr/GearSix";
import { QrCode } from "@phosphor-icons/react/dist/ssr/QrCode";
import { Robot } from "@phosphor-icons/react/dist/ssr/Robot";
import { UserGear } from "@phosphor-icons/react/dist/ssr/UserGear";
import { UsersThree } from "@phosphor-icons/react/dist/ssr/UsersThree";
import type { TeachingOperationId } from "@/components/teaching/teaching-operation-data";
import type { LocalizedText } from "@/i18n/copy";

export type OperationMetric = {
  label: LocalizedText;
  value: LocalizedText | string;
};

export type OperationConfig = {
  id: TeachingOperationId;
  pillar: LocalizedText;
  summary: LocalizedText;
  readyMessage: LocalizedText;
  primaryAction: LocalizedText;
  primaryMessage: LocalizedText;
  secondaryAction: LocalizedText;
  secondaryMessage: LocalizedText;
  metrics: OperationMetric[];
  workflow: LocalizedText[];
  records: LocalizedText[];
};

export type OpenMaicExportPackage = {
  title: LocalizedText;
  format: LocalizedText;
  status: LocalizedText;
  includes: LocalizedText[];
  note: LocalizedText;
};

export type OpenMaicAgentPlan = {
  name: LocalizedText;
  mode: "preset" | "auto";
  persona: LocalizedText;
  permissions: LocalizedText[];
  voice: LocalizedText;
  binding: LocalizedText;
  status: LocalizedText;
};

export type OpenMaicScenePlan = {
  scene: string;
  type: "slide" | "quiz" | "interactive" | "PBL";
  title: LocalizedText;
  playback: LocalizedText;
  proEdit: LocalizedText;
  continuation: LocalizedText;
};

export const operationMenuIcons = {
  "course-settings": GearSix,
  agents: Robot,
  "knowledge-base": Books,
  content: FileText,
  admins: UserGear,
  students: UsersThree,
  "data-export": ExportIcon,
  dashboard: ChartBar,
  "quiz-board": Exam,
  grading: ClipboardText,
  "invite-code": QrCode,
};

export const openMaicExportPackages: OpenMaicExportPackage[] = [
  {
    title: localText("课堂演示文稿", "Classroom Presentation PPTX"),
    format: localText("演示文稿", "PPTX"),
    status: localText("可下载", "Download ready"),
    includes: [
      localText("按场景顺序导出演示页", "Slides exported in scene order"),
      localText("保留教师讲解备注", "Teacher narration notes preserved"),
      localText("与课堂播放节奏对齐", "Aligned with classroom playback cadence"),
    ],
    note: localText(
      "对应开放课堂智能系统的演示文稿导出入口。",
      "Maps to the OpenMAIC PPTX export entry.",
    ),
  },
  {
    title: localText("资源包", "Resource Pack ZIP"),
    format: localText("压缩包", "ZIP"),
    status: localText("包含媒体", "Media included"),
    includes: [
      localText("图片、音频和附件清单", "Image, audio, and attachment manifest"),
      localText("课件资源引用表", "Courseware resource reference table"),
      localText("离线复核所需素材", "Assets for offline review"),
    ],
    note: localText(
      "对应开放课堂智能系统的资源包打包能力。",
      "Maps to the OpenMAIC Resource Pack bundling capability.",
    ),
  },
  {
    title: localText("课堂包", "Classroom ZIP"),
    format: localText("压缩包", "ZIP"),
    status: localText("课堂包", "Classroom package"),
    includes: [
      localText("清单文件与场景文件", "manifest.json and scenes.json"),
      localText("智能体、媒体、音频引用", "Agent, media, and audio references"),
      localText("课堂播放与恢复数据", "Classroom playback and restore data"),
    ],
    note: localText(
      "对应开放课堂智能系统的课堂包导出。",
      "Maps to OpenMAIC classroom-package export.",
    ),
  },
];

export const openMaicManifestChecklist = [
  localText("清单记录课程、场景、导出时间和包版本", "Manifest records course, scene, export time, and package version"),
  localText("媒体/音频只记录脱敏引用，不展示本地路径", "Media and audio use redacted references, not local paths"),
  localText("智能体配置随课堂包一起打包，便于还原课堂", "Agent configs travel with the classroom package for restore"),
];

export const openMaicAgentPlans: OpenMaicAgentPlan[] = [
  {
    name: localText("研究助教", "Research TA"),
    mode: "preset",
    persona: localText(
      "帮助学生澄清研究问题、变量关系和证据意识。",
      "Helps students clarify research questions, variables, and evidence.",
    ),
    permissions: [
      localText("允许追问", "Ask follow-up questions"),
      localText("允许标注白板", "Annotate the whiteboard"),
      localText("禁止替学生提交答案", "Cannot submit for students"),
    ],
    voice: localText("康霞课堂语音", "Kang Xia classroom voice"),
    binding: localText("大学研究方法第 3 单元", "Research Methods Unit 3"),
    status: localText("预设可用", "Preset ready"),
  },
  {
    name: localText("方法顾问", "Methods Advisor"),
    mode: "preset",
    persona: localText(
      "用方法论视角检查研究设计、数据收集和有效性。",
      "Reviews study design, data collection, and validity from a methods lens.",
    ),
    permissions: [
      localText("允许提示资料", "Suggest resources"),
      localText("允许聚焦小组", "Spotlight groups"),
      localText("禁止调用未授权课程", "Cannot call unauthorized courses"),
    ],
    voice: localText("中性教学语音", "Neutral teaching voice"),
    binding: localText("研究设计课堂讨论", "Research design discussion"),
    status: localText("预设可用", "Preset ready"),
  },
  {
    name: localText("课堂追问智能体", "Classroom Probe Agent"),
    mode: "auto",
    persona: localText(
      "从当前课程场景自动生成追问、误区提示和小组任务。",
      "Generated from the active scene to ask probes, flag misconceptions, and assign group work.",
    ),
    permissions: [
      localText("允许读取当前场景", "Read active scene"),
      localText("允许生成下一轮提示", "Generate next prompt"),
      localText("需教师确认后发布", "Requires teacher approval before release"),
    ],
    voice: localText("跟随课程默认语音", "Follows course default voice"),
    binding: localText("按课程内容自动绑定", "Bound from course content automatically"),
    status: localText("自动生成草稿", "Auto-generated draft"),
  },
];

export const openMaicCourseScenes: OpenMaicScenePlan[] = [
  {
    scene: "S01",
    type: "slide",
    title: localText("研究问题导入", "Research Question Opening"),
    playback: localText("课堂播放就绪", "Playback ready"),
    proEdit: localText("专业编辑锁定标题与讲稿", "Pro edit locks title and narration"),
    continuation: localText("可续生成案例页", "Can continue with a case scene"),
  },
  {
    scene: "S02",
    type: "quiz",
    title: localText("变量关系快测", "Variable Relation Check"),
    playback: localText("支持即时答题", "Supports live responses"),
    proEdit: localText("题目、选项、讲评可编辑", "Questions, options, and feedback editable"),
    continuation: localText("错因可续生成补救任务", "Errors can continue into remediation tasks"),
  },
  {
    scene: "S03",
    type: "interactive",
    title: localText("小组白板活动", "Group Whiteboard Activity"),
    playback: localText("支持分组互动", "Supports group interaction"),
    proEdit: localText("白板提示和素材可编辑", "Whiteboard prompts and assets editable"),
    continuation: localText("可续生成展示讨论", "Can continue into presentation discussion"),
  },
  {
    scene: "S04",
    type: "PBL",
    title: localText("研究设计挑战", "Research Design Challenge"),
    playback: localText("问题式学习课堂流程就绪", "PBL classroom flow ready"),
    proEdit: localText("任务、评分量规、角色卡可编辑", "Task, rubric, and role cards editable"),
    continuation: localText("可续生成下一轮研究迭代", "Can continue into the next research iteration"),
  },
];

export const operationConfigs: Record<TeachingOperationId, OperationConfig> = {
  "course-settings": {
    id: "course-settings",
    pillar: {
      "zh-CN": "课程治理",
      "en-US": "Course governance",
    },
    summary: {
      "zh-CN": "集中维护课程档案、学期节奏、班级偏好和发布前检查。",
      "en-US": "Maintain course profile, term cadence, class preferences, and preflight checks.",
    },
    readyMessage: {
      "zh-CN": "课程设置等待教师确认。",
      "en-US": "Course settings are waiting for teacher confirmation.",
    },
    primaryAction: {
      "zh-CN": "保存课程设置",
      "en-US": "Save Course Settings",
    },
    primaryMessage: {
      "zh-CN": "课程设置已保存到本地工作区。",
      "en-US": "Course settings saved to the local workspace.",
    },
    secondaryAction: {
      "zh-CN": "预览学生端",
      "en-US": "Preview Student View",
    },
    secondaryMessage: {
      "zh-CN": "学生端预览已生成。",
      "en-US": "Student preview generated.",
    },
    metrics: [
      metric("开课状态", "Term status", localText("运行中", "Active")),
      metric("班级偏好", "Class preferences", "4"),
      metric("发布检查", "Release checks", "7/7"),
    ],
    workflow: [
      localText("基础信息校验", "Profile validation"),
      localText("学期计划锁定", "Term plan locked"),
      localText("学生端预览", "Student-facing preview"),
    ],
    records: [
      localText("研究方法课程已绑定春季学期。", "Research Methods is bound to spring term."),
      localText("数学教学法保留教师确认状态。", "Math Pedagogy remains teacher-confirmed."),
    ],
  },
  agents: {
    id: "agents",
    pillar: {
      "zh-CN": "智能体编排",
      "en-US": "Agent orchestration",
    },
    summary: {
      "zh-CN": "按开放课堂智能系统的预设/自动模式配置智能体角色、人格、动作权限、语音和课程绑定。",
      "en-US": "Configure OpenMAIC-style preset/auto agents with roles, personas, action permissions, voices, and course bindings.",
    },
    readyMessage: {
      "zh-CN": "智能体方案已载入，等待预检。",
      "en-US": "Agent plan loaded and waiting for preflight.",
    },
    primaryAction: {
      "zh-CN": "保存智能体方案",
      "en-US": "Save Agent Plan",
    },
    primaryMessage: {
      "zh-CN": "智能体方案已保存，服务端密钥仍保持隔离。",
      "en-US": "Agent plan saved while server-side keys remain isolated.",
    },
    secondaryAction: {
      "zh-CN": "运行权限预检",
      "en-US": "Run Permission Preflight",
    },
    secondaryMessage: {
      "zh-CN": "权限预检通过：学生端仅能访问课程授权角色。",
      "en-US": "Permission preflight passed for course-authorized roles only.",
    },
    metrics: [
      metric("预设 / 自动", "Preset / Auto", "2 / 1"),
      metric("动作权限", "Action permissions", "9"),
      metric("课程绑定", "Course bindings", localText("按场景绑定", "Scene-bound")),
    ],
    workflow: [
      localText("选择预设或自动智能体", "Choose preset or auto agents"),
      localText("配置角色、人格与语音", "Configure role/persona and voice"),
      localText("预检动作权限与课程绑定", "Preflight action permissions and course binding"),
    ],
    records: [
      localText("预设研究助教保留教师确认边界。", "Preset Research TA keeps teacher-confirmation boundaries."),
      localText("自动课堂追问智能体从当前场景生成。", "Auto classroom probe agent is generated from the active scene."),
    ],
  },
  "knowledge-base": {
    id: "knowledge-base",
    pillar: {
      "zh-CN": "知识库治理",
      "en-US": "Knowledge governance",
    },
    summary: {
      "zh-CN": "整理课件、阅读材料、案例、活动记录和智能体可引用资料。",
      "en-US": "Organize slides, readings, cases, activity records, and citable agent material.",
    },
    readyMessage: {
      "zh-CN": "知识库索引保持只读预览状态。",
      "en-US": "Knowledge base index is in read-only preview.",
    },
    primaryAction: {
      "zh-CN": "同步知识库索引",
      "en-US": "Sync Knowledge Index",
    },
    primaryMessage: {
      "zh-CN": "知识库索引已同步到本地预览。",
      "en-US": "Knowledge index synced to local preview.",
    },
    secondaryAction: {
      "zh-CN": "添加资料占位",
      "en-US": "Add Resource Placeholder",
    },
    secondaryMessage: {
      "zh-CN": "资料占位已加入待审核队列。",
      "en-US": "Resource placeholder added to review queue.",
    },
    metrics: [
      metric("资料", "Resources", "42"),
      metric("引用片段", "Citable chunks", "186"),
      metric("待审核", "Review queue", "5"),
    ],
    workflow: [
      localText("资料入库", "Resource intake"),
      localText("分段与标签", "Chunking and tagging"),
      localText("教师审核", "Teacher review"),
    ],
    records: [
      localText("第 3 单元研究设计案例已可引用。", "Unit 3 research design cases are citable."),
      localText("课堂提问链材料等待教师审核。", "Question-sequence materials await review."),
    ],
  },
  content: {
    id: "content",
    pillar: {
      "zh-CN": "内容生产",
      "en-US": "Content production",
    },
    summary: {
      "zh-CN": "以开放课堂智能系统的场景结构维护演示页、测验、互动任务、问题式学习、课堂播放、专业编辑和场景续生成。",
      "en-US": "Maintain OpenMAIC-style scenes for slide, quiz, interactive, PBL, classroom playback, Pro editing, and scene continuation.",
    },
    readyMessage: {
      "zh-CN": "课程内容处于草稿检查状态。",
      "en-US": "Course content is in draft review.",
    },
    primaryAction: {
      "zh-CN": "发布课程内容",
      "en-US": "Publish Course Content",
    },
    primaryMessage: {
      "zh-CN": "课程内容已进入发布前确认。",
      "en-US": "Course content moved to pre-publish confirmation.",
    },
    secondaryAction: {
      "zh-CN": "生成单元草稿",
      "en-US": "Generate Unit Draft",
    },
    secondaryMessage: {
      "zh-CN": "单元草稿已生成，等待教师校订。",
      "en-US": "Unit draft generated and waiting for teacher edits.",
    },
    metrics: [
      metric("场景类型", "Scene types", "4"),
      metric("课堂播放", "Playback", localText("就绪", "Ready")),
      metric("专业编辑", "Pro edit", localText("开启", "On")),
    ],
    workflow: [
      localText("编排场景结构", "Arrange scene structure"),
      localText("校验课堂播放与互动", "Verify playback and interaction"),
      localText("专业编辑后续生成", "Continue generation after Pro edits"),
    ],
    records: [
      localText("演示页、测验、互动任务、问题式学习四类场景已落到页面合同。", "slide/quiz/interactive/PBL scene types are represented in the page contract."),
      localText("场景续生成保持教师确认，不直接发布到学生端。", "Scene continuation keeps teacher confirmation before student release."),
    ],
  },
  admins: {
    id: "admins",
    pillar: {
      "zh-CN": "角色与权限",
      "en-US": "Roles and permissions",
    },
    summary: {
      "zh-CN": "管理教师、助教、协作者、课程管理员和权限审计记录。",
      "en-US": "Manage teachers, TAs, collaborators, admins, and permission audit records.",
    },
    readyMessage: {
      "zh-CN": "管理员设置等待权限复核。",
      "en-US": "Admin settings are waiting for permission review.",
    },
    primaryAction: {
      "zh-CN": "保存管理员设置",
      "en-US": "Save Admin Settings",
    },
    primaryMessage: {
      "zh-CN": "管理员设置已保存，权限变更进入审计记录。",
      "en-US": "Admin settings saved and permission changes logged.",
    },
    secondaryAction: {
      "zh-CN": "发送协作邀请",
      "en-US": "Send Collaboration Invite",
    },
    secondaryMessage: {
      "zh-CN": "协作邀请通知已进入服务端邮件队列。",
      "en-US": "Collaboration invite notification queued in the server mail outbox.",
    },
    metrics: [
      metric("教师", "Teachers", "2"),
      metric("助教", "TAs", "3"),
      metric("审计项", "Audit items", "12"),
    ],
    workflow: [
      localText("角色分配", "Role assignment"),
      localText("权限审计", "Permission audit"),
      localText("协作者邀请", "Collaborator invitation"),
    ],
    records: [
      localText("康老师拥有课程管理员权限。", "Prof. Kang has course-admin permission."),
      localText("助教权限限定为作业反馈与课堂活动。", "TA permission is scoped to feedback and activities."),
    ],
  },
  students: {
    id: "students",
    pillar: {
      "zh-CN": "学生与小组",
      "en-US": "Students and groups",
    },
    summary: {
      "zh-CN":
        "查看学生名单、小组分配、加入状态、学习记录和异常提醒；小组的创建与编辑在“我的教学 → 课程设置工作台 → 小组协作”面板完成。",
      "en-US":
        "Review roster, groups, join status, learning records, and alerts. Groups are created and edited in the Group Collaboration panel of the course-settings workspace.",
    },
    readyMessage: {
      "zh-CN": "学生名单已加载。",
      "en-US": "Student roster loaded.",
    },
    primaryAction: {
      "zh-CN": "同步学生名单",
      "en-US": "Sync Roster",
    },
    primaryMessage: {
      "zh-CN": "学生名单已同步到本地视图。",
      "en-US": "Roster synced to local view.",
    },
    secondaryAction: {
      "zh-CN": "生成分组建议",
      "en-US": "Generate Group Suggestions",
    },
    secondaryMessage: {
      "zh-CN": "分组建议已生成，等待教师确认。",
      "en-US": "Group suggestions generated for teacher confirmation.",
    },
    metrics: [
      metric("学生", "Students", "64"),
      metric("小组", "Groups", "14"),
      metric("待加入", "Pending joins", "6"),
    ],
    workflow: [
      localText("名单同步", "Roster sync"),
      localText("小组分配", "Group assignment"),
      localText("学习记录核对", "Learning-record reconciliation"),
    ],
    // The "Generate Group Suggestions" secondary action still only produces a
    // reviewed suggestion receipt. Its student ids are NOT auto-assigned: the
    // teacher creates the real group in the course-settings Group Collaboration
    // panel, which posts to /api/teaching/courses/[courseId]/groups.
    // TODO(S13/S05): pass a reviewed suggestion into `LearningGroupDialog`'s
    // `suggestedMemberIds` seam once this operation surface can hand the panel a
    // draft; auto-assignment must stay teacher-reviewed either way.
    records: [
      localText("研究方法课程 36 名学生已加入。", "36 students joined Research Methods."),
      localText("数学教学法有 2 名学生等待邀请码加入。", "2 students await invite-code join."),
      localText(
        "聊天室小组在“课程设置工作台 → 小组协作”面板中创建、编辑和删除。",
        "Chatroom groups are created, edited, and deleted in the Group Collaboration panel of the course-settings workspace.",
      ),
      localText(
        "分组建议仅供教师复核，不会自动分配学生。",
        "Group suggestions are for teacher review only and never auto-assign students.",
      ),
    ],
  },
  "data-export": {
    id: "data-export",
    pillar: {
      "zh-CN": "数据交付",
      "en-US": "Data delivery",
    },
    summary: {
      "zh-CN": "按开放课堂智能系统的导出模式生成演示文稿、资源包、课堂包和清单，并打包媒体、音频和智能体配置。",
      "en-US": "Generate OpenMAIC-style PPTX, Resource Pack ZIP, Classroom ZIP, manifest, and media/audio/agent packaging.",
    },
    readyMessage: {
      "zh-CN": "导出任务等待范围确认。",
      "en-US": "Export job is waiting for scope confirmation.",
    },
    primaryAction: {
      "zh-CN": "生成导出清单",
      "en-US": "Create Export Manifest",
    },
    primaryMessage: {
      "zh-CN": "导出清单已生成，可交给服务端导出任务。",
      "en-US": "Export manifest created for a server-side export job.",
    },
    secondaryAction: {
      "zh-CN": "校验脱敏范围",
      "en-US": "Validate Redaction Scope",
    },
    secondaryMessage: {
      "zh-CN": "脱敏范围校验通过：不包含真实密钥。",
      "en-US": "Redaction scope passed with no real secrets included.",
    },
    metrics: [
      metric("导出包", "Packages", localText("演示文稿 + 2 个压缩包", "PPTX + 2 ZIP")),
      metric("清单", "Manifest", localText("数据清单", "JSON")),
      metric("打包对象", "Packaged items", localText("场景 / 媒体 / 智能体", "Scenes/Media/Agents")),
    ],
    workflow: [
      localText("选择演示文稿、资源包和课堂包", "Choose PPTX / Resource Pack / Classroom ZIP"),
      localText("生成清单与资源索引", "Create manifest and resource index"),
      localText("打包媒体、音频与智能体", "Bundle media, audio, and agents"),
    ],
    records: [
      localText("课堂包会携带场景、智能体、媒体和音频引用。", "Classroom ZIP carries scenes, agents, media, and audio references."),
      localText("清单只展示脱敏引用，不展示本地绝对路径。", "Manifest shows redacted references, not local absolute paths."),
    ],
  },
  dashboard: {
    id: "dashboard",
    pillar: {
      "zh-CN": "运营洞察",
      "en-US": "Operational insight",
    },
    summary: {
      "zh-CN": "查看参与度、单元进度、小组协作、作业反馈和预警趋势。",
      "en-US": "Review participation, unit progress, collaboration, feedback, and risk trends.",
    },
    readyMessage: {
      "zh-CN": "数据看板已载入最近 7 天摘要。",
      "en-US": "Dashboard loaded the latest 7-day summary.",
    },
    primaryAction: {
      "zh-CN": "刷新数据看板",
      "en-US": "Refresh Dashboard",
    },
    primaryMessage: {
      "zh-CN": "数据看板已刷新。",
      "en-US": "Dashboard refreshed.",
    },
    secondaryAction: {
      "zh-CN": "锁定日报快照",
      "en-US": "Lock Daily Snapshot",
    },
    secondaryMessage: {
      "zh-CN": "日报快照已锁定到当前视图。",
      "en-US": "Daily snapshot locked to current view.",
    },
    metrics: [
      metric("参与率", "Participation", "84%"),
      metric("任务完成", "Task completion", "71%"),
      metric("风险提醒", "Risk alerts", "4"),
    ],
    workflow: [
      localText("学习记录汇总", "Learning-record aggregation"),
      localText("趋势计算", "Trend calculation"),
      localText("教师日报", "Teacher daily digest"),
    ],
    records: [
      localText("小组协作次数本周提升 12%。", "Group collaboration rose 12% this week."),
      localText("第 3 单元作业提交率低于课程均值。", "Unit 3 submission rate is below course average."),
    ],
  },
  "quiz-board": {
    id: "quiz-board",
    pillar: {
      "zh-CN": "测验质量",
      "en-US": "Quiz quality",
    },
    summary: {
      "zh-CN": "分析测验表现、题目质量、错因分布和补救建议。",
      "en-US": "Analyze quiz performance, item quality, error patterns, and remediation.",
    },
    readyMessage: {
      "zh-CN": "测验看板等待最新答题数据。",
      "en-US": "Quiz board is waiting for latest responses.",
    },
    primaryAction: {
      "zh-CN": "刷新测验看板",
      "en-US": "Refresh Quiz Board",
    },
    primaryMessage: {
      "zh-CN": "测验看板已刷新，错因分布可复核。",
      "en-US": "Quiz board refreshed with error patterns ready for review.",
    },
    secondaryAction: {
      "zh-CN": "标记低质题复核",
      "en-US": "Flag Low-quality Items",
    },
    secondaryMessage: {
      "zh-CN": "低质题已标记为教师复核。",
      "en-US": "Low-quality items flagged for teacher review.",
    },
    metrics: [
      metric("测验", "Quizzes", "8"),
      metric("平均分", "Average", "82"),
      metric("需复核题", "Items to review", "3"),
    ],
    workflow: [
      localText("答题数据", "Response data"),
      localText("题目质量", "Item quality"),
      localText("补救建议", "Remediation suggestions"),
    ],
    records: [
      localText("变量关系题错因集中在概念混淆。", "Variable-relation errors cluster around concept confusion."),
      localText("课堂提问链测验需要补充例题。", "Question-sequence quiz needs more examples."),
    ],
  },
  grading: {
    id: "grading",
    pillar: {
      "zh-CN": "作业反馈",
      "en-US": "Assignment feedback",
    },
    summary: {
      "zh-CN": "集中处理作业批改、评分量规、智能建议、教师确认和反馈发布。",
      "en-US": "Handle grading, rubrics, AI suggestions, teacher confirmation, and feedback release.",
    },
    readyMessage: {
      "zh-CN": "作业批改队列已载入。",
      "en-US": "Assignment review queue loaded.",
    },
    primaryAction: {
      "zh-CN": "保存批改队列",
      "en-US": "Save Review Queue",
    },
    primaryMessage: {
      "zh-CN": "批改队列已保存，学生端暂不发布。",
      "en-US": "Review queue saved without publishing to students.",
    },
    secondaryAction: {
      "zh-CN": "生成智能反馈建议",
      "en-US": "Generate AI Feedback",
    },
    secondaryMessage: {
      "zh-CN": "AI 反馈建议已生成，等待教师逐条确认。",
      "en-US": "AI feedback suggestions generated for teacher confirmation.",
    },
    metrics: [
      metric("待批改", "Pending", "21"),
      metric("已反馈", "Reviewed", "43"),
      metric("智能建议", "AI suggestions", "18"),
    ],
    workflow: [
      localText("评分量规匹配", "Rubric matching"),
      localText("智能建议", "AI suggestions"),
      localText("教师确认", "Teacher confirmation"),
    ],
    records: [
      localText("研究设计草案 11 份等待教师确认。", "11 research-design drafts await teacher confirmation."),
      localText("数学例题分析已生成结构化反馈。", "Math-example analysis has structured feedback."),
    ],
  },
  "invite-code": {
    id: "invite-code",
    pillar: {
      "zh-CN": "班级加入",
      "en-US": "Class joining",
    },
    summary: {
      "zh-CN": "生成班级邀请码、二维码、有效期、加入范围和发布确认。",
      "en-US": "Generate class invite codes, QR codes, expiry, join scope, and publish confirmation.",
    },
    readyMessage: {
      "zh-CN": "当前邀请码可用于班级加入预览。",
      "en-US": "Current invite code is ready for join preview.",
    },
    primaryAction: {
      "zh-CN": "生成新邀请码",
      "en-US": "Generate New Invite Code",
    },
    primaryMessage: {
      "zh-CN": "邀请码已更新并等待教师确认发布。",
      "en-US": "Invite code updated and waiting for teacher publish confirmation.",
    },
    secondaryAction: {
      "zh-CN": "确认发布邀请码",
      "en-US": "Publish Invite Code",
    },
    secondaryMessage: {
      "zh-CN": "邀请码已发布到班级加入入口。",
      "en-US": "Invite code published to the class join entry.",
    },
    metrics: [
      metric("有效期", "Validity", "2026-12-17"),
      metric("加入范围", "Join scope", localText("班级", "Class")),
      metric("扫码状态", "QR state", localText("就绪", "Ready")),
    ],
    workflow: [
      localText("生成代码", "Generate code"),
      localText("二维码预览", "QR preview"),
      localText("教师发布", "Teacher publish"),
    ],
    records: [
      localText("测试班邀请码沿用 8 位数字格式。", "Peter test class uses an 8-digit code."),
      localText("发布前不写入真实学生账户。", "No real student account is written before publish."),
    ],
  },
};

export function metric(
  zhLabel: string,
  enLabel: string,
  value: LocalizedText | string,
): OperationMetric {
  return {
    label: localText(zhLabel, enLabel),
    value,
  };
}

export function localText(zhText: string, enText: string): LocalizedText {
  return {
    "zh-CN": zhText,
    "en-US": enText,
  };
}

export type ExportManifestState = {
  manifestId: string;
  downloadUrl?: string;
};

export const defaultExportManifest: ExportManifestState = {
  manifestId: "export-manifest-teacher-kang-2026",
};
