# Published lesson decks

One JSON file per published deck, named `<courseId>.json`. A file here is a
published lecture: `/learning?courseId=<courseId>` plays it, and the narration
audio route serves its WAVs.

A published lesson is three things, not one:

| Part | Lives at | Comes from |
| --- | --- | --- |
| Deck manifest | `data/learning-ppt-playback/<courseId>.json` | `--deck` |
| Slide images | `public/learning/ppt-playback/slides/<pptAssetId>/page-NN.jpg` | `--slides-dir` |
| Narration audio | `public/learning/ppt-playback/audio/<audioManifestId>/<audioId>.wav` | `--audio-dir` |

All three, or the lecture is broken in a way nothing reports. Every slide's
`imageUrl` is built from the `pptAssetId` unconditionally, so a deck published
without its images renders a lecture of empty slide frames.

## Happy path

Lay the assets out so the filenames match the deck's slide ids — `slide-01`
takes `page-01.jpg` and `<audioId>.wav`:

```text
week-01/
  deck.json
  slides/page-01.jpg … page-NN.jpg
  audio/tts_<pptAssetId>_slide-01.wav … _slide-NN.wav
```

Check first — this writes nothing at all, so it is safe to run against the live
data directory:

```bash
node -- scripts/publish-learning-deck.mjs \
  --deck ./week-01/deck.json \
  --slides-dir ./week-01/slides \
  --audio-dir ./week-01/audio \
  --check
```

Then publish:

```bash
node -- scripts/publish-learning-deck.mjs \
  --deck ./week-01/deck.json \
  --slides-dir ./week-01/slides \
  --audio-dir ./week-01/audio
```

Exit code 0 means the deck is live and complete. Exit code 1 with a `Blocked:`
line on stderr means nothing was written. Exit code 1 with a summary on stdout
means the deck was published but the `warnings` array says what is missing —
usually a page image or a narration WAV for a named slide.

Finally, smoke the deployment. Add `--session-cookie` when the deployment
enforces authentication, and `--course-id` for any course other than the
compiled-in demo deck:

```bash
node -- scripts/learning-ppt-playback-deployment-smoke.mjs --live --approved \
  --environment production --base-url https://uais.top \
  --release-run-id <release-run-id> \
  --course-id <courseId> --session-cookie "<session cookie>"
```

## What the publisher refuses

- **Slide ids that are not `slide-01` … `slide-NN` in order.** Narration audio
  is looked up by that ordinal, so any other numbering loads the deck fine and
  then serves the wrong audio, or none.
- **A publish that would ship no slide image at all.** Pass `--slides-dir`, or
  `--allow-missing-slides` to publish a deck deliberately without images.
  Individual missing pages are warnings, not refusals — an incremental publish
  is a real workflow, a lecture of blank frames is not.
- **Localized copy that does not cover every slide.** The runtime validates
  `localized` the same way, and a deck it rejects is dropped at load with a
  console error nobody is watching — the lecture would simply not be there.
- **Two decks sharing one `audioManifestId`.** Audio lookup takes the first
  catalog entry with a matching id, so the loser of a collision would serve the
  winner's narration under its own lecture.
- **Text shaped like a credential or a local path** in any displayed field.
  Shaped, not worded: `api_key=…`, an `sk-…` prefix, a JWT, a long base64 run, a
  `/Users/…` path. Prose about tokens, secrets or secretaries publishes fine.

`durationSeconds` is derived from the WAV headers when `--audio-dir` is given. A
value typed into the deck overrides the derived one and warns when the two
differ by more than a second.

Assets are copied before the catalog entry is written, and the entry is written
through a temp file and a rename, so a publish that fails part-way leaves the
previous state of the course intact.

## Where the files go

`UAIS_LEARNING_PPT_PLAYBACK_DATA_DIR` moves this directory — at a mounted volume,
say — without a rebuild. The publisher reads the same variable (through
`--env-file` or the ambient environment) so it publishes where the deployment
reads, and `--data-dir` overrides both.

The running server re-reads this directory when its mtime changes, so a deck
dropped in or published over a mounted volume appears without a restart. That
covers anything the publish script does — it writes through a temp file and a
rename, which moves the directory's mtime. Editing a deck file's contents **in
place** does not, so a hand-edit still needs a restart; re-run the publisher
instead.

Slide images and narration WAVs still ship under `public/`, which on Vercel means
they are part of the deployment: publishing those two needs a deploy, while the
deck manifest alone does not.

A file whose `courseId` matches the compiled-in demo deck overrides it, which is
how the real course replaces the placeholder without a code change.
