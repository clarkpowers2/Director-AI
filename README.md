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
| Photoreal lip-sync (D-ID) | The photo lip-syncs every word with natural head movement; tone uses Microsoft speaking styles | `DID_API_KEY`, D-ID credits |
| Animated (free) | Cloudflare Workers AI voice (Deepgram Aura); the photo breathes when idle and moves with the loudness of the speech. No lip movement. | Workers AI binding (on by default) |

In both engines, the avatar reacts to the script: it leans toward POINTS TO / ZOOM / CALLOUT targets (with a pointing beam for POINTS TO) and steps aside for TITLE cards. Real arm gestures need a full-body avatar platform and are planned for v2.

## Architecture

- `src/lib/parser.ts`: the script parser. Its text output is identical to the API's; keep it in sync with `directorai-plugin/src/parser.js`.
- `src/lib/effects.ts`, `render.ts`: effect timing and the frame compositor. The preview and the export use the same code.
- `src/lib/player.ts`: the clock that syncs base video, cleaned audio, music, avatar lines and B-roll.
- `src/lib/export.ts`, `video.ts`, `audio.ts`: MediaRecorder export; ffmpeg.wasm (from jsDelivr, loaded on first use) for MP4 finishing, MP3 mixing and noise reduction.
- `src/lib/storage.ts`: autosave and IndexedDB media.
- `functions/api/*`: Cloudflare Pages Functions. The D-ID proxy, `/api/tts` (Workers AI), `/api/assist` and `/api/translate` (Claude, `claude-sonnet-4-6`). Every route except `/api/status` requires the studio access code.

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

Secrets: `npx wrangler pages secret put DID_API_KEY | ANTHROPIC_API_KEY | APP_ACCESS_CODE --project-name directorai-web`.

## Coming in v2

- Real arm/body gestures (needs a full-body avatar provider)
- Custom voice cloning from uploaded audio
- Background remover for the presenter photo
- Green screen replacement (WebGL)
- Share preview links (needs cloud video storage)
- Faster-than-real-time export that also works in background tabs
