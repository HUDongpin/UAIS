// The one validator behind both the publish script and the runtime catalog.
//
// It used to be two. `scripts/publish-learning-deck.mjs` carried a hand-kept
// copy of the rules in `published-playback-store.ts`, and the copies had already
// drifted: the script passed `localized` straight through while the store
// validated it slide by slide. A deck with a malformed `en-US` block therefore
// published cleanly, printed `status: "published"`, and then vanished at load -
// the store dropped it with a `console.error` no operator is watching, and the
// lecture simply was not there. Publishing has to fail at the operator's
// terminal or it fails at a student's first click.
//
// Plain `.mjs` so an operator script can import it with no TypeScript loader,
// with JSDoc annotations so the TypeScript side still gets the real types. This
// is the only module in `src/` written that way, and only because it has a
// caller on each side of that line.

/**
 * Credential-SHAPED text, not credential-shaped WORDS.
 *
 * This list replaces `/api[_-]?key|secret|token/i`, which read every prose
 * mention of a bare word as a leak. A computer-science lecture could not be
 * published under that rule: "a token is the smallest unit a lexer emits" was
 * refused, so was "secretary", so was "the secret of the proof". The rule exists
 * to stop a real credential reaching a student's response body, and a real
 * credential has a shape - a name followed by its value, a known key prefix, or
 * a long opaque run - that prose does not.
 */
export const unsafeTextPatterns = [
  // An absolute macOS home path: an operator's machine leaking into a manifest.
  /\/Users\//,
  // A credential name followed by its value: `api_key=abc123`, `secret: hunter2`,
  // `"apiKey": "9f3c1a…"`. The value has to look like a value - six or more
  // credential characters, at least one of them a digit - so that "the token: a
  // lexical unit" and "the secret: perseverance" stay publishable.
  /(?:api[\s_-]?key|secret|token|password|passwd|credential|bearer)["'\s]*[:=]\s*["']?(?=[A-Za-z0-9_\-.+/]{6,})(?=[A-Za-z0-9_\-.+/]*\d)/i,
  // An env-var-shaped credential name. `DASHSCOPE_API_KEY` and
  // `UAIS_LIVE_AI_APPROVAL_TOKEN` are already refused by the manifest's own
  // display-safety assert at request time; refusing them here only moves the
  // message to where an operator can read it.
  /\b[A-Z][A-Z0-9_]*_(?:API_KEY|KEY|SECRET|TOKEN|PASSWORD)\b/,
  // Provider key prefixes.
  /\bsk-[A-Za-z0-9_-]{16,}/,
  // A JWT: base64url runs joined by dots.
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./,
  // A long opaque base64 run - what an API key looks like with no prefix. Prose
  // does not produce forty unbroken base64 characters.
  /(?<![A-Za-z0-9+/=])[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9+/=])/,
];

/**
 * @param {string} value
 * @returns {boolean}
 */
export function containsUnsafeText(value) {
  return unsafeTextPatterns.some((pattern) => pattern.test(value));
}

/**
 * Duration of a 16-bit mono PCM WAV, from its total byte length.
 *
 * The same arithmetic `createLearningPptPlaybackManifest` applies to a stored
 * narration asset, so a published deck's hand-typed `durationSeconds` and the
 * manifest the runtime builds from the same WAV agree by construction.
 *
 * @param {number} byteLength Total WAV byte length, header included.
 * @param {number} sampleRateHz
 * @returns {number}
 */
export function durationSecondsFromPcmWavBytes(byteLength, sampleRateHz) {
  const pcmBytes = Math.max(byteLength - 44, 0);
  return Math.round((pcmBytes / (sampleRateHz * 2)) * 100) / 100;
}

/**
 * Reads the `fmt ` chunk of a WAV so a duration can be derived from the file an
 * operator actually holds, rather than from a number they typed next to it.
 *
 * Returns `undefined` for anything that is not the 16-bit mono PCM the narration
 * pipeline writes (`createPcm16MonoWav`), because `durationSecondsFromPcmWavBytes`
 * assumes exactly that layout and a wrong duration is worse than none.
 *
 * @param {Uint8Array} bytes
 * @returns {{ sampleRateHz: number, durationSeconds: number } | undefined}
 */
