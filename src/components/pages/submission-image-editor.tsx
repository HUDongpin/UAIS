"use client";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/i18n/copy";
import {
  submissionImageByteLimit,
  submissionImageCountLimit,
  type SubmissionImage,
} from "@/lib/learning-loop/submission-image-policy";
import {
  readPendingImages,
  savePendingImage,
  removePendingImage,
  replacePendingImages,
  type PendingSubmissionImage,
  type SubmissionRecoveryScope,
} from "@/lib/learning-loop/client-submission-recovery";
import { SubmissionImageGallery } from "./submission-image-gallery";

export type SubmissionImageSnapshot = {
  submissionVersionId: string | null;
  draftRevision: number;
  attachments: SubmissionImage[];
  contentText: string;
  sealed: boolean;
};
type Pending = {
  record: PendingSubmissionImage;
  error?: string;
  uploading?: boolean;
};
type Props = {
  scope: SubmissionRecoveryScope;
  locale: Locale;
  versionId: string | null;
  revision: number;
  attachments: SubmissionImage[];
  editable: boolean;
  disabled: boolean;
  prepareDraft: () => Promise<SubmissionImageSnapshot | undefined>;
  readSnapshot: () => Promise<SubmissionImageSnapshot>;
  onUpdated: (value: SubmissionImageSnapshot) => void;
  onConflict: (value: SubmissionImageSnapshot) => void;
  onAuthenticationRequired: () => void;
  onBusyChange: (busy: boolean) => void;
  onPendingChange: (count: number) => void;
  onRecoveryReady: () => void;
};

