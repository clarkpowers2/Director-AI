# DirectorAI™ Studio

**Write it like a director. Render it like a production.**

A single-page video production studio: write one director's script, then add a talking avatar, effects, branding and captions to your screen recording, and export an H.264 MP4.

Live: https://app.directorai.hccgsa.com · API: https://directorai.hccgsa.com (the `directorai-plugin` Worker)

## The six sections

1. **Script Editor.** Live syntax highlighting, parsing as you type, AI Assist (Claude), find & replace, a Scenes view (collapse, drag to reorder, duplicate, delete, add), and click-to-edit voiceover lines.
2. **Avatar Studio.** Five presenter styles, a photo per outfit, four voices with slow/normal/fast speed and warm/neutral/authoritative tone, five positions, three sizes, and a label. On mobile it opens as a bottom drawer.
3. **Video Editor.** Base video up to 30 minutes, background music, preview, a timeline (effect markers, speaking segments, chapters, B-roll), trim in/out, 0.5×–2× speed, and a video/voice/music mix.
4. **Effects & Branding.** Add ZOOM, HIGHLIGHT, PULSE, POINTER, CALLOUT, TITLE CARD, LOWER THIRD or TRANSITION (fade/slide) at the playhead, then click or drag on the preview to place it. Per-effect colors. Colors, 5 fonts, logo, intro/outro cards, and captions.
5. **Advanced Tools.** Noise reduction, auto chapters (YouTube format), B-roll clips (full screen or picture-in-picture), subtitle translation (14 languages), and a teleprompter.
6. **Export.** MP4 or WebM at 720p/1080p/4K, plus voiceover MP3, SRT captions and a scene-directions PDF, with live progress and a download button.

The project autosaves every 30 seconds. Settings go to localStorage; videos, music, photos and generated avatar lines go to IndexedDB, so a reload keeps everything.

## Avatar engines

| Engine | What you get | Needs |
|---|---|---|
| HeyGen | A lifelike presenter per voiceover line: lip-sync, natural movement, full-body or upper-body avatars from HeyGen's library, or a photo avatar made from your own photo | `HEYGEN_API_KEY`, HeyGen credits (a few minutes' render time per line) |
| Animated (free) | Cloudflare Workers AI voice (Deepgram Aura); your photo breathes when idle and moves with the loudness of the speech. No lip-sync. | Workers AI binding (on by default) |

### HeyGen details

- **API:** HeyGen v3. `POST /v3/videos` creates a clip and `GET /v3/videos/{id}` polls it; the gallery comes from `GET /v3/avatars/looks` and voices from `GET /v3/voices`. "Create from my photo" uses `POST /v3/assets` then `POST /v3/avatars` (type `photo`).
- **Transparent presenters:** clips are requested as `output_format: "webm"` (alpha channel). HeyGen only allows that for avatars trained with matting (new digital twins, most photo avatars). Studio avatars with a fixed background fall back to MP4 automatically and appear in a framed card. The studio crops a cut-out to the presenter's visible pixels and stands it on the bottom edge (left / right / bottom center; 25% / 33% / 50% of screen width). VP9 transparency plays in Chrome, Edge and Firefox; Safari shows a black box.
- **Avatar library cache:** HeyGen lists ~10,000 avatar looks (~200 pages) and ~3,000 voices. `/api/avatar/catalog` caches both in Cloudflare KV (binding `CATALOG`) for 24 hours. The first build runs in steps of 40 pages (Functions have a subrequest limit) while the studio shows indexing progress; after that, stale copies are served while a refresh runs in the background. Search and filtering happen server-side over the whole library.
- **Gallery tabs** follow HeyGen's `avatar_type`: **Full Body** (studio avatars filmed standing: "Standing"/"Walking"/"Full Body" in the name; wide knee-up shots, since HeyGen's stock library has no head-to-toe presenters), **Studio**, **Digital Twin**, **Talking Head** (photo avatars), and **My avatars** (live).
- **Voice picker:** search by name or language, gender and language filters, 3-second previews from HeyGen's sample audio. Defaults to "Victor" (English, male); "Avatar's own default voice" is also an option.
- **Gestures:** HeyGen takes one `motion_prompt` per clip. It can't time a gesture to a word, but the studio renders one clip per voiceover line, so each line gets the gestures its scene calls for:
  - POINTS TO: points toward the element (direction worked out from where you placed it and which side the avatar is on)
  - ZOOM, CALLOUT, HIGHLIGHT: looks and gestures toward it
  - TITLE: steps back with a sweeping gesture
  - A new timestamped scene: turns to camera
  - GESTURE and stage directions ("Victor walks in"): passed through as written

  The Presenter, Teacher, Anchor and Casual styles set the base motion and expressiveness. Gesture prompts only work on **photo avatars** and on **video avatars that support the Avatar V engine** (✋ badge); other avatars move naturally but ignore direction. The server drops the prompt rather than failing the line.
- **Out-of-date gestures:** a clip's cache key is avatar + voice + text. Moving an effect target doesn't silently re-bill HeyGen; instead the studio shows "Update gestures (N)" to re-render just those lines.

## Architecture

- `src/lib/parser.ts`: the script parser. Its text output is identical to the API's; keep it in sync with `directorai-plugin/src/parser.js`.
- `src/lib/effects.ts`, `render.ts`: effect timing and the frame compositor. The preview and the export use the same code.
- `src/lib/player.ts`: the clock that syncs base video, cleaned audio, music, avatar lines and B-roll.
- `src/lib/export.ts`, `video.ts`, `audio.ts`: MediaRecorder export; ffmpeg.wasm (from jsDelivr, loaded on first use) for MP4 finishing, MP3 mixing and noise reduction.
- `src/lib/storage.ts`: autosave and IndexedDB media.
- `src/lib/gestures.ts`: turns scene directions into a HeyGen motion prompt per line.
- `functions/api/*`: Cloudflare Pages Functions. HeyGen (`/api/avatar/looks`, `voices`, `photo`, `videos`, `media`), `/api/tts` (Workers AI), `/api/assist` and `/api/translate` (Claude, `claude-sonnet-4-6`). Every route except `/api/status` requires the studio access code.

API keys never reach the browser. They're Cloudflare secrets used only by the Functions.

## Export notes

- The export renders in real time, so keep the tab open and visible.
- Chrome/Edge on Windows and Mac, and Safari, record H.264 + AAC directly.
- Chrome on Linux records H.264 + Opus; the audio is converted to AAC in seconds.
- Firefox records WebM only. MP4 needs a full re-encode (about 5× the video length), and a "Save WebM now" button skips it.
- Over 8 minutes, the recording is saved without conversion (browser memory limit), at a lower bitrate.

## Develop & deploy

```bash
npm install
cp .dev.vars.example .dev.vars   # local secrets
npm run build && npx wrangler pages dev dist   # app + /api at http://localhost:8788
npm run check                    # type-check + parser tests
npm run deploy                   # build + deploy to Cloudflare Pages (directorai-web)
```

Secrets (set per environment; add `--env preview` for preview deployments):
`npx wrangler pages secret put HEYGEN_API_KEY | ANTHROPIC_API_KEY | APP_ACCESS_CODE --project-name directorai-web`.

Preview first: `npm run build && npx wrangler pages deploy dist --project-name directorai-web --branch preview` → https://preview.directorai-web.pages.dev

## Coming in v2

- Word-level gesture timing (HeyGen's API takes one motion prompt per clip)
- Custom voice cloning from uploaded audio
- Background remover for the presenter photo
- Green screen replacement (WebGL)
- Share preview links (needs cloud video storage)
- Faster-than-real-time export that also works in background tabs
