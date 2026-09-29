/**
 * Video helpers and ffmpeg.wasm operations.
 * The ffmpeg core (~30 MB) is fetched from jsDelivr the first time it's
 * needed, so it doesn't slow down page load or count against Pages' file limit.
 */
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

const CORE_BASE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";

let ffmpegPromise: Promise<FFmpeg> | null = null;

export function loadFFmpeg(): Promise<FFmpeg> {
  ffmpegPromise ??= (async () => {
    const ffmpeg = new FFmpeg();
    await ffmpeg.load({
      coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm")
    });
    return ffmpeg;
  })().catch(err => {
    ffmpegPromise = null;
    throw new Error(`Could not load the video engine (ffmpeg.wasm). Check your connection. ${err instanceof Error ? err.message : ""}`);
  });
  return ffmpegPromise;
}

/**
 * Run an ffmpeg command. Progress comes from the "time=" in ffmpeg's log against
 * the known output length — MediaRecorder WebM files carry no duration, so
 * ffmpeg's own progress event stays at 0. Aborting terminates the worker.
 */
export async function runWithProgress(
  ffmpeg: FFmpeg, args: string[], totalSeconds: number, onProgress?: (p: number) => void, signal?: AbortSignal
) {
  const logs: string[] = [];
  const logHandler = ({ message }: { message: string }) => {
    logs.push(message);
    if (logs.length > 30) logs.shift();
    const time = message.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (time && totalSeconds > 0) {
      const done = Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]);
      onProgress?.(Math.min(1, Math.max(0, done / totalSeconds)));
    }
  };
  const onAbort = () => {
    ffmpeg.terminate();
    ffmpegPromise = null;
  };
  ffmpeg.on("log", logHandler);
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const code = await ffmpeg.exec(args).catch(err => {
      if (signal?.aborted) throw new Error("Export cancelled");
      throw err;
    });
    if (signal?.aborted) throw new Error("Export cancelled");
    if (code !== 0) {
      const reason = logs.filter(l => /error|invalid|unknown|not found|failed|unrecognized/i.test(l)).slice(-2).join(" · ");
      throw new Error(`Video conversion failed (ffmpeg code ${code})${reason ? `: ${reason}` : ""}`);
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (!signal?.aborted) ffmpeg.off("log", logHandler);
  }
}

export function toBlob(data: Uint8Array | string, type: string): Blob {
  if (typeof data === "string") return new Blob([data], { type });
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return new Blob([copy.buffer], { type });
}

/**
 * Turn a browser recording into an H.264 + AAC MP4.
 * "remux" copies the H.264 video untouched and only encodes the audio (fast);
 * "transcode" re-encodes the video too (slow — only for browsers that can't record H.264).
 */
export async function toMp4(
  input: Blob, ext: string, mode: "remux" | "transcode", totalSeconds: number,
  onProgress?: (p: number) => void, signal?: AbortSignal
): Promise<Blob> {
  const ffmpeg = await loadFFmpeg();
  const inName = `in.${ext}`;
  await ffmpeg.writeFile(inName, await fetchFile(input));
  const video = mode === "remux"
    ? ["-c:v", "copy"]
    : ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p"];
  await runWithProgress(ffmpeg, [
    "-i", inName, ...video, "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "out.mp4"
  ], totalSeconds, onProgress, signal);
  const data = await ffmpeg.readFile("out.mp4");
  await ffmpeg.deleteFile(inName);
  await ffmpeg.deleteFile("out.mp4");
  return toBlob(data, "video/mp4");
}

/** Mix avatar clip audio at their start times into one MP3 covering the whole program */
export async function mixClipsToMp3(
  clips: { blob: Blob; start: number }[], totalSeconds: number, rate: number, onProgress?: (p: number) => void
): Promise<Blob> {
  if (clips.length === 0) throw new Error("Generate the avatar voice first — there's no voiceover audio yet.");
  const ffmpeg = await loadFFmpeg();
  const args: string[] = [];
  for (let i = 0; i < clips.length; i++) {
    await ffmpeg.writeFile(`clip${i}.mp4`, await fetchFile(clips[i].blob));
    args.push("-i", `clip${i}.mp4`);
  }
  const delays = clips.map((c, i) => {
    const ms = Math.max(0, Math.round(c.start * 1000));
    return `[${i}:a]${rate !== 1 ? `atempo=${rate},` : ""}adelay=${ms}|${ms}[a${i}]`;
  });
  const mix = `${clips.map((_, i) => `[a${i}]`).join("")}amix=inputs=${clips.length}:normalize=0:duration=longest[mixed]`;
  args.push(
    "-filter_complex", `${delays.join(";")};${mix}`, "-map", "[mixed]",
    "-t", totalSeconds.toFixed(2), "-c:a", "libmp3lame", "-b:a", "192k", "voiceover.mp3"
  );
  await runWithProgress(ffmpeg, args, totalSeconds, onProgress);
  const data = await ffmpeg.readFile("voiceover.mp3");
  for (let i = 0; i < clips.length; i++) await ffmpeg.deleteFile(`clip${i}.mp4`);
  await ffmpeg.deleteFile("voiceover.mp3");
  return toBlob(data, "audio/mpeg");
}

export function createAudio(src: string): HTMLAudioElement {
  const a = document.createElement("audio");
  a.src = src;
  a.preload = "auto";
  return a;
}

export function createVideo(src: string, muted = false): HTMLVideoElement {
  const v = document.createElement("video");
  v.src = src;
  v.preload = "auto";
  v.playsInline = true;
  v.muted = muted;
  return v;
}

/** Resolves once metadata is loaded. Handles WebM recordings that report Infinity duration. */
export function videoReady(v: HTMLVideoElement): Promise<number> {
  return new Promise((resolve, reject) => {
    const done = () => {
      if (Number.isFinite(v.duration)) return resolve(v.duration);
      // Chrome's MediaRecorder WebM has no duration header — seek far to force it
      const onUpdate = () => {
        if (!Number.isFinite(v.duration)) return;
        v.removeEventListener("timeupdate", onUpdate);
        v.currentTime = 0;
        resolve(v.duration);
      };
      v.addEventListener("timeupdate", onUpdate);
      v.currentTime = 1e101;
    };
    if (v.readyState >= 1) done();
    else {
      v.addEventListener("loadedmetadata", done, { once: true });
      v.addEventListener("error", () => reject(new Error("This video format isn't supported by your browser.")), { once: true });
    }
  });
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = src;
  });
}

export function readAsDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Downscale an image file to a small JPEG data URL (for thumbnails kept in localStorage) */
export async function thumbnail(file: Blob, max = 384): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}
