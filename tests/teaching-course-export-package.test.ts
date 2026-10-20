import { createHash } from "node:crypto";
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTeachingCourseExportPackage,
  type TeachingCourseExportSource,
} from "@/lib/server/teaching-course-export-package";
import { teachingUnitDraftContent } from "./fixtures/teaching-unit-draft-content";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6f8AAAAASUVORK5CYII=",
  "base64",
);
const audio = Buffer.alloc(48);
audio.write("RIFF", 0);
audio.writeUInt32LE(40, 4);
audio.write("WAVEfmt ", 8);
audio.writeUInt32LE(16, 16);
audio.writeUInt16LE(1, 20);
audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(8000, 24);
audio.writeUInt32LE(16000, 28);
audio.writeUInt16LE(2, 32);
audio.writeUInt16LE(16, 34);
audio.write("data", 36);
audio.writeUInt32LE(4, 40);

const source: TeachingCourseExportSource = {
  courseId: "course-one",
  title: "Evidence and teaching",
  sourceKind: "published-playback",
  slides: [
    { id: "../../first", title: "First real slide", notes: "Actual narration & evidence.", image: { bytes: png, extension: "png" }, audio: { bytes: audio, extension: "wav" }, durationSeconds: 8 },
    { id: "second", title: "Second real slide", notes: "Saved teaching content, without invented material." },
  ],
  agents: [{ scopes: ["lesson-guide"], governancePolicy: "teacher-supervised" }],
};
const now = new Date("2026-10-20T01:02:03.000Z");

