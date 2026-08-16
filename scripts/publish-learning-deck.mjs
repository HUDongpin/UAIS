// Publishes a lecture deck into the learning catalog.
//
//   node -- scripts/publish-learning-deck.mjs --deck ./week-01.json \
//     --slides-dir ./week-01/slides --audio-dir ./week-01/audio [--check]
//
// The whole lesson catalog used to be one deck compiled into the bundle, so
// putting the real Week-1 lecture in front of students meant hand-editing
// TypeScript, copying assets, committing and redeploying - per lecture, per
// week. This validates a deck against the same rules the runtime enforces and
// writes it into the catalog directory, so publishing is a reviewable file
// change instead of a code change.
//
// A published lesson is three things, not one: the deck JSON, the narration
// WAVs, and the slide IMAGES. This script used to handle the first two, and the
// runtime points every slide at
// `/learning/ppt-playback/slides/<pptAssetId>/page-NN.jpg` unconditionally - so
// a by-the-book publish shipped a lecture of broken image frames. `--slides-dir`
// is what closes that, and a publish that would ship no slide images at all is
// refused unless the operator says `--allow-missing-slides` out loud.
//
// It validates BEFORE it writes, and `--check` validates without writing, so a
// malformed deck fails at an operator's terminal rather than at a student's
// first click. A warning is part of that: a run that ends `exit 1` used to write
// the deck anyway, so a lecture with half its slide images, missing narration or
// a duration the WAV contradicts went LIVE while the terminal said it had
// failed - and CI, which reads the exit code, reported a failure for a publish
// that had already reached students. Warnings now refuse the catalog write
// unless `--allow-warnings` says out loud that shipping them is intended.
// Validation is the runtime's own, imported rather than copied:
// see `src/lib/learning/published-deck-validation.mjs`. The rules it enforces
// are the ones that would otherwise fail silently at request time - in
// particular that slide ids are `slide-01 … slide-NN` in order, because audio
// lookup indexes by that ordinal.
//
// Assets are copied first and the catalog entry is written last, through a temp
// file and a rename. A publish that fails halfway therefore leaves no live deck
// behind: the previous state of the course is what students keep seeing.
import { readFileSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { argv, cwd, env, exit, pid, stderr, stdout } from "node:process";
import {
  compiledInPlaybackDeck,
  normalizePublishedDeck,
  readPcm16MonoWavDuration,
} from "../src/lib/learning/published-deck-validation.mjs";

const defaultDataDir = join("data", "learning-ppt-playback");
const durationDivergenceToleranceSeconds = 1;

if (argv.includes("--help") || argv.includes("-h")) {
  stdout.write(
    [
      "Usage: node -- scripts/publish-learning-deck.mjs --deck <deck.json> [options]",
      "",
      "Options:",
      "  --deck <path>           Deck manifest to publish (required)",
      "  --data-dir <path>       Catalog directory (default: data/learning-ppt-playback)",
      "  --slides-dir <path>     page-NN.jpg slide images to copy into public/",
      "  --audio-dir <path>      Narration WAVs to copy into public/ alongside the deck",
      "  --allow-missing-slides  Publish even though no slide image would ship",
      "  --allow-warnings        Publish even though this run reports warnings",
      "  --check                 Validate only; write nothing",
      "  --env-file <path>       Load environment variables from a file before running",
      "  --help                  Show this message",
      "",
      "Deck manifest fields: courseId, courseTitle, sourceDeckTitle, teacherName,",
      "voiceLabel, audioManifestId, pptAssetId, slides[] (slideId, slideTitle,",
      "narrationText, audioId, optional durationSeconds), optional localized{zh-CN,en-US}.",
      "",
      "Slide ids must be slide-01 .. slide-NN in order: narration audio is looked",
      "up by that ordinal, so any other numbering fails silently at playback.",
      "",
      "With --audio-dir, the WAV header is authoritative for durationSeconds. A",
      "value typed into the deck is discarded with a duration-divergence warning",
      "when it differs by more than a second; it survives only for slides whose",
      "WAV is missing or unreadable.",
      "",
      "Any warning refuses the catalog write. Fix the deck, or pass",
      "--allow-warnings to publish it as it stands. --check never writes, so it",
      "reports warnings and exits 1 without needing the flag.",
      "",
    ].join("\n"),
  );
  exit(0);
}

// `readOption` returns the NEXT token, so an option typed as the final argument
// reads back as "not passed". `--env-file` at the end of the line then published
// into whatever `UAIS_LEARNING_PPT_PLAYBACK_DATA_DIR` the ambient shell happened
// to export - a different deployment's catalog - and said `status: "published"`.
// Same guard as the account scripts.
const optionMissingValue = [
  "--deck",
  "--data-dir",
  "--slides-dir",
  "--audio-dir",
  "--env-file",
].find((name) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] === undefined;
});
if (optionMissingValue) {
  stderr.write(`Blocked: ${optionMissingValue} requires a value.\n`);
  exit(1);
}

