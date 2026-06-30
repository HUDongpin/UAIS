import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LoginPage } from "@/components/pages/login-page";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace,
  }),
}));

vi.mock("@/components/providers/app-preferences", () => ({
  useAppPreferences: () => ({
    locale: "zh-CN",
    toggleLocale: vi.fn(),
  }),
}));

describe("LoginPage", () => {
  it("uses the Chinese UAIS brand translation and only exposes account-password login", () => {
    render(<LoginPage />);

    expect(
      screen.getByRole("heading", {
        name: "欢迎来到优爱思：多智能体赋能的个性化学习和教学智能平台",
      }),
    ).toBeTruthy();
    expect(screen.getAllByText("优爱思").length).toBeGreaterThan(0);
    expect(screen.getAllByText("大学人工智能系统").length).toBeGreaterThan(0);
    expect(screen.getByText("账号密码登录")).toBeTruthy();
    expect(screen.queryByText("校内人员登录")).toBeNull();
    expect(screen.queryByRole("link", { name: /注册/ })).toBeNull();
  });

  it("uses a polished lock-key glyph for the password field", () => {
    render(<LoginPage />);

    const passwordIcon = document.querySelector("[data-uais-login-password-icon]");

    expect(passwordIcon?.getAttribute("data-uais-login-password-icon")).toBe("lock-key");
    expect(passwordIcon?.getAttribute("class")).toContain("text-[#7d8aa3]");
    expect(passwordIcon?.getAttribute("width")).toBe("21");
    expect(passwordIcon?.getAttribute("height")).toBe("21");
  });

  it("renders the asset-backed dual-card login design deck", () => {
    render(<LoginPage />);

    const deck = document.querySelector("[data-uais-login-design-deck]");
    expect(deck).not.toBeNull();
    expect(deck?.getAttribute("style") ?? "").toContain("aspect-ratio: 766 / 520");
    const studentCard = deck?.querySelector('[data-uais-login-card="student"]');
    const teacherCard = deck?.querySelector('[data-uais-login-card="teacher"]');
    expect(studentCard).toBeTruthy();
    expect(teacherCard).toBeTruthy();
    expect(deck?.querySelectorAll("[data-uais-login-asset]").length).toBe(2);
    expect(
      deck
        .querySelector('[data-uais-login-card="student"] [data-uais-login-asset]')
        ?.getAttribute("src"),
    ).toContain("/login/uais-student-card-illustration");
    expect(
      deck
        .querySelector('[data-uais-login-card="student"] [data-uais-login-asset]')
        ?.getAttribute("alt"),
    ).toContain("平板电脑和笔记本电脑");
    expect(
      deck
        .querySelector('[data-uais-login-card="teacher"] [data-uais-login-asset]')
        ?.getAttribute("src"),
    ).toContain("/login/uais-teacher-card-illustration");
    expect(
      deck
        .querySelector('[data-uais-login-card="teacher"] [data-uais-login-asset]')
        ?.getAttribute("alt"),
    ).toContain("戴眼镜的女教师");
    expect(
      deck
        .querySelector('[data-uais-login-card="student"] [data-uais-login-footer-icon]')
        ?.getAttribute("data-uais-login-footer-icon"),
    ).toBe("laptop");
    expect(
      deck
        .querySelector('[data-uais-login-card="teacher"] [data-uais-login-footer-icon]')
        ?.getAttribute("data-uais-login-footer-icon"),
    ).toBe("book");

    [studentCard, teacherCard].forEach((card) => {
      const assetFrame = card?.querySelector("[data-uais-login-asset-frame]");
      const chipRail = card?.querySelector("[data-uais-login-feature-rail]");
      const heading = card?.querySelector("[data-uais-login-card-heading]");
      const mediaStack = card?.querySelector("[data-uais-login-media-stack]");
      const footerBand = card?.querySelector("[data-uais-login-footer-band]");
      const asset = card?.querySelector("[data-uais-login-asset]");

      expect(assetFrame).toBeTruthy();
      expect(chipRail).toBeTruthy();
      expect(mediaStack).toBeTruthy();
      expect(mediaStack?.className).toContain("grid-rows-[minmax(0,1fr)_auto]");
      expect(heading?.className).toContain("text-[20px]");
      expect(heading?.className).toContain("2xl:text-[24px]");
      expect(asset?.className).toContain("object-contain");
      expect(asset?.className).toContain("object-center");
      expect(asset?.className).not.toContain("object-cover");
      expect(assetFrame?.querySelectorAll("[data-uais-login-feature-chip]").length).toBe(0);
      expect(chipRail?.querySelectorAll("[data-uais-login-feature-chip]").length).toBe(3);
      chipRail?.querySelectorAll("[data-uais-login-feature-chip]").forEach((chip) => {
        expect(chip.className).toContain("min-h-[54px]");
        expect(chip.className).toContain("gap-3");
        expect(chip.className).toContain("px-4");
        expect(chip.className).toContain("py-3");
        expect(chip.className).toContain("text-[13px]");
        expect(chip.className).toContain("2xl:min-h-[60px]");
        expect(chip.className).toContain("2xl:text-[15px]");
        const iconSlot = chip.querySelector("[data-uais-login-feature-icon]");
        const label = chip.querySelector("[data-uais-login-feature-label]");
        const iconSvg = iconSlot?.querySelector("svg");

        expect(iconSlot?.className).toContain("size-7");
        expect(iconSlot?.className).toContain("2xl:size-8");
        expect(iconSvg?.getAttribute("width")).toBe("22");
        expect(iconSvg?.getAttribute("height")).toBe("22");
        expect(label?.className).toContain("leading-[1.18]");
      });
      expect(footerBand?.className).toContain("mt-5");
      expect(footerBand?.className).toContain("min-h-[58px]");
      expect(footerBand?.className).not.toContain("mt-auto");
      expect(footerBand?.className).not.toContain("h-[49px]");
      expect(footerBand?.querySelector("span")?.className).not.toContain("truncate");
    });

    expect(document.querySelector("[data-uais-login-mobile-carousel]")).toBeTruthy();
    expect(screen.queryByText("学生登录")).toBeNull();
    expect(screen.queryByText("教师登录")).toBeNull();
    expect(screen.getAllByText("学生全自主学习").length).toBeGreaterThan(0);
    expect(screen.getAllByText("教师全智能辅助").length).toBeGreaterThan(0);
    expect(screen.getAllByText("多智能体即时回应").length).toBeGreaterThan(0);
    expect(screen.getAllByText("每个疑问都有高质量回答").length).toBeGreaterThan(0);
    expect(screen.getAllByText("个性化教学").length).toBeGreaterThan(0);
    expect(screen.getAllByText("智能助教即时反馈").length).toBeGreaterThan(0);
    expect(screen.getAllByText("高度自定义教学界面").length).toBeGreaterThan(0);
    expect(screen.queryByText("每个疑问都有回应")).toBeNull();
    expect(screen.queryByText("自动化备课")).toBeNull();
    expect(screen.queryByText("AI课程与学情线索")).toBeNull();
    expect(screen.queryByText("自动化备课与班级邀请")).toBeNull();
  });

  it("does not use the old CSS-built cartoon people in the asset deck", () => {
    const { container } = render(<LoginPage />);

    expect(container.querySelector("[data-uais-login-design-deck]")).toBeTruthy();
    expect(container.querySelectorAll("[data-uais-cartoon-person]").length).toBe(0);
    expect(container.querySelectorAll("[data-uais-cartoon-feature]").length).toBe(0);
    expect(container.querySelectorAll("[data-uais-cartoon-prop]").length).toBe(0);
  });

  it("asks the server to issue the teacher app session and enters My Teaching", async () => {
    const cookieSetter = vi.spyOn(document, "cookie", "set");
    const fetchMock = vi.fn(async () =>
      Response.json({
        status: "ok",
        redirectTarget: "/teaching",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText("账号"), {
      target: { value: "Phoebe" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "12345" },
    });
    fireEvent.click(screen.getByRole("button", { name: "立即登录" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/teaching"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/app-session",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
      }),
    );
    expect(cookieSetter).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    cookieSetter.mockRestore();
  });

  it("asks the server to issue the student app session and enters Student Dashboard", async () => {
    const cookieSetter = vi.spyOn(document, "cookie", "set");
    const fetchMock = vi.fn(async () =>
      Response.json({
        status: "ok",
        redirectTarget: "/student-dashboard",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText("账号"), {
      target: { value: "Peter" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "12345" },
    });
    fireEvent.click(screen.getByRole("button", { name: "立即登录" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/student-dashboard"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/app-session",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
      }),
    );
    expect(cookieSetter).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    cookieSetter.mockRestore();
  });
});
