import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Header } from "@/components/layout/header";

let mockPathname = "/courses";
const replace = vi.fn();
const assign = vi.fn();

function stubLocationAssign() {
  vi.stubGlobal("location", { ...window.location, assign });
}

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
    assign.mockClear();
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

    // No session was provided, so the header knows no name. It used to print the
    // demo persona "Phoebe" here, which told a visitor whose session had expired
    // - or who had never signed in - that they were logged in as somebody. With
    // nothing real to show it falls back to the neutral role label the control
    // is already announced with, and invents nothing.
    expect(within(menu).queryByText("Phoebe")).toBeNull();
    expect(within(menu).getAllByText("教师账号").length).toBeGreaterThan(0);
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

  it("names the signed-in account, and never a name the session did not carry", () => {
    mockPathname = "/teaching";
    const { unmount } = render(
      <Header
        initialSessionUser={{
          account: "t2026007",
          role: "teacher",
          displayName: "康霞",
          department: "教育学院",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "教师账号" }));
    expect(
      within(screen.getByRole("menu", { name: "教师账号" })).getByText("康霞"),
    ).toBeTruthy();
    unmount();

    // A session with no display name still has a real identity behind it - the
    // account id - which is the next rung down. Only when even that is missing
    // does the header fall back to the role label.
    render(
      <Header
        initialSessionUser={{
          account: "t2026007",
          role: "teacher",
          displayName: "   ",
          department: "教育学院",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "教师账号" }));
    const fallbackMenu = screen.getByRole("menu", { name: "教师账号" });
    expect(within(fallbackMenu).getByText("t2026007")).toBeTruthy();
    expect(within(fallbackMenu).queryByText("Phoebe")).toBeNull();
  });

  it("returns to login only after the session-clearing request has settled", async () => {
    const cookieSetter = vi.spyOn(document, "cookie", "set");
    let resolveSignOutRequest: (response: Response) => void = () => undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveSignOutRequest = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    stubLocationAssign();
    mockPathname = "/teaching";
    render(<Header />);

    fireEvent.click(screen.getByRole("button", { name: "教师账号" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "退出账号" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/app-session",
      expect.objectContaining({
        method: "DELETE",
        credentials: "same-origin",
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(assign).not.toHaveBeenCalled();

    resolveSignOutRequest(Response.json({ status: "signed-out" }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith("/login"));
    expect(replace).not.toHaveBeenCalled();
    expect(cookieSetter).not.toHaveBeenCalled();
    cookieSetter.mockRestore();
  });

  it("still leaves for login when the session-clearing request fails", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchMock);
    stubLocationAssign();
    mockPathname = "/teaching";
    render(<Header />);

    fireEvent.click(screen.getByRole("button", { name: "教师账号" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "退出账号" }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith("/login"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });

  it("does not show the global search button in the header", () => {
    mockPathname = "/courses";
    render(<Header />);

    expect(screen.queryByRole("button", { name: "全局搜索" })).toBeNull();
  });

  // E12/PKG-7: the header had 30 hardcoded light hex classes and no dark
  // handling at all, so the dark theme rendered a white bar over a dark page.
  it("paints the header from the shared theme tokens", () => {
    mockPathname = "/courses";
    const { container } = render(<Header />);

    const header = container.querySelector("header") as HTMLElement;
    expect(header.className).toContain("border-[var(--border)]");
    expect(header.className).toContain("bg-[var(--surface)]");
    // Nothing in the always-visible header chrome is a raw hex any more. (The
    // account menu's "signed in" check mark keeps a literal green — no token
    // fits it — and pairs it with an explicit `dark:` variant.)
    const hexClasses = Array.from(container.querySelectorAll<HTMLElement>("*"))
      .flatMap((element) => element.className.split?.(" ") ?? [])
      .filter((token) => /#[0-9a-fA-F]{6}/.test(token) && !token.startsWith("dark:"));
    expect(hexClasses).toEqual([]);
  });

  // E12/PKG-7 mobile navigation. jsdom has no viewport matching, and this suite
  // has never stubbed `matchMedia`, so the drawer is asserted the way the rest of
  // the suite asserts responsive behaviour: on the rendered structure, plus the
  // `md:hidden` / `md:flex` classes that decide which of the two surfaces a
  // phone actually sees.
  describe("mobile navigation drawer", () => {
    it("keeps the drawer trigger below md and the desktop nav from md up", () => {
      mockPathname = "/courses";
      const { container } = render(<Header />);

      const trigger = screen.getByRole("button", { name: "打开导航菜单" });
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(trigger.getAttribute("aria-controls")).toBe("uais-mobile-nav-panel");
      expect(trigger.parentElement?.className).toContain("md:hidden");
      expect(
        screen.getByRole("navigation", { name: "Primary" }).className,
      ).toContain("md:flex");
      expect(container.querySelector("[data-uais-mobile-nav]")).toBeNull();
    });

    it("opens a drawer carrying the role-scoped links and the sign out", () => {
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

      const trigger = screen.getByRole("button", { name: "打开导航菜单" });
      fireEvent.click(trigger);

      const drawer = screen.getByRole("dialog", { name: "导航" });
      // The trigger renames itself while the sheet is open.
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      expect(trigger.getAttribute("aria-label")).toBe("关闭导航菜单");
      expect(
        within(drawer)
          .getAllByRole("link")
          .map((link) => [link.textContent, link.getAttribute("href")]),
      ).toEqual([
        ["学生看板", "/student-dashboard"],
        ["我的学习", "/learning"],
        ["课程广场", "/courses"],
      ]);
      expect(within(drawer).getByRole("button", { name: "退出账号" })).toBeTruthy();
      expect(within(drawer).getByText("Peter")).toBeTruthy();
    });

    it("signs out from the drawer, so a phone is not trapped in the app", async () => {
      const fetchMock = vi.fn(async () => Response.json({ status: "signed-out" }));
      vi.stubGlobal("fetch", fetchMock);
      stubLocationAssign();
      mockPathname = "/teaching";
      render(<Header />);

      fireEvent.click(screen.getByRole("button", { name: "打开导航菜单" }));
      fireEvent.click(
        within(screen.getByRole("dialog", { name: "导航" })).getByRole("button", {
          name: "退出账号",
        }),
      );

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/app-session",
        expect.objectContaining({ method: "DELETE", credentials: "same-origin" }),
      );
      await waitFor(() => expect(assign).toHaveBeenCalledWith("/login"));
    });

    it("moves focus into the drawer, traps Tab inside it, and closes on Escape", () => {
      mockPathname = "/courses";
      render(<Header />);

      const trigger = screen.getByRole("button", { name: "打开导航菜单" });
      fireEvent.click(trigger);

      const drawer = screen.getByRole("dialog", { name: "导航" });
      const focusables = Array.from(
        drawer.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"),
      );
      expect(document.activeElement).toBe(focusables[0]);

      // Forwards off the last control wraps to the first, and back off the first
      // wraps to the last: focus never leaves the sheet covering the page.
      focusables[focusables.length - 1].focus();
      fireEvent.keyDown(document, { key: "Tab" });
      expect(document.activeElement).toBe(focusables[0]);
      fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(focusables[focusables.length - 1]);

      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("dialog", { name: "导航" })).toBeNull();
      expect(document.activeElement).toBe(trigger);
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
    });
  });
});
