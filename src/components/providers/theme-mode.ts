// Server-safe theme primitives.
//
// These are imported by both the server root layout (`src/app/layout.tsx`) and
// the `"use client"` preferences provider (`app-preferences.tsx`). Keeping them
// in a module WITHOUT a `"use client"` directive is required: an export from a
// client module becomes a client reference and cannot be *called* on the server
// (Next.js throws "Attempted to call resolveThemeMode() from the server"). This
// module has no client-only dependencies, so it stays callable in both runtimes.

export type ThemeMode = "light" | "dark";

export const defaultThemeMode: ThemeMode = "light";

export function resolveThemeMode(value: string | undefined | null): ThemeMode {
  return value === "dark" ? "dark" : "light";
}
