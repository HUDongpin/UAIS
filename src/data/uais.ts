import type { LocalizedText } from "@/i18n/copy";

export type NavItem = {
  href: string;
  label: LocalizedText;
};

export type NavRole = "teacher" | "student";

export type Course = {
  id: string;
  learningCourseId: string;
  title: LocalizedText;
  description: LocalizedText;
  teacherHint: LocalizedText;
  teacher: LocalizedText;
  progressText: LocalizedText;
  nextUnit: LocalizedText;
  tone: "violet" | "indigo";
};

export type LearningCourse = {
  id: string;
  title: LocalizedText;
  currentUnit: LocalizedText;
  progress: LocalizedText;
  focus: LocalizedText;
  nextAction: LocalizedText;
};

export type AiAgent = {
  id: string;
  handle: string;
  name: LocalizedText;
  specialty: LocalizedText;
};

export type ChatMessage = {
  id: string;
  kind: "student" | "agent";
  author: LocalizedText;
  text: LocalizedText;
  time: string;
  agentHandle?: string;
};

export type TeacherCourse = {
  id: string;
  title: LocalizedText;
  status: LocalizedText;
  students: number;
  currentFocus: LocalizedText;
};

export type TeacherDashboardItem = {
  id: string;
  title: LocalizedText;
  description: LocalizedText;
};

export const navItems: NavItem[] = [
  {
    href: "/teaching",
    label: {
      "zh-CN": "我的教学",
      "en-US": "My Teaching",
    },
  },
  {
    href: "/learning",
    label: {
      "zh-CN": "我的学习",
      "en-US": "My Learning",
    },
  },
  {
    href: "/courses",
    label: {
      "zh-CN": "课程广场",
      "en-US": "Course Plaza",
    },
  },
];

export const studentNavItems: NavItem[] = [
  {
    href: "/student-dashboard",
    label: {
      "zh-CN": "学生看板",
      "en-US": "Student Dashboard",
    },
  },
  {
    href: "/learning",
    label: {
      "zh-CN": "我的学习",
      "en-US": "My Learning",
    },
  },
  {
    href: "/courses",
    label: {
      "zh-CN": "课程广场",
      "en-US": "Course Plaza",
    },
  },
];

export function getNavItemsForRole(role: NavRole) {
  return role === "student" ? studentNavItems : navItems;
}

export const plazaCourses: Course[] = [
  {
    id: "research-methods",
    learningCourseId: "research-methods-learning",
    title: {
      "zh-CN": "大学研究方法",
      "en-US": "University Research Methods",
    },
    description: {
      "zh-CN": "从研究问题、文献阅读到数据证据，建立适合本科课堂的研究入门路径。",
      "en-US":
        "Build an undergraduate research path from questions and literature to evidence.",
    },
    teacherHint: {
      "zh-CN": "教师引导，智能助教辅助小组讨论与写作反馈。",
      "en-US": "Teacher-led with AI support for group discussion and writing feedback.",
    },
    teacher: {
      "zh-CN": "授课教师：吴亚军老师",
      "en-US": "Instructor: Prof. Wu",
    },
    progressText: {
      "zh-CN": "第 1 / 12 单元",
      "en-US": "Unit 1 of 12",
    },
    nextUnit: {
      "zh-CN": "研究问题与证据意识",
      "en-US": "Research Questions and Evidence",
    },
    tone: "violet",
  },
  {
    id: "math-pedagogy",
    learningCourseId: "math-pedagogy-learning",
    title: {
      "zh-CN": "数学教学法",
      "en-US": "Mathematics Pedagogy",
    },
    description: {
      "zh-CN": "围绕数学概念理解、课堂提问、例题设计和学生误解分析展开学习。",
      "en-US":
        "Study concept understanding, classroom questioning, examples, and misconceptions.",
    },
    teacherHint: {
      "zh-CN": "数学助教可帮助生成例题、比较解法并提示常见误区。",
      "en-US": "The math tutor can draft examples, compare methods, and flag pitfalls.",
    },
    teacher: {
      "zh-CN": "授课教师：康霞老师",
      "en-US": "Instructor: Prof. Kang",
    },
    progressText: {
      "zh-CN": "第 1 / 12 单元",
      "en-US": "Unit 1 of 12",
    },
    nextUnit: {
      "zh-CN": "数学概念的课堂表达",
      "en-US": "Explaining Mathematical Concepts",
    },
    tone: "indigo",
  },
];