export function readPcm16MonoWavDuration(bytes) {
  if (bytes.byteLength < 44) {
    return undefined;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readAscii(bytes, 0, 4) !== "RIFF" || readAscii(bytes, 8, 4) !== "WAVE") {
    return undefined;
  }

  // Walk the chunk list rather than assuming `fmt ` sits at offset 12: an
  // exported WAV may carry a LIST/INFO chunk ahead of it.
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const chunkId = readAscii(bytes, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    if (chunkId === "fmt " && chunkSize >= 16 && offset + 8 + 16 <= bytes.byteLength) {
      const audioFormat = view.getUint16(offset + 8, true);
      const channels = view.getUint16(offset + 10, true);
      const sampleRateHz = view.getUint32(offset + 12, true);
      const bitsPerSample = view.getUint16(offset + 22, true);
      if (audioFormat !== 1 || channels !== 1 || bitsPerSample !== 16 || sampleRateHz <= 0) {
        return undefined;
      }
      return {
        sampleRateHz,
        durationSeconds: durationSecondsFromPcmWavBytes(bytes.byteLength, sampleRateHz),
      };
    }
    // Chunks are word-aligned.
    offset += 8 + chunkSize + (chunkSize % 2);
  }

  return undefined;
}

/**
 * The one deck compiled into the bundle instead of published into the catalog
 * directory.
 *
 * `findPublishedPlaybackByCourseId` serves it exactly like a published deck and
 * `assertPublishedLearningPptPlaybackAudio` resolves narration by audio manifest
 * id across BOTH sources, while every slide image URL is built from the ppt
 * asset id alone. A published deck that reuses either id therefore collides with
 * a deck the publish script cannot see by listing `--data-dir`: the loser serves
 * the demo lecture's narration, or writes its pages over the demo's slide
 * directory, and nothing reports a fault. The values are duplicated here rather
 * than imported because this module is plain `.mjs` and the catalog is
 * TypeScript; `tests/learning-deck-publish.test.ts` pins them against it.
 */
export const compiledInPlaybackDeck = {
  courseId: "elementary-math-research",
  audioManifestId:
    "audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1",
  pptAssetId: "natural-number-ordinal-theory-ppt1",
};

/**
 * Validates hard, because these values become filesystem paths and URLs.
 *
 * `findPublishedLearningPptPlaybackAudio` builds a path from `audioId`, and
 * `assertPublishedLearningPptPlaybackAudio` parses a trailing `slide-(\d+)` to
 * index into `slides` - so a deck whose slideIds are not `slide-01 … slide-NN`
 * in order would silently fail audio lookup at playback time rather than at
 * publish time. Rejecting it here is what makes that failure legible.
 *
 * @param {unknown} value
 * @returns {import("./ppt-playback-catalog").PublishedPptPlayback}
 */
export function normalizePublishedDeck(value) {
  if (!isRecord(value)) {
    throw new Error("Published deck must be a JSON object.");
  }

  const courseId = requireSafeId(value.courseId, "courseId");
  const audioManifestId = requireSafeId(value.audioManifestId, "audioManifestId");
  const pptAssetId = requireSafeId(value.pptAssetId, "pptAssetId");
  const slidesValue = value.slides;
  if (!Array.isArray(slidesValue) || slidesValue.length === 0) {
    throw new Error("Published deck must carry at least one slide.");
  }

  const slides = slidesValue.map((slide, index) => {
    if (!isRecord(slide)) {
      throw new Error(`Slide ${index + 1} must be an object.`);
    }
    const slideId = requireSafeId(slide.slideId, `slide ${index + 1} slideId`);
    const expectedSlideId = `slide-${String(index + 1).padStart(2, "0")}`;
    if (slideId !== expectedSlideId) {
      throw new Error(
        `Slide ${index + 1} must have slideId "${expectedSlideId}"; audio lookup indexes by that ordinal.`,
      );
    }
    const audioId = requireSafeId(slide.audioId, `slide ${index + 1} audioId`);
    if (!audioId.endsWith(slideId)) {
      throw new Error(`Slide ${index + 1} audioId must end with "${slideId}".`);
    }
    const durationSeconds = slide.durationSeconds;
    if (
      typeof durationSeconds !== "number" ||
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0
    ) {
      throw new Error(`Slide ${index + 1} durationSeconds must be a positive number.`);
    }
    return {
      slideId,
      slideTitle: requireText(slide.slideTitle, `slide ${index + 1} slideTitle`),
      narrationText: requireText(slide.narrationText, `slide ${index + 1} narrationText`),
      audioId,
      durationSeconds,
    };
  });

  return {
    courseId,
    courseTitle: requireText(value.courseTitle, "courseTitle"),
    sourceDeckTitle: requireText(value.sourceDeckTitle, "sourceDeckTitle"),
    teacherName: requireText(value.teacherName, "teacherName"),
    voiceLabel: requireText(value.voiceLabel, "voiceLabel"),
    audioManifestId,
    pptAssetId,
    ...(value.learningUnit === undefined
      ? {}
      : { learningUnit: normalizeLearningUnit(value.learningUnit) }),
    slides,
    ...(isRecord(value.localized)
      ? { localized: normalizeLocalized(value.localized, slides.length) }
      : {}),
  };
}

