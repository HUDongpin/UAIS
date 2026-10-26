import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ClassRosterImportPanel } from "@/components/teaching/class-roster-import-panel";
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
describe("class roster import UI", () => {
  it("requires preview before confirmation and clears credentials when switching class", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.body) return Response.json({ accounts: [] });
      const body = JSON.parse(String(init.body));
      return Response.json(body.action === "preview" ? { rows: [{ row: 2, account: "s1", displayName: "A", status: "new" }] } : { credentials: [{ account: "s1", displayName: "A", initialPassword: "disposable-test" }] });
    });
    globalThis.fetch = fetchMock;
    const { rerender } = render(<ClassRosterImportPanel courseId="c1" classId="cl1" locale="en-US" />);
    const confirm = screen.getByRole("button", { name: "Confirm student account creation" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    const file = new File(["account,displayName\ns1,A"], "roster.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => "account,displayName\ns1,A" });
    fireEvent.change(screen.getByLabelText("Choose roster CSV"), { target: { files: [file] } });
    await waitFor(() => expect((screen.getByRole("button", { name: "Preview roster" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Preview roster" }));
    await waitFor(() => expect(confirm.disabled).toBe(false));
    fireEvent.click(confirm);
    await screen.findByRole("button", { name: "Download initial credentials" });
    expect(screen.queryByText("disposable-test")).toBeNull();
    rerender(<ClassRosterImportPanel courseId="c1" classId="cl2" locale="en-US" />);
    expect(screen.queryByRole("button", { name: "Download initial credentials" })).toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/teaching/courses/c1/classes/cl2/roster", expect.anything()));
  });
  it("does not permit confirmation with invalid or duplicate records", async () => {
    globalThis.fetch = vi.fn(async (_input, init) => Response.json(init?.body ? { rows: [{ row: 2, account: "s1", displayName: "A", status: "duplicate" }] } : { accounts: [] }));
    render(<ClassRosterImportPanel courseId="c1" classId="cl1" locale="en-US" />);
    const file = new File(["ignored"], "roster.csv"); Object.defineProperty(file, "text", { value: async () => "account,displayName\ns1,A" });
    fireEvent.change(screen.getByLabelText("Choose roster CSV"), { target: { files: [file] } });
    await waitFor(() => expect((screen.getByRole("button", { name: "Preview roster" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Preview roster" }));
    await screen.findByText("Duplicate in file");
    expect((screen.getByRole("button", { name: "Confirm student account creation" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
