import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { ChatroomTranscriptDocument } from "@/lib/server/learning-chatroom-share-view";

// Server-side PDF for a chatroom transcript (S24, owner-approved 2026-08-08).
//
// This draws the document rather than printing a rendered page: the transcript
// already arrives as structured data with display names resolved and timestamps
// pre-formatted as timezone-free UTC, so there is nothing a browser engine would
// add except ~50MB of binary and a cold start.
//
// The whole design hinges on one constraint: the product ships no font, and the
// default locale is Chinese. The UI gets CJK glyphs from the reader's operating
// system; a server has none, and PDF's built-in fonts cannot encode Chinese at
// all. So a CJK face is embedded from `public/fonts` - see PROVENANCE.md there.
//
// The face is embedded WHOLE, and it is pre-subset on disk rather than at
// runtime. That is not a preference: pdf-lib's own `subset: true` was measured
// against this font and silently drops most CJK glyphs - the file still opens,
// text still extracts, and the page renders blanks and mojibake. Build-time
// subsetting to the GB2312 repertoire is what keeps the embedded face at ~2MB
// while every glyph it claims actually draws.
//
// Privacy: this module never sees an account id. It renders only what
// `ChatroomTranscriptDocument` carries, which the loader has already narrowed to
// display names.

const pageWidth = 595.28; // A4 portrait, points
const pageHeight = 841.89;
const marginX = 56;
const marginTop = 64;
const marginBottom = 56;
const bodySize = 10.5;
const bodyLineHeight = 15;
const metaSize = 9;
const authorSize = 10;
const titleSize = 17;

const ink = rgb(0.09, 0.125, 0.2);
const muted = rgb(0.35, 0.4, 0.48);
const accent = rgb(0.12, 0.435, 0.922);
const hairline = rgb(0.81, 0.878, 0.961);

const fontFileName = "NotoSansSC-GB2312-Regular.ttf";

// Read once per process. A serverless instance renders many exports over its
// life and the file is ~2MB; re-reading it per request would dominate the work
// this route actually does.
let cachedFontBytes: Uint8Array | undefined;

export function resolveChatroomPdfFontPath() {
  return path.join(process.cwd(), "public", "fonts", fontFileName);
}

async function readChatroomPdfFontBytes(fontPath: string) {
  if (!cachedFontBytes) {
    cachedFontBytes = new Uint8Array(await readFile(fontPath));
  }
  return cachedFontBytes;
}

/** Test seam: drops the process-level font cache. */
export function resetChatroomPdfFontCacheForTesting() {
  cachedFontBytes = undefined;
}

export type ChatroomTranscriptPdfLabels = {
  title: string;
  courseLabel: string;
  groupLabel: string;
  membersLabel: string;
  dateRangeLabel: string;
  messageCountLabel: string;
  agentTag: string;
  unavailableNotice: string;
  // Printed under the meta lines when the room was already holding a full
  // rolling window: a saved PDF outlives the room it came from, so it is the
  // last place that can still say the conversation started earlier than page 1.
  windowTrimmedNotice: string;
};

type RenderState = {
  doc: PDFDocument;
  font: PDFFont;
  page: PDFPage;
  y: number;
  pageIndex: number;
};

export async function renderChatroomTranscriptPdf(input: {
  document: ChatroomTranscriptDocument;
  labels: ChatroomTranscriptPdfLabels;
  fontPath?: string;
}): Promise<Uint8Array> {
  const fontBytes = await readChatroomPdfFontBytes(
    input.fontPath ?? resolveChatroomPdfFontPath(),
  );

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  // `subset: false` is deliberate - see the note at the top of this file. The
  // face on disk is already the subset, so a document carries ~2MB of glyphs
  // and, unlike pdf-lib's runtime subsetting, every one of them renders.
  const font = await doc.embedFont(fontBytes, { subset: false });

  doc.setTitle(input.labels.title);
  doc.setProducer("UAIS");
  doc.setCreator("UAIS");

  const state: RenderState = {
    doc,
    font,
    page: doc.addPage([pageWidth, pageHeight]),
    y: pageHeight - marginTop,
    pageIndex: 0,
  };

  drawHeader(state, input.document, input.labels);

  if (input.document.transcriptStatus === "unavailable") {
    drawParagraph(state, input.labels.unavailableNotice, {
      size: bodySize,
      color: muted,
    });
  }

  for (const message of input.document.messages) {
    drawMessage(state, message, input.labels);
  }

  drawPageNumbers(state);

  return doc.save();
}

/**
 * The header's meta block, as text.
 *
 * Split out and exported because a PDF's drawn text is unreadable from the
 * saved bytes - the CJK glyphs travel as an embedded subset inside a compressed
 * content stream - so this is the only way a suite can assert that a line the
 * document is REQUIRED to carry is actually on the page. Exactly the reason
 * `wrapText` is exported.
 */
