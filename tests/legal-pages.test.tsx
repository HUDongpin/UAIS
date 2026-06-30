import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import TermsPage from "@/app/terms/page";
import PrivacyPage from "@/app/privacy/page";
import { LoginPage } from "@/components/pages/login-page";
import { AppShell } from "@/components/layout/app-shell";

const navigationState = vi.hoisted(() => ({
  pathname: "/login",
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: navigationState.replace,
  }),
  usePathname: () => navigationState.pathname,
}));

vi.mock("@/components/providers/app-preferences", () => ({
  useAppPreferences: () => {
    const [locale, setLocale] = useState<"zh-CN" | "en-US">("zh-CN");

    return {
      locale,
      theme: "light",
      toggleLocale: () => setLocale((current) => (current === "zh-CN" ? "en-US" : "zh-CN")),
      toggleTheme: vi.fn(),
    };
  },
}));

describe("legal policy pages", () => {
  it("renders a detailed Chinese user agreement at /terms", () => {
    render(<TermsPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "用户协议" }),
    ).toBeTruthy();
    expect(screen.getByText("生效日期：")).toBeTruthy();
    expect(screen.getByText("2026年6月22日")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "账号、权限与使用边界" })).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "人工智能生成内容与教学责任" }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "知识产权与内容许可" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "服务变更、暂停与终止" })).toBeTruthy();

    const sections = screen.getAllByRole("article");
    expect(sections.length).toBeGreaterThanOrEqual(8);
    expect(document.body.textContent?.length ?? 0).toBeGreaterThan(2500);
    expect(document.body.textContent).not.toContain("UAIS");
  });

  it("renders a detailed Chinese privacy policy at /privacy", () => {
    render(<PrivacyPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "隐私政策" }),
    ).toBeTruthy();
    expect(screen.getByText("生效日期：")).toBeTruthy();
    expect(screen.getByText("2026年6月22日")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "我们收集的信息" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "我们如何使用信息" })).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "人工智能服务与第三方处理" }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "您的权利与选择" })).toBeTruthy();

    const sections = screen.getAllByRole("article");
    expect(sections.length).toBeGreaterThanOrEqual(8);
    expect(document.body.textContent?.length ?? 0).toBeGreaterThan(2500);
    expect(document.body.textContent).not.toContain("UAIS");
  });

  it("keeps the login consent links wired to the legal pages", () => {
    render(<LoginPage />);

    const consent = screen.getByText("我已阅读并同意").closest("p");
    expect(consent).toBeTruthy();
    expect(
      within(consent as HTMLElement).getByRole("link", { name: "用户协议" }).getAttribute("href"),
    ).toBe("/terms");
    expect(
      within(consent as HTMLElement).getByRole("link", { name: "隐私政策" }).getAttribute("href"),
    ).toBe("/privacy");
  });

  it.each([
    ["/terms", "用户协议", <TermsPage key="terms" />],
    ["/privacy", "隐私政策", <PrivacyPage key="privacy" />],
  ])("does not show the global navigation shell on %s", (pathname, heading, page) => {
    navigationState.pathname = pathname;

    render(<AppShell>{page}</AppShell>);

    expect(screen.getByRole("heading", { level: 1, name: heading })).toBeTruthy();
    expect(screen.queryByRole("banner")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Primary" })).toBeNull();
    expect(screen.queryByText("课程广场")).toBeNull();
    expect(screen.queryByText("我的学习")).toBeNull();
    expect(screen.queryByText("我的教学")).toBeNull();
  });

  it("lets users switch the user agreement between Chinese and English", () => {
    render(<TermsPage />);

    expect(screen.getByRole("button", { name: "切换到英文" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "用户协议" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "切换到英文" }));

    expect(screen.getByRole("button", { name: "Switch to Chinese" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Terms of Use" })).toBeTruthy();
    expect(screen.getByText("Effective date:")).toBeTruthy();
    expect(screen.getByText("June 22, 2026")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Accounts, Permissions, and Boundaries" })).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "AI-Generated Content and Teaching Responsibility" }),
    ).toBeTruthy();
  });

  it("lets users switch the privacy policy between Chinese and English", () => {
    render(<PrivacyPage />);

    expect(screen.getByRole("button", { name: "切换到英文" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "隐私政策" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "切换到英文" }));

    expect(screen.getByRole("button", { name: "Switch to Chinese" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeTruthy();
    expect(screen.getByText("Effective date:")).toBeTruthy();
    expect(screen.getByText("June 22, 2026")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Information We Collect" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Your Rights and Choices" })).toBeTruthy();
  });
});
