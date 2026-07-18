// Static playback catalog for the learner workspace (Phase 3 decomposition of
// learning-page.tsx): the PlaybackContent shape, fallback/published course ids, and
// the bilingual playbackByCourseId content map. Pure data — imported by the page and
// its playback helpers.

import type { Locale } from "@/i18n/copy";

export type PlaybackContent = {
  cockpitTitle: string;
  cockpitSummary: string;
  liveHint: string;
  slideLabel: string;
  slideTitle: string;
  slideSubtitle: string;
  slidePoints: string[];
  slideFooter: string;
  teacher: string;
  narration: string;
  speed: string;
  autoMode: string;
  conceptPins: string[];
  studyAids: string[];
  aiMessages: {
    author: string;
    body: string;
  }[];
  subtitles: {
    time: string;
    text: string;
    active?: boolean;
  }[];
  directory: {
    title: string;
    status: string;
  }[];
  settings: {
    label: string;
    value: string;
  }[];
  metrics: {
    label: string;
    value: string;
  }[];
};

export const fallbackCourseId = "research-methods-learning";
export const publishedLearningPptCourseId = "elementary-math-research";

export const playbackByCourseId: Record<string, Record<Locale, PlaybackContent>> = {
  "research-methods-learning": {
    "zh-CN": {
      cockpitTitle: "我的学习",
      cockpitSummary:
        "左侧保留课程、课件与讲解控制，右侧用一个栏目切换智能导学、全部字幕和课程目录。",
      liveHint: "当前课程：大学研究方法",
      slideLabel: "课件第 3 页 / 12",
      slideTitle: "把研究问题转化为可观察证据",
      slideSubtitle: "教师讲解研究变量、证据链和小组讨论任务。",
      slidePoints: [
        "研究问题要能被课堂片段、访谈或作业证据支持。",
        "先区分变量关系，再决定观察维度和编码方式。",
        "小组需要在讨论区提交一版证据链草案。",
      ],
      slideFooter: "本页重点：变量关系、观察证据、共同编码表",
      teacher: "康老师",
      narration: "语音讲解 08:24 / 18:40",
      speed: "1.25 倍",
      autoMode: "自动播放",
      conceptPins: ["变量关系", "课堂片段编码", "证据质量"],
      studyAids: ["问这页", "生成笔记", "学习检查点", "概念钉"],
      aiMessages: [
        {
          author: "智能导学",
          body: "本页可以先抓住三个词：变量、证据、编码。需要我把它转成小组任务清单吗？",
        },
        {
          author: "方法顾问",
          body: "建议把教师提问数量、问题层次和学生回应质量分开记录，避免把解释和评价混在一起。",
        },
      ],
      subtitles: [
        {
          time: "08:24",
          text: "如果一个研究问题不能被课堂中的行为证据支持，它就需要继续收窄。",
          active: true,
        },
        {
          time: "08:51",
          text: "变量关系不是先写得复杂，而是先让小组成员能共同观察。",
        },
        {
          time: "09:18",
          text: "请每组在讨论区提交一版证据链草案，智能导学会帮助检查可观察性。",
        },
      ],
      directory: [
        { title: "研究问题与证据意识", status: "已完成" },
        { title: "文献阅读与概念框架", status: "已完成" },
        { title: "变量关系与课堂证据", status: "进行中" },
        { title: "编码表设计工作坊", status: "下一节" },
      ],
      settings: [
        { label: "字幕语言", value: "中文" },
        { label: "讲解速度", value: "1.25 倍" },
        { label: "智能追问", value: "开启" },
      ],
      metrics: [
        { label: "本页掌握", value: "良好" },
        { label: "小组任务", value: "1 项待交" },
        { label: "笔记素材", value: "6 条" },
      ],
    },
    "en-US": {
      cockpitTitle: "My Learning",
      cockpitSummary:
        "Courses, slides, and narration stay on the left while one companion column switches between AI guidance, subtitles, and the course outline.",
      liveHint: "Current course: University Research Methods",
      slideLabel: "Slide 3 / 12",
      slideTitle: "Turn research questions into observable evidence",
      slideSubtitle: "The instructor explains variables, evidence chains, and group tasks.",
      slidePoints: [
        "A research question should be supported by classroom clips, interviews, or assignment evidence.",
        "Separate variable relationships before choosing observation dimensions and coding methods.",
        "Each group submits one draft evidence chain in the discussion area.",
      ],
      slideFooter: "Focus: variable relationships, classroom evidence, shared coding sheet",
      teacher: "Prof. Kang",
      narration: "Narration 08:24 / 18:40",
      speed: "1.25x",
      autoMode: "Auto play",
      conceptPins: ["Variable relation", "Clip coding", "Evidence quality"],
      studyAids: ["Ask this slide", "Generate notes", "Study checkpoint", "Concept pins"],
      aiMessages: [
        {
          author: "AI Guide",
          body: "Start with three words on this slide: variable, evidence, coding. Want a group task list?",
        },
        {
          author: "Methods Advisor",
          body: "Track question count, cognitive level, and student response quality separately.",
        },
      ],
      subtitles: [
        {
          time: "08:24",
          text: "If a research question cannot be supported by classroom behavior evidence, it needs to be narrowed.",
          active: true,
        },
        {
          time: "08:51",
          text: "Variable relationships should be observable together before they become complex.",
        },
        {
          time: "09:18",
          text: "Each group should submit one draft evidence chain. AI will check observability.",
        },
      ],
      directory: [
        { title: "Research Questions and Evidence", status: "Done" },
        { title: "Literature Reading and Frameworks", status: "Done" },
        { title: "Variables and Classroom Evidence", status: "Now" },
        { title: "Coding Sheet Workshop", status: "Next" },
      ],
      settings: [
        { label: "Subtitle language", value: "Chinese + English" },
        { label: "Narration speed", value: "1.25x" },
        { label: "AI follow-up", value: "On" },
      ],
      metrics: [
        { label: "Slide mastery", value: "Good" },
        { label: "Group task", value: "1 due" },
        { label: "Note clips", value: "6" },
      ],
    },
  },
  "math-pedagogy-learning": {
    "zh-CN": {
      cockpitTitle: "我的学习",
      cockpitSummary:
        "用课件、语音讲解、智能导学和字幕同步支持数学教学法学习。",
      liveHint: "当前课程：数学教学法",
      slideLabel: "课件第 2 页 / 12",
      slideTitle: "把例题变成课堂提问链",
      slideSubtitle: "围绕概念理解、学生误解和教师追问建立教学路径。",
      slidePoints: [
        "例题不只是展示算法，也要暴露学生可能的理解断点。",
        "提问链需要从观察、解释到迁移逐步推进。",
        "智能导学可以帮助比较不同解法的课堂价值。",
      ],
      slideFooter: "本页重点：提问链、误解诊断、解法比较",
      teacher: "吴老师",
      narration: "语音讲解 05:42 / 16:10",
      speed: "1.0 倍",
      autoMode: "自动播放",
      conceptPins: ["提问链", "学生误解", "多解比较"],
      studyAids: ["问这页", "生成笔记", "学习检查点", "概念钉"],
      aiMessages: [
        {
          author: "智能导学",
          body: "这页的关键是把例题拆成连续提问。需要我生成一组追问脚本吗？",
        },
        {
          author: "数学助教",
          body: "可以比较代数解法和图像解法的认知负荷，再决定课堂展示顺序。",
        },
      ],
      subtitles: [
        {
          time: "05:42",
          text: "一个好例题必须帮助教师判断学生理解停在哪一步。",
          active: true,
        },
        {
          time: "06:05",
          text: "提问链的顺序会影响学生是否能把计算结果解释成数学意义。",
        },
        {
          time: "06:38",
          text: "请把这道例题改写成三层问题：观察、解释和迁移。",
        },
      ],
      directory: [
        { title: "数学概念的课堂表达", status: "已完成" },
        { title: "例题与提问链设计", status: "进行中" },
        { title: "学生误解诊断", status: "下一节" },
        { title: "小组微课展示", status: "待解锁" },
      ],
      settings: [
        { label: "字幕语言", value: "中文" },
        { label: "讲解速度", value: "1.0 倍" },
        { label: "智能追问", value: "开启" },
      ],
      metrics: [
        { label: "本页掌握", value: "需复习" },
        { label: "小组任务", value: "2 项待交" },
        { label: "笔记素材", value: "4 条" },
      ],
    },
    "en-US": {
      cockpitTitle: "My Learning",
      cockpitSummary:
        "Slides, narration, AI guidance, and subtitles work together for math pedagogy study.",
      liveHint: "Current course: Mathematics Pedagogy",
      slideLabel: "Slide 2 / 12",
      slideTitle: "Turn examples into classroom question chains",
      slideSubtitle:
        "Build a teaching path through concept understanding, misconceptions, and follow-up questions.",
      slidePoints: [
        "An example should reveal where student understanding may break down.",
        "Question chains move from observation to explanation and transfer.",
        "AI can help compare the classroom value of different solutions.",
      ],
      slideFooter: "Focus: question chains, misconception diagnosis, solution comparison",
      teacher: "Prof. Wu",
      narration: "Narration 05:42 / 16:10",
      speed: "1.0x",
      autoMode: "Auto play",
      conceptPins: ["Question chain", "Misconception", "Solution comparison"],
      studyAids: ["Ask this slide", "Generate notes", "Study checkpoint", "Concept pins"],
      aiMessages: [
        {
          author: "AI Guide",
          body: "The key move is turning one example into a sequence of questions. Want a follow-up script?",
        },
        {
          author: "Math TA",
          body: "Compare algebraic and visual solutions by cognitive load before choosing the classroom order.",
        },
      ],
      subtitles: [
        {
          time: "05:42",
          text: "A good example helps the teacher see where student understanding stops.",
          active: true,
        },
        {
          time: "06:05",
          text: "The question sequence affects whether students can explain the meaning of an answer.",
        },
        {
          time: "06:38",
          text: "Rewrite this example into three question layers: observe, explain, and transfer.",
        },
      ],
      directory: [
        { title: "Explaining Mathematical Concepts", status: "Done" },
        { title: "Examples and Question Chains", status: "Now" },
        { title: "Diagnosing Misconceptions", status: "Next" },
        { title: "Group Micro-teaching", status: "Locked" },
      ],
      settings: [
        { label: "Subtitle language", value: "Chinese + English" },
        { label: "Narration speed", value: "1.0x" },
        { label: "AI follow-up", value: "On" },
      ],
      metrics: [
        { label: "Slide mastery", value: "Review" },
        { label: "Group task", value: "2 due" },
        { label: "Note clips", value: "4" },
      ],
    },
  },
};
