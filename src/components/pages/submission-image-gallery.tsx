"use client";
import type { Locale } from "@/i18n/copy";
import type { SubmissionImage } from "@/lib/learning-loop/submission-image-policy";
export function SubmissionImageGallery({
  images,
  locale,
  prefix = "",
  onRemove,
  disabled = false,
}: {
  images: SubmissionImage[];
  locale: Locale;
  prefix?: string;
  onRemove?: (image: SubmissionImage) => void;
  disabled?: boolean;
}) {
  const zh = locale === "zh-CN";
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {images.map((image, index) => (
        <figure
          key={image.id}
          className="rounded-xl border border-[var(--border)] p-3"
        >
          <a href={image.url} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element -- authenticated media must use the viewer's session, never an image optimizer. */}
            <img
              src={image.url}
              alt={`${prefix}${zh ? "作业图片" : "Submission image"} ${index + 1}`}
              className="max-h-80 w-full rounded-lg object-contain"
              loading="lazy"
            />
          </a>
          <figcaption className="mt-2 flex items-center justify-between gap-2 text-xs text-[var(--muted)]">
            <span>
              {zh
                ? `图片 ${index + 1} · 已保存到服务器`
                : `Image ${index + 1} · saved by server`}
            </span>
            {onRemove ? (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onRemove(image)}
                className="rounded-full border border-[var(--border)] px-3 py-1.5 font-semibold disabled:opacity-40"
              >
                {zh ? "移除图片" : "Remove image"}
              </button>
            ) : null}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
