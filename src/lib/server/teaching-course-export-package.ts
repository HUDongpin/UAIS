import { createHash } from "node:crypto";
import { imageSize } from "image-size";
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";
import type { TeachingUnitDraftContent } from "@/lib/teaching/unit-draft";

export type TeachingCourseExportSource = {
  courseId: string;
  title: string;
  sourceKind?: "published-playback" | "unit-draft";
  slides: Array<{
    id: string;
    title: string;
    notes: string;
    image?: { bytes: Buffer; extension: "jpg" | "png" };
    audio?: { bytes: Buffer; extension: "wav" };
    durationSeconds?: number;
  }>;
  unitDraft?: TeachingUnitDraftContent;
  agents: Array<{ scopes: string[]; governancePolicy: string }>;
};

type ExportInput = {
  source: TeachingCourseExportSource;
  format: "pptx" | "resource-zip" | "classroom-zip";
  locale: "zh-CN" | "en-US";
  now?: Date;
};

type ExportScene = {
  id: string;
  title: string;
  notes: string;
  image?: string;
  audio?: string;
  durationSeconds?: number;
};

function conciseText(text: string, limit: number) {
  const preview = text.replace(/\s+/g, " ").trim();
  return preview.length > limit ? `${preview.slice(0, limit).trimEnd()}…` : preview;
}

