import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AppPreferencesProvider, useAppPreferences } from "@/components/providers/app-preferences";

afterEach(() => vi.restoreAllMocks());
function Classroom() {
  const preferences = useAppPreferences();
  return <><p>Classroom remains available</p><button onClick={preferences.toggleLocale}>{preferences.locale}</button><button onClick={preferences.toggleTheme}>{preferences.theme}</button></>;
}
it("keeps the classroom and preference controls usable when browser storage is denied", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Storage denied", "QuotaExceededError"); });
  expect(() => render(<AppPreferencesProvider><Classroom /></AppPreferencesProvider>)).not.toThrow();
  fireEvent.click(screen.getByRole("button", { name: "zh-CN" }));
  expect(screen.getByRole("button", { name: "en-US" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "light" }));
  expect(screen.getByRole("button", { name: "dark" })).toBeTruthy();
  expect(screen.getByText("Classroom remains available")).toBeTruthy();
});
