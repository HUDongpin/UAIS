"use client";

import { useState } from "react";
import { copy, type Locale } from "@/i18n/copy";
import { draftMediaFileLimit, isDraftMediaSlides, type DraftMediaFile, type DraftMediaSlide } from "@/lib/teaching/unit-draft-media";

async function readMedia(file: File, kind: "image" | "audio"): Promise<DraftMediaFile> {
  if (!file.size || file.size > draftMediaFileLimit) throw new Error("media-size");
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("media-read"));
    reader.readAsDataURL(file);
  });
  if (kind === "image") {
    const bitmap = await createImageBitmap(file);
    try {
      if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40_000_000) throw new Error("media-dimensions");
    } finally { bitmap.close(); }
  }
  return { mime: kind === "audio" ? "audio/wav" : file.type === "image/png" ? "image/png" : "image/jpeg", base64: data.slice(data.indexOf(",") + 1) };
}

export function TeachingUnitDraftMediaEditor({ value, locale, onChange, onBusy }: {
  value: DraftMediaSlide[]; locale: Locale; onChange: (value: DraftMediaSlide[]) => void; onBusy: (busy: boolean) => void;
}) {
  const t = copy[locale].teachingUnitDraft;
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [image, setImage] = useState<File>();
  const [audio, setAudio] = useState<File>();
  const [error, setError] = useState(false);
  const [inputKey, setInputKey] = useState(0);
  async function add() {
    onBusy(true); setError(false);
    try {
      const slide: DraftMediaSlide = {
        id: crypto.randomUUID(), title: title.trim(), notes,
        ...(image ? { image: await readMedia(image, "image") } : {}),
        ...(audio ? { audio: await readMedia(audio, "audio") } : {}),
      };
      const next = [...value, slide];
      if (!isDraftMediaSlides(next)) throw new Error("media-invalid");
      onChange(next); setTitle(""); setNotes(""); setImage(undefined); setAudio(undefined); setInputKey((key) => key + 1);
    } catch { setError(true); }
    finally { onBusy(false); }
  }
  const field = "w-full min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2";
  return <fieldset className="min-w-0 space-y-3 rounded-xl border border-[var(--border)] p-3">
    <legend className="px-1 font-semibold">{t.mediaHeading}</legend>
    <p className="text-sm text-[var(--muted)]">{t.mediaHelp}</p>
    {value.map((slide) => <div key={slide.id} className="space-y-2 border-b border-[var(--border)] pb-3">
      <h4 className="font-semibold">{slide.title}</h4>
      {slide.image ? <img src={`data:${slide.image.mime};base64,${slide.image.base64}`} alt={slide.title} className="max-h-56 max-w-full object-contain" /> : null}
      {slide.audio ? <audio controls preload="metadata" aria-label={slide.title} src={`data:audio/wav;base64,${slide.audio.base64}`} /> : null}
      <p className="whitespace-pre-wrap text-sm">{slide.notes}</p>
      <button type="button" className="min-h-11 rounded-lg border border-[var(--border)] px-3" onClick={() => onChange(value.filter((item) => item.id !== slide.id))}>{t.mediaRemove}</button>
    </div>)}
    <label className="grid gap-1 text-sm">{t.mediaTitle}<input className={field} maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
    <label className="grid gap-1 text-sm">{t.mediaNotes}<textarea className={field} maxLength={6000} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
    <label className="grid gap-1 text-sm">{t.mediaImage}<input key={`image-${inputKey}`} type="file" accept="image/jpeg,image/png" onChange={(event) => setImage(event.target.files?.[0])} /></label>
    <label className="grid gap-1 text-sm">{t.mediaAudio}<input key={`audio-${inputKey}`} type="file" accept="audio/wav,.wav" onChange={(event) => setAudio(event.target.files?.[0])} /></label>
    {error ? <p role="alert" className="text-sm">{t.mediaInvalid}</p> : null}
    <button type="button" className="min-h-11 rounded-lg border border-[var(--border)] px-3" onClick={() => void add()}>{t.mediaAdd}</button>
  </fieldset>;
}
