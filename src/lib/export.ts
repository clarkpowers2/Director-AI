/**
 * Export: full video (canvas render + MediaRecorder → MP4 or WebM), voiceover MP3,
 * scene directions PDF, and SRT captions.
 */
import { EFFECT_DURATION, TARGETED, timedEffects } from "./effects.ts";
import { formatSeconds } from "./parser.ts";
import { Player } from "./player.ts";
import { emptyMedia, renderFrame, videoFrame } from "./render.ts";
import { sceneClipKey, speechSchedule, SPEED_RATE, targetKey, type RenderState } from "./project.ts";
import { createAudio, createVideo, loadImage, mixClipsToMp3, toMp4, videoReady } from "./video.ts";

export type Resolution = "720p" | "1080p" | "4k";
export type Format = "mp4" | "webm";
export const RESOLUTIONS: Record<Resolution, { w: number; h: number; label: string; avc: string; bitrate: number; longBitrate: number }> = {
  "720p": { w: 1280, h: 720, label: "720p HD", avc: "avc1.64001f", bitrate: 5_000_000, longBitrate: 2_500_000 },
  "1080p": { w: 1920, h: 1080, label: "1080p Full HD", avc: "avc1.640028", bitrate: 10_000_000, longBitrate: 4_500_000 },
  "4k": { w: 3840, h: 2160, label: "4K UHD", avc: "avc1.640033", bitrate: 35_000_000, longBitrate: 14_000_000 }
};

/** Resolution labels use the frame height; retain the selected project's aspect ratio. */
export function outputDimensions(res: Resolution, format: "16:9" | "9:16" | "1:1"): { w: number; h: number } {
  const h = RESOLUTIONS[res].h;
  if (format === "9:16") return { w: Math.round(h * 9 / 16), h };
  if (format === "1:1") return { w: h, h };
  return { w: RESOLUTIONS[res].w, h };
}

/** An export failure with a message that's safe to show as-is */
export class ExportError extends Error {}

/** Beyond this, the browser can't hold the recording in ffmpeg.wasm's memory to convert it */
const LONG_VIDEO_SECONDS = 8 * 60;

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * How the recording becomes the chosen file:
 *  direct    — the browser records it as-is (MP4 H.264+AAC on Chrome/Edge Windows & Mac and Safari; any WebM)
 *  remux     — Chrome on Linux records H.264 with Opus audio; ffmpeg.wasm converts just the audio (fast)
 *  transcode — no H.264 recording at all (Firefox); ffmpeg.wasm re-encodes everything (slow)
 */
type RecordMode = "direct" | "remux" | "transcode";

function pickRecording(res: Resolution, format: Format): { mime: string; mode: RecordMode; ext: string } {
  if (typeof MediaRecorder === "undefined" || typeof HTMLCanvasElement.prototype.captureStream !== "function") {
    throw new ExportError("This browser can't record video. Use a current Chrome, Edge, Firefox, or Safari 14.1 or newer.");
  }
  const avc = RESOLUTIONS[res].avc;
  const webm = [
    { mime: "video/webm;codecs=vp9,opus", ext: "webm" },
    { mime: "video/webm;codecs=vp8,opus", ext: "webm" },
    { mime: "video/webm", ext: "webm" }
  ];
  const candidates: { mime: string; mode: RecordMode; ext: string }[] = format === "webm"
    ? webm.map(c => ({ ...c, mode: "direct" as const }))
    : [
      { mime: `video/mp4;codecs=${avc},mp4a.40.2`, mode: "direct", ext: "mp4" },
      { mime: "video/mp4;codecs=avc1,mp4a.40.2", mode: "direct", ext: "mp4" },
      { mime: `video/mp4;codecs=${avc},opus`, mode: "remux", ext: "mp4" },
      { mime: "video/mp4;codecs=avc1,opus", mode: "remux", ext: "mp4" },
      { mime: `video/x-matroska;codecs=${avc},opus`, mode: "remux", ext: "mkv" },
      ...webm.map(c => ({ ...c, mode: "transcode" as const }))
    ];
  const pick = candidates.find(c => MediaRecorder.isTypeSupported(c.mime));
  if (!pick) throw new ExportError(format === "webm"
    ? "This browser can't record WebM. Choose MP4 instead."
    : "This browser can't record video. Use a current Chrome, Edge, Firefox or Safari.");
  return pick;
}

