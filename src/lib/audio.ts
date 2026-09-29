/** Audio helpers: loudness envelopes for the animated avatar, and ffmpeg.wasm noise reduction. */
import { fetchFile } from "@ffmpeg/util";
import { loadFFmpeg, runWithProgress, toBlob } from "./video.ts";

export const ENVELOPE_FPS = 30;

/** Loudness per 1/30 s (0..1), normalized to the clip's peak */
export async function audioEnvelope(blob: Blob): Promise<{ envelope: number[]; duration: number }> {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
  const data = buffer.getChannelData(0);
  const step = Math.floor(buffer.sampleRate / ENVELOPE_FPS);
  const env: number[] = [];
  let peak = 0;
  for (let i = 0; i < data.length; i += step) {
    let sum = 0;
    const end = Math.min(data.length, i + step);
    for (let j = i; j < end; j++) sum += data[j] * data[j];
    const rms = Math.sqrt(sum / Math.max(1, end - i));
    env.push(rms);
    peak = Math.max(peak, rms);
  }
  return { envelope: env.map(v => Math.round((peak ? v / peak : 0) * 100) / 100), duration: buffer.duration };
}

/**
 * Noise-reduce an audio track (or the audio of a video) with ffmpeg's FFT denoiser
 * plus a gentle high-pass for rumble. Returns an MP3.
 */
export async function reduceNoise(input: Blob, seconds: number, onProgress?: (p: number) => void): Promise<Blob> {
  const ffmpeg = await loadFFmpeg();
  const ext = (input.type.split("/")[1] || "bin").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "bin";
  const name = `denoise-in.${ext}`;
  await ffmpeg.writeFile(name, await fetchFile(input));
  await runWithProgress(ffmpeg, ["-i", name, "-vn", "-af", "highpass=f=80,afftdn=nf=-25", "-c:a", "libmp3lame", "-b:a", "160k", "denoise-out.mp3"], seconds, onProgress);
  const data = await ffmpeg.readFile("denoise-out.mp3");
  await ffmpeg.deleteFile(name);
  await ffmpeg.deleteFile("denoise-out.mp3");
  return toBlob(data, "audio/mpeg");
}
