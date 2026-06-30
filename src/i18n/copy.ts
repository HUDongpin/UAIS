export const supportedLocales = ["zh-CN", "en-US"] as const;

export type Locale = (typeof supportedLocales)[number];

export const defaultLocale: Locale = "zh-CN";

export type LocalizedText = Record<Locale, string>;

export const copy = {
  "zh-CN": {
    brand: {
      name: "优爱思",
      headerSubtitle: "大学人工智能系统",
      uaisMeaning:
        "优爱思代表大学人工智能系统，也可扩展为大学自适应交互系统。",
      topMeaning: "面向大学课堂的高质量学习和教学体验。",
      personalUse: "个人教学模板",
    },
    nav: {
      plaza: "课程广场",
      learning: "我的学习",
      teaching: "我的教学",
      studentDashboard: "学生看板",
    },
    controls: {
      language: "语言",
      theme: "主题",
      light: "浅色",
      dark: "深色",
      user: "教师账号",
    },
    coursePlaza: {
      title: "课程广场",
      summary: "选择课程，进入清晰、节制、可继续扩展的大学课堂学习空间。",
      empty: "暂无更多课程。当前模板只展示两门示例课程。",
    },
    learning: {
      title: "我的学习",
      summary: "查看已加入课程、当前单元和协作学习记录。",
      enrolled: "已加入课程",
      chatTitle: "人机协作聊天室",
      chatSummary: "小组成员可以随时 @智能体，围绕研究、方法、数学和写作问题协作。",
      openChatroom: "进入聊天室",
      backToLearning: "返回我的学习",
      fullChatSummary:
        "在完整聊天室中查看小组消息、选择 @智能体，并导出或分享协作记录。",
      exportPdf: "导出文档",
      shareLink: "生成分享链接",
      inputLabel: "发送小组消息",
      inputPlaceholder: "输入消息，或先选择一个 @智能体",
      send: "发送",
      copied: "分享链接已生成并复制到剪贴板。",
      copiedFallback: "分享链接已生成，可在模板中接入复制能力。",
      exported: "文档导出已模拟完成，后续可接入服务端生成。",
      emptyChat: "暂无聊天内容。发送第一条小组消息即可开始协作。",
      error: "请输入一条消息后再发送。",
    },
    teaching: {
      title: "我的教学",
      summary: "面向教师的课程管理工作台，保留课程、内容、智能体、学生和数据入口。",
      myCourses: "我的课程",
      operations: "轻量教学操作",
      manage: "进入管理",
      continue: "继续编辑",
      status: "课程状态",
    },
    common: {
      enterLearning: "进入学习",
      viewProgress: "查看进度",
      manageCourse: "管理课程",
      aiAssisted: "智能辅助学习",
      nextUnit: "下一单元",
      templateReady: "模板占位",
    },
  },
  "en-US": {
    brand: {
      name: "UAIS",
      headerSubtitle: "University AI System",
      uaisMeaning:
        "UAIS stands for both University AI System and University Adaptive Interactive System.",
      topMeaning: "High-quality learning and teaching experiences for university classrooms.",
      personalUse: "University AI System",
    },
    nav: {
      plaza: "Course Plaza",
      learning: "My Learning",
      teaching: "My Teaching",
      studentDashboard: "Student Dashboard",
    },
    controls: {
      language: "Language",
      theme: "Theme",
      light: "Light",
      dark: "Dark",
      user: "Teacher",
    },
    coursePlaza: {
      title: "Course Plaza",
      summary: "Choose a course and enter a calm university learning workspace.",
      empty: "No more courses. This template intentionally shows two sample courses.",
    },
    learning: {
      title: "My Learning",
      summary: "Review enrolled courses, current units, and collaborative study records.",
      enrolled: "Enrolled Courses",
      chatTitle: "Human-AI Collaboration Chatroom",
      chatSummary:
        "Group members can mention AI agents at any time for research, methods, math, and writing support.",
      openChatroom: "Open Chatroom",
      backToLearning: "Back to My Learning",
      fullChatSummary:
        "Use the full chatroom to review group messages, choose @AI agents, and export or share collaboration records.",
      exportPdf: "Export PDF",
      shareLink: "Create Share Link",
      inputLabel: "Send group message",
      inputPlaceholder: "Type a message, or choose an @AI agent first",
      send: "Send",
      copied: "Share link created and copied to clipboard.",
      copiedFallback: "Share link created. Clipboard support can be connected later.",
      exported: "PDF export is mocked and ready for a backend generator.",
      emptyChat: "No chat yet. Send the first group message to begin.",
      error: "Please enter a message before sending.",
    },
    teaching: {
      title: "My Teaching",
      summary:
        "A lightweight teacher workspace for courses, content, agents, students, and data.",
      myCourses: "My Courses",
      operations: "Teaching Operations",
      manage: "Manage",
      continue: "Continue Editing",
      status: "Status",
    },
    common: {
      enterLearning: "Enter",
      viewProgress: "Progress",
      manageCourse: "Manage",
      aiAssisted: "AI-assisted learning",
      nextUnit: "Next Unit",
      templateReady: "Template placeholder",
    },
  },
} as const;
