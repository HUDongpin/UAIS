"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useAppPreferences } from "@/components/providers/app-preferences";
import { classroomAccountCopy } from "@/i18n/copy";
import { isUaisRouteAllowedForRole } from "@/lib/auth/uais-app-session";
export function FirstLoginPage() {
  const { locale } = useAppPreferences();
  const t = classroomAccountCopy[locale];
  const [password, setPassword] = useState(""), [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if (password !== repeat) { setError(t.mismatch); return; }
    if (password.length < 12 || password.length > 128) { setError(t.length); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/first-password", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
      const body = await response.json();
      if (!response.ok) { setError(body.reasonCode === "password-setup-expired" ? t.expired : body.reasonCode === "password-must-differ-from-initial" ? t.different : t.firstFailed); return; }
      const target = body.redirectTarget;
      window.location.assign(typeof target === "string" && target.startsWith("/") && !target.startsWith("//") && !target.includes("\\") && isUaisRouteAllowedForRole(target, "student") ? target : "/courses");
    } catch { setError(t.firstFailed); } finally { setBusy(false); }
  }
  return <main className="grid min-h-dvh place-items-center bg-[var(--background)] p-6 text-[var(--foreground)]"><form onSubmit={submit} className="w-full max-w-md space-y-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-7">
    <h1 className="text-xl font-semibold">{t.firstTitle}</h1><p className="text-sm leading-6">{t.firstHelp}</p>
    <label className="block text-sm">{t.password}<input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={event => setPassword(event.target.value)} className="mt-2 w-full rounded-lg border p-3" /></label>
    <label className="block text-sm">{t.repeat}<input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={repeat} onChange={event => setRepeat(event.target.value)} className="mt-2 w-full rounded-lg border p-3" /></label>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <button type="submit" disabled={busy} className="w-full rounded-lg bg-blue-700 px-4 py-3 text-white disabled:opacity-50">{busy ? t.pending : t.save}</button>
    <Link href="/login" className="block text-center text-sm underline">{t.login}</Link>
  </form></main>;
}
