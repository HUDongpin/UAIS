import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeachingPage } from "@/components/pages/teaching-page";

// Phase 4 teaching-workspace group management: the course-settings Group
// Collaboration panel lists persisted learning groups, offers the approved
// roster as the only member picker, and runs create/edit/rename/delete through
// the receipt-and-readback handlers. Same harness as tests/teaching-page.test.tsx:
// stubbed fetch + mocked preferences provider + link stub.

const mockPreferences = vi.hoisted(() => ({
  locale: "zh-CN" as "zh-CN" | "en-US",
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    onClick,
    ...props
  }: {
    href: string;
    children: ReactNode;
  } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      href={href}
      onClick={(event) => {
        onClick?.(event);
      }}
      {...props}
    >
      {children}
    </a>
  ),
}));

vi.mock("@/components/providers/app-preferences", () => ({
  useAppPreferences: () => ({
    locale: mockPreferences.locale,
    theme: "light",
    toggleLocale: vi.fn(),
    toggleTheme: vi.fn(),
  }),
}));

afterEach(() => {
  mockPreferences.locale = "zh-CN";
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const courseId = "teacher-course-group-workspace-20260808";
const classId = `${courseId}-class-1`;
const courseName = "小组协作研究方法";
const courseNameEn = "Group Collaboration Research Methods";

type PersistedLearningGroup = {
  groupId: string;
  courseId: string;
  classId?: string;
  ownerTeacherId: string;
  groupName: string;
  members: Array<{ studentId: string; studentDisplayName: string; addedAt: string }>;
};

type SeedOptions = {
  approvedStudents?: Array<{
    studentId: string;
    studentDisplayName: string;
    classId?: string;
  }>;
  pendingStudents?: Array<{ studentId: string; studentDisplayName: string }>;
  extraClasses?: Array<{ classId: string; className: string }>;
  learningGroups?: PersistedLearningGroup[];
  // Server-computed feature state (plan D9). `null` models a deployment that
  // predates the field; the panel treats that exactly like `false`.
  features?: { learningChatroomGroups: boolean } | null;
};

function createTeachingCourseListBody(options: SeedOptions = {}) {
  const approvedStudents = options.approvedStudents ?? [
    { studentId: "student-lin", studentDisplayName: "林若晨" },
    { studentId: "student-zhao", studentDisplayName: "赵一诺" },
    { studentId: "student-chen", studentDisplayName: "陈嘉树" },
  ];
  const pendingStudents = options.pendingStudents ?? [
    { studentId: "student-pending", studentDisplayName: "待审批同学" },
  ];

  return {
    courses: [
      {
        courseId,
        courseName: mockPreferences.locale === "en-US" ? courseNameEn : courseName,
        instructor: "康霞",
        unit: "广州大学（404）",
        department: "实验教学中心",
        semester: "2026 春季",
        students: approvedStudents.length,
      },
    ],
    classes: [
      {
        classId,
        courseId,
        className: "研究方法实验班",
        students: approvedStudents.length,
        semester: "2026 春季",
        invitationCode: "66334455",
      },
      ...(options.extraClasses ?? []).map((extraClass) => ({
        classId: extraClass.classId,
        courseId,
        className: extraClass.className,
        students: 0,
        semester: "2026 春季",
        invitationCode: "66334456",
      })),
    ],
    memberships: [
      ...approvedStudents.map((student) => ({
        membershipId: `membership-${student.studentId}`,
        courseId,
        classId: student.classId ?? classId,
        invitationCode: "66334455",
        studentId: student.studentId,
        studentDisplayName: student.studentDisplayName,
        membershipStatus: "approved",
        joinedAt: "2026-08-01T08:00:00.000Z",
        approvedAt: "2026-08-01T09:00:00.000Z",
      })),
      ...pendingStudents.map((student) => ({
        membershipId: `membership-${student.studentId}`,
        courseId,
        classId,
        invitationCode: "66334455",
        studentId: student.studentId,
        studentDisplayName: student.studentDisplayName,
        membershipStatus: "pending-teacher-review",
        joinedAt: "2026-08-02T08:00:00.000Z",
      })),
    ],
    learningGroups: options.learningGroups ?? [],
    ...(options.features === null
      ? {}
      : { features: options.features ?? { learningChatroomGroups: true } }),
    receipt: {
      action: "list-courses",
      actorId: "teacher-kang",
      status: "read",
      traceId: "trace-list-courses",
    },
  };
}

function createPersistedLearningGroup(
  overrides: Partial<PersistedLearningGroup> = {},
): PersistedLearningGroup {
  return {
    groupId: "group-alpha-20260808",
    courseId,
    classId,
    ownerTeacherId: "teacher-kang",
    groupName: "证据链小组",
    members: [
      {
        studentId: "student-lin",
        studentDisplayName: "林若晨",
        addedAt: "2026-08-08T02:00:00.000Z",
      },
      {
        studentId: "student-zhao",
        studentDisplayName: "赵一诺",
        addedAt: "2026-08-08T02:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

function createLearningGroupReceipt(action: string) {
  return {
    receiptId: `${action}-${courseId}-20260808020000`,
    action,
    actorId: "teacher-kang",
    courseId,
    classId,
    status: "persisted",
    traceId: `trace-${action}`,
    createdAt: "2026-08-08T02:00:00.000Z",
  };
}

type StubbedRequest = { url: string; method: string; body?: unknown };

function stubTeachingFetch(
  handler: (input: {
    url: string;
    method: string;
    body?: unknown;
  }) => Response | undefined,
  seed: () => ReturnType<typeof createTeachingCourseListBody>,
) {
  const requests: StubbedRequest[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ url, method, body });

    const handled = handler({ url, method, body });
    if (handled) {
      return handled;
    }
    if (url === "/api/teaching/courses" && method === "GET") {
      return Response.json(seed());
    }
    return Response.json({ error: `Unexpected request: ${method} ${url}` }, { status: 500 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, requests };
}

// The manage toggle only exists once the server has answered that group rooms
// are live (plan D9), so opening the panel waits for the gate rather than the
// course card.
async function openLearningGroupPanel(title = courseName) {
  const toggle = await screen.findByRole("button", {
    name: mockPreferences.locale === "en-US" ? `Manage groups for ${title}` : `管理${title}的小组`,
  });
  fireEvent.click(toggle);
}

function readLearningGroupPanel(container: HTMLElement) {
  const panel = container.querySelector(`[data-uais-learning-group-panel="${courseId}"]`);
  expect(panel).toBeTruthy();
  return within(panel as HTMLElement);
}

describe("teaching workspace learning group panel", () => {
  it("lists persisted groups with member chips and a teacher observe deep link", async () => {
    window.history.replaceState(null, "", "/teaching");
    stubTeachingFetch(
      () => undefined,
      () =>
        createTeachingCourseListBody({
          learningGroups: [
            createPersistedLearningGroup(),
            createPersistedLearningGroup({
              groupId: "group-course-wide",
              classId: undefined,
              groupName: "全课程写作小组",
              members: [
                {
                  studentId: "student-chen",
                  studentDisplayName: "陈嘉树",
                  addedAt: "2026-08-08T02:00:00.000Z",
                },
                {
                  studentId: "student-zhao",
                  studentDisplayName: "赵一诺",
                  addedAt: "2026-08-08T02:00:00.000Z",
                },
              ],
            }),
          ],
        }),
    );

    const { container } = render(<TeachingPage />);
    await openLearningGroupPanel();

    const panel = readLearningGroupPanel(container);
    await waitFor(() => {
      expect(panel.getByText("证据链小组")).toBeTruthy();
    });
    expect(panel.getByText("林若晨")).toBeTruthy();
    expect(panel.getAllByText("赵一诺").length).toBe(2);
    expect(panel.getByText("所属班级：研究方法实验班")).toBeTruthy();
    // A group without a classId is course-wide.
    expect(panel.getByText("所属班级：全课程")).toBeTruthy();

    const observeLink = panel.getByRole("link", { name: "进入证据链小组聊天室" });
    expect(observeLink.getAttribute("href")).toBe(
      `/learning/chatroom?courseId=${courseId}&groupId=group-alpha-20260808`,
    );
  });

  it("creates a group through receipt-and-readback verification", async () => {
    window.history.replaceState(null, "", "/teaching");
    let persistedGroups: PersistedLearningGroup[] = [];
    const { requests } = stubTeachingFetch(
      ({ url, method, body }) => {
        if (url === `/api/teaching/courses/${courseId}/groups` && method === "POST") {
          const payload = body as { groupName: string; members: Array<{ studentId: string }> };
          const createdGroup = createPersistedLearningGroup({
            groupId: "group-new-20260808",
            groupName: payload.groupName,
            members: payload.members.map((member) => ({
              studentId: member.studentId,
              studentDisplayName:
                member.studentId === "student-lin" ? "林若晨" : "赵一诺",
              addedAt: "2026-08-08T02:00:00.000Z",
            })),
          });
          persistedGroups = [createdGroup];
          return Response.json(
            {
              group: createdGroup,
              receipt: createLearningGroupReceipt("create-learning-group"),
              traceId: "trace-create-learning-group",
            },
            { status: 201 },
          );
        }
        return undefined;
      },
      () => createTeachingCourseListBody({ learningGroups: persistedGroups }),
    );

    const { container } = render(<TeachingPage />);
    await openLearningGroupPanel();
    const panel = readLearningGroupPanel(container);
    await waitFor(() => {
      expect(panel.getByText("还没有小组，先为这门课程创建一个聊天室小组。")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: `为${courseName}新建小组` }));
    fireEvent.change(screen.getByLabelText("小组名称"), {
      target: { value: "证据链小组" },
    });
    fireEvent.click(screen.getByLabelText("林若晨"));
    fireEvent.click(screen.getByLabelText("赵一诺"));
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => {
      expect(panel.getByText("小组已创建。")).toBeTruthy();
    });

    const createRequest = requests.find(
      (request) => request.method === "POST" && request.url.endsWith("/groups"),
    );
    // The whole-course default sends no classId at all, so the server treats the
    // group as course-wide instead of binding it to an empty class id.
    expect(createRequest?.body).toEqual({
      groupName: "证据链小组",
      members: [{ studentId: "student-lin" }, { studentId: "student-zhao" }],
    });
    // The verification readback re-reads the signed teacher course list.
    expect(
      requests.filter(
        (request) => request.url === "/api/teaching/courses" && request.method === "GET",
      ).length,
    ).toBeGreaterThanOrEqual(2);
    expect(panel.getByText("证据链小组")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers only approved memberships and enforces the 2..12 member bounds", async () => {
    window.history.replaceState(null, "", "/teaching");
    const manyApprovedStudents = Array.from({ length: 13 }, (_, index) => ({
      studentId: `student-${index + 1}`,
      studentDisplayName: `同学${index + 1}`,
    }));
    stubTeachingFetch(
      () => undefined,
      () =>
        createTeachingCourseListBody({
          approvedStudents: manyApprovedStudents,
        }),
    );

    render(<TeachingPage />);
    await openLearningGroupPanel();
    fireEvent.click(await screen.findByRole("button", { name: `为${courseName}新建小组` }));

    const dialog = within(screen.getByRole("dialog"));
    // The pending-review student is never assignable.
    expect(dialog.queryByLabelText("待审批同学")).toBeNull();
    expect(dialog.getByLabelText("同学1")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("小组名称"), { target: { value: "边界小组" } });
    fireEvent.click(dialog.getByLabelText("同学1"));
    expect(dialog.getByText("小组至少需要 2 名成员。")).toBeTruthy();
    expect(dialog.getByRole("button", { name: "创建" })).toHaveProperty("disabled", true);

    manyApprovedStudents
      .slice(1)
      .forEach((student) => fireEvent.click(dialog.getByLabelText(student.studentDisplayName)));
    expect(dialog.getByText("小组最多 12 名成员。")).toBeTruthy();
    expect(dialog.getByRole("button", { name: "创建" })).toHaveProperty("disabled", true);

    fireEvent.click(dialog.getByLabelText("同学13"));
    expect(dialog.getByRole("button", { name: "创建" })).toHaveProperty("disabled", false);
  });

  it("scopes a class group to that class roster and sends its class id", async () => {
    window.history.replaceState(null, "", "/teaching");
    const secondClassId = `${courseId}-class-2`;
    let persistedGroups: PersistedLearningGroup[] = [];
    const { requests } = stubTeachingFetch(
      ({ url, method, body }) => {
        if (url === `/api/teaching/courses/${courseId}/groups` && method === "POST") {
          const payload = body as {
            groupName: string;
            classId?: string;
            members: Array<{ studentId: string }>;
          };
          persistedGroups = [
            createPersistedLearningGroup({
              groupId: "group-second-class",
              classId: payload.classId,
              groupName: payload.groupName,
              members: payload.members.map((member) => ({
                studentId: member.studentId,
                studentDisplayName: member.studentId === "student-wu" ? "吴凌" : "何予安",
                addedAt: "2026-08-08T02:00:00.000Z",
              })),
            }),
          ];
          return Response.json(
            {
              group: persistedGroups[0],
              receipt: createLearningGroupReceipt("create-learning-group"),
            },
            { status: 201 },
          );
        }
        return undefined;
      },
      () =>
        createTeachingCourseListBody({
          approvedStudents: [
            { studentId: "student-lin", studentDisplayName: "林若晨" },
            { studentId: "student-zhao", studentDisplayName: "赵一诺" },
            { studentId: "student-wu", studentDisplayName: "吴凌", classId: secondClassId },
            { studentId: "student-he", studentDisplayName: "何予安", classId: secondClassId },
          ],
          extraClasses: [{ classId: secondClassId, className: "研究方法二班" }],
          learningGroups: persistedGroups,
        }),
    );

    render(<TeachingPage />);
    await openLearningGroupPanel();
    fireEvent.click(await screen.findByRole("button", { name: `为${courseName}新建小组` }));

    const dialog = within(screen.getByRole("dialog"));
    // Whole-course default offers every approved student in the course.
    expect(dialog.getByLabelText("林若晨")).toBeTruthy();
    expect(dialog.getByLabelText("吴凌")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("所属班级"), {
      target: { value: secondClassId },
    });
    expect(dialog.queryByLabelText("林若晨")).toBeNull();
    fireEvent.change(screen.getByLabelText("小组名称"), { target: { value: "二班小组" } });
    fireEvent.click(dialog.getByLabelText("吴凌"));
    fireEvent.click(dialog.getByLabelText("何予安"));
    fireEvent.click(dialog.getByRole("button", { name: "创建" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    const createRequest = requests.find(
      (request) => request.method === "POST" && request.url.endsWith("/groups"),
    );
    expect(createRequest?.body).toEqual({
      groupName: "二班小组",
      classId: secondClassId,
      members: [{ studentId: "student-wu" }, { studentId: "student-he" }],
    });
  });

  it("renders server validation reason codes as friendly guidance", async () => {
    window.history.replaceState(null, "", "/teaching");
    stubTeachingFetch(
      ({ url, method }) => {
        if (url === `/api/teaching/courses/${courseId}/groups` && method === "POST") {
          return Response.json(
            {
              error: "Teaching learning group member must hold an approved course membership.",
              traceId: "trace-group-member-not-approved",
              validation: {
                target: "teaching-learning-group",
                status: "invalid",
                reasonCode: "group-member-not-approved",
                field: "members",
                memberIndex: 1,
                responsibleSession: "S12",
              },
            },
            { status: 400 },
          );
        }
        return undefined;
      },
      () => createTeachingCourseListBody(),
    );

    render(<TeachingPage />);
    await openLearningGroupPanel();
    fireEvent.click(await screen.findByRole("button", { name: `为${courseName}新建小组` }));
    fireEvent.change(screen.getByLabelText("小组名称"), { target: { value: "证据链小组" } });
    fireEvent.click(screen.getByLabelText("林若晨"));
    fireEvent.click(screen.getByLabelText("赵一诺"));
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => {
      expect(screen.getByText("只能选择已批准加入课程的学生。")).toBeTruthy();
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("refuses an unverified create when the persisted receipt is missing", async () => {
    window.history.replaceState(null, "", "/teaching");
    stubTeachingFetch(
      ({ url, method }) => {
        if (url === `/api/teaching/courses/${courseId}/groups` && method === "POST") {
          return Response.json(
            {
              group: createPersistedLearningGroup({ groupId: "group-unverified" }),
              traceId: "trace-create-learning-group",
            },
            { status: 201 },
          );
        }
        return undefined;
      },
      () => createTeachingCourseListBody(),
    );

    render(<TeachingPage />);
    await openLearningGroupPanel();
    fireEvent.click(await screen.findByRole("button", { name: `为${courseName}新建小组` }));
    fireEvent.change(screen.getByLabelText("小组名称"), { target: { value: "证据链小组" } });
    fireEvent.click(screen.getByLabelText("林若晨"));
    fireEvent.click(screen.getByLabelText("赵一诺"));
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => {
      expect(screen.getByText("小组保存回执缺失，请稍后刷新。")).toBeTruthy();
    });
  });

  it("refuses an unverified create when the readback does not carry the group", async () => {
    window.history.replaceState(null, "", "/teaching");
    stubTeachingFetch(
      ({ url, method }) => {
        if (url === `/api/teaching/courses/${courseId}/groups` && method === "POST") {
          return Response.json(
            {
              group: createPersistedLearningGroup({ groupId: "group-missing-readback" }),
              receipt: createLearningGroupReceipt("create-learning-group"),
              traceId: "trace-create-learning-group",
            },
            { status: 201 },
          );
        }
        return undefined;
      },
      () => createTeachingCourseListBody({ learningGroups: [] }),
    );

    render(<TeachingPage />);
    await openLearningGroupPanel();
    fireEvent.click(await screen.findByRole("button", { name: `为${courseName}新建小组` }));
    fireEvent.change(screen.getByLabelText("小组名称"), { target: { value: "证据链小组" } });
    fireEvent.click(screen.getByLabelText("林若晨"));
    fireEvent.click(screen.getByLabelText("赵一诺"));
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => {
      expect(screen.getByText("小组读回未包含本次保存结果，请稍后刷新。")).toBeTruthy();
    });
  });

  it("renames a group and replaces its members through one verified patch", async () => {
    window.history.replaceState(null, "", "/teaching");
    let persistedGroups = [createPersistedLearningGroup()];
    const { requests } = stubTeachingFetch(
      ({ url, method, body }) => {
        if (
          url === `/api/teaching/courses/${courseId}/groups/group-alpha-20260808` &&
          method === "PATCH"
        ) {
          const payload = body as {
            groupName?: string;
            members?: Array<{ studentId: string }>;
          };
          const updatedGroup = createPersistedLearningGroup({
            groupName: payload.groupName ?? "证据链小组",
            members: (payload.members ?? []).map((member) => ({
              studentId: member.studentId,
              studentDisplayName:
                member.studentId === "student-lin"
                  ? "林若晨"
                  : member.studentId === "student-zhao"
                    ? "赵一诺"
                    : "陈嘉树",
              addedAt: "2026-08-08T03:00:00.000Z",
            })),
          });
          persistedGroups = [updatedGroup];
          return Response.json({
            group: updatedGroup,
            receipt: createLearningGroupReceipt("rename-learning-group"),
            receipts: [
              createLearningGroupReceipt("update-learning-group-members"),
              createLearningGroupReceipt("rename-learning-group"),
            ],
            traceId: "trace-update-learning-group",
          });
        }
        return undefined;
      },
      () => createTeachingCourseListBody({ learningGroups: persistedGroups }),
    );

    const { container } = render(<TeachingPage />);
    await openLearningGroupPanel();
    const panel = readLearningGroupPanel(container);
    await waitFor(() => {
      expect(panel.getByText("证据链小组")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "编辑证据链小组" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(screen.getByLabelText("小组名称")).toHaveProperty("value", "证据链小组");
    fireEvent.change(screen.getByLabelText("小组名称"), {
      target: { value: "研究设计小组" },
    });
    fireEvent.click(dialog.getByLabelText("赵一诺"));
    fireEvent.click(dialog.getByLabelText("陈嘉树"));
    fireEvent.click(dialog.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(panel.getByText("小组已更新。")).toBeTruthy();
    });
    const patchRequest = requests.find((request) => request.method === "PATCH");
    expect(patchRequest?.body).toEqual({
      groupName: "研究设计小组",
      members: [{ studentId: "student-lin" }, { studentId: "student-chen" }],
    });
    expect(panel.getByText("研究设计小组")).toBeTruthy();
    expect(panel.getByText("陈嘉树")).toBeTruthy();
  });

  it("deletes a group only after an explicit confirm and a verified readback", async () => {
    window.history.replaceState(null, "", "/teaching");
    let persistedGroups = [createPersistedLearningGroup()];
    const { requests } = stubTeachingFetch(
      ({ url, method }) => {
        if (
          url === `/api/teaching/courses/${courseId}/groups/group-alpha-20260808` &&
          method === "DELETE"
        ) {
          const deletedGroup = persistedGroups[0];
          persistedGroups = [];
          return Response.json({
            group: deletedGroup,
            receipt: createLearningGroupReceipt("delete-learning-group"),
            traceId: "trace-delete-learning-group",
          });
        }
        return undefined;
      },
      () => createTeachingCourseListBody({ learningGroups: persistedGroups }),
    );

    const { container } = render(<TeachingPage />);
    await openLearningGroupPanel();
    const panel = readLearningGroupPanel(container);
    await waitFor(() => {
      expect(panel.getByText("证据链小组")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "删除证据链小组" }));
    expect(requests.some((request) => request.method === "DELETE")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "确认删除证据链小组" }));
    await waitFor(() => {
      expect(panel.getByText("小组已删除。")).toBeTruthy();
    });
    expect(requests.some((request) => request.method === "DELETE")).toBe(true);
    expect(panel.queryByText("证据链小组")).toBeNull();
    expect(panel.getByText("还没有小组，先为这门课程创建一个聊天室小组。")).toBeTruthy();
  });

  it("hides the whole group surface while groups ship dark", async () => {
    window.history.replaceState(null, "", "/teaching");
    const { requests } = stubTeachingFetch(
      () => undefined,
      () =>
        createTeachingCourseListBody({
          features: { learningChatroomGroups: false },
          // Even with a persisted group present, a flag-off deployment must not
          // advertise a room the chatroom API would refuse.
          learningGroups: [createPersistedLearningGroup()],
        }),
    );

    const { container } = render(<TeachingPage />);

    // The workspace itself still renders; only the group surface is withheld.
    await waitFor(() => {
      expect(screen.getByText("研究方法实验班")).toBeTruthy();
    });
    // The gate costs no request of its own: the feature state rides the single
    // course-list read the workspace already performs.
    expect(
      requests.filter(
        (request) => request.url === "/api/teaching/courses" && request.method === "GET",
      ).length,
    ).toBe(1);

    expect(container.querySelector(`[data-uais-learning-group-panel="${courseId}"]`)).toBeNull();
    expect(screen.queryByRole("button", { name: `管理${courseName}的小组` })).toBeNull();
    expect(screen.queryByRole("button", { name: `为${courseName}新建小组` })).toBeNull();
    expect(screen.queryByText("小组协作")).toBeNull();
    // The room deep links disappear with the panel.
    expect(screen.queryByRole("link", { name: "进入证据链小组聊天室" })).toBeNull();
    expect(screen.queryByText("证据链小组")).toBeNull();
  });

  it("hides the group surface when the server reports no feature state at all", async () => {
    window.history.replaceState(null, "", "/teaching");
    stubTeachingFetch(
      () => undefined,
      () =>
        createTeachingCourseListBody({
          features: null,
          learningGroups: [createPersistedLearningGroup()],
        }),
    );

    const { container } = render(<TeachingPage />);

    await waitFor(() => {
      expect(screen.getByText(courseName)).toBeTruthy();
    });
    // A deployment that predates the feature field reads as off, which is the
    // safe direction for a dark rollout.
    await waitFor(() => {
      expect(screen.getByText("研究方法实验班")).toBeTruthy();
    });
    expect(container.querySelector(`[data-uais-learning-group-panel="${courseId}"]`)).toBeNull();
    expect(screen.queryByRole("button", { name: `管理${courseName}的小组` })).toBeNull();
  });

  it("shows the group surface as soon as the server reports the feature on", async () => {
    window.history.replaceState(null, "", "/teaching");
    stubTeachingFetch(
      () => undefined,
      () =>
        createTeachingCourseListBody({
          features: { learningChatroomGroups: true },
          learningGroups: [createPersistedLearningGroup()],
        }),
    );

    const { container } = render(<TeachingPage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: `管理${courseName}的小组` })).toBeTruthy();
    });
    expect(
      container.querySelector(`[data-uais-learning-group-panel="${courseId}"]`),
    ).toBeTruthy();
  });

  it("renders the group panel in English under the en-US locale", async () => {
    mockPreferences.locale = "en-US";
    window.history.replaceState(null, "", "/teaching");
    stubTeachingFetch(
      () => undefined,
      () =>
        createTeachingCourseListBody({
          learningGroups: [createPersistedLearningGroup({ groupName: "Evidence Chain Group" })],
        }),
    );

    const { container } = render(<TeachingPage />);
    await openLearningGroupPanel(courseNameEn);

    const panel = readLearningGroupPanel(container);
    await waitFor(() => {
      expect(panel.getByText("Evidence Chain Group")).toBeTruthy();
    });
    expect(panel.getByText("Group Collaboration")).toBeTruthy();
    expect(panel.getByRole("button", { name: `New group for ${courseNameEn}` })).toBeTruthy();
    expect(
      panel
        .getByRole("link", { name: "Open the Evidence Chain Group chatroom" })
        .getAttribute("href"),
    ).toBe(`/learning/chatroom?courseId=${courseId}&groupId=group-alpha-20260808`);

    fireEvent.click(panel.getByRole("button", { name: `New group for ${courseNameEn}` }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("Group members")).toBeTruthy();
    expect(
      dialog.getByText("Choose 2 to 12 students with an approved course membership."),
    ).toBeTruthy();
  });
});
