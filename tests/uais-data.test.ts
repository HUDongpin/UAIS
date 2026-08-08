import { describe, expect, it } from "vitest";
import {
  aiAgents,
  chatMessages,
  getNavItemsForRole,
  learningCourses,
  navItems,
  plazaCourses,
  teacherDashboardItems,
  teacherSidebarItems,
} from "@/data/uais";
import { copy, defaultLocale, supportedLocales } from "@/i18n/copy";
import {
  createLearningChatroomExportUrl,
  createLearningChatroomShareUrl,
} from "@/lib/chat-actions";

describe("UAIS template data contract", () => {
  it("keeps the top navigation focused on the three teaching areas", () => {
    expect(navItems.map((item) => item.label["zh-CN"])).toEqual([
      "我的教学",
      "我的学习",
      "课程广场",
    ]);
    expect(getNavItemsForRole("teacher").map((item) => item.label["zh-CN"])).toEqual([
      "我的教学",
      "我的学习",
      "课程广场",
    ]);
    expect(getNavItemsForRole("student").map((item) => item.label["zh-CN"])).toEqual([
      "学生看板",
      "我的学习",
      "课程广场",
    ]);
  });

  it("shows exactly two required course plaza cards with unit progress", () => {
    expect(plazaCourses).toHaveLength(2);
    expect(plazaCourses.map((course) => course.title["zh-CN"])).toEqual([
      "大学研究方法",
      "数学教学法",
    ]);
    expect(plazaCourses.map((course) => course.teacher["zh-CN"])).toEqual([
      "授课教师：吴亚军老师",
      "授课教师：康霞老师",
    ]);
    expect(plazaCourses.every((course) => course.progressText["zh-CN"] === "第 1 / 12 单元")).toBe(true);
    expect(plazaCourses.every((course) => course.progressText["en-US"] === "Unit 1 of 12")).toBe(true);
  });

  it("separates bilingual copy and defaults to Simplified Chinese", () => {
    expect(defaultLocale).toBe("zh-CN");
    expect(supportedLocales).toEqual(["zh-CN", "en-US"]);
    expect(copy["zh-CN"].brand.uaisMeaning).toBe(
      "优爱思代表大学人工智能系统，也可扩展为大学自适应交互系统。",
    );
    expect(copy["zh-CN"].brand.topMeaning).toBe(
      "面向大学课堂的高质量学习和教学体验。",
    );
    expect(copy["en-US"].brand.headerSubtitle).toBe("University AI System");
    expect(copy["en-US"].brand.personalUse).toBe("University AI System");
    expect(copy["en-US"].nav.learning).toBe("My Learning");
  });

  it("omits the removed course plaza template note from bilingual copy", () => {
    expect(copy["zh-CN"].coursePlaza).not.toHaveProperty("note");
    expect(copy["en-US"].coursePlaza).not.toHaveProperty("note");
  });

  it("includes the required AI agents and a mixed group chat timeline", () => {
    expect(aiAgents.map((agent) => agent.handle)).toEqual([
      "@研究助教",
      "@方法顾问",
      "@数学助教",
      "@写作助手",
    ]);
    expect(chatMessages.some((message) => message.kind === "student")).toBe(true);
    expect(chatMessages.some((message) => message.kind === "agent")).toBe(true);
    expect(chatMessages.some((message) => message.text["zh-CN"].includes("@方法顾问"))).toBe(
      true,
    );
  });

  it("provides learning and teaching workspace mock data", () => {
    expect(learningCourses.length).toBeGreaterThanOrEqual(2);
    expect(teacherDashboardItems.map((item) => item.title["zh-CN"])).toEqual([
      "我的课程",
      "课程内容",
      "智能体配置",
      "学生管理",
      "数据看板",
      "作业批改",
    ]);
  });

  it("keeps the teaching sidebar aligned with the full operations menu", () => {
    expect(teacherSidebarItems.map((item) => item.title["zh-CN"])).toEqual([
      "课程设置",
      "智能体配置",
      "课程知识库",
      "课程内容",
      "管理员设置",
      "学生管理",
      "数据导出",
      "数据看板",
      "测验看板",
      "作业批改",
      "邀请码",
    ]);
  });

  // Phase 5 replaced the export/share mocks with real room-addressed actions:
  // export is the print-view route for the room in hand, and a share link is
  // minted server-side, so the old hard-coded `research-method-group` slug is
  // gone from both.
  it("addresses the real room from the export and share actions", () => {
    expect(
      createLearningChatroomExportUrl({
        courseId: "elementary-math-research",
        classId: "elementary-math-research-class-1",
        groupId: "group-three",
      }),
    ).toBe(
      "/learning/chatroom/export?courseId=elementary-math-research&classId=elementary-math-research-class-1&groupId=group-three",
    );
    expect(createLearningChatroomExportUrl({ courseId: "elementary-math-research" })).toBe(
      "/learning/chatroom/export?courseId=elementary-math-research",
    );
    expect(
      createLearningChatroomShareUrl("share-abc123", "https://uais.top/"),
    ).toBe("https://uais.top/share/share-abc123");
  });
});