export function SubmissionImageEditor(props: Props) {
  const { scope, locale, attachments, editable, disabled } = props;
  const zh = locale === "zh-CN";
  const [pending, setPending] = useState<Pending[]>([]);
  const pendingRef = useRef<Pending[]>([]);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [error, setError] = useState("");
  const [recoveryUnavailable, setRecoveryUnavailable] = useState(false);
  const identity = JSON.stringify(scope);
  // Callbacks/attachments are read once at recovery start; later selection is
  // merged, so a slow IndexedDB read cannot erase newly chosen local images.
  const initial = useRef(props);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const input = initial.current;
      const result = await readPendingImages(input.scope);
      if (cancelled) return;
      if (!result.available) setRecoveryUnavailable(true);
      const remaining: Pending[] = [];
      for (const record of result.images) {
        if (
          input.attachments.some(
            (image) =>
              image.clientAttachmentId === record.clientAttachmentId &&
              image.submissionVersionId === record.scope.submissionVersionId,
          )
        ) {
          await removePendingImage(record);
        } else remaining.push({ record, error: "image-recovered" });
      }
      if (cancelled) return;
      const merged = [
        ...remaining.filter(
          (item) =>
            !pendingRef.current.some(
              (other) =>
                other.record.clientAttachmentId ===
                item.record.clientAttachmentId,
            ),
        ),
        ...pendingRef.current,
      ];
      pendingRef.current = merged;
      setPending(merged);
      input.onPendingChange(merged.length);
      input.onRecoveryReady();
    })();
    return () => {
      cancelled = true;
    };
  }, [identity]);
  function update(change: (items: Pending[]) => Pending[]) {
    const next = change(pendingRef.current);
    pendingRef.current = next;
    setPending(next);
    props.onPendingChange(next.length);
  }
  function lock(value: boolean) {
    running.current = value;
    setBusy(value);
    props.onBusyChange(value);
  }
  async function clear(record: PendingSubmissionImage) {
    await removePendingImage(record);
    update((items) =>
      items.filter(
        (item) => item.record.clientAttachmentId !== record.clientAttachmentId,
      ),
    );
  }
  async function advanceAcknowledgedQueue(
    before: { submissionVersionId: string | null; draftRevision?: number },
    current: SubmissionImageSnapshot,
  ) {
    if (
      before.submissionVersionId === current.submissionVersionId &&
      before.draftRevision === current.draftRevision
    )
      return;
    const changes = pendingRef.current
      .filter(
        ({ record }) =>
          record.scope.submissionVersionId === before.submissionVersionId &&
          record.draftRevision === before.draftRevision,
      )
      .map(({ record }) => ({
        previous: record,
        next: {
          ...record,
          scope: {
            ...record.scope,
            submissionVersionId: current.submissionVersionId,
          },
          draftRevision: current.draftRevision,
          updatedAt: Date.now(),
        },
      }));
    // Only the exact baseline that this editor advanced is rebased. Older
    // recovered/conflicted items never inherit another device's fresh tokens.
    if (!(await replacePendingImages(changes))) setRecoveryUnavailable(true);
    const byClientId = new Map(
      changes.map(({ next }) => [next.clientAttachmentId, next]),
    );
    update((items) =>
      items.map((item) =>
        byClientId.has(item.record.clientAttachmentId)
          ? { ...item, record: byClientId.get(item.record.clientAttachmentId)! }
          : item,
      ),
    );
  }
  async function upload(original: PendingSubmissionImage, fresh: boolean) {
    // Earlier items in a batch can advance the queue while the selection array
    // still holds its original objects. Always use the acknowledged queue copy.
    let record =
      pendingRef.current.find(
        (item) =>
          item.record.clientAttachmentId === original.clientAttachmentId,
      )?.record ?? original;
    update((items) =>
      items.map((item) =>
        item.record.clientAttachmentId === record.clientAttachmentId
          ? { ...item, error: undefined, uploading: true }
          : item,
      ),
    );
    try {
      let current: SubmissionImageSnapshot;
      if (fresh) {
        const prepared = await props.prepareDraft();
        if (!prepared) throw Error("image-draft-not-ready");
        current = prepared;
      } else {
        current = await props.readSnapshot();
        if (
          current.attachments.some(
            (image) =>
              image.clientAttachmentId === record.clientAttachmentId &&
              image.submissionVersionId === record.scope.submissionVersionId,
          )
        ) {
          if (
            record.draftRevision !== undefined &&
            current.draftRevision === record.draftRevision + 1
          ) {
            await advanceAcknowledgedQueue(
              {
                submissionVersionId: record.scope.submissionVersionId,
                draftRevision: record.draftRevision,
              },
              current,
            );
          }
          props.onUpdated(current);
          await clear(
            pendingRef.current.find(
              (item) =>
                item.record.clientAttachmentId === record.clientAttachmentId,
            )?.record ?? record,
          );
          return true;
        }
        if (
          current.submissionVersionId !== record.scope.submissionVersionId ||
          current.sealed
        ) {
          props.onConflict(current);
          throw Error("image-version-changed");
        }
        if (
          record.draftRevision !== undefined &&
          record.draftRevision !== current.draftRevision
        ) {
          props.onConflict(current);
          throw Error("image-draft-changed");
        }
        if (!current.submissionVersionId) {
          const prepared = await props.prepareDraft();
          if (!prepared) throw Error("image-draft-not-ready");
          current = prepared;
        }
      }
      if (!current.submissionVersionId || current.sealed)
        throw Error("image-version-changed");
      await advanceAcknowledgedQueue(
        {
          submissionVersionId: record.scope.submissionVersionId,
          draftRevision: record.draftRevision,
        },
        current,
      );
      record =
        pendingRef.current.find(
          (item) =>
            item.record.clientAttachmentId === record.clientAttachmentId,
        )?.record ?? record;
      const bound: PendingSubmissionImage = {
        ...record,
        scope: {
          ...record.scope,
          submissionVersionId: current.submissionVersionId,
        },
        draftRevision: current.draftRevision,
        updatedAt: Date.now(),
      };
      const persisted = await savePendingImage(bound);
      if (!persisted) setRecoveryUnavailable(true);
      if (
        persisted &&
        record.scope.submissionVersionId !== bound.scope.submissionVersionId
      )
        await removePendingImage(record);
      record = bound;
      update((items) =>
        items.map((item) =>
          item.record.clientAttachmentId === record.clientAttachmentId
            ? { record, uploading: true }
            : item,
        ),
      );
      const form = new FormData();
      form.append("image", record.blob, record.name);
      form.append("expectedSubmissionVersionId", current.submissionVersionId);
      form.append("expectedDraftRevision", String(current.draftRevision));
      form.append("clientAttachmentId", record.clientAttachmentId);
      const response = await fetch(
        `/api/learning/activities/${encodeURIComponent(scope.activityId)}/submission/images`,
        { method: "POST", body: form },
      );
      const body = await response.json();
      if (response.status === 401) {
        props.onAuthenticationRequired();
        throw Error("session-required");
      }
      if (!response.ok || !body.attachment || typeof body.revision !== "number")
        throw Error(body.reasonCode ?? "image-upload-failed");
      const acknowledged: SubmissionImageSnapshot = {
        ...current,
        draftRevision: body.revision,
        attachments: [
          ...current.attachments.filter(
            (image) => image.clientAttachmentId !== record.clientAttachmentId,
          ),
          body.attachment,
        ],
      };
      if (body.revision === current.draftRevision + 1)
        await advanceAcknowledgedQueue(current, acknowledged);
      props.onUpdated(acknowledged);
      await clear(
        pendingRef.current.find(
          (item) =>
            item.record.clientAttachmentId === record.clientAttachmentId,
        )?.record ?? record,
      );
      return true;
    } catch (caught) {
      update((items) =>
        items.map((item) =>
          item.record.clientAttachmentId === record.clientAttachmentId
            ? { record, error: (caught as Error).message }
            : item,
        ),
      );
      return false;
    }
  }
  async function choose(files: FileList | null) {
    if (!files || !editable || disabled || running.current) return;
    setError("");
    const selected = Array.from(files);
    if (
      selected.length + attachments.length + pendingRef.current.length >
      submissionImageCountLimit
    ) {
      setError("image-count-limit");
      return;
    }
    if (
      selected.some(
        (file) =>
          !["image/png", "image/jpeg"].includes(file.type) ||
          file.size < 1 ||
          file.size > submissionImageByteLimit,
      )
    ) {
      setError("image-file-invalid");
      return;
    }
    lock(true);
    try {
      const records = selected.map((file): PendingSubmissionImage => ({
        scope: { ...scope, submissionVersionId: props.versionId },
        draftRevision: props.revision,
        clientAttachmentId: crypto.randomUUID(),
        blob: file,
        name: file.name,
        updatedAt: Date.now(),
      }));
      update((items) => [...items, ...records.map((record) => ({ record }))]);
      for (const record of records)
        if (!(await savePendingImage(record))) setRecoveryUnavailable(true);
      for (const record of records) {
        if (!(await upload(record, true))) break;
      }
      // Unattempted files remain explicit retries; no background retry loop.
      update((items) =>
        items.map((item) =>
          item.error || item.uploading
            ? item
            : { ...item, error: "image-waiting" },
        ),
      );
    } finally {
      lock(false);
    }
  }
  async function retry(record: PendingSubmissionImage) {
    if (disabled || running.current || !editable) return;
    lock(true);
    try {
      await upload(record, false);
    } finally {
      lock(false);
    }
  }
  async function remove(image: SubmissionImage) {
    if (disabled || running.current || !editable) return;
    lock(true);
    setError("");
    try {
      let current = await props.readSnapshot();
      let targetImage = image;
      let preparedRevision = false;
      // A revision request keeps the previous version sealed. Start its new
      // draft first, then locate the copied image by its stable client identity.
      // Never send DELETE against the sealed version or its attachment ID.
      if (
        current.sealed &&
        props.revision === 0 &&
        current.submissionVersionId === image.submissionVersionId
      ) {
        const prepared = await props.prepareDraft();
        if (!prepared) throw Error("image-draft-not-ready");
        current = prepared;
        await advanceAcknowledgedQueue(
          {
            submissionVersionId: image.submissionVersionId,
            draftRevision: props.revision,
          },
          current,
        );
        preparedRevision = true;
        const copied = current.attachments.find(
          (item) => item.clientAttachmentId === image.clientAttachmentId,
        );
        if (!copied) {
          props.onUpdated(current);
          return;
        }
        targetImage = copied;
      }
      if (
        current.submissionVersionId !== targetImage.submissionVersionId ||
        current.sealed
      ) {
        props.onConflict(current);
        throw Error("image-version-changed");
      }
      if (!current.attachments.some((item) => item.id === targetImage.id)) {
        props.onUpdated(current);
        return;
      }
      if (!preparedRevision && current.draftRevision !== props.revision) {
        props.onConflict(current);
        throw Error("image-draft-changed");
      }
      const response = await fetch(
        `/api/learning/activities/${encodeURIComponent(scope.activityId)}/submission/images/${encodeURIComponent(targetImage.id)}`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expectedSubmissionVersionId: current.submissionVersionId,
            expectedDraftRevision: current.draftRevision,
          }),
        },
      );
      const body = await response.json();
      if (response.status === 401) props.onAuthenticationRequired();
      if (!response.ok || typeof body.revision !== "number")
        throw Error(body.reasonCode ?? "image-remove-failed");
      const acknowledged: SubmissionImageSnapshot = {
        ...current,
        draftRevision: body.revision,
        attachments: current.attachments.filter(
          (item) => item.id !== targetImage.id,
        ),
      };
      if (body.revision === current.draftRevision + 1)
        await advanceAcknowledgedQueue(current, acknowledged);
      props.onUpdated(acknowledged);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      lock(false);
    }
  }
  return (
    <section className="space-y-3 rounded-xl border border-[var(--border)] p-4">
      <h3 className="font-semibold">{zh ? "作业图片" : "Submission images"}</h3>
      <p className="text-xs leading-5 text-[var(--muted)]">
        {zh
          ? "可只交图片，也可配文字。最多 3 张 PNG/JPEG，每张不超过 1 MiB。图片保存完毕后才能提交。"
          : "Submit images alone or with text. Up to 3 PNG/JPEG images, 1 MiB each. Finish uploads before submitting."}
      </p>
      <SubmissionImageGallery
        images={attachments}
        locale={locale}
        onRemove={editable ? remove : undefined}
        disabled={disabled || busy}
      />
      {editable ? (
        <label className="block text-sm font-semibold">
          {zh ? "上传作业图片" : "Upload submission images"}
          <input
            type="file"
            accept="image/png,image/jpeg"
            multiple
            disabled={
              disabled ||
              busy ||
              attachments.length + pending.length >= submissionImageCountLimit
            }
            className="mt-2 block max-w-full text-sm"
            onChange={(event) => {
              void choose(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
      ) : null}
      {recoveryUnavailable ? (
        <p role="status" className="text-sm text-[var(--warning)]">
          {zh
            ? "本机图片恢复副本不可用；未上传图片只在当前页面。刷新后需要重新选择，请先保留原文件。"
            : "Local image recovery is unavailable. Pending images exist only on this page; keep the originals and reselect them after a refresh."}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {imageError(error, zh)}
        </p>
      ) : null}
      {pending.map((item) => (
        <div
          key={item.record.clientAttachmentId}
          className="space-y-2 rounded-lg bg-[var(--surface-elevated)] p-3"
        >
          <PendingImagePreview record={item.record} locale={locale} />
          <p className="text-sm" role={item.error ? "alert" : "status"}>
            {item.uploading
              ? zh
                ? "正在保存图片…"
                : "Saving image…"
              : imageError(item.error ?? "image-waiting", zh)}
          </p>
          <div className="flex flex-wrap gap-2">
            {editable ? (
              <button
                type="button"
                disabled={
                  disabled ||
                  busy ||
                  item.error === "image-version-changed" ||
                  item.error === "image-draft-changed"
                }
                onClick={() => void retry(item.record)}
                className="rounded-full border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-40"
              >
                {zh ? "重试图片上传" : "Retry image upload"}
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => void clear(item.record)}
              className="rounded-full border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-40"
            >
              {zh ? "取消这张待传图片" : "Discard pending image"}
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
function imageError(code: string, zh: boolean) {
  if (code === "image-file-invalid")
    return zh
      ? "请选择有效 PNG/JPEG 图片，每张不超过 1 MiB。"
      : "Choose a PNG/JPEG image no larger than 1 MiB.";
  if (code === "image-count-limit")
    return zh
      ? "最多保留 3 张图片，请先移除不需要的图片。"
      : "Keep at most 3 images; remove an image first.";
  if (code === "image-version-changed" || code === "image-draft-changed")
    return zh
      ? "服务端草稿已改变。这张图片仍保留；请先保存图片、处理版本冲突，再重新选择上传。"
      : "The server draft changed. Keep this image, resolve the version conflict, then select it again.";
  if (code === "image-recovered")
    return zh
      ? "已恢复待传图片。重试前会核对服务器，避免重复上传。"
      : "Pending image recovered. A retry checks the server first to avoid duplicates.";
  if (code === "image-waiting")
    return zh
      ? "图片尚未保存，请重试上传。"
      : "This image is not saved yet. Retry the upload.";
  return zh
    ? "图片操作未完成，待传图片仍在当前页面。请恢复连接后重试。"
    : "The image operation did not finish. The pending image is still on this page; reconnect and retry.";
}
function PendingImagePreview({
  record,
  locale,
}: {
  record: PendingSubmissionImage;
  locale: Locale;
}) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (typeof URL.createObjectURL !== "function") return;
    const value = URL.createObjectURL(record.blob);
    const timer = setTimeout(() => setUrl(value), 0);
    return () => {
      clearTimeout(timer);
      URL.revokeObjectURL(value);
    };
  }, [record.blob]);
  return (
    <div className="space-y-2">
      <p className="break-all text-sm font-medium">{record.name}</p>
      {url ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- local Blob previews never use a remote optimizer. */}
          <img
            src={url}
            alt={
              locale === "zh-CN" ? "待传作业图片" : "Pending submission image"
            }
            className="max-h-40 max-w-full rounded-lg"
          />
          <a
            href={url}
            download={record.name}
            className="inline-block text-xs underline"
          >
            {locale === "zh-CN" ? "保存图片到设备" : "Save image to device"}
          </a>
        </>
      ) : null}
    </div>
  );
}
