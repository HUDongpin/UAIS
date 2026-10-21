"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { localizedText } from "@/components/ui/localized-text";
import type { Locale } from "@/i18n/copy";
import { openMaicExportPackages } from "./teaching-operation-page-data";

const packages = [
  { format: "pptx", zh: "下载 PPTX", en: "Download PPTX", suffix: ".pptx", contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  { format: "resource-zip", zh: "下载资源 ZIP", en: "Download Resource ZIP", suffix: "-resources.zip", contentType: "application/zip" },
  { format: "classroom-zip", zh: "下载课堂 ZIP", en: "Download Classroom ZIP", suffix: "-classroom.zip", contentType: "application/zip" },
] as const;

export function TeachingCourseExportDownloads({ courseId, locale }: {
  courseId?: string;
  locale: Locale;
}) {
  const [pending, setPending] = useState<string>();
  const [result, setResult] = useState<{ error: boolean; message: string }>();
  const requestRef = useRef<AbortController | null>(null);
  const downloadUrls = useRef<string[]>([]);
  useEffect(() => () => {
    requestRef.current?.abort();
    downloadUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  async function download(item: typeof packages[number]) {
    if (!courseId || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setPending(item.format);
    setResult(undefined);
    try {
      const response = await fetch(
        `/api/teaching/courses/${encodeURIComponent(courseId)}/export/${item.format}?locale=${locale}`,
        { credentials: "same-origin", signal: controller.signal },
      );
      if (!response.ok) {
        const reason = response.status === 401 || response.status === 403
          ? (locale === "zh-CN" ? "请确认已登录并拥有该课程的导出权限。" : "Check your sign-in and export permission for this course.")
          : response.status === 404 || response.status === 422
            ? (locale === "zh-CN" ? "课程内容或媒体尚未就绪，请保存教学内容并检查已发布的媒体文件。" : "Course content or media is unavailable. Save teaching content and check published media files.")
            : response.status === 413
              ? (locale === "zh-CN" ? "课程超过文件导出大小上限，请缩小课件或媒体后重试。" : "This course exceeds the export size limit. Reduce the deck or media size and retry.")
            : (locale === "zh-CN" ? "导出服务暂时不可用，请稍后重试。" : "The export service is unavailable. Please try again.");
        throw new Error(reason);
      }
      if (response.headers.get("content-type")?.split(";")[0] !== item.contentType) {
        throw new Error(locale === "zh-CN" ? "服务器没有返回所选类型的文件，下载未完成。" : "The server did not return the requested file type. Download was not completed.");
      }
      const blob = await response.blob();
      if (!blob.size) throw new Error(locale === "zh-CN" ? "导出文件为空，下载未完成。" : "The exported file is empty. Download was not completed.");
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      downloadUrls.current.push(url);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${courseId}${item.suffix}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Give browsers time to consume the download before releasing its bytes.
      setTimeout(() => {
        URL.revokeObjectURL(url);
        downloadUrls.current = downloadUrls.current.filter((value) => value !== url);
      }, 60_000);
      setResult({ error: false, message: locale === "zh-CN" ? "文件已生成，已开始下载。" : "File generated. Download started." });
    } catch (error) {
      if (!controller.signal.aborted) {
        setResult({
          error: true,
          message: error instanceof Error && error.name !== "TypeError"
            ? error.message
            : locale === "zh-CN" ? "下载失败，请检查连接后重试。" : "Download failed. Check your connection and retry.",
        });
      }
    } finally {
      if (!controller.signal.aborted) setPending(undefined);
      if (requestRef.current === controller) requestRef.current = null;
    }
  }

  return (
    <>
      <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-3">
        {openMaicExportPackages.map((item, index) => {
          const file = packages[index];
          return (
            <article key={file.format} className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-[var(--foreground)]">{localizedText(item.title, locale)}</h4>
                <span className="rounded-full bg-[var(--surface-soft)] px-2 py-1 text-xs font-semibold text-[var(--muted)]">{file.format === "pptx" ? "PPTX" : "ZIP"}</span>
              </div>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--muted)]">
                {item.includes.map((include) => (
                  <li key={localizedText(include, locale)} className="flex gap-2">
                    <CheckCircle size={16} weight="duotone" className="mt-1 shrink-0 text-[var(--accent)]" />
                    <span>{localizedText(include, locale)}</span>
                  </li>
                ))}
              </ul>
              <p className="mb-4 mt-3 text-xs leading-5 text-[var(--muted)]">{localizedText(item.note, locale)}</p>
              <button
                type="button"
                disabled={!courseId || Boolean(pending)}
                aria-busy={pending === file.format}
                onClick={() => void download(file)}
                className="mt-auto min-h-11 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-2 text-sm font-semibold text-[var(--accent)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending === file.format
                  ? locale === "zh-CN" ? "正在生成文件…" : "Generating file…"
                  : locale === "zh-CN" ? file.zh : file.en}
              </button>
            </article>
          );
        })}
      </div>
      {!courseId && <p className="mt-3 text-sm text-[var(--muted)]">{locale === "zh-CN" ? "请从课程卡片进入，选择要导出的课程。" : "Open this page from a course card to select the course to export."}</p>}
      {result && <p role={result.error ? "alert" : "status"} className={`mt-3 text-sm ${result.error ? "text-red-600 dark:text-red-400" : "text-[var(--accent)]"}`}>{result.message}</p>}
    </>
  );
}