export interface ExportCallbacks {
  onStatus: (message: string) => void;
  onProgress: (fraction: number) => void;
  /** The raw recording, offered while a slow conversion runs */
  onRecorded?: (blob: Blob, ext: string) => void;
}

export interface ExportSources {
  base: string | null;
  cleanedAudio: string | null;
  music: string | null;
  broll: Map<string, string>;
  photo: string | null;
}

export interface ExportResult { blob: Blob; ext: string; note?: string }

/**
 * Renders the program in real time into a canvas and records it. Real time means a
 * 2-minute video takes about 2 minutes; keep the tab open and visible.
 */
export async function exportVideo(
  state: RenderState, sources: ExportSources, res: Resolution, format: Format, cb: ExportCallbacks, signal?: AbortSignal
): Promise<ExportResult> {
  const { w: W, h: H } = outputDimensions(res, state.project.format ?? "16:9");
  const long = state.timing.total > LONG_VIDEO_SECONDS;
  const bitrate = long ? RESOLUTIONS[res].longBitrate : RESOLUTIONS[res].bitrate;
  const { video: vset } = state.project;
  cb.onStatus("Preparing media...");
  cb.onProgress(0);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  // Audio mix: one gain per category, matching the preview's volume sliders
  const audio = new AudioContext();
  await audio.resume();
  const dest = audio.createMediaStreamDestination();
  const bus = (volume: number) => {
    const g = audio.createGain();
    g.gain.value = volume;
    g.connect(dest);
    return g;
  };
  const videoBus = bus(vset.volumes.video), voiceBus = bus(vset.volumes.voice), musicBus = bus(vset.volumes.music);
  const route = (el: HTMLMediaElement, to: GainNode) => audio.createMediaElementSource(el).connect(to);
  // Keep the audio track flowing even when silent, or the WebM recorder writes an empty file
  const silence = audio.createGain();
  silence.gain.value = 0;
  const tone = audio.createOscillator();
  tone.connect(silence).connect(dest);
  tone.start();

  const media = emptyMedia();
  if (sources.base) {
    media.base = createVideo(sources.base);
    if (sources.cleanedAudio && vset.cleanBaseAudio) {
      media.base.muted = true;
      media.baseAudio = createAudio(sources.cleanedAudio);
      route(media.baseAudio, videoBus);
    } else {
      route(media.base, videoBus);
    }
  }
  if (sources.music) {
    media.music = createAudio(sources.music);
    route(media.music, musicBus);
  }
  for (const b of state.project.broll) {
    const url = sources.broll.get(b.id);
    if (url) media.broll.set(b.id, createVideo(url, true));
  }
  const needed = new Set(
    (state.parse?.scenes ?? []).map(s => sceneClipKey(state.project.avatar, state.project.voice, s.spoken)).filter((k): k is string => !!k)
  );
  for (const [key, clip] of Object.entries(state.clips)) {
    if (clip.status !== "done" || !clip.url || !needed.has(key)) continue;
    const el = clip.kind === "audio" ? createAudio(clip.url) : createVideo(clip.url);
    route(el, voiceBus);
    media.clips.set(key, el);
  }
  if (state.project.avatar.enabled && sources.photo) media.avatarPhoto = await loadImage(sources.photo);
  if (state.project.branding.logo) media.logo = await loadImage(state.project.branding.logo);
  const videos = [media.base, ...media.broll.values(), ...[...media.clips.values()].filter(e => e instanceof HTMLVideoElement)]
    .filter((v): v is HTMLVideoElement => v instanceof HTMLVideoElement);
  await Promise.all(videos.map(videoReady));
  // Decode a first frame of every avatar clip before recording, so the avatar is
  // never missing while a clip's decoder spins up (transparent VP9 decodes in software)
  await Promise.all([...media.clips.values()].filter((v): v is HTMLVideoElement => v instanceof HTMLVideoElement).map(primeFrame));
  await document.fonts.load(`700 40px "${state.project.branding.font}"`).catch(() => {});

  const effects = timedEffects(state.parse, state.project.targets, state.project.effectStyles);
  const player = new Player(() => state, media);
  player.useElementVolume = false;
  player.seek(0);
  await new Promise(r => setTimeout(r, 300)); // let the first frames decode

  const { mime, mode, ext } = pickRecording(res, format);
  const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate, audioBitsPerSecond: 192_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>(resolve => (recorder.onstop = () => resolve()));

  cb.onStatus("Applying effects...");
  recorder.start(1000);
  player.play();

  await new Promise<void>((resolve, reject) => {
    const frame = () => {
      if (signal?.aborted) {
        player.pause();
        return reject(new ExportError("Export cancelled."));
      }
      const running = player.tick();
      renderFrame(ctx, W, H, player.t, state, media, effects);
      cb.onProgress(player.t / player.total);
      if (player.t > state.timing.intro + 0.5) cb.onStatus("Rendering final video...");
      if (!running) return resolve();
      setTimeout(frame, 1000 / 30);
    };
    frame();
  }).finally(() => {
    if (recorder.state !== "inactive") recorder.stop();
  });
  await stopped;
  await audio.close();

  const recorded = new Blob(chunks, { type: mime.split(";")[0] });
  if (mode === "direct") return { blob: recorded, ext };

  if (long) {
    // Too large to convert in the browser — hand over the recording as-is
    return {
      blob: recorded, ext,
      note: mode === "remux"
        ? "Long video: saved as MP4 (H.264) with Opus audio, which plays in browsers, VLC and YouTube. Some desktop editors need AAC audio."
        : "Long video: this browser can't record MP4, so it's saved as WebM. Use Chrome, Edge or Safari for MP4."
    };
  }

  cb.onProgress(0);
  if (mode === "remux") {
    cb.onStatus("Finalizing MP4 (converting audio to AAC)...");
    return { blob: await convert(recorded, ext, "remux", state.timing.total, cb, signal), ext: "mp4" };
  }
  cb.onRecorded?.(recorded, ext);
  cb.onStatus("Converting to MP4 (H.264)... this browser can't record MP4, so this takes several times the video length. Chrome, Edge or Safari are much faster.");
  return { blob: await convert(recorded, ext, "transcode", state.timing.total, cb, signal), ext: "mp4" };
}