const deckPath = readOption("--deck");
if (!deckPath) {
  stderr.write("Blocked: --deck <deck.json> is required.\n");
  exit(1);
}
loadEnvFile(readOption("--env-file"));
// Same resolution order as `resolveLearningPptPlaybackDataDir`: an operator who
// has pointed the deployment at a mounted volume publishes into that volume,
// not into the repo copy the runtime never reads.
const dataDir = resolve(
  readOption("--data-dir") ??
    env.UAIS_LEARNING_PPT_PLAYBACK_DATA_DIR?.trim() ??
    join(cwd(), defaultDataDir),
);
const audioDir = readOption("--audio-dir");
const slidesDir = readOption("--slides-dir");
const checkOnly = argv.includes("--check");
const allowMissingSlides = argv.includes("--allow-missing-slides");
const allowWarnings = argv.includes("--allow-warnings");

let deckInput;
try {
  deckInput = JSON.parse(await readFile(deckPath, "utf8"));
} catch (error) {
  // The deck path is an operator artifact and safe to name; its contents are
  // not echoed.
  stderr.write(`Blocked: ${deckPath} is not a valid deck. ${error.message}\n`);
  exit(1);
}

const warnings = [];

// Durations resolve before validation, because with `--audio-dir` in hand the
// deck no longer has to carry them - the WAV is the fact, the typed number is
// at best a second opinion.
let narrationAudio;
try {
  narrationAudio = await resolveNarrationAudio(deckInput);
} catch (error) {
  // The errno class, not the message: an errno message carries both paths.
  stderr.write(`Blocked: narration audio could not be read (${error.code ?? "unknown"}).\n`);
  exit(1);
}

let deck;
try {
  deck = normalizePublishedDeck(narrationAudio.deck);
} catch (error) {
  stderr.write(`Blocked: ${deckPath} is not a valid deck. ${error.message}\n`);
  exit(1);
}

// A second deck already serving one of this deck's two shared-namespace ids is
// not a warning.
//
// `assertPublishedLearningPptPlaybackAudio` finds the FIRST entry with a matching
// audioManifestId, so the loser of that collision serves the winner's narration
// under its own lecture - a student hears another course's teacher and nothing in
// the system reports a fault. The pptAssetId is the same kind of shared key one
// layer down: every slide's imageUrl is built from it, and both decks copy their
// pages into `public/learning/ppt-playback/slides/<pptAssetId>/`, so the second
// publish overwrites the first deck's slides in place - the lecture keeps its own
// narration and shows somebody else's frames.
//
// The compiled-in demo deck counts in both. It is served exactly like a published
// deck but is not a file in `--data-dir`, so listing the directory could never see
// it, and a deck colliding with it published cleanly.
const collision = await findCatalogIdCollision(deck);
if (collision) {
  stderr.write(
    collision.field === "audioManifestId"
      ? `Blocked: audioManifestId is already published by ${collision.owner}. Two decks cannot share one audio manifest id.\n`
      : `Blocked: pptAssetId is already published by ${collision.owner}. Two decks cannot share one slide asset id: their slide images overwrite each other.\n`,
  );
  exit(1);
}

const slideImages = await inspectSlideImages(deck);
if (slideImages.available === 0 && !allowMissingSlides) {
  if (checkOnly) {
    warnings.push("no-slide-images");
  } else {
    stderr.write(
      [
        `Blocked: publishing ${deck.courseId} would ship no slide image.`,
        `Every slide points at /learning/ppt-playback/slides/${deck.pptAssetId}/page-NN.jpg;`,
        "pass --slides-dir <dir> with page-NN.jpg files, or --allow-missing-slides to publish anyway.\n",
      ].join(" "),
    );
    exit(1);
  }
}

if (checkOnly) {
  // Writes nothing: not the catalog entry, not the public assets, not a temp
  // file. An operator can run this against production data safely. Unaffected by
  // --allow-warnings, which is a permission to WRITE and there is no write here.
  stdout.write(JSON.stringify(createSummary("checked"), null, 2) + "\n");
  exit(warnings.length > 0 ? 1 : 0);
}

