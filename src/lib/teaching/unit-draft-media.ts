export const draftMediaFileLimit = 1024 * 1024;
export const draftMediaTotalLimit = 2 * 1024 * 1024;
export const draftMediaSlideLimit = 12;
export const draftRequestByteLimit = 4_000_000;

export type DraftMediaFile = { mime: "image/jpeg" | "image/png" | "audio/wav"; base64: string };
export type DraftMediaSlide = { id: string; title: string; notes: string; image?: DraftMediaFile; audio?: DraftMediaFile };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function decodeDraftMedia(file: DraftMediaFile): Uint8Array {
  return Uint8Array.from(atob(file.base64), (character) => character.charCodeAt(0));
}

/** Validate PCM WAV chunk boundaries and derive duration from actual samples. */
export function draftWavDuration(bytes: Uint8Array): number | undefined {
  if (bytes.length < 44) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE" || view.getUint32(4, true) + 8 !== bytes.length) return;
  let byteRate = 0, blockAlign = 0, dataSize = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = view.getUint32(offset + 4, true), start = offset + 8;
    if (start + size > bytes.length) return;
    if (tag(offset) === "fmt ") {
      if (size < 16 || view.getUint16(start, true) !== 1) return;
      const channels = view.getUint16(start + 2, true), rate = view.getUint32(start + 4, true);
      const bits = view.getUint16(start + 14, true);
      byteRate = view.getUint32(start + 8, true); blockAlign = view.getUint16(start + 12, true);
      if (![1, 2].includes(channels) || rate < 8000 || rate > 192000 || ![8, 16, 24, 32].includes(bits) || blockAlign !== channels * bits / 8 || byteRate !== rate * blockAlign) return;
    }
    if (tag(offset) === "data") dataSize += size;
    offset = start + size + (size % 2);
  }
  return byteRate && dataSize && dataSize % blockAlign === 0 ? dataSize / byteRate : undefined;
}

export function isDraftMediaFile(value: unknown, kind: "image" | "audio"): value is DraftMediaFile {
  if (!record(value) || Object.keys(value).length !== 2 || typeof value.base64 !== "string" || typeof value.mime !== "string") return false;
  if (value.base64.length > Math.ceil(draftMediaFileLimit / 3) * 4 || (value.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.base64))) return false;
  if (!(kind === "image" ? ["image/jpeg", "image/png"] : ["audio/wav"]).includes(value.mime)) return false;
  try {
    const bytes = decodeDraftMedia(value as DraftMediaFile);
    if (!bytes.length || bytes.length > draftMediaFileLimit) return false;
    if (kind === "audio") return draftWavDuration(bytes) !== undefined;
    return value.mime === "image/jpeg"
      ? bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217
      : bytes.length > 24 && [137,80,78,71,13,10,26,10].every((byte, index) => bytes[index] === byte);
  } catch { return false; }
}

export function isDraftMediaSlides(value: unknown): value is DraftMediaSlide[] {
  if (!Array.isArray(value) || value.length > draftMediaSlideLimit) return false;
  const ids = new Set<string>(); let total = 0;
  for (const slide of value) {
    if (!record(slide) || Object.keys(slide).some((key) => !["id", "title", "notes", "image", "audio"].includes(key)) ||
      typeof slide.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(slide.id) || ids.has(slide.id) ||
      typeof slide.title !== "string" || !slide.title.trim() || slide.title.length > 200 ||
      typeof slide.notes !== "string" || slide.notes.length > 6000 || (!slide.image && !slide.audio)) return false;
    ids.add(slide.id);
    for (const kind of ["image", "audio"] as const) {
      if (slide[kind] === undefined) continue;
      if (!isDraftMediaFile(slide[kind], kind)) return false;
      total += decodeDraftMedia(slide[kind]).length;
    }
  }
  return total <= draftMediaTotalLimit;
}