async function convert(recorded: Blob, ext: string, mode: "remux" | "transcode", seconds: number, cb: ExportCallbacks, signal?: AbortSignal): Promise<Blob> {
  try {
    return await toMp4(recorded, ext, mode, seconds, p => cb.onProgress(p), signal);
  } catch (err) {
    if (signal?.aborted) throw new ExportError("Export cancelled.");
    if (err instanceof Error && /load the video engine/.test(err.message)) throw new ExportError("Couldn't load the video converter. Check your connection, or export as WebM.");
    throw new ExportError("Converting to MP4 didn't work in this browser. Export as WebM, or use Chrome, Edge or Safari.");
  }
}

function primeFrame(v: HTMLVideoElement): Promise<void> {
  return new Promise(resolve => {
    const done = () => {
      videoFrame(v); // keep this frame as the clip's fallback
      resolve();
    };
    const timer = setTimeout(done, 4000);
    v.addEventListener("seeked", () => {
      clearTimeout(timer);
      if (v.readyState >= 2) done();
      else v.addEventListener("loadeddata", done, { once: true });
    }, { once: true });
    v.currentTime = 0.05;
  });
}

/** Avatar voiceover lines mixed at their timestamps (at the chosen voice speed) into one MP3 */
export async function exportAudio(state: RenderState, cb: ExportCallbacks): Promise<Blob> {
  cb.onStatus("Mixing avatar audio...");
  const { voice } = state.project;
  const clips = speechSchedule(state.parse, state.project, state.clips).flatMap(({ clip, start }) =>
    clip?.status === "done" && clip.blob ? [{ blob: clip.blob, start: state.timing.intro + start }] : []
  );
  if (clips.length === 0) throw new ExportError("Generate the avatar voice first — there's no voiceover audio yet.");
  try {
    return await mixClipsToMp3(clips, state.timing.total, SPEED_RATE[voice.speed], p => cb.onProgress(p));
  } catch {
    throw new ExportError("Mixing the voiceover audio failed. Check your connection (the audio engine loads on first use) and try again.");
  }
}