// Every warning this run can raise describes a lecture a student would meet
// broken: a slide whose page image is not there (the runtime builds the URL
// anyway, so it renders as a blank frame), narration that is missing or in a
// format the pipeline cannot read, or a typed duration the WAV contradicts -
// which drives the progress rail and the xAPI result.duration.
//
// All three used to publish. The run exited 1 and the deck went live, so the
// non-zero exit was the only thing that failed: CI reported a broken publish
// that had in fact already reached students, and an operator who saw the exit
// code had nothing left to stop. The write is now refused, and the escape hatch
// has to be typed - the same shape as --allow-missing-slides, which stays a
// separate gate for the different, larger claim that shipping NO slide image at
// all is intended.
if (warnings.length > 0 && !allowWarnings) {
  stderr.write(
    [
      `Blocked: publishing ${deck.courseId} would ship ${warnings.length} warning(s):`,
      `${warnings.join(", ")}.`,
      "Fix the deck, or pass --allow-warnings to publish it as it stands.",
      "No catalog entry and no asset were written.\n",
    ].join(" "),
  );
  exit(1);
}

// Assets first. A deck entry that exists before its audio does is a lecture
// whose narration 404s, and the failure lands on the student.
try {
  await copyNarrationAudio();
  await copySlideImages();
} catch (error) {
  // The errno class, not the message: an errno message carries both paths.
  stderr.write(
    `Blocked: ${deck.courseId} assets could not be copied (${error.code ?? "unknown"}). No catalog entry was written.\n`,
  );
  exit(1);
}

await mkdir(dataDir, { recursive: true });
await writeCatalogEntryAtomically();

stdout.write(JSON.stringify(createSummary("published"), null, 2) + "\n");
exit(warnings.length > 0 ? 1 : 0);