/**
 * @param {unknown} value
 * @returns {import("./ppt-playback-catalog").PublishedLearningUnit}
 */
function normalizeLearningUnit(value) {
  if (!isRecord(value)) {
    throw new Error("learningUnit must be an object.");
  }
  if (!Number.isInteger(value.position) || value.position <= 0) {
    throw new Error("learningUnit position must be a positive integer.");
  }
  if (!isRecord(value.title)) {
    throw new Error("learningUnit title must contain zh-CN and en-US.");
  }
  return {
    lessonKey: requireSafeId(value.lessonKey, "learningUnit lessonKey"),
    position: value.position,
    title: {
      "zh-CN": requireText(value.title["zh-CN"], "learningUnit title zh-CN"),
      "en-US": requireText(value.title["en-US"], "learningUnit title en-US"),
    },
  };
}

/**
 * @param {Record<string, unknown>} value
 * @param {number} slideCount
 */
function normalizeLocalized(value, slideCount) {
  /** @type {Record<string, unknown>} */
  const localized = {};
  for (const locale of ["zh-CN", "en-US"]) {
    const entry = value[locale];
    if (!isRecord(entry)) {
      continue;
    }
    const slidesValue = entry.slides;
    if (!Array.isArray(slidesValue) || slidesValue.length !== slideCount) {
      throw new Error(`Localized copy for ${locale} must cover all ${slideCount} slides.`);
    }
    localized[locale] = {
      courseTitle: requireText(entry.courseTitle, `${locale} courseTitle`),
      sourceDeckTitle: requireText(entry.sourceDeckTitle, `${locale} sourceDeckTitle`),
      teacherName: requireText(entry.teacherName, `${locale} teacherName`),
      voiceLabel: requireText(entry.voiceLabel, `${locale} voiceLabel`),
      slides: slidesValue.map((slide, index) => {
        if (!isRecord(slide)) {
          throw new Error(`Localized ${locale} slide ${index + 1} must be an object.`);
        }
        return {
          slideId: requireSafeId(slide.slideId, `${locale} slide ${index + 1} slideId`),
          slideTitle: requireText(slide.slideTitle, `${locale} slide ${index + 1} slideTitle`),
          narrationText: requireText(
            slide.narrationText,
            `${locale} slide ${index + 1} narrationText`,
          ),
        };
      }),
    };
  }
  return localized;
}

// The same character class the catalog's own `requireSafeId` enforces: these
// values are interpolated into filesystem paths and URLs.
/**
 * @param {unknown} value
 * @param {string} label
 * @returns {string}
 */
function requireSafeId(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {string}
 */
function requireText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing ${label}.`);
  }
  // The manifest is later checked by `assertLearningPlaybackIsDisplaySafe`, but
  // rejecting a filesystem path or a credential at publish time gives an
  // operator a message naming the field instead of an opaque failure at request
  // time. The message names the FIELD, never the value.
  if (containsUnsafeText(value)) {
    throw new Error(`Unsafe text in ${label}.`);
  }
  return value.trim();
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @param {number} length
 */
function readAscii(bytes, offset, length) {
  let text = "";
  for (let index = offset; index < offset + length && index < bytes.byteLength; index += 1) {
    text += String.fromCharCode(bytes[index]);
  }
  return text;
}