function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000), m = Math.floor(ms / 60_000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}

/** SRT in the captions language (original or a translation) */
export function buildSrt(state: RenderState): string {
  const { translations, branding } = state.project;
  const lang = branding.captions.language;
  return speechSchedule(state.parse, state.project, state.clips).map((slot, i) => {
    const scene = state.parse!.scenes[slot.sceneIndex];
    const start = state.timing.intro + slot.start;
    const length = slot.length;
    const text = lang !== "original" ? translations[lang]?.[scene.spoken] ?? scene.spoken : scene.spoken;
    return `${i + 1}\n${srtTime(start)} --> ${srtTime(start + length)}\n${text}\n`;
  }).join("\n");
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export async function buildPdf(state: RenderState): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const navy = hexToRgb(state.project.branding.primary);
  const gold = hexToRgb(state.project.branding.accent);
  const margin = 48;

  const header = () => {
    doc.setFillColor(...navy);
    doc.rect(0, 0, pageW, 84, "F");
    doc.setTextColor(...gold);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text("SCENE DIRECTIONS", margin, 44);
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "normal");
    doc.text(`DirectorAI™ | HCCGSA LLC  ·  Project: ${state.project.name}  ·  Presenter: ${state.project.avatar.label}  ·  Length: ${formatSeconds(state.timing.total)}`, margin, 64);
  };
  header();

  let y = 116;
  const newPageIfNeeded = (h: number) => {
    if (y + h > pageH - 48) {
      doc.addPage();
      header();
      y = 116;
    }
  };

  doc.setTextColor(40, 40, 40);
  doc.setFontSize(10);
  doc.text("Times include the intro card, if enabled. Target = position on the base video (left, top, width, height).", margin, y);
  y += 22;

  const cols = [margin, margin + 64, margin + 156, margin + 400];
  doc.setFillColor(...gold);
  doc.rect(margin - 6, y - 13, pageW - 2 * margin + 12, 20, "F");
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...navy);
  ["TIME", "EFFECT", "DIRECTION", "TARGET"].forEach((h, i) => doc.text(h, cols[i], y));
  y += 20;

  doc.setFont("helvetica", "normal");
  doc.setTextColor(30, 30, 30);
  const scenes = state.parse?.scenes ?? [];
  for (const scene of scenes) {
    for (const d of scene.directions) {
      const lines = doc.splitTextToSize(d.display, cols[3] - cols[2] - 10) as string[];
      const rowH = Math.max(18, lines.length * 13 + 5);
      newPageIfNeeded(rowH);
      const t = scene.start === null ? `Scene ${scene.index + 1}` : `${scene.estimated ? "~" : ""}${formatSeconds(state.timing.intro + scene.start)}`;
      const target = TARGETED.has(d.type) ? state.project.targets[targetKey(d)] : undefined;
      doc.text(t, cols[0], y);
      doc.text(`${d.type}${EFFECT_DURATION[d.type] ? ` (${EFFECT_DURATION[d.type]}s)` : ""}`, cols[1], y);
      doc.text(lines, cols[2], y);
      doc.text(target ? `${Math.round(target.x * 100)}%, ${Math.round(target.y * 100)}%, ${Math.round(target.w * 100)}×${Math.round(target.h * 100)}%` : TARGETED.has(d.type) ? "center (default)" : "—", cols[3], y);
      doc.setDrawColor(225, 225, 225);
      doc.line(margin - 6, y + rowH - 12, pageW - margin + 6, y + rowH - 12);
      y += rowH;
    }
  }

  y += 16;
  newPageIfNeeded(40);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...navy);
  doc.setFontSize(13);
  doc.text("VOICEOVER", margin, y);
  y += 20;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);
  for (const scene of scenes.filter(s => s.spoken)) {
    const lines = doc.splitTextToSize(scene.spoken, pageW - 2 * margin - 70) as string[];
    const rowH = lines.length * 13 + 8;
    newPageIfNeeded(rowH);
    doc.text(scene.start === null ? "" : formatSeconds(state.timing.intro + scene.start), margin, y);
    doc.text(lines, margin + 70, y);
    y += rowH;
  }

  return doc.output("blob");
}