export function createChatroomTranscriptPdfMetaLines(
  document: ChatroomTranscriptDocument,
  labels: ChatroomTranscriptPdfLabels,
): string[] {
  const metaLines: string[] = [];
  if (document.courseName) {
    metaLines.push(`${labels.courseLabel}: ${document.courseName}`);
  }
  if (document.groupName) {
    metaLines.push(`${labels.groupLabel}: ${document.groupName}`);
  }
  if (document.memberNames.length > 0) {
    metaLines.push(`${labels.membersLabel}: ${document.memberNames.join("、")}`);
  }
  if (document.dateRange) {
    metaLines.push(
      `${labels.dateRangeLabel}: ${document.dateRange.startLabel} — ${document.dateRange.endLabel}`,
    );
  }
  metaLines.push(`${labels.messageCountLabel}: ${document.messageCount}`);
  // The saved file outlives the room, so this is the last surface that can
  // still say the conversation started before page 1 does.
  if (document.windowAtCapacity) {
    metaLines.push(labels.windowTrimmedNotice);
  }
  return metaLines;
}

function drawHeader(
  state: RenderState,
  document: ChatroomTranscriptDocument,
  labels: ChatroomTranscriptPdfLabels,
) {
  drawParagraph(state, labels.title, { size: titleSize, color: ink, gapAfter: 10 });

  for (const line of createChatroomTranscriptPdfMetaLines(document, labels)) {
    drawParagraph(state, line, { size: metaSize, color: muted, lineHeight: 13 });
  }

  state.y -= 6;
  drawRule(state);
  state.y -= 12;
}

function drawMessage(
  state: RenderState,
  message: ChatroomTranscriptDocument["messages"][number],
  labels: ChatroomTranscriptPdfLabels,
) {
  const isAgent = message.role === "agent";
  // Keep an author line with at least one line of its message: a heading
  // stranded at the foot of a page reads as a lost turn.
  ensureSpace(state, bodyLineHeight * 2 + 8);

  const authorLine = isAgent
    ? `${message.authorLabel} · ${labels.agentTag}`
    : message.authorLabel;
  drawParagraph(state, `${authorLine}   ${message.timeLabel}`, {
    size: authorSize,
    color: isAgent ? accent : ink,
    lineHeight: 14,
  });

  for (const rawLine of splitContentLines(message.content)) {
    if (rawLine === "") {
      state.y -= bodyLineHeight / 2;
      continue;
    }
    drawParagraph(state, rawLine, { size: bodySize, color: ink, indent: 12 });
  }

  state.y -= 8;
}

function drawParagraph(
  state: RenderState,
  text: string,
  options: {
    size: number;
    color: ReturnType<typeof rgb>;
    lineHeight?: number;
    indent?: number;
    gapAfter?: number;
  },
) {
  const indent = options.indent ?? 0;
  const lineHeight = options.lineHeight ?? bodyLineHeight;
  const maxWidth = pageWidth - marginX * 2 - indent;

  for (const line of wrapText(sanitizeForPdf(text), state.font, options.size, maxWidth)) {
    ensureSpace(state, lineHeight);
    state.page.drawText(line, {
      x: marginX + indent,
      y: state.y - options.size,
      size: options.size,
      font: state.font,
      color: options.color,
    });
    state.y -= lineHeight;
  }

  if (options.gapAfter) {
    state.y -= options.gapAfter;
  }
}

function drawRule(state: RenderState) {
  ensureSpace(state, 2);
  state.page.drawRectangle({
    x: marginX,
    y: state.y,
    width: pageWidth - marginX * 2,
    height: 0.75,
    color: hairline,
  });
}

function ensureSpace(state: RenderState, needed: number) {
  if (state.y - needed >= marginBottom) {
    return;
  }
  state.page = state.doc.addPage([pageWidth, pageHeight]);
  state.pageIndex += 1;
  state.y = pageHeight - marginTop;
}

function drawPageNumbers(state: RenderState) {
  const pages = state.doc.getPages();
  pages.forEach((page, index) => {
    const label = `${index + 1} / ${pages.length}`;
    const width = state.font.widthOfTextAtSize(label, metaSize);
    page.drawText(label, {
      x: pageWidth - marginX - width,
      y: marginBottom - 24,
      size: metaSize,
      font: state.font,
      color: muted,
    });
  });
}

// Content arrives as a single string that may carry newlines. Splitting here
// keeps `wrapText` a pure width problem.
function splitContentLines(content: string) {
  return content.replace(/\r\n?/g, "\n").split("\n");
}

// pdf-lib refuses control characters outright, and a transcript is arbitrary
// learner input, so they are replaced rather than allowed to fail a whole
// export. Tabs become spaces because the layout has no tab stops.
function sanitizeForPdf(text: string) {
  return text
    .replace(/\t/g, "    ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

/**
 * Width-aware wrapping for mixed Chinese and Latin text.
 *
 * Chinese runs carry no spaces, so a word-only wrap would overflow the page;
 * Latin words broken mid-word would read badly. This accumulates character by
 * character and, when a line overflows, prefers the last space if the line has
 * one and it is not so far back that the break looks arbitrary.
 */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  if (text === "") {
    return [""];
  }

  const lines: string[] = [];
  let current = "";

  for (const character of Array.from(text)) {
    const candidate = current + character;
    if (current !== "" && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      const lastSpace = current.lastIndexOf(" ");
      if (lastSpace > 0 && current.length - lastSpace <= 24) {
        lines.push(current.slice(0, lastSpace));
        current = `${current.slice(lastSpace + 1)}${character}`;
      } else {
        lines.push(current);
        current = character;
      }
      continue;
    }
    current = candidate;
  }

  if (current !== "") {
    lines.push(current);
  }
  return lines;
}

