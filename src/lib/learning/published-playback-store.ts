import { readdirSync, readFileSync, statSync } from "node:fs";
import { cwd, env as processEnv } from "node:process";
import { join, resolve } from "node:path";
import type { PublishedPptPlayback } from "@/lib/learning/ppt-playback-catalog";
import { normalizePublishedDeck } from "@/lib/learning/published-deck-validation.mjs";

// Where a real lecture enters the system.
//
// The entire lesson catalog used to be one 19-slide demo deck compiled into the
// bundle. Publishing the September course's Week-1 lecture meant a developer
// hand-editing TypeScript, copying assets, committing and redeploying - per
// lecture, per week - and even then no student outside the demo course could be
// authorized to see it. This module lets a deck be published as a reviewable
// JSON file instead.
//
// Three properties decided the design:
//
//   1. SYNCHRONOUS. `findPublishedPlaybackByCourseId` is called from
//      `isPublishedDemoTeacherCourseAccess`, which is called from inside
//      `authorizeLearningPptPlaybackAccess`, all synchronously. Making the
//      catalog async ripples through the access module, the manifest builder and
//      the LRS record builder - a large change with no benefit here, since the
//      decks are a handful of small files read once per process.
//   2. FILES, NOT A TABLE. There is no deck or slide table in the core schema,
//      and the playback stack does not touch drizzle at all today (it reads the
//      teaching snapshot store). A table would mean a migration, a store, a
//      repository, async everywhere - and a published lecture would stop being a
//      reviewable diff.
//   3. ADDITIVE. The hardcoded deck stays as the last entry, so a deployment
//      that configures nothing behaves exactly as it did.
//
// The publish flow is: put a JSON file in the data dir, deploy (or point
// UAIS_LEARNING_PPT_PLAYBACK_DATA_DIR at a mounted directory), done. Slide
// images and narration audio still ship under `public/` - moving those to blob
// storage is a separate decision this module does not prejudge.

// Repo-tracked by default, so a published lecture arrives as a reviewable diff
// rather than as state on one machine. An operator can point this elsewhere -
// at a mounted volume, say - without a rebuild.
const defaultPlaybackDataDir = join("data", "learning-ppt-playback");

export function resolveLearningPptPlaybackDataDir(configured?: string) {
  const trimmed = configured?.trim();
  return trimmed ? resolve(trimmed) : join(cwd(), defaultPlaybackDataDir);
}

// Cached per directory revision, not per process.
//
// The catalog is consulted on every playback request and every audio range
// request, so re-reading and re-parsing the directory each time would put a
// synchronous filesystem walk on the hot path of a streaming endpoint. But
// caching for the life of the process meant a deck dropped into a mounted data
// dir did not exist until someone restarted the server - and the operator who
// ran the publish script, saw `status: "published"`, then loaded the course and
// got the empty state, had no way to tell that from a failed publish.
//
// One `statSync` of the directory is the compromise. A publish adds, replaces or
// removes an entry - the script writes through a temp file and `rename`, and a
// rename into a directory bumps that directory's mtime - so the signature moves
// whenever the catalog does, and the walk happens once per publish rather than
// once per request. Keyed by directory as well, because the resolved data dir
// varies between an operator's local run and a mounted volume.
let cachedFilePlaybacks:
  | { dataDir: string; signature: string; playbacks: PublishedPptPlayback[] }
  | undefined;

export function readPublishedPlaybackFiles(
  env: Record<string, string | undefined> = processEnv,
): PublishedPptPlayback[] {
  const dataDir = resolveLearningPptPlaybackDataDir(env.UAIS_LEARNING_PPT_PLAYBACK_DATA_DIR);
  const signature = readPlaybackDataDirSignature(dataDir);
  if (cachedFilePlaybacks?.dataDir === dataDir && cachedFilePlaybacks.signature === signature) {
    return cachedFilePlaybacks.playbacks;
  }

  let filenames: string[];
  try {
    filenames = readdirSync(dataDir).filter((name) => name.endsWith(".json")).sort();
  } catch {
    // No directory is the ordinary case for a deployment that has published
    // nothing yet, and for every test. Not an error.
    cachedFilePlaybacks = { dataDir, signature, playbacks: [] };
    return cachedFilePlaybacks.playbacks;
  }

  const playbacks: PublishedPptPlayback[] = [];
  for (const filename of filenames) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(dataDir, filename), "utf8"));
      playbacks.push(normalizePublishedDeck(parsed));
    } catch (error) {
      // One malformed deck must not take the whole catalog down - a student in
      // another course would lose their lesson over a file they never touched.
      // The filename is named because it is an operator artifact, never user
      // input; the deck contents are not.
      console.error("[learning-ppt-playback] Skipped an invalid published deck.", {
        filename,
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  cachedFilePlaybacks = { dataDir, signature, playbacks };
  return playbacks;
}

// The directory's mtime and size. A `rename` into the directory moves the mtime
// even when it replaces an existing entry - verified, and the reason the publish
// script writes through a temp file and a rename rather than in place. Editing a
// deck file's CONTENT in place does not move it, so a hand-edited file still
// needs a restart; publishing with the script does not. A missing directory has
// a stable signature of its own, so the empty catalog is cached too.
function readPlaybackDataDirSignature(dataDir: string) {
  try {
    const stats = statSync(dataDir);
    return `${stats.mtimeMs}:${stats.size}`;
  } catch {
    return "absent";
  }
}

/** Test seam: drops the module cache so a suite can publish a deck mid-run. */
export function resetPublishedPlaybackFilesForTesting() {
  cachedFilePlaybacks = undefined;
}

// Validation lives in `published-deck-validation.mjs`, which the publish
// script imports as well. It used to live here, with a hand-kept copy in the
// script; the copies drifted, and a deck the script accepted could still be
// dropped here at load time.
export { normalizePublishedDeck as normalizePublishedPptPlayback };
