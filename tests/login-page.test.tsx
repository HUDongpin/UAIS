import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "@/components/pages/login-page";

const replace = vi.fn();

const mockPreferences = vi.hoisted(() => ({ locale: "zh-CN" as "zh-CN" | "en-US" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace,
  }),
}));

vi.mock("@/components/providers/app-preferences", () => ({
  useAppPreferences: () => ({
    locale: mockPreferences.locale,
    toggleLocale: vi.fn(),
  }),
}));

describe("LoginPage", () => {
  afterEach(() => {
    mockPreferences.locale = "zh-CN";
    vi.unstubAllGlobals();
  });

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

    fireEvent.change(screen.getByLabelText("账号或邮箱"), {
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

    fireEvent.change(screen.getByLabelText("账号或邮箱"), {
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

  it("invites an account or an email, which is what the account store accepts", () => {
    const { unmount } = render(<LoginPage />);

    const identifierField = screen.getByLabelText("账号或邮箱") as HTMLInputElement;
    expect(identifierField.placeholder).toBe("教师账号、学生账号或注册邮箱");
    unmount();

    mockPreferences.locale = "en-US";
    render(<LoginPage />);

    const englishIdentifierField = screen.getByLabelText(
      "Account or email",
    ) as HTMLInputElement;
    expect(englishIdentifierField.placeholder).toBe(
      "Teacher account, student account, or registered email",
    );
  });

  it("labels the password-visibility toggle in the reader's own language", () => {
    const { unmount } = render(<LoginPage />);

    const chineseToggle = screen.getByRole("button", { name: "显示密码" });
    fireEvent.click(chineseToggle);
    expect(screen.getByRole("button", { name: "隐藏密码" })).toBeTruthy();
    unmount();

    mockPreferences.locale = "en-US";
    render(<LoginPage />);

    const englishToggle = screen.getByRole("button", { name: "Show password" });
    fireEvent.click(englishToggle);
    expect(screen.getByRole("button", { name: "Hide password" })).toBeTruthy();
  });

  it("states consent in the implicit form it actually collects, and links both documents", () => {
    const { unmount } = render(<LoginPage />);

    // No checkbox is rendered and the submit handler checks no consent state,
    // so the line must not claim the reader ticked anything.
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText("登录即表示同意")).toBeTruthy();
    expect(screen.queryByText("我已阅读并同意")).toBeNull();
    expect(screen.getByRole("link", { name: "《用户协议》" }).getAttribute("href")).toBe(
      "/terms",
    );
    expect(screen.getByRole("link", { name: "《隐私政策》" }).getAttribute("href")).toBe(
      "/privacy",
    );
    unmount();

    mockPreferences.locale = "en-US";
    render(<LoginPage />);

    expect(screen.getByText("By signing in you agree to the")).toBeTruthy();
    expect(screen.queryByText("I have read and agree to the")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Terms of Use" }).getAttribute("href"),
    ).toBe("/terms");
    expect(screen.getByRole("link", { name: "Privacy Policy" }).getAttribute("href")).toBe(
      "/privacy",
    );
  });

  it("renders a known reason code as Chinese copy instead of the server's English string", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: "UAIS app auth provider is not production-ready.",
            reasonCode: "app-auth-provider-not-production-ready",
          },
          { status: 503 },
        ),
      ),
    );

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText("账号或邮箱"), { target: { value: "Peter" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "12345" } });
    fireEvent.click(screen.getByRole("button", { name: "立即登录" }));

    const failure = await screen.findByText("登录服务尚未完成配置，暂时无法登录。");
    expect(failure).toBeTruthy();
    // The English sentence never reaches the student on a mapped code.
    expect(screen.queryByText(/production-ready/)).toBeNull();
    expect(document.querySelector("[data-uais-login-failure-detail]")).toBeNull();
    // Every failure names a support channel, from the single copy.ts slot.
    expect(
      document.querySelector("[data-uais-support-channel]")?.textContent,
    ).toBe("如果问题持续出现，请联系任课教师获取帮助。");
  });

  it("does not point an empty-field mistake at the support channel", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<LoginPage />);

    fireEvent.click(screen.getByRole("button", { name: "立即登录" }));

    expect(screen.getByText("请输入账号和密码。")).toBeTruthy();
    // The reader fixes this one by typing, so naming their teacher would be
    // noise dressed as help. Nothing was sent, either.
    expect(document.querySelector("[data-uais-support-channel]")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to a bilingual sentence and collapses an unmapped server string", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: "Some brand-new server failure nobody has mapped yet.",
            reasonCode: "an-unmapped-future-reason-code",
          },
          { status: 500 },
        ),
      ),
    );

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText("账号或邮箱"), { target: { value: "Peter" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "12345" } });
    fireEvent.click(screen.getByRole("button", { name: "立即登录" }));

    expect(await screen.findByText("登录服务暂时不可用，请稍后再试。")).toBeTruthy();
    const detail = document.querySelector("[data-uais-login-failure-detail]");
    expect(detail?.textContent).toBe("Some brand-new server failure nobody has mapped yet.");
    // Secondary and collapsed: inside a <details>, never the sentence itself.
    expect(detail?.closest("details")).toBeTruthy();
    expect(document.querySelector("details > summary")?.textContent).toBe("技术详情");
  });
});
