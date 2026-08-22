import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/layout/app-shell";

const routeState = vi.hoisted(() => ({ pathname: "/courses" }));
const preferenceState = vi.hoisted(() => ({ locale: "zh-CN" as "zh-CN" | "en-US" }));

vi.mock("next/navigation", () => ({
  usePathname: () => routeState.pathname,
}));

vi.mock("@/components/layout/header", () => ({
  Header: () => <header>UAIS header</header>,
}));

vi.mock("@/components/providers/app-preferences", () => ({
  useAppPreferences: () => preferenceState,
}));

describe("AppShell accessibility", () => {
  afterEach(() => {
    routeState.pathname = "/courses";
    preferenceState.locale = "zh-CN";
  });

  it("provides a localized skip link to a programmatically focusable main region", () => {
    render(
      <AppShell>
        <p>Course content</p>
      </AppShell>,
    );

    const skipLink = screen.getByRole("link", { name: "跳到主要内容" });
    const main = screen.getByRole("main");
    expect(skipLink.getAttribute("href")).toBe("#uais-main-content");
    expect(main.id).toBe("uais-main-content");
    expect(main.getAttribute("tabindex")).toBe("-1");
  });

  it("renders the skip link in English when English is selected", () => {
    preferenceState.locale = "en-US";
    render(<AppShell>Course content</AppShell>);

    expect(screen.getByRole("link", { name: "Skip to main content" })).toBeTruthy();
  });
});