async function readJson<T = Record<string, unknown>>(zip: JSZip, path: string): Promise<T> {
  return JSON.parse(await zip.file(path)!.async("string")) as T;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("real teaching course export packages", () => {
  it("creates an OOXML PPTX with ordered real slide content, image bytes, embedded WAV and complete speaker notes", async () => {
    const output = await createTeachingCourseExportPackage({ source, format: "pptx", locale: "en-US", now });
    expect(output.contentType).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    expect(output.filename).toMatch(/\.pptx$/);
    const deck = await JSZip.loadAsync(output.bytes);
    expect(deck.file("[Content_Types].xml")).not.toBeNull();
    expect(deck.file("ppt/presentation.xml")).not.toBeNull();
    expect(Object.keys(deck.files).filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))).toHaveLength(2);
    const slide1 = await deck.file("ppt/slides/slide1.xml")!.async("string");
    const slide2 = await deck.file("ppt/slides/slide2.xml")!.async("string");
    expect(slide1).toContain("<p:pic>");
    const picture = new DOMParser().parseFromString(slide1, "application/xml").getElementsByTagName("p:pic")[0];
    const extent = picture.getElementsByTagName("a:ext")[0];
    const offset = picture.getElementsByTagName("a:off")[0];
    expect(Number(extent.getAttribute("cx"))).toBe(Number(extent.getAttribute("cy")));
    expect(Number(offset.getAttribute("x"))).toBeGreaterThan(0);
    expect(slide2).toContain("Second real slide");
    expect(slide2).toContain("Saved teaching content, without invented material.");
    const notes = await deck.file("ppt/notesSlides/notesSlide1.xml")!.async("string");
    expect(notes).toContain("Actual narration &amp; evidence.");
    const media = await Promise.all(Object.keys(deck.files).filter((path) => path.startsWith("ppt/media/") && !deck.files[path].dir)
      .map((path) => deck.file(path)!.async("nodebuffer")));
    expect(media.some((bytes) => bytes.equals(png))).toBe(true);
    expect(media.some((bytes) => bytes.equals(audio))).toBe(true);
    expect(await deck.file("ppt/notesSlides/notesSlide2.xml")!.async("string")).toContain(source.slides[1].notes);
  });

  it("packages the actual image, audio, readable notes and hash-verified inventory in resource ZIP", async () => {
    const output = await createTeachingCourseExportPackage({ source, format: "resource-zip", locale: "zh-CN", now });
    expect(output.contentType).toBe("application/zip");
    expect(output.filename).toMatch(/\.zip$/);
    const zip = await JSZip.loadAsync(output.bytes);
    expect(await zip.file("media/slide-001.png")!.async("nodebuffer")).toEqual(png);
    expect(await zip.file("audio/slide-001.wav")!.async("nodebuffer")).toEqual(audio);
    expect(await zip.file("materials/notes.md")!.async("string")).toContain(source.slides[0].notes);
    expect(zip.file("classroom.pptx")).toBeNull();
    const manifest = await readJson<{ sourceKind: string; generatedAt: string; files: Array<{ path: string; bytes: number; sha256: string }> }>(zip, "manifest.json");
    expect(manifest.sourceKind).toBe("published-playback");
    expect(manifest.generatedAt).toBe(now.toISOString());
    expect(manifest.files.length).toBeGreaterThanOrEqual(5);
    for (const file of manifest.files) {
      const bytes = await zip.file(file.path)!.async("nodebuffer");
      expect(file.bytes).toBe(bytes.length);
      expect(file.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(file.path).not.toMatch(/(^\/|(^|\/)\.\.(\/|$)|\\)/);
    }
    const allFiles = Object.keys(zip.files).filter((path) => !zip.files[path].dir && path !== "manifest.json");
    expect(manifest.files.map((file) => file.path).sort()).toEqual(allFiles.sort());
  });

  it("renders classroom slides offline with relative media, working navigation and inert hostile saved text", async () => {
    const hostileTitle = "</script><script>globalThis.exportAttack=true</script><img src=x onerror=alert(1)>";
    const hostileSource = { ...source, title: hostileTitle, slides: [{ ...source.slides[0], title: hostileTitle, notes: hostileTitle }, source.slides[1]] };
    const output = await createTeachingCourseExportPackage({ source: hostileSource, format: "classroom-zip", locale: "en-US", now });
    expect(output.filename).not.toMatch(/[\/\\\r\n<>]/);
    const zip = await JSZip.loadAsync(output.bytes);
    const deck = await JSZip.loadAsync(await zip.file("classroom.pptx")!.async("nodebuffer"));
    expect(deck.file("ppt/slides/slide2.xml")).not.toBeNull();
    const scenes = await readJson<Array<{ title: string; notes: string; image?: string; audio?: string }>>(zip, "scenes.json");
    expect(scenes[0].image).toBe("media/slide-001.png");
    expect(scenes[0].audio).toBe("audio/slide-001.wav");
    expect(scenes[0].title).toBe(hostileTitle);
    expect(await readJson(zip, "agents.json")).toEqual(source.agents);
    const html = await zip.file("index.html")!.async("string");
    document.documentElement.innerHTML = html;
    expect(document.querySelectorAll("script[src]")).toHaveLength(0);
    expect(document.querySelectorAll("script")).toHaveLength(2);
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline"));
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    const script = document.querySelector("script:not([type])")!.textContent!;
    new Function("document", script)(document);
    expect(fetch).not.toHaveBeenCalled();
    expect(document.querySelector("#slide-title")!.textContent).toBe(hostileTitle);
    expect(document.querySelector("#slide-notes")!.textContent).toBe(hostileTitle);
    expect(document.querySelector("#slide-image")!.getAttribute("src")).toBe("media/slide-001.png");
    expect(document.querySelector("#slide-audio")!.getAttribute("src")).toBe("audio/slide-001.wav");
    expect(document.querySelectorAll("img[onerror]")).toHaveLength(0);
    expect((globalThis as { exportAttack?: boolean }).exportAttack).toBeUndefined();
    (document.querySelector("#next-slide") as HTMLButtonElement).click();
    expect(document.querySelector("#slide-title")!.textContent).toBe("Second real slide");
    expect((document.querySelector("#slide-image") as HTMLImageElement).hidden).toBe(true);
    expect((document.querySelector("#slide-audio") as HTMLAudioElement).hidden).toBe(true);
    expect((document.querySelector("#next-slide") as HTMLButtonElement).disabled).toBe(true);
    (document.querySelector("#previous-slide") as HTMLButtonElement).click();
    expect(document.querySelector("#slide-title")!.textContent).toBe(hostileTitle);
  });

  it("exports saved draft content in full, retaining long narration in notes and whitelisting metadata", async () => {
    const lectureScript = `${"Detailed saved draft sentence. ".repeat(150)}Final source sentence.`;
    const draft = { ...teachingUnitDraftContent, lectureScript, providerSecret: "secret-do-not-export" };
    const draftSource = {
      courseId: "saved-draft",
      title: draft.title,
      sourceKind: "unit-draft" as const,
      slides: [{ id: "lecture", title: draft.title, notes: lectureScript, localPath: "/private/teacher-content" }],
      unitDraft: draft,
      agents: [],
      localPath: "/private/course",
    };
    const output = await createTeachingCourseExportPackage({ source: draftSource, format: "classroom-zip", locale: "zh-CN", now });
    const zip = await JSZip.loadAsync(output.bytes);
    const unit = await readJson(zip, "unit-draft.json");
    expect(unit.lectureScript).toBe(lectureScript);
    expect(unit).not.toHaveProperty("providerSecret");
    expect(await readJson(zip, "agents.json")).toEqual([]);
    expect(await readJson(zip, "manifest.json")).toMatchObject({ sourceKind: "unit-draft" });
    const deck = await JSZip.loadAsync(await zip.file("classroom.pptx")!.async("nodebuffer"));
    const notes = await deck.file("ppt/notesSlides/notesSlide1.xml")!.async("string");
    expect(notes).toContain(lectureScript);
    const slide = await deck.file("ppt/slides/slide1.xml")!.async("string");
    expect(slide.length).toBeLessThan(notes.length);
    expect(slide).toContain("教学草稿 · 未发布");
    expect(await zip.file("index.html")!.async("string")).toContain("教学草稿 · 未发布");
    for (const entry of Object.values(zip.files).filter((file) => !file.dir && /\.(json|html|md|txt)$/.test(file.name))) {
      const value = await entry.async("string");
      expect(value).not.toContain("secret-do-not-export");
      expect(value).not.toContain("/private/");
    }
  });

  it.each(["pptx", "resource-zip", "classroom-zip"] as const)("rejects an empty source instead of a %s preview", async (format) => {
    await expect(createTeachingCourseExportPackage({ source: { ...source, slides: [] }, format, locale: "en-US", now }))
      .rejects.toThrow("Course export requires saved slides.");
  });
});
