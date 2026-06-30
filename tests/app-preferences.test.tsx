import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AppPreferencesProvider,
  useAppPreferences,
} from "@/components/providers/app-preferences";
import { LoginPage } from "@/components/pages/login-page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
  }),
}));

function LocaleProbe() {
  const { locale, toggleLocale } = useAppPreferences();

  return (
    <>
      <output aria-label="Current locale">{locale}</output>
      <button type="button" onClick={toggleLocale}>
        Toggle locale
      </button>
    </>
  );
}

describe("AppPreferencesProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.cookie = "uais-locale=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    document.documentElement.removeAttribute("lang");
  });

  it("uses the server-provided initial locale on the first client render", () => {
    render(
      <AppPreferencesProvider initialLocale="en-US">
        <LocaleProbe />
      </AppPreferencesProvider>,
    );

    expect(screen.getByLabelText("Current locale").textContent).toBe("en-US");
  });

  it("renders the login page in English when the server-provided locale is English", () => {
    render(
      <AppPreferencesProvider initialLocale="en-US">
        <LoginPage />
      </AppPreferencesProvider>,
    );

    expect(
      screen.getByRole("heading", {
        name: "Welcome to UAIS: an intelligent platform where multi-agent AI powers personalized learning and teaching.",
      }),
    ).toBeTruthy();
    expect(screen.getByText("Account Login")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log In" })).toBeTruthy();
  });

  it("persists locale changes to local storage and a route-readable cookie", () => {
    render(
      <AppPreferencesProvider initialLocale="zh-CN">
        <LocaleProbe />
      </AppPreferencesProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Toggle locale" }));

    expect(screen.getByLabelText("Current locale").textContent).toBe("en-US");
    expect(window.localStorage.getItem("uais-locale")).toBe("en-US");
    expect(document.cookie).toContain("uais-locale=en-US");
  });
});