export const learningCourses: LearningCourse[] = [
  {
    id: "research-methods-learning",
    title: plazaCourses[0].title,
    currentUnit: {
      "zh-CN": "第 3 / 12 单元",
      "en-US": "Unit 3 of 12",
    },
    progress: {
      "zh-CN": "正在整理研究问题与变量关系",
      "en-US": "Organizing research questions and variable relationships",
    },
    focus: {
      "zh-CN": "本周重点：小组研究设计草案",
      "en-US": "This week: group research design draft",
    },
    nextAction: {
      "zh-CN": "继续学习",
      "en-US": "Continue",
    },
  },
  {
    id: "math-pedagogy-learning",
    title: plazaCourses[1].title,
    currentUnit: {
      "zh-CN": "第 2 / 12 单元",
      "en-US": "Unit 2 of 12",
    },
    progress: {
      "zh-CN": "正在比较不同例题的教学功能",
      "en-US": "Comparing the teaching role of different examples",
    },
    focus: {
      "zh-CN": "本周重点：课堂提问链设计",
      "en-US": "This week: classroom question sequence",
    },
    nextAction: {
      "zh-CN": "查看任务",
      "en-US": "View Tasks",
    },
  },
];

export const aiAgents: AiAgent[] = [
  {
    id: "research-assistant",
    handle: "@研究助教",
    name: {
      "zh-CN": "研究助教",
      "en-US": "Research TA",
    },
    specialty: {
      "zh-CN": "研究问题、文献线索、变量关系",
      "en-US": "Research questions, literature leads, variable relationships",
    },
  },
  {
    id: "methods-consultant",
    handle: "@方法顾问",
    name: {
      "zh-CN": "方法顾问",
      "en-US": "Methods Advisor",
    },
    specialty: {
      "zh-CN": "研究设计、数据收集、证据质量",
      "en-US": "Study design, data collection, evidence quality",
    },
  },
  {
    id: "math-tutor",
    handle: "@数学助教",
    name: {
      "zh-CN": "数学助教",
      "en-US": "Math TA",
    },
    specialty: {
      "zh-CN": "例题设计、解法比较、概念误区",
      "en-US": "Example design, solution comparison, misconceptions",
    },
  },
  {
    id: "writing-helper",
    handle: "@写作助手",
    name: {
      "zh-CN": "写作助手",
      "en-US": "Writing Helper",
    },
    specialty: {
      "zh-CN": "段落结构、学术表达、反馈整合",
      "en-US": "Paragraph structure, academic phrasing, feedback synthesis",
    },
  },
];

export const chatMessages: ChatMessage[] = [
  {
    id: "m1",
    kind: "student",
    author: {
      "zh-CN": "林若晨",
      "en-US": "Ruocheng Lin",
    },
    text: {
      "zh-CN": "我们的小组题目想研究生成式人工智能对课堂提问的影响，变量应该怎么定？@方法顾问",
      "en-US":
        "Our group wants to study how generative AI affects classroom questioning. How should we define variables? @MethodsAdvisor",
    },
    time: "09:18",
  },
  {
    id: "m2",
    kind: "agent",
    author: {
      "zh-CN": "方法顾问",
      "en-US": "Methods Advisor",
    },
    agentHandle: "@方法顾问",
    text: {
      "zh-CN":
        "可以先区分教师提问数量、问题层次和学生回应质量。建议把课堂片段编码表作为小组共同证据。",
      "en-US":
        "Start by separating question count, cognitive level, and student response quality. Use a shared coding sheet for classroom clips.",
    },
    time: "09:19",
  },
  {
    id: "m3",
    kind: "student",
    author: {
      "zh-CN": "周亦宁",
      "en-US": "Yining Zhou",
    },
    text: {
      "zh-CN": "我们还需要写一段研究意义，想强调教师提问链的变化。@写作助手",
      "en-US":
        "We also need a short rationale that highlights changes in teacher question sequences. @WritingHelper",
    },
    time: "09:23",
  },
  {
    id: "m4",
    kind: "agent",
    author: {
      "zh-CN": "写作助手",
      "en-US": "Writing Helper",
    },
    agentHandle: "@写作助手",
    text: {
      "zh-CN":
        "可以从课堂互动质量切入：人工智能工具可能改变教师追问方式，也可能影响学生解释数学概念的机会。",
      "en-US":
        "Frame it through interaction quality: AI tools may change follow-up questioning and student opportunities to explain concepts.",
    },
    time: "09:24",
  },
];

export const teacherCourses: TeacherCourse[] = [
  {
    id: "teacher-research-methods",
    title: plazaCourses[0].title,
    status: {
      "zh-CN": "春季学期进行中",
      "en-US": "Spring term in progress",
    },
    students: 36,
    currentFocus: {
      "zh-CN": "第 3 单元：研究设计",
      "en-US": "Unit 3: Research Design",
    },
  },
  {
    id: "teacher-math-pedagogy",
    title: plazaCourses[1].title,
    status: {
      "zh-CN": "课程内容准备中",
      "en-US": "Preparing course content",
    },
    students: 28,
    currentFocus: {
      "zh-CN": "第 2 单元：提问链设计",
      "en-US": "Unit 2: Question Sequences",
    },
  },
];