async function addAudioClickTiming(bytes: Buffer, source: TeachingCourseExportSource) {
  if (!source.slides.some((slide) => slide.audio)) return bytes;
  const archive = await JSZip.loadAsync(bytes);
  for (const [index, content] of source.slides.entries()) {
    if (!content.audio) continue;
    const path = `ppt/slides/slide${index + 1}.xml`;
    const xml = await archive.file(path)!.async("string");
    // PptxGenJS embeds the WAV as videoFile and omits the slideshow trigger.
    // Match our generated media picture, whose ID varies with slide content.
    const media = xml.match(/<p:pic>[\s\S]*?<\/p:pic>/g)
      ?.find((picture) => picture.includes("<p14:media "));
    const shapeId = media?.match(/<p:cNvPr id="(\d+)"/)?.[1];
    if (!shapeId || xml.includes("<p:timing")) {
      throw new Error("PPTX audio timing could not be bound to its media shape.");
    }
    const target = `<p:tgtEl><p:spTgt spid="${shapeId}"/></p:tgtEl>`;
    const duration = content.durationSeconds && Number.isFinite(content.durationSeconds) && content.durationSeconds > 0
      ? Math.max(1, Math.round(content.durationSeconds * 1000)) : "indefinite";
    // PowerPoint's native "When Clicked On" sequence: consume the icon click,
    // play this shape, and leave narration idle until explicitly requested.
    const timing = `<p:timing><p:tnLst><p:par>
      <p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>
        <p:seq concurrent="1" nextAc="seek">
          <p:cTn id="2" restart="whenNotActive" fill="hold" evtFilter="cancelBubble" nodeType="interactiveSeq">
            <p:stCondLst><p:cond evt="onClick" delay="0">${target}</p:cond></p:stCondLst>
            <p:endSync evt="end" delay="0"><p:rtn val="all"/></p:endSync>
            <p:childTnLst><p:par><p:cTn id="3" fill="hold">
              <p:stCondLst><p:cond delay="0"/></p:stCondLst>
              <p:childTnLst><p:par><p:cTn id="4" fill="hold">
                <p:stCondLst><p:cond delay="0"/></p:stCondLst>
                <p:childTnLst><p:par>
                  <p:cTn id="5" presetID="1" presetClass="mediacall" presetSubtype="0" fill="hold" nodeType="clickEffect">
                    <p:stCondLst><p:cond delay="0"/></p:stCondLst>
                    <p:childTnLst><p:cmd type="call" cmd="playFrom(0.0)"><p:cBhvr>
                      <p:cTn id="6" dur="${duration}" fill="hold"/>${target}
                    </p:cBhvr></p:cmd></p:childTnLst>
                  </p:cTn>
                </p:par></p:childTnLst>
              </p:cTn></p:par></p:childTnLst>
            </p:cTn></p:par></p:childTnLst>
          </p:cTn>
          <p:nextCondLst><p:cond evt="onClick" delay="0">${target}</p:cond></p:nextCondLst>
        </p:seq>
        <p:audio><p:cMediaNode>
          <p:cTn id="7" fill="hold" display="0">
            <p:stCondLst><p:cond delay="indefinite"/></p:stCondLst>
            <p:endCondLst><p:cond evt="onStopAudio" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:endCondLst>
          </p:cTn>${target}
        </p:cMediaNode></p:audio>
      </p:childTnLst></p:cTn>
    </p:par></p:tnLst></p:timing>`;
    const audioXml = xml.replace(media!, media!.replace("<a:videoFile ", "<a:audioFile "));
    archive.file(path, audioXml.replace("</p:sld>", `${timing}</p:sld>`));
  }
  return archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function createPresentation(source: TeachingCourseExportSource, locale: ExportInput["locale"]) {
  const draft = source.sourceKind === "unit-draft" || (!source.sourceKind && Boolean(source.unitDraft));
  const draftLabel = locale === "zh-CN" ? "教学草稿 · 未发布" : "Teaching draft · Unpublished";
  const presentation = new PptxGenJS();
  presentation.layout = "LAYOUT_WIDE";
  presentation.author = "UAIS";
  presentation.subject = draft ? "Saved teaching unit draft" : "Course slide export";
  presentation.title = source.title;
  presentation.theme = { headFontFace: "Arial", bodyFontFace: "Arial" };

  for (const [index, content] of source.slides.entries()) {
    const slide = presentation.addSlide();
    slide.background = { color: "FFFFFF" };
    if (content.image) {
      const mime = content.image.extension === "jpg" ? "jpeg" : "png";
      const data = `image/${mime};base64,${content.image.bytes.toString("base64")}`;
      const { width, height } = imageSize(new Uint8Array(
        content.image.bytes.buffer, content.image.bytes.byteOffset, content.image.bytes.byteLength,
      ));
      if (!width || !height) throw new Error("Course slide image dimensions are unavailable.");
      const scale = Math.min((40 / 3) / width, 7.5 / height);
      const imageWidth = width * scale;
      const imageHeight = height * scale;
      slide.addImage({
        data, x: ((40 / 3) - imageWidth) / 2, y: (7.5 - imageHeight) / 2,
        w: imageWidth, h: imageHeight,
        altText: content.title,
      });
      if (draft) {
        slide.addText(draftLabel, {
          x: 0.65, y: 6.8, w: 4, h: 0.3, fontSize: 11, margin: 0.04,
          color: "263B48", fill: { color: "FFFFFF" }, lang: locale,
        });
      }
    } else {
      // Office does not consistently apply automatic shrinking on first open.
      // Keep the preview within the text boxes; the full text stays in notes.
      slide.addText(conciseText(content.title, 56), {
        x: 0.65, y: 0.55, w: 12, h: 1.3, fontFace: "Arial", fontSize: 30,
        color: "172A36", bold: true, margin: 0, breakLine: false, fit: "shrink", lang: locale,
      });
      slide.addText(conciseText(content.notes, 280), {
        x: 0.65, y: 2.0, w: 12, h: 4.35, fontFace: "Arial", fontSize: 20,
        color: "263B48", margin: 0, valign: "top", fit: "shrink", paraSpaceAfter: 0, lang: locale,
      });
      const notesLabel = locale === "zh-CN" ? "完整讲稿见演讲者备注" : "Full teaching notes are in speaker notes";
      slide.addText(`${index + 1} / ${source.slides.length}    ${draft ? `${draftLabel}    ` : ""}${notesLabel}`, {
        x: 0.65, y: 6.8, w: 11.4, h: 0.25, fontFace: "Arial", fontSize: 10,
        color: "60717B", margin: 0, lang: locale,
      });
    }
    // The original notes remain complete even when the visible text is shortened.
    slide.addNotes(`${content.title}\n\n${content.notes}`);
    if (content.audio) {
      slide.addMedia({
        type: "audio", extn: "wav",
        data: `audio/wav;base64,${content.audio.bytes.toString("base64")}`,
        x: 12.5, y: 6.8, w: 0.4, h: 0.4,
      });
    }
  }
  const bytes = await presentation.write({ outputType: "nodebuffer", compression: true });
  if (!Buffer.isBuffer(bytes)) throw new Error("PPTX export did not produce a binary file.");
  return addAudioClickTiming(bytes, source);
}

function publicDraft(draft: TeachingUnitDraftContent): TeachingUnitDraftContent {
  return {
    title: draft.title,
    objectives: draft.objectives.map((objective) => objective),
    activities: draft.activities.map((activity) => ({
      title: activity.title, durationMinutes: activity.durationMinutes, instructions: activity.instructions,
    })),
    lectureScript: draft.lectureScript,
    questions: draft.questions.map((question) => ({
      prompt: question.prompt, referenceAnswer: question.referenceAnswer,
    })),
  };
}

function htmlText(text: string) {
  return text.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

function jsonForHtml(value: unknown) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => (
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
  ));
}