// Temp file plus rename, in the same directory so the rename stays on one
// filesystem and is atomic. A reader either sees the previous deck or the new
// one, never a half-written file - and the store, which skips a deck it cannot
// parse, would have dropped the course entirely on a partial write.
async function writeCatalogEntryAtomically() {
  const target = join(dataDir, `${deck.courseId}.json`);
  const temporary = `${target}.publish-${pid}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(deck, null, 2) + "\n");
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

// `durationSeconds` used to be hand-typed and never checked against the WAV
// sitting next to it. The number drives the playback progress rail, the time
// readout, and the xAPI result.duration — playback itself ends on the real
// <audio> clock — so a typed number that disagrees with the WAV buys only a
// broken progress ring and a false learning record. The WAV header is
// therefore authoritative wherever it can be read (arbitration ruling,
// 2026-08-16); linger-style teacher intent belongs to a future additive
// holdSeconds field the player would have to learn to consume.
async function resolveNarrationAudio(value) {
  const isDeckShaped = typeof value === "object" && value !== null && !Array.isArray(value);
  const slides = isDeckShaped && Array.isArray(value.slides) ? value.slides : [];
  // Anything else is left exactly as it is, so the validator below reports what
  // is actually wrong with it rather than a derived complaint about slides.
  if (!audioDir || !isDeckShaped) {
    return { deck: value, present: new Set(), derived: 0 };
  }

  const audioRoot = resolve(audioDir);
  const present = new Set(await readdir(audioRoot).catch(() => []));
  let derived = 0;
  const resolvedSlides = [];
  for (const slide of slides) {
    const slideId = typeof slide?.slideId === "string" ? slide.slideId : "unknown";
    const filename = typeof slide?.audioId === "string" ? `${slide.audioId}.wav` : undefined;
    if (!filename || !present.has(filename)) {
      warnings.push(`missing-audio:${slideId}`);
      resolvedSlides.push(slide);
      continue;
    }

    const wav = readPcm16MonoWavDuration(await readFile(join(audioRoot, filename)));
    if (!wav) {
      // Not the 16-bit mono PCM the narration pipeline writes, so the duration
      // formula does not apply. Better to keep the typed number than to derive
      // a wrong one.
      warnings.push(`unsupported-wav-format:${slideId}`);
      resolvedSlides.push(slide);
      continue;
    }

    derived += 1;
    const typed = slide?.durationSeconds;
    if (
      typeof typed === "number" &&
      Number.isFinite(typed) &&
      Math.abs(typed - wav.durationSeconds) > durationDivergenceToleranceSeconds
    ) {
      warnings.push(`duration-divergence:${slideId}`);
    }
    // The WAV is what actually plays, so its header wins whenever it is
    // readable; a divergent typed number is discarded, and the warning above
    // (which fails the publish) is what keeps the discard impossible to miss.
    resolvedSlides.push({
      ...slide,
      durationSeconds: wav.durationSeconds,
    });
  }

  return { deck: { ...value, slides: resolvedSlides }, present, derived };
}

async function copyNarrationAudio() {
  if (!audioDir) {
    return;
  }
  const target = join(cwd(), "public", "learning", "ppt-playback", "audio", deck.audioManifestId);
  await mkdir(target, { recursive: true });
  for (const slide of deck.slides) {
    const filename = `${slide.audioId}.wav`;
    if (!narrationAudio.present.has(filename)) {
      continue;
    }
    await copyFile(join(resolve(audioDir), filename), join(target, filename));
  }
}

// Every slide's `imageUrl` is built unconditionally from the pptAssetId, so a
// missing page renders as a broken frame rather than as an absence anyone
// reports. Counted against the slide list and warned per page.
async function inspectSlideImages(value) {
  const publicTarget = join(
    cwd(),
    "public",
    "learning",
    "ppt-playback",
    "slides",
    value.pptAssetId,
  );
  const alreadyPublished = new Set(await readdir(publicTarget).catch(() => []));
  const source = slidesDir ? new Set(await readdir(resolve(slidesDir)).catch(() => [])) : undefined;

  const copyable = [];
  const missing = [];
  let available = 0;
  for (const slide of value.slides) {
    const filename = `${slide.slideId.replace(/^slide-/, "page-")}.jpg`;
    if (source?.has(filename)) {
      copyable.push(filename);
      available += 1;
      continue;
    }
    if (alreadyPublished.has(filename)) {
      available += 1;
      continue;
    }
    missing.push(slide.slideId);
    warnings.push(`missing-slide-image:${slide.slideId}`);
  }

  return {
    publicTarget,
    source: slidesDir ? "slides-dir" : alreadyPublished.size > 0 ? "already-published" : "none",
    expected: value.slides.length,
    available,
    copyable,
    missing,
  };
}

async function copySlideImages() {
  if (!slidesDir || slideImages.copyable.length === 0) {
    return;
  }
  await mkdir(slideImages.publicTarget, { recursive: true });
  for (const filename of slideImages.copyable) {
    await copyFile(join(resolve(slidesDir), filename), join(slideImages.publicTarget, filename));
  }
}

// One deck per audio manifest id and one deck per ppt asset id, across the whole
// catalog directory PLUS the compiled-in demo deck. Reads only; a file it cannot
// parse is left to the store's own skip-and-log path rather than blocking an
// unrelated publish. Republishing the same courseId is not a collision with
// itself, which is what the courseId skips below are for.
async function findCatalogIdCollision(value) {
  if (value.courseId !== compiledInPlaybackDeck.courseId) {
    const compiledInField = readCollidingIdField(value, compiledInPlaybackDeck);
    if (compiledInField) {
      return { field: compiledInField, owner: "the compiled-in demo deck" };
    }
  }

  const filenames = (await readdir(dataDir).catch(() => [])).filter((name) =>
    name.endsWith(".json"),
  );
  for (const filename of filenames.sort()) {
    if (filename === `${value.courseId}.json`) {
      continue;
    }
    let existing;
    try {
      existing = JSON.parse(await readFile(join(dataDir, filename), "utf8"));
    } catch {
      continue;
    }
    const field = readCollidingIdField(value, existing ?? {});
    if (field) {
      return { field, owner: filename };
    }
  }
  return undefined;
}

// audioManifestId first, so the message an operator sees names the collision
// that costs a student the wrong teacher's voice before the one that costs them
// the wrong slides.
function readCollidingIdField(value, existing) {
  if (existing.audioManifestId === value.audioManifestId) {
    return "audioManifestId";
  }
  if (existing.pptAssetId === value.pptAssetId) {
    return "pptAssetId";
  }
  return undefined;
}

function createSummary(status) {
  return {
    target: "uais-learning-deck-publish",
    status,
    courseId: deck.courseId,
    audioManifestId: deck.audioManifestId,
    pptAssetId: deck.pptAssetId,
    slideCount: deck.slides.length,
    localizedLocales: Object.keys(deck.localized ?? {}),
    catalogFile: `${basename(dataDir)}/${deck.courseId}.json`,
    slideImages: {
      source: slideImages.source,
      expected: slideImages.expected,
      available: slideImages.available,
      copied: status === "published" ? slideImages.copyable.length : 0,
      missing: slideImages.missing,
      allowMissing: allowMissingSlides,
    },
    narrationAudio: {
      source: audioDir ? "audio-dir" : "none",
      durationsDerivedFromWav: narrationAudio.derived,
    },
    warnings,
    // Whether this run was permitted to write despite them. A published summary
    // with a non-empty `warnings` and `allowWarnings: false` is now impossible.
    allowWarnings,
    valueRedacted: true,
  };
}

function readOption(name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

// The flag was advertised in --help long before anything read it, so an
// operator following the help text published against whatever their shell
// happened to export. Same shape as the other UAIS operator scripts: existing
// environment wins, so a file cannot quietly redirect a live run.
function loadEnvFile(envFile) {
  if (!envFile) {
    return;
  }
  let content;
  try {
    content = readFileSync(envFile, "utf8");
  } catch (error) {
    stderr.write(`Blocked: --env-file could not be read. ${error.message}\n`);
    exit(1);
    return;
  }
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    if (key && env[key] === undefined) {
      env[key] = stripQuotes(line.slice(separatorIndex + 1).trim());
    }
  }
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
