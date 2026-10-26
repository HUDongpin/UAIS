"use client";
import { useState, useEffect } from "react";
import { DownloadSimple } from "@phosphor-icons/react/dist/ssr/DownloadSimple";
import { Printer } from "@phosphor-icons/react/dist/ssr/Printer";
import { classroomAccountCopy, type Locale } from "@/i18n/copy";
import { rosterCredentialsCsv, type ClassroomInitialCredential, type ClassroomRosterRow } from "@/lib/teaching/classroom-roster";

type Account = { account: string; displayName: string; activated: boolean };
export function ClassRosterImportPanel(props: { courseId: string; classId: string; locale: Locale }) {
  // A scope change unmounts private in-memory credentials and pending previews.
  return <RosterImportForm key={`${props.courseId}:${props.classId}`} {...props} />;
}
function RosterImportForm({ courseId, classId, locale }: { courseId: string; classId: string; locale: Locale }) {
  const t = classroomAccountCopy[locale], endpoint = `/api/teaching/courses/${encodeURIComponent(courseId)}/classes/${encodeURIComponent(classId)}/roster`;
  const [csv, setCsv] = useState(""), [rows, setRows] = useState<ClassroomRosterRow[]>([]), [credentials, setCredentials] = useState<ClassroomInitialCredential[]>([]), [accounts, setAccounts] = useState<Account[]>([]);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [confirmAccount, setConfirmAccount] = useState("");
  async function refresh() {
    const response = await fetch(endpoint, { cache: "no-store", credentials: "same-origin" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.reasonCode ?? "failed");
    setAccounts(body.accounts);
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { cache: "no-store", credentials: "same-origin", signal: controller.signal }).then(async response => {
      const body = await response.json(); if (!response.ok) throw new Error(body.reasonCode ?? "failed"); setAccounts(body.accounts);
    }).catch(error => { if (error.name !== "AbortError") setMessage(error.message === "database-accounts-provider-required" ? t.blocked : t.failed); });
    return () => controller.abort();
  }, [endpoint, t.blocked, t.failed]);
  async function action(action: "preview" | "import" | "reissue", account?: string) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, csv, account }) });
      const body = await response.json();
      if (!response.ok) { setMessage(response.status === 423 ? t.closed : body.reasonCode === "database-accounts-provider-required" ? t.blocked : body.reasonCode === "roster-csv-invalid" ? t.fileFailed : t.failed); return; }
      if (action === "preview") { setRows(body.rows); if (body.rows.some((row: ClassroomRosterRow) => row.status === "invalid" || row.status === "duplicate")) setMessage(t.issue); }
      else { setCredentials(body.credentials ?? []); setRows([]); setConfirmAccount(""); setMessage(body.credentials?.length ? t.imported : t.noCredentials); await refresh(); }
    } catch { setMessage(t.failed); } finally { setBusy(false); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([rosterCredentialsCsv(credentials)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "student-initial-credentials.csv"; link.click(); URL.revokeObjectURL(url);
  }
  function print() {
    const popup = window.open("", "_blank", "popup,width=800,height=600"); if (!popup) { setMessage(t.failed); return; }
    popup.opener = null;
    const heading = popup.document.createElement("h1"); heading.textContent = t.title; popup.document.body.append(heading);
    for (const item of credentials) {
      const card = popup.document.createElement("pre"); card.style.cssText = "border:1px solid #aaa;padding:20px;white-space:pre-wrap;break-inside:avoid";
      card.textContent = `${item.displayName}\n${t.account}: ${item.account}\n${locale === "zh-CN" ? "初始凭据" : "Initial credential"}: ${item.initialPassword}\n${window.location.origin}/login`;
      popup.document.body.append(card);
    }
    popup.document.title = t.title; popup.print(); popup.close();
  }
  const button = "rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50";
  return <section aria-label={t.title} className="space-y-4 rounded-xl border border-[var(--border)] p-4">
    <h3 className="font-semibold">{t.title}</h3><p className="text-sm leading-6">{t.help}</p>
    <label className="block text-sm">{t.upload}<input aria-label={t.upload} type="file" accept=".csv,text/csv" disabled={busy} className="mt-2 block w-full" onChange={async event => {
      const file = event.target.files?.[0]; setRows([]); setCsv(""); setMessage("");
      if (!file) return; if (file.size > 100_000) { setMessage(t.fileFailed); return; }
      try { setCsv(await file.text()); } catch { setMessage(t.fileFailed); }
    }} /></label>
    <div className="flex flex-wrap gap-2"><button className={button} disabled={busy || !csv} onClick={() => void action("preview")}>{busy ? t.pending : t.preview}</button>
      <button className={button} disabled={busy || !rows.length || rows.some(row => !["new", "existing"].includes(row.status))} onClick={() => void action("import")}>{t.confirm}</button></div>
    {rows.length > 0 && <div className="max-h-72 overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th>{t.account}</th><th>{t.name}</th><th>{t.status}</th></tr></thead><tbody>{rows.map(row => <tr key={row.row}><td className="py-2">{row.account}</td><td>{row.displayName}</td><td>{t[row.status]}</td></tr>)}</tbody></table></div>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {credentials.length > 0 && <div className="space-y-3 rounded-lg border border-amber-400 p-3"><p className="text-sm">{t.credentials}</p><div className="flex flex-wrap gap-2"><button className={button} onClick={download}><DownloadSimple className="mr-1 inline" aria-hidden />{t.download}</button><button className={button} onClick={print}><Printer className="mr-1 inline" aria-hidden />{t.print}</button><button className={button} onClick={() => setCredentials([])}>{t.clear}</button></div></div>}
    <button className={button} disabled={busy} onClick={() => void refresh().catch(() => setMessage(t.failed))}>{t.refresh}</button>
    {!accounts.length ? <p className="text-sm">{t.empty}</p> : <ul className="space-y-2">{accounts.map(account => <li key={account.account} className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)] p-2 text-sm"><span>{account.displayName} ({account.account})</span><span>{account.activated ? t.activated : t.waiting}</span>{!account.activated && (confirmAccount === account.account ? <><button className={button} disabled={busy} onClick={() => void action("reissue", account.account)}>{t.confirmReissue}</button><button className={button} disabled={busy} onClick={() => setConfirmAccount("")}>{t.cancel}</button></> : <button className={button} disabled={busy} onClick={() => setConfirmAccount(account.account)}>{t.reissue}</button>)}</li>)}</ul>}
  </section>;
}