function offlineClassroomHtml(title: string, scenes: ExportScene[], locale: ExportInput["locale"], draft: boolean) {
  const zh = locale === "zh-CN";
  const labels = zh
    ? { previous: "上一页", next: "下一页", notes: "讲稿与教学内容", deck: "打开 PPTX", materials: "教学讲稿", help: "解压后直接打开本文件；使用左右方向键或按钮切换，语音由播放器播放。此离线副本不连接 AI 服务。" }
    : { previous: "Previous slide", next: "Next slide", notes: "Narration and teaching content", deck: "Open PPTX", materials: "Teaching notes", help: "Open this file after extracting the ZIP. Use the arrow keys or buttons to navigate and the audio player to play narration. This offline copy does not connect to AI services." };
  return `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${htmlText(title)}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f2f5f7;color:#172a36;font:16px/1.6 system-ui,sans-serif}
main{max-width:1100px;margin:auto;padding:24px}h1{font-size:1.5rem;overflow-wrap:anywhere}h2{font-size:1.25rem;overflow-wrap:anywhere}
section{background:white;border-radius:14px;padding:24px}img{display:block;max-width:100%;max-height:70vh;margin:auto;object-fit:contain}
[hidden]{display:none!important}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}audio{width:100%;margin-top:16px}
nav{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin:20px 0}button,a{font:inherit}button{min-height:44px;padding:8px 16px;border:1px solid #b5c5ce;border-radius:8px;background:white;color:#172a36;cursor:pointer}
button:disabled{opacity:.45;cursor:default}button:focus-visible,a:focus-visible{outline:3px solid #25758a;outline-offset:3px}a{color:#175e75}small{display:block;color:#526673}
</style></head><body><main><h1>${htmlText(title)}</h1>${draft ? `<p>${zh ? "教学草稿 · 未发布" : "Teaching draft · Unpublished"}</p>` : ""}<small>${labels.help}</small>
<nav aria-label="${zh ? "幻灯片导航" : "Slide navigation"}"><button id="previous-slide" type="button">${labels.previous}</button><span id="slide-position" aria-live="polite"></span><button id="next-slide" type="button">${labels.next}</button><a href="classroom.pptx">${labels.deck}</a><a href="materials/notes.md">${labels.materials}</a></nav>
<section aria-labelledby="slide-title"><h2 id="slide-title"></h2><img id="slide-image" hidden alt=""><audio id="slide-audio" controls preload="metadata" hidden></audio><h3>${labels.notes}</h3><pre id="slide-notes"></pre></section>
</main><script id="classroom-data" type="application/json">${jsonForHtml(scenes)}</script>
<script>
(function(){
  "use strict";
  const scenes = JSON.parse(document.getElementById("classroom-data").textContent);
  const title = document.getElementById("slide-title");
  const notes = document.getElementById("slide-notes");
  const image = document.getElementById("slide-image");
  const audio = document.getElementById("slide-audio");
  const position = document.getElementById("slide-position");
  const previous = document.getElementById("previous-slide");
  const next = document.getElementById("next-slide");
  let current = 0;
  function render() {
    const scene = scenes[current];
    title.textContent = scene.title;
    notes.textContent = scene.notes;
    image.hidden = !scene.image;
    image.alt = scene.title;
    if (scene.image) image.setAttribute("src", scene.image); else image.removeAttribute("src");
    audio.pause();
    audio.hidden = !scene.audio;
    if (scene.audio) audio.setAttribute("src", scene.audio); else audio.removeAttribute("src");
    audio.load();
    position.textContent = (current + 1) + " / " + scenes.length;
    previous.disabled = current === 0;
    next.disabled = current === scenes.length - 1;
  }
  previous.addEventListener("click", function(){ if(current > 0){ current -= 1; render(); } });
  next.addEventListener("click", function(){ if(current < scenes.length - 1){ current += 1; render(); } });
  document.addEventListener("keydown", function(event){
    if (event.target && /^(INPUT|TEXTAREA|SELECT|AUDIO)$/.test(event.target.tagName)) return;
    if(event.key === "ArrowLeft"){ event.preventDefault(); previous.click(); }
    if(event.key === "ArrowRight"){ event.preventDefault(); next.click(); }
  });
  render();
})();
</script></body></html>`;
}