export const teacherDashboardItems: TeacherDashboardItem[] = [
  {
    id: "courses",
    title: {
      "zh-CN": "我的课程",
      "en-US": "My Courses",
    },
    description: {
      "zh-CN": "查看课程状态、进入学习视图或管理视图。",
      "en-US": "Review course status and enter learning or management views.",
    },
  },
  {
    id: "content",
    title: {
      "zh-CN": "课程内容",
      "en-US": "Course Content",
    },
    description: {
      "zh-CN": "维护单元、课件、课堂活动与材料。",
      "en-US": "Maintain units, slides, activities, and resources.",
    },
  },
  {
    id: "agents",
    title: {
      "zh-CN": "智能体配置",
      "en-US": "Agent Setup",
    },
    description: {
      "zh-CN": "配置研究、方法、数学与写作智能体。",
      "en-US": "Configure research, methods, math, and writing agents.",
    },
  },
  {
    id: "students",
    title: {
      "zh-CN": "学生管理",
      "en-US": "Student Management",
    },
    description: {
      "zh-CN": "查看名单、小组、邀请码和学习记录。",
      "en-US": "Manage rosters, groups, invite codes, and learning records.",
    },
  },
  {
    id: "dashboard",
    title: {
      "zh-CN": "数据看板",
      "en-US": "Data Dashboard",
    },
    description: {
      "zh-CN": "查看参与度、单元进度和协作趋势。",
      "en-US": "Review participation, unit progress, and collaboration trends.",
    },
  },
  {
    id: "grading",
    title: {
      "zh-CN": "作业批改",
      "en-US": "Assignment Review",
    },
    description: {
      "zh-CN": "集中处理作业反馈、评分记录和智能建议。",
      "en-US": "Handle feedback, grade records, and AI suggestions in one place.",
    },
  },
];

export const teacherSidebarItems: TeacherDashboardItem[] = [
  {
    id: "course-settings",
    title: {
      "zh-CN": "课程设置",
      "en-US": "Course Settings",
    },
    description: {
      "zh-CN": "维护课程基础信息、学期安排和课堂偏好。",
      "en-US": "Maintain course profile, term schedule, and classroom preferences.",
    },
  },
  {
    id: "agents",
    title: {
      "zh-CN": "智能体配置",
      "en-US": "Agent Setup",
    },
    description: {
      "zh-CN": "配置研究、方法、数学与写作智能体。",
      "en-US": "Configure research, methods, math, and writing agents.",
    },
  },
  {
    id: "knowledge-base",
    title: {
      "zh-CN": "课程知识库",
      "en-US": "Course Knowledge Base",
    },
    description: {
      "zh-CN": "整理课件、阅读材料、案例和课程资料。",
      "en-US": "Organize slides, readings, cases, and course resources.",
    },
  },
  {
    id: "content",
    title: {
      "zh-CN": "课程内容",
      "en-US": "Course Content",
    },
    description: {
      "zh-CN": "维护单元、课件、课堂活动与材料。",
      "en-US": "Maintain units, slides, activities, and resources.",
    },
  },
  {
    id: "admins",
    title: {
      "zh-CN": "管理员设置",
      "en-US": "Admin Settings",
    },
    description: {
      "zh-CN": "管理助教、协作者、权限和课程角色。",
      "en-US": "Manage teaching assistants, collaborators, permissions, and roles.",
    },
  },
  {
    id: "students",
    title: {
      "zh-CN": "学生管理",
      "en-US": "Student Management",
    },
    description: {
      "zh-CN": "查看名单、小组、邀请码和学习记录。",
      "en-US": "Manage rosters, groups, invite codes, and learning records.",
    },
  },
  {
    id: "data-export",
    title: {
      "zh-CN": "数据导出",
      "en-US": "Data Export",
    },
    description: {
      "zh-CN": "导出学习记录、聊天内容、成绩和课堂数据。",
      "en-US": "Export learning records, chats, grades, and classroom data.",
    },
  },
  {
    id: "dashboard",
    title: {
      "zh-CN": "数据看板",
      "en-US": "Data Dashboard",
    },
    description: {
      "zh-CN": "查看参与度、单元进度和协作趋势。",
      "en-US": "Review participation, unit progress, and collaboration trends.",
    },
  },
  {
    id: "quiz-board",
    title: {
      "zh-CN": "测验看板",
      "en-US": "Quiz Board",
    },
    description: {
      "zh-CN": "查看测验表现、题目质量和错因分布。",
      "en-US": "Review quiz performance, item quality, and error patterns.",
    },
  },
  {
    id: "grading",
    title: {
      "zh-CN": "作业批改",
      "en-US": "Assignment Review",
    },
    description: {
      "zh-CN": "集中处理作业反馈、评分记录和智能建议。",
      "en-US": "Handle feedback, grade records, and AI suggestions in one place.",
    },
  },
  {
    id: "invite-code",
    title: {
      "zh-CN": "邀请码",
      "en-US": "Invite Code",
    },
    description: {
      "zh-CN": "生成班级邀请码，支持学生加入课程。",
      "en-US": "Generate class invite codes for students to join the course.",
    },
  },
];
