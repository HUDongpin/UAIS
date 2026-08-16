import { afterAll, afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { findPublishedPlaybackByCourseId } from "@/lib/learning/ppt-playback-catalog";
import { compiledInPlaybackDeck } from "@/lib/learning/published-deck-validation.mjs";
import {
  normalizePublishedPptPlayback,
  readPublishedPlaybackFiles,
  resetPublishedPlaybackFilesForTesting,
} from "@/lib/learning/published-playback-store";

// Real course content entering the system.
//
// The whole lesson catalog was one 19-slide demo deck compiled into the bundle:
// publishing the September course's Week-1 lecture meant a developer editing
// TypeScript, copying assets, committing and redeploying - per lecture, per
// week. These assertions cover the path that replaces that, and in particular
// the validation that turns a silent runtime failure into a refused publish.

const run = promisify(execFile);
const dirs: string[] = [];

afterEach(() => {
  resetPublishedPlaybackFilesForTesting();
});

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

function createDeck(overrides: Record<string, unknown> = {}) {
  return {
    courseId: "autumn-2026-research-methods",
    courseTitle: "大学研究方法",
    sourceDeckTitle: "第一周：研究问题",
    teacherName: "康霞博士",
    voiceLabel: "康霞博士克隆声音",
    audioManifestId: "audio-manifest-autumn-2026-week-01",
    pptAssetId: "autumn-2026-week-01",
    slides: [
      {
        slideId: "slide-01",
        slideTitle: "研究问题从哪里来",
        narrationText: "同学们好，这一周我们讨论研究问题的来源。",
        audioId: "tts_autumn-2026-week-01_slide-01",
        durationSeconds: 18.4,
      },
      {
        slideId: "slide-02",
        slideTitle: "可观察证据",
        narrationText: "把研究问题转化为可观察证据，是这门课的核心训练。",
        audioId: "tts_autumn-2026-week-01_slide-02",
        durationSeconds: 21.1,
      },
    ],
    ...overrides,
  };
}

async function createDeckDir() {
  const dir = await mkdtemp(join(tmpdir(), "uais-deck-"));
  dirs.push(dir);
  return dir;
}

// The publish script writes slide images and narration WAVs under
// `<cwd>/public/`, so every asset-touching case runs with cwd pointed at a
// throwaway directory. Nothing in these tests may land in the repo's `public/`.
async function createPublishRoot() {
  return createDeckDir();
}

/** A 16-bit mono PCM WAV of a known length, laid out like `createPcm16MonoWav`. */
function createNarrationWav(durationSeconds: number, sampleRateHz = 24000) {
  const pcmByteLength = Math.round(durationSeconds * sampleRateHz) * 2;
  const bytes = Buffer.alloc(44 + pcmByteLength);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(36 + pcmByteLength, 4);
  bytes.write("WAVE", 8, "ascii");
  bytes.write("fmt ", 12, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRateHz, 24);
  bytes.writeUInt32LE(sampleRateHz * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(pcmByteLength, 40);
  return bytes;
}

async function listDirectory(dir: string) {
  return (await readdir(dir).catch(() => [] as string[])).sort();
}

describe("published deck validation", () => {
  it("accepts a well-formed deck", () => {
    const deck = normalizePublishedPptPlayback(createDeck());

    expect(deck.courseId).toBe("autumn-2026-research-methods");
    expect(deck.slides).toHaveLength(2);
    expect(deck.slides[1].audioId).toBe("tts_autumn-2026-week-01_slide-02");
  });

  it("refuses slide ids that are not slide-01..slide-NN in order", () => {
    // This is the rule worth failing loudly on: `findPublishedLearningPptPlaybackAudio`
    // parses the trailing ordinal to index into `slides`, so any other numbering
    // loads the deck fine and then serves the wrong audio - or none - at a
    // student's first click.
    expect(() =>
      normalizePublishedPptPlayback(
        createDeck({
          slides: [
            {
              slideId: "slide-1",
              slideTitle: "T",
              narrationText: "N",
              audioId: "tts_x_slide-1",
              durationSeconds: 1,
            },
          ],
        }),
      ),
    ).toThrow(/slide-01/);

    expect(() =>
      normalizePublishedPptPlayback(
        createDeck({
          slides: [
            {
              slideId: "slide-02",
              slideTitle: "T",
              narrationText: "N",
              audioId: "tts_x_slide-02",
              durationSeconds: 1,
            },
          ],
        }),
      ),
    ).toThrow(/slide-01/);
  });

  it("refuses ids that would escape into a filesystem path or a URL", () => {
    for (const courseId of ["../etc/passwd", "course id", "course/id", ""]) {
      expect(() => normalizePublishedPptPlayback(createDeck({ courseId }))).toThrow(
        /Invalid courseId/,
      );
    }
  });

  it("refuses an audioId that does not belong to its slide", () => {
    expect(() =>
      normalizePublishedPptPlayback(
        createDeck({
          slides: [
            {
              slideId: "slide-01",
              slideTitle: "T",
              narrationText: "N",
              audioId: "tts_x_slide-09",
              durationSeconds: 1,
            },
          ],
        }),
      ),
    ).toThrow(/must end with/);
  });

  it("refuses text that would carry a path or a credential into a response body", () => {
    expect(() =>
      normalizePublishedPptPlayback(createDeck({ teacherName: "/Users/dongpinhu/deck" })),
    ).toThrow(/Unsafe text/);
    expect(() =>
      normalizePublishedPptPlayback(createDeck({ courseTitle: "DASHSCOPE_API_KEY=sk-live" })),
    ).toThrow(/Unsafe text/);

    for (const credential of [
      "api_key=9f3c1a2b4d",
      'The config is {"apiKey": "a1b2c3d4e5f6"}',
      "secret: hunter2000",
      "sk-proj-0a1b2c3d4e5f6g7h8i9j",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc",
      "UAIS_LIVE_AI_APPROVAL_TOKEN",
      `Paste ${"QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbg"} into the field`,
    ]) {
      expect(() =>
        normalizePublishedPptPlayback(createDeck({ courseTitle: credential })),
      ).toThrow(/Unsafe text/);
    }
  });

  it("publishes prose that merely mentions tokens, secrets and keys", () => {
    // The rule used to be /api[_-]?key|secret|token/i, which reads a lecture
    // about lexical analysis as a credential leak. A computer-science course
    // could not be published at all.
    const lecture = [
      "A token is the smallest unit a lexer emits.",
      "Tokenization is the first step of compilation.",
      "The secret of the proof is the induction hypothesis.",
      "Ask the departmental secretary for the room key.",
      "词元（token）是词法分析的基本单位。",
      "The token: a lexical unit, not a credential.",
      "The secret: perseverance.",
    ].join(" ");

    const deck = normalizePublishedPptPlayback(
      createDeck({
        courseTitle: "Formal Languages",
        slides: [
          {
            slideId: "slide-01",
            slideTitle: "Tokens, keys and secrets",
            narrationText: lecture,
            audioId: "tts_x_slide-01",
            durationSeconds: 12,
          },
        ],
      }),
    );

    expect(deck.slides[0].narrationText).toBe(lecture);
    expect(deck.slides[0].slideTitle).toBe("Tokens, keys and secrets");
  });

  it("requires localized copy to cover every slide", () => {
    expect(() =>
      normalizePublishedPptPlayback(
        createDeck({
          localized: {
            "en-US": {
              courseTitle: "Research Methods",
              sourceDeckTitle: "Week 1",
              teacherName: "Dr Kang Xia",
              voiceLabel: "Cloned voice",
              slides: [
                { slideId: "slide-01", slideTitle: "Where questions come from", narrationText: "…" },
              ],
            },
          },
        }),
      ),
    ).toThrow(/all 2 slides/);
  });
});

describe("published deck catalog", () => {
  it("loads a deck from the data directory and serves it by courseId", async () => {
    const dir = await createDeckDir();
    await writeFile(
      join(dir, "autumn-2026-research-methods.json"),
      JSON.stringify(createDeck()),
    );

    const loaded = readPublishedPlaybackFiles({ UAIS_LEARNING_PPT_PLAYBACK_DATA_DIR: dir });

    expect(loaded).toHaveLength(1);
    expect(loaded[0].courseTitle).toBe("大学研究方法");
  });

  it("skips one malformed deck without taking the catalog down", async () => {
    const dir = await createDeckDir();
    await writeFile(join(dir, "good.json"), JSON.stringify(createDeck()));
    await writeFile(join(dir, "broken.json"), "{ not json");

    // A student in another course must not lose their lesson over a file they
    // never touched.
    const loaded = readPublishedPlaybackFiles({ UAIS_LEARNING_PPT_PLAYBACK_DATA_DIR: dir });

    expect(loaded.map((deck) => deck.courseId)).toEqual(["autumn-2026-research-methods"]);
  });

  it("returns an empty catalog when nothing has been published yet", () => {
    expect(
      readPublishedPlaybackFiles({
        UAIS_LEARNING_PPT_PLAYBACK_DATA_DIR: join(tmpdir(), "uais-deck-does-not-exist"),
      }),
    ).toEqual([]);
  });

  it("picks up a deck dropped in after the catalog was first read", async () => {
    // The catalog cached for the life of the process, so a deck published onto a
    // mounted data dir did not exist until someone restarted the server - and
    // the operator who saw `status: "published"` and then the empty state had no
    // way to tell that from a failed publish.
    const dir = await createDeckDir();
    expect(readPublishedPlaybackFiles({ UAIS_LEARNING_PPT_PLAYBACK_DATA_DIR: dir })).toEqual([]);

    await writeFile(
      join(dir, "autumn-2026-research-methods.json"),
      JSON.stringify(createDeck()),
    );

    expect(
      readPublishedPlaybackFiles({ UAIS_LEARNING_PPT_PLAYBACK_DATA_DIR: dir }).map(
        (deck) => deck.courseId,
      ),
    ).toEqual(["autumn-2026-research-methods"]);
  });

  it("keeps two data directories apart in the cache", async () => {
    const first = await createDeckDir();
    const second = await createDeckDir();
    await writeFile(join(first, "a.json"), JSON.stringify(createDeck()));
    await writeFile(
      join(second, "b.json"),
      JSON.stringify(createDeck({ courseId: "spring-2027-statistics" })),
    );

    expect(
      readPublishedPlaybackFiles({ UAIS_LEARNING_PPT_PLAYBACK_DATA_DIR: first }).map(
        (deck) => deck.courseId,
      ),
    ).toEqual(["autumn-2026-research-methods"]);
    expect(
      readPublishedPlaybackFiles({ UAIS_LEARNING_PPT_PLAYBACK_DATA_DIR: second }).map(
        (deck) => deck.courseId,
      ),
    ).toEqual(["spring-2027-statistics"]);
  });

  it("still serves the compiled-in demo deck", () => {
    // The change is additive: a deployment that publishes nothing behaves
    // exactly as it did.
    expect(findPublishedPlaybackByCourseId("elementary-math-research")?.slides.length).toBe(19);
  });
});

describe("publish script", () => {
  const scriptPath = join(process.cwd(), "scripts", "publish-learning-deck.mjs");

  async function publish(args: string[], options: { cwd?: string } = {}) {
    try {
      const { stdout } = await run(process.execPath, [scriptPath, ...args], {
        cwd: options.cwd ?? process.cwd(),
      });
      return { code: 0, stdout, stderr: "" };
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string };
      return { code: failure.code ?? 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
    }
  }

  /** deck.json + page-NN.jpg + narration WAVs, laid out the way the README says. */
  async function createLesson(
    options: { durationSeconds?: number[]; deck?: Record<string, unknown> } = {},
  ) {
    const sourceDir = await createDeckDir();
    const slidesDir = join(sourceDir, "slides");
    const audioDir = join(sourceDir, "audio");
    await mkdir(slidesDir, { recursive: true });
    await mkdir(audioDir, { recursive: true });

    const deck = createDeck(options.deck);
    const deckPath = join(sourceDir, "deck.json");
    await writeFile(deckPath, JSON.stringify(deck));
    for (const [index, slide] of (deck.slides as Array<Record<string, unknown>>).entries()) {
      await writeFile(join(slidesDir, `page-0${index + 1}.jpg`), "jpeg-bytes");
      // The WAV matches the deck's own typed duration unless a case says
      // otherwise, so divergence is something a test opts into.
      const durationSeconds =
        options.durationSeconds?.[index] ??
        (typeof slide.durationSeconds === "number" ? slide.durationSeconds : 5);
      await writeFile(join(audioDir, `${slide.audioId}.wav`), createNarrationWav(durationSeconds));
    }

    return { deckPath, slidesDir, audioDir };
  }

  function publicSlidesDir(root: string, pptAssetId = "autumn-2026-week-01") {
    return join(root, "public", "learning", "ppt-playback", "slides", pptAssetId);
  }

  function publicAudioDir(root: string, manifestId = "audio-manifest-autumn-2026-week-01") {
    return join(root, "public", "learning", "ppt-playback", "audio", manifestId);
  }

  it("validates without writing under --check", async () => {
    const catalogDir = await createDeckDir();
    const publishRoot = await createPublishRoot();
    const { deckPath, slidesDir, audioDir } = await createLesson();

    const result = await publish(
      [
        "--deck",
        deckPath,
        "--data-dir",
        catalogDir,
        "--slides-dir",
        slidesDir,
        "--audio-dir",
        audioDir,
        "--check",
      ],
      { cwd: publishRoot },
    );

    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "checked",
      courseId: "autumn-2026-research-methods",
      slideCount: 2,
      slideImages: { source: "slides-dir", expected: 2, available: 2, copied: 0, missing: [] },
      warnings: [],
    });
    // --check writes NOTHING: not the catalog entry, not an asset, not a temp
    // file. An operator has to be able to run it against the live data dir.
    expect(await listDirectory(catalogDir)).toEqual([]);
    expect(await listDirectory(join(publishRoot, "public"))).toEqual([]);
  });

  it("publishes a lesson complete with its slide images and narration audio", async () => {
    const catalogDir = await createDeckDir();
    const publishRoot = await createPublishRoot();
    const { deckPath, slidesDir, audioDir } = await createLesson();

    const result = await publish(
      [
        "--deck",
        deckPath,
        "--data-dir",
        catalogDir,
        "--slides-dir",
        slidesDir,
        "--audio-dir",
        audioDir,
      ],
      { cwd: publishRoot },
    );

    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "published",
      slideImages: { source: "slides-dir", expected: 2, available: 2, copied: 2, missing: [] },
      narrationAudio: { source: "audio-dir", durationsDerivedFromWav: 2 },
      warnings: [],
    });

    // The property that matters: what the script writes is what the runtime
    // accepts. A drift between the two validators would show up here.
    const loaded = readPublishedPlaybackFiles({
      UAIS_LEARNING_PPT_PLAYBACK_DATA_DIR: catalogDir,
    });
    expect(loaded.map((deck) => deck.courseId)).toEqual(["autumn-2026-research-methods"]);

    // And the two halves the runtime serves from `public/` are really there, at
    // the paths `buildLearningSlideImageUrl` and the audio route construct.
    expect(await listDirectory(publicSlidesDir(publishRoot))).toEqual([
      "page-01.jpg",
      "page-02.jpg",
    ]);
    expect(await listDirectory(publicAudioDir(publishRoot))).toEqual([
      "tts_autumn-2026-week-01_slide-01.wav",
      "tts_autumn-2026-week-01_slide-02.wav",
    ]);
  });

  it("refuses a partly-imaged publish, and ships it only when --allow-warnings is typed", async () => {
    const catalogDir = await createDeckDir();
    const publishRoot = await createPublishRoot();
    const { deckPath, slidesDir } = await createLesson();
    await rm(join(slidesDir, "page-02.jpg"));

    const refused = await publish(
      ["--deck", deckPath, "--data-dir", catalogDir, "--slides-dir", slidesDir],
      { cwd: publishRoot },
    );

    // The old behaviour was "exit 1 and publish anyway": slide 2 rendered as a
    // blank frame for every student while the terminal reported a failure. The
    // exit code is unchanged; what it now describes is a deck that did NOT go
    // live, and nothing was copied into public/ either.
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("missing-slide-image:slide-02");
    expect(refused.stderr).toContain("--allow-warnings");
    expect(await listDirectory(catalogDir)).toEqual([]);
    expect(await listDirectory(join(publishRoot, "public"))).toEqual([]);

    // An incremental publish is a real workflow, so it stays available - it just
    // has to be said out loud.
    const allowed = await publish(
      [
        "--deck",
        deckPath,
        "--data-dir",
        catalogDir,
        "--slides-dir",
        slidesDir,
        "--allow-warnings",
      ],
      { cwd: publishRoot },
    );

    expect(allowed.code).toBe(1);
    expect(JSON.parse(allowed.stdout)).toMatchObject({
      status: "published",
      slideImages: { expected: 2, available: 1, copied: 1, missing: ["slide-02"] },
      warnings: ["missing-slide-image:slide-02"],
      allowWarnings: true,
    });
    expect(await listDirectory(publicSlidesDir(publishRoot))).toEqual(["page-01.jpg"]);
  });

  it("refuses a publish that would ship no slide image at all", async () => {
    const catalogDir = await createDeckDir();
    const publishRoot = await createPublishRoot();
    const { deckPath } = await createLesson();

    // Every slide's imageUrl is built from the pptAssetId unconditionally, so
    // this deck would render as a lecture of broken frames.
    const refused = await publish(["--deck", deckPath, "--data-dir", catalogDir], {
      cwd: publishRoot,
    });

    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("would ship no slide image");
    expect(refused.stderr).toContain("--allow-missing-slides");
    expect(await listDirectory(catalogDir)).toEqual([]);

    // The escape hatch has to be said out loud - and it is a narrow one.
    // `--allow-missing-slides` waives only the zero-image REFUSAL; the per-slide
    // warnings it leaves behind are still warnings, and they still refuse the
    // write on their own.
    const stillRefused = await publish(
      ["--deck", deckPath, "--data-dir", catalogDir, "--allow-missing-slides"],
      { cwd: publishRoot },
    );

    expect(stillRefused.code).toBe(1);
    expect(stillRefused.stderr).toContain("--allow-warnings");
    expect(await listDirectory(catalogDir)).toEqual([]);

    const allowed = await publish(
      [
        "--deck",
        deckPath,
        "--data-dir",
        catalogDir,
        "--allow-missing-slides",
        "--allow-warnings",
      ],
      { cwd: publishRoot },
    );

    expect(JSON.parse(allowed.stdout)).toMatchObject({
      status: "published",
      slideImages: { source: "none", available: 0, allowMissing: true },
      allowWarnings: true,
    });
    expect(await listDirectory(catalogDir)).toEqual(["autumn-2026-research-methods.json"]);
  });

  it("reports the missing images under --check without writing anything", async () => {
    const catalogDir = await createDeckDir();
    const publishRoot = await createPublishRoot();
    const { deckPath } = await createLesson();

    const result = await publish(
      ["--deck", deckPath, "--data-dir", catalogDir, "--check"],
      { cwd: publishRoot },
    );

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).warnings).toContain("no-slide-images");
    expect(await listDirectory(catalogDir)).toEqual([]);
    expect(await listDirectory(join(publishRoot, "public"))).toEqual([]);
  });

  it("derives durationSeconds from the WAV headers when the deck omits them", async () => {
    const catalogDir = await createDeckDir();
    const publishRoot = await createPublishRoot();
    const { deckPath, slidesDir, audioDir } = await createLesson({
      durationSeconds: [7.5, 12.25],
      deck: {
        slides: [
          {
            slideId: "slide-01",
            slideTitle: "研究问题从哪里来",
            narrationText: "同学们好，这一周我们讨论研究问题的来源。",
            audioId: "tts_autumn-2026-week-01_slide-01",
          },
          {
            slideId: "slide-02",
            slideTitle: "可观察证据",
            narrationText: "把研究问题转化为可观察证据，是这门课的核心训练。",
            audioId: "tts_autumn-2026-week-01_slide-02",
          },
        ],
      },
    });

    const result = await publish(
      [
        "--deck",
        deckPath,
        "--data-dir",
        catalogDir,
        "--slides-dir",
        slidesDir,
        "--audio-dir",
        audioDir,
      ],
      { cwd: publishRoot },
    );

    expect(result.code, result.stderr).toBe(0);
    // The WAV is the fact. The number typed beside it never was.
    const published = readPublishedPlaybackFiles({
      UAIS_LEARNING_PPT_PLAYBACK_DATA_DIR: catalogDir,
    })[0];
    expect(published.slides.map((slide) => slide.durationSeconds)).toEqual([7.5, 12.25]);
  });

  it("warns when a hand-typed duration diverges from its WAV by more than a second", async () => {
    const catalogDir = await createDeckDir();
    const publishRoot = await createPublishRoot();
    // Slide 1's typed 18.4s is close to its 18s WAV; slide 2's typed 21.1s is
    // nowhere near its 5s WAV, which is what a copy-paste slip looks like.
    const { deckPath, slidesDir, audioDir } = await createLesson({ durationSeconds: [18, 5] });

    // A divergent duration refuses the write like any other warning: the number
    // drives the progress rail and the xAPI result.duration, so a deck the
    // script has just contradicted must not reach students on an operator's
    // shrug. `--allow-warnings` is what makes the discard a decision.
    const refused = await publish(
      [
        "--deck",
        deckPath,
        "--data-dir",
        catalogDir,
        "--slides-dir",
        slidesDir,
        "--audio-dir",
        audioDir,
      ],
      { cwd: publishRoot },
    );

    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("duration-divergence:slide-02");
    expect(await listDirectory(catalogDir)).toEqual([]);

    const result = await publish(
      [
        "--deck",
        deckPath,
        "--data-dir",
        catalogDir,
        "--slides-dir",
        slidesDir,
        "--audio-dir",
        audioDir,
        "--allow-warnings",
      ],
      { cwd: publishRoot },
    );

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).warnings).toEqual(["duration-divergence:slide-02"]);
    // The WAV wins wherever it is readable — even for slide-01, whose typed
    // 18.4 was plausibly close — because the audio clock is what actually ends
    // narration, so any other number breaks the progress rail and falsifies
    // result.duration in the learning record (arbitration ruling, 2026-08-16).
    // The loud exit-1 divergence warning is what keeps the discard visible.
    const published = readPublishedPlaybackFiles({
      UAIS_LEARNING_PPT_PLAYBACK_DATA_DIR: catalogDir,
    })[0];
    expect(published.slides.map((slide) => slide.durationSeconds)).toEqual([18, 5]);
  });

  it("keeps the typed duration only for a slide whose WAV is absent", async () => {
    const catalogDir = await createDeckDir();
    const publishRoot = await createPublishRoot();
    const { deckPath, slidesDir, audioDir } = await createLesson({ durationSeconds: [18, 5] });
    // Slide 2 loses its narration file: with no WAV to read there is nothing
    // authoritative to derive, so the typed 21.1 is all the catalog can carry.
    await unlink(join(audioDir, "tts_autumn-2026-week-01_slide-02.wav"));

    const refused = await publish(
      [
        "--deck",
        deckPath,
        "--data-dir",
        catalogDir,
        "--slides-dir",
        slidesDir,
        "--audio-dir",
        audioDir,
      ],
      { cwd: publishRoot },
    );

    // A slide with no narration is a lecture that goes silent mid-way, so the
    // write is refused until the operator says the gap is intended.
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("missing-audio:slide-02");
    expect(await listDirectory(catalogDir)).toEqual([]);

    const result = await publish(
      [
        "--deck",
        deckPath,
        "--data-dir",
        catalogDir,
        "--slides-dir",
        slidesDir,
        "--audio-dir",
        audioDir,
        "--allow-warnings",
      ],
      { cwd: publishRoot },
    );

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).warnings).toEqual(["missing-audio:slide-02"]);
    const published = readPublishedPlaybackFiles({
      UAIS_LEARNING_PPT_PLAYBACK_DATA_DIR: catalogDir,
    })[0];
    expect(published.slides.map((slide) => slide.durationSeconds)).toEqual([18, 21.1]);
  });

  it("refuses localized copy the runtime would silently drop at load", async () => {
    const catalogDir = await createDeckDir();
    const publishRoot = await createPublishRoot();
    // The script used to pass `localized` through raw while the store validated
    // it. This deck published cleanly and then vanished: the store skipped it
    // with a console.error, and the lecture was simply not there.
    const { deckPath, slidesDir } = await createLesson({
      deck: {
        localized: {
          "en-US": {
            courseTitle: "Research Methods",
            sourceDeckTitle: "Week 1",
            teacherName: "Dr Kang Xia",
            voiceLabel: "Cloned voice",
            slides: [
              { slideId: "slide-01", slideTitle: "Where questions come from", narrationText: "…" },
            ],
          },
        },
      },
    });

    const result = await publish(
      ["--deck", deckPath, "--data-dir", catalogDir, "--slides-dir", slidesDir],
      { cwd: publishRoot },
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("all 2 slides");
    expect(await listDirectory(catalogDir)).toEqual([]);
  });

  it("refuses two decks that would share one audioManifestId", async () => {
    const catalogDir = await createDeckDir();
    const publishRoot = await createPublishRoot();
    await writeFile(
      join(catalogDir, "spring-2027-statistics.json"),
      JSON.stringify(createDeck({ courseId: "spring-2027-statistics" })),
    );
    const { deckPath, slidesDir } = await createLesson();

    // Audio lookup takes the FIRST catalog entry with a matching manifest id, so
    // the loser of a collision serves the winner's narration under its own
    // lecture and nothing in the system reports a fault.
    const result = await publish(
      ["--deck", deckPath, "--data-dir", catalogDir, "--slides-dir", slidesDir],
      { cwd: publishRoot },
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("spring-2027-statistics.json");
    expect(await listDirectory(catalogDir)).toEqual(["spring-2027-statistics.json"]);
  });

  it("refuses two decks that would share one pptAssetId", async () => {
    const catalogDir = await createDeckDir();
    const publishRoot = await createPublishRoot();
    // Distinct narration, same slide asset id. Every slide's imageUrl is built
    // from the pptAssetId alone and both decks copy their pages into
    // `public/learning/ppt-playback/slides/<pptAssetId>/`, so the second publish
    // overwrites the first lecture's frames in place: it keeps its own voice and
    // shows somebody else's slides, and nothing in the system reports a fault.
    await writeFile(
      join(catalogDir, "spring-2027-statistics.json"),
      JSON.stringify(
        createDeck({
          courseId: "spring-2027-statistics",
          audioManifestId: "audio-manifest-spring-2027-statistics",
        }),
      ),
    );
    const { deckPath, slidesDir } = await createLesson();

    const result = await publish(
      ["--deck", deckPath, "--data-dir", catalogDir, "--slides-dir", slidesDir],
      { cwd: publishRoot },
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("pptAssetId");
    expect(result.stderr).toContain("spring-2027-statistics.json");
    expect(await listDirectory(catalogDir)).toEqual(["spring-2027-statistics.json"]);
  });

  it("refuses a deck colliding with the compiled-in demo deck, which no directory listing can see", async () => {
    const demoDeck = findPublishedPlaybackByCourseId("elementary-math-research");
    // The ids the publish script carries as constants have to be the demo deck's
    // real ones: it is plain .mjs and cannot import the TypeScript catalog, so
    // this is the pin that keeps the duplicate honest.
    expect(demoDeck).toBeDefined();
    expect(compiledInPlaybackDeck).toEqual({
      courseId: demoDeck?.courseId,
      audioManifestId: demoDeck?.audioManifestId,
      pptAssetId: demoDeck?.pptAssetId,
    });

    for (const collidingField of ["audioManifestId", "pptAssetId"] as const) {
      const catalogDir = await createDeckDir();
      const publishRoot = await createPublishRoot();
      const { deckPath, slidesDir } = await createLesson({
        deck: { [collidingField]: compiledInPlaybackDeck[collidingField] },
      });

      // The demo deck is served exactly like a published one but is compiled
      // into the bundle, so an empty `--data-dir` used to look collision-free.
      const result = await publish(
        ["--deck", deckPath, "--data-dir", catalogDir, "--slides-dir", slidesDir],
        { cwd: publishRoot },
      );

      expect(result.code, result.stdout).toBe(1);
      expect(result.stderr).toContain(collidingField);
      expect(result.stderr).toContain("compiled-in demo deck");
      expect(await listDirectory(catalogDir)).toEqual([]);
    }
  });

  it("refuses an option typed as the final token instead of ignoring it", async () => {
    const publishRoot = await createPublishRoot();
    const { deckPath } = await createLesson();

    // `--env-file` last would read back as "not passed" and publish into
    // whatever UAIS_LEARNING_PPT_PLAYBACK_DATA_DIR the ambient shell exported -
    // another deployment's catalog - while reporting success.
    const result = await publish(["--deck", deckPath, "--env-file"], { cwd: publishRoot });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("--env-file requires a value");
    expect(await listDirectory(join(publishRoot, "public"))).toEqual([]);
  });

  it("leaves the live deck untouched when an asset copy fails part-way", async () => {
    const catalogDir = await createDeckDir();
    const publishRoot = await createPublishRoot();
    const { deckPath, slidesDir, audioDir } = await createLesson();

    const first = await publish(
      [
        "--deck",
        deckPath,
        "--data-dir",
        catalogDir,
        "--slides-dir",
        slidesDir,
        "--audio-dir",
        audioDir,
      ],
      { cwd: publishRoot },
    );
    expect(first.code, first.stderr).toBe(0);
    const live = await readFile(join(catalogDir, "autumn-2026-research-methods.json"), "utf8");

    // A source page that cannot be copied - here a directory wearing a .jpg
    // name. The catalog entry is written LAST, so this must not touch the deck
    // students are currently being served.
    const brokenSlidesDir = await createDeckDir();
    await mkdir(join(brokenSlidesDir, "page-01.jpg"), { recursive: true });
    await writeFile(join(brokenSlidesDir, "page-02.jpg"), "jpeg-bytes");
    const revisedDeckPath = join(brokenSlidesDir, "deck.json");
    await writeFile(
      revisedDeckPath,
      JSON.stringify(createDeck({ courseTitle: "大学研究方法（修订）" })),
    );

    const failed = await publish(
      ["--deck", revisedDeckPath, "--data-dir", catalogDir, "--slides-dir", brokenSlidesDir],
      { cwd: publishRoot },
    );

    expect(failed.code).toBe(1);
    expect(failed.stderr).toContain("No catalog entry was written");
    expect(await readFile(join(catalogDir, "autumn-2026-research-methods.json"), "utf8")).toBe(live);
    // No temp file left behind for the store to trip over either.
    expect(await listDirectory(catalogDir)).toEqual(["autumn-2026-research-methods.json"]);
  });

  it("publishes into the data directory the deployment actually reads", async () => {
    const catalogDir = await createDeckDir();
    const publishRoot = await createPublishRoot();
    const { deckPath } = await createLesson();
    const envFile = join(publishRoot, "playback.env");
    await writeFile(envFile, `UAIS_LEARNING_PPT_PLAYBACK_DATA_DIR=${catalogDir}\n`);

    // Publishing into the repo copy while the deployment reads a mounted volume
    // is a publish that reports success and changes nothing a student sees.
    const result = await publish(
      [
        "--deck",
        deckPath,
        "--env-file",
        envFile,
        "--allow-missing-slides",
        "--allow-warnings",
      ],
      { cwd: publishRoot },
    );

    expect(JSON.parse(result.stdout)).toMatchObject({ status: "published" });
    expect(await listDirectory(catalogDir)).toEqual(["autumn-2026-research-methods.json"]);
  });

  it("refuses a deck the runtime would reject, before writing anything", async () => {
    const dir = await createDeckDir();
    const deckPath = join(dir, "bad.json");
    await writeFile(
      deckPath,
      JSON.stringify(
        createDeck({
          slides: [
            {
              slideId: "intro",
              slideTitle: "T",
              narrationText: "N",
              audioId: "tts_x_intro",
              durationSeconds: 1,
            },
          ],
        }),
      ),
    );

    const result = await publish(["--deck", deckPath, "--data-dir", dir]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("slide-01");
    expect(
      readPublishedPlaybackFiles({ UAIS_LEARNING_PPT_PLAYBACK_DATA_DIR: dir }),
    ).toEqual([]);
  });

  it("never echoes deck contents into an error message", async () => {
    const dir = await createDeckDir();
    const deckPath = join(dir, "unsafe.json");
    await writeFile(deckPath, JSON.stringify(createDeck({ teacherName: "/Users/secret/path" })));

    const result = await publish(["--deck", deckPath, "--data-dir", dir]);

    expect(result.code).toBe(1);
    expect(result.stderr).not.toContain("/Users/secret");
  });
});