export async function createTeachingCourseExportPackage(
  { source, format, locale, now = new Date() }: ExportInput,
): Promise<{ bytes: Buffer; contentType: string; filename: string }> {
  if (source.slides.length === 0) throw new Error("Course export requires saved slides.");
  const safeId = source.courseId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80) || "course";
  if (format === "pptx") {
    return {
      bytes: await createPresentation(source, locale),
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      filename: `${safeId}.pptx`,
    };
  }

  const files = new Map<string, Buffer>();
  const addText = (path: string, text: string) => files.set(path, Buffer.from(text, "utf8"));
  const addJson = (path: string, value: unknown) => addText(path, `${JSON.stringify(value, null, 2)}\n`);
  const scenes: ExportScene[] = source.slides.map((slide, index) => {
    const ordinal = String(index + 1).padStart(3, "0");
    const scene: ExportScene = { id: slide.id, title: slide.title, notes: slide.notes };
    if (slide.image) {
      scene.image = `media/slide-${ordinal}.${slide.image.extension}`;
      files.set(scene.image, slide.image.bytes);
    }
    if (slide.audio) {
      scene.audio = `audio/slide-${ordinal}.wav`;
      files.set(scene.audio, slide.audio.bytes);
    }
    if (typeof slide.durationSeconds === "number" && Number.isFinite(slide.durationSeconds) && slide.durationSeconds > 0) {
      scene.durationSeconds = slide.durationSeconds;
    }
    return scene;
  });
  addJson("scenes.json", scenes);
  addText("materials/notes.md", `# ${source.title}\n\n${scenes.map((scene, index) => (
    `## ${index + 1}. ${scene.title}\n\n${scene.notes}\n`
  )).join("\n")}`);
  if (source.unitDraft) addJson("unit-draft.json", publicDraft(source.unitDraft));
  const sourceKind = source.sourceKind ?? (source.unitDraft ? "unit-draft" : "published-playback");
  const classroom = format === "classroom-zip";
  const zh = locale === "zh-CN";
  addText("README.txt", zh
    ? `${source.title}\n\n这是${sourceKind === "unit-draft" ? "已保存教学单元草稿" : "已发布课堂播放内容"}的文件导出。\nscenes.json 按教学顺序列出内容和相对媒体路径；materials/notes.md 保留完整讲稿。\n${classroom ? "解压整个 ZIP 后，用浏览器打开 index.html 离线浏览，或使用 PowerPoint 打开 classroom.pptx。agents.json 仅记录已保存的作用范围与治理策略，不启动在线 AI。\n" : "media/ 与 audio/ 保存源内容实际存在的媒体文件；没有媒体的文字草稿不会生成占位媒体。\n"}manifest.json 记录其他文件的字节数和 SHA-256，便于校验文件完整性。\n`
    : `${source.title}\n\nFile export of ${sourceKind === "unit-draft" ? "the saved teaching unit draft" : "published classroom playback content"}.\nscenes.json preserves teaching order and relative media paths; materials/notes.md preserves complete narration.\n${classroom ? "Extract the entire ZIP and open index.html in a browser for offline playback, or open classroom.pptx in PowerPoint. agents.json records saved scopes and governance policies only; it does not start online AI.\n" : "media/ and audio/ contain actual source media when present. Text drafts do not receive placeholder media.\n"}manifest.json contains byte lengths and SHA-256 hashes of the other files for integrity checks.\n`);

  if (classroom) {
    files.set("classroom.pptx", await createPresentation(source, locale));
    addJson("agents.json", source.agents.map((agent) => ({
      scopes: agent.scopes.map((scope) => scope), governancePolicy: agent.governancePolicy,
    })));
    addText("index.html", offlineClassroomHtml(source.title, scenes, locale, sourceKind === "unit-draft"));
  }
  addJson("manifest.json", {
    schemaVersion: 1,
    format,
    courseId: source.courseId,
    title: source.title,
    sourceKind,
    locale,
    generatedAt: now.toISOString(),
    slideCount: scenes.length,
    files: [...files.entries()].map(([path, bytes]) => ({
      path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
    })),
  });
  const archive = new JSZip();
  for (const [path, bytes] of files) archive.file(path, bytes, { date: now, createFolders: false });
  return {
    bytes: await archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
    contentType: "application/zip",
    filename: `${safeId}-${classroom ? "classroom" : "resources"}.zip`,
  };
}
