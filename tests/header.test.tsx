import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Header } from "@/components/layout/header";

let mockPathname = "/courses";
const replace = vi.fn();

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({
    replace,
  }),
}));

vi.mock("@/components/providers/app-preferences", () => ({
  useAppPreferences: () => ({
    locale: "zh-CN",
    theme: "light",
    toggleLocale: vi.fn(),
    toggleTheme: vi.fn(),
  }),
}));

describe("Header", () => {
  beforeEach(() => {
    replace.mockClear();
    vi.unstubAllGlobals();
    document.cookie = "uais_app_session=; Max-Age=0; path=/";
    document.cookie = "uais_app_session_signature=; Max-Age=0; path=/";
  });

  it("shows the Chinese UAIS name in the top-left brand lockup", () => {
    mockPathname = "/courses";
    render(<Header />);

    const brandLink = screen.getByRole("link", { name: "UAIS" });

    expect(within(brandLink).getByText("UAIS")).toBeTruthy();
    expect(within(brandLink).getByText("优爱思")).toBeTruthy();
    expect(within(brandLink).queryByText("个人教学模板")).toBeNull();
  });

  it("uses the sparkle mark for the brand logo", () => {
    mockPathname = "/courses";
    render(<Header />);

    const brandLink = screen.getByRole("link", { name: "UAIS" });
    const logoPaths = Array.from(brandLink.querySelectorAll("svg path")).map((path) =>
      path.getAttribute("d"),
    );

    expect(logoPaths.some((path) => path?.startsWith("M194.82,151.43"))).toBe(true);
    expect(logoPaths.some((path) => path?.startsWith("M216,113.07"))).toBe(false);
  });

  it("keeps the teacher navigation centered on every route", () => {
    mockPathname = "/learning";
    render(<Header />);

    const primaryNav = screen.getByRole("navigation", { name: "Primary" });
    const navLinks = within(primaryNav).getAllByRole("link");

    expect(navLinks.map((link) => link.textContent)).toEqual([
      "我的教学",
      "我的学习",
      "课程广场",
    ]);
    expect(primaryNav.className).toContain("left-1/2");
    expect(primaryNav.className).toContain("-translate-x-1/2");
    expect(primaryNav.className).toContain("justify-center");
    expect(screen.getAllByText("教师账号").length).toBeGreaterThan(0);
  });

  it("shows Student Dashboard instead of My Teaching for the Peter student account", () => {
    mockPathname = "/student-dashboard";
    render(
      <Header
        initialSessionUser={{
          account: "Peter",
          department: "学生账号",
          displayName: "Peter",
          role: "student",
        }}
      />,
    );

    const primaryNav = screen.getByRole("navigation", { name: "Primary" });
    const navLinks = within(primaryNav).getAllByRole("link");

    expect(navLinks.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["学生看板", "/student-dashboard"],
      ["我的学习", "/learning"],
      ["课程广场", "/courses"],
    ]);
    expect(screen.queryByRole("link", { name: "我的教学" })).toBeNull();
    expect(screen.getAllByText("学生账号").length).toBeGreaterThan(0);
  });

  it("opens a teacher account menu with identity, teaching overview, shortcuts, and sign out", () => {
    mockPathname = "/teaching";
    render(<Header />);

    fireEvent.click(screen.getByRole("button", { name: "教师账号" }));

    const menu = screen.getByRole("menu", { name: "教师账号" });

    expect(within(menu).getByText("Phoebe")).toBeTruthy();
    expect(within(menu).getByText("已登录")).toBeTruthy();
    expect(within(menu).getByText("2 门课程")).toBeTruthy();
    expect(within(menu).getByText("64 名学生")).toBeTruthy();
    expect(within(menu).getByText("大学研究方法")).toBeTruthy();
    expect(within(menu).getByText("第 3 单元：研究设计")).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "我的教学" }).getAttribute("href")).toBe(
      "/teaching",
    );
    expect(within(menu).getByRole("menuitem", { name: "课程内容" }).getAttribute("href")).toBe(
      "/teaching/content",
    );
    expect(within(menu).getByRole("menuitem", { name: "学生管理" }).getAttribute("href")).toBe(
      "/teaching/students",
    );
    expect(within(menu).getByRole("menuitem", { name: "数据看板" }).getAttribute("href")).toBe(
      "/teaching/dashboard",
    );
    expect(within(menu).getByRole("menuitem", { name: "退出账号" })).toBeTruthy();
    expect(within(menu).queryByText("教师工作台权限")).toBeNull();
  });

  it("asks the server to clear the HttpOnly app session and returns to login", async () => {
    const cookieSetter = vi.spyOn(document, "cookie", "set");
    const fetchMock = vi.fn(async () => Response.json({ status: "signed-out" }));
    vi.stubGlobal("fetch", fetchMock);
    mockPathname = "/teaching";
    render(<Header />);

    fireEvent.click(screen.getByRole("button", { name: "教师账号" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "退出账号" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/app-session",
      expect.objectContaining({
        method: "DELETE",
        credentials: "same-origin",
      }),
    );
    expect(cookieSetter).not.toHaveBeenCalled();
    cookieSetter.mockRestore();
  });

  it("does not show the global search button in the header", () => {
    mockPathname = "/courses";
    render(<Header />);

    expect(screen.queryByRole("button", { name: "全局搜索" })).toBeNull();
  });
});
