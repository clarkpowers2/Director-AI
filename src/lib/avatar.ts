/**
 * Avatar voice + video generation. All calls go through this app's /api
 * functions, which hold the D-ID and Anthropic keys — nothing secret reaches the browser.
 *
 *  did      → D-ID talk per voiceover line (photoreal lip-sync, returns MP4)
 *  animated → free voice per line (Workers AI), the photo is animated from its loudness
 */
import {
  currentPhoto, didVoice, VOICE_PRESETS, sceneClipKey,
  type AvatarClip, type AvatarImage, type AvatarSettings, type VoiceSettings
} from "./project.ts";
import type { Scene } from "./parser.ts";
import { audioEnvelope } from "./audio.ts";
import { getMedia, putClipRecord } from "./storage.ts";

const ACCESS_KEY = "directorai:access-code";

export function getAccessCode(): string {
  try {
    return localStorage.getItem(ACCESS_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setAccessCode(code: string): void {
  try {
    localStorage.setItem(ACCESS_KEY, code);
  } catch {
    // ignore
  }
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Plain-English fallback messages — the server already words its own errors */
function fallbackMessage(status: number): string {
  if (status === 0) return "You're offline. Parsing still works; avatar voices and AI features need a connection.";
  if (status === 401) return "Enter your studio access code in Settings to use avatar and AI features.";
  if (status === 413) return "That file is too large.";
  if (status === 429) return "Too many requests right now. Try again in a minute.";
  if (status === 503) return "This feature isn't set up on the server yet.";
  if (status >= 500) return "The server had a problem. Try again shortly.";
  return "Something went wrong. Try again.";
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { ...(init.headers ?? {}), "X-DirectorAI-Code": getAccessCode() } });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new ApiError(fallbackMessage(0), 0);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    const message = typeof body.error === "string" && body.error.length < 200 && !/[{}<>]/.test(body.error) ? body.error : fallbackMessage(res.status);
    throw new ApiError(res.status === 401 ? fallbackMessage(401) : message, res.status);
  }
  return res;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  return (await request(path, init)).json() as Promise<T>;
}

export interface ServerStatus { did: boolean; anthropic: boolean; tts: boolean; accessRequired: boolean }

export async function getServerStatus(): Promise<ServerStatus | null> {
  try {
    const res = await fetch("/api/status");
    return res.ok ? ((await res.json()) as ServerStatus) : null;
  } catch {
    return null;
  }
}

/** The photo needs a D-ID URL before D-ID can animate it; upload once and remember it */
export async function ensureDidPhoto(photo: AvatarImage): Promise<string> {
  if (photo.didUrl) return photo.didUrl;
  const blob = await getMedia(photo.mediaId);
  if (!blob) throw new ApiError("The presenter photo is missing. Upload it again.", 400);
  const form = new FormData();
  form.append("image", blob, "avatar.png");
  const res = await api<{ url: string }>("/api/avatar/images", { method: "POST", body: form });
  return res.url;
}

interface Talk { id: string; status: string; result_url?: string; error?: { description?: string } }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function didTalk(imageUrl: string, voice: VoiceSettings, text: string, signal?: AbortSignal): Promise<Blob> {
  const v = didVoice(voice);
  const created = await api<Talk>("/api/avatar/talks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source_url: imageUrl, text, voice_id: v.voice_id, style: v.style }),
    signal
  });
  for (let attempt = 0; attempt < 120; attempt++) {
    if (signal?.aborted) throw new ApiError("Cancelled", 0);
    await sleep(attempt < 5 ? 1500 : 3000);
    const talk = await api<Talk>(`/api/avatar/talks/${encodeURIComponent(created.id)}`, { signal });
    if (talk.status === "done" && talk.result_url) {
      return (await request(`/api/avatar/media?url=${encodeURIComponent(talk.result_url)}`, { signal })).blob();
    }
    if (talk.status === "error" || talk.status === "rejected") {
      throw new ApiError("D-ID couldn't animate this line. Try rewording it or using a different photo.", 502);
    }
  }
  throw new ApiError("D-ID took too long. Try again.", 504);
}

async function freeVoice(voice: VoiceSettings, text: string, signal?: AbortSignal): Promise<Blob> {
  const res = await request("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, speaker: VOICE_PRESETS[voice.preset].aura }),
    signal
  });
  return res.blob();
}

export interface ClipJob { key: string; text: string; scene: Scene }

export function pendingClipJobs(scenes: Scene[], avatar: AvatarSettings, voice: VoiceSettings, clips: Record<string, AvatarClip>): ClipJob[] {
  const jobs: ClipJob[] = [];
  const seen = new Set<string>();
  for (const scene of scenes) {
    const key = sceneClipKey(avatar, voice, scene.spoken);
    if (!key || seen.has(key) || clips[key]?.status === "done") continue;
    seen.add(key);
    jobs.push({ key, text: scene.spoken, scene });
  }
  return jobs;
}

/**
 * Generate every missing line. For D-ID, uploads the photo first and reports the
 * resulting URL through onPhotoUploaded so it's saved with the project.
 */
export async function runClipJobs(
  jobs: ClipJob[], avatar: AvatarSettings, voice: VoiceSettings,
  update: (key: string, clip: AvatarClip) => void,
  onPhotoUploaded: (didUrl: string) => void,
  signal?: AbortSignal, concurrency = 2
): Promise<{ done: number; failed: number }> {
  let imageUrl = "";
  if (voice.engine === "did") {
    const photo = currentPhoto(avatar);
    if (!photo) throw new ApiError("Add a presenter photo first.", 400);
    imageUrl = await ensureDidPhoto(photo);
    if (!photo.didUrl) onPhotoUploaded(imageUrl);
  }
  let next = 0, done = 0, failed = 0;
  jobs.forEach(j => update(j.key, { key: j.key, status: "queued" }));

  async function worker() {
    while (next < jobs.length && !signal?.aborted) {
      const job = jobs[next++];
      update(job.key, { key: job.key, status: "generating" });
      try {
        const blob = voice.engine === "did" ? await didTalk(imageUrl, voice, job.text, signal) : await freeVoice(voice, job.text, signal);
        const kind = voice.engine === "did" ? "video" : "audio";
        const { envelope, duration } = await audioEnvelope(blob).catch(() => ({ envelope: undefined, duration: 0 }));
        const url = URL.createObjectURL(blob);
        const finalDuration = duration || (await mediaDuration(url, kind));
        await putClipRecord(job.key, blob, { kind, duration: finalDuration, envelope });
        update(job.key, { key: job.key, status: "done", kind, blob, url, duration: finalDuration, envelope });
        done++;
      } catch (err) {
        update(job.key, { key: job.key, status: "error", error: err instanceof ApiError ? err.message : "This line couldn't be generated. Try again." });
        failed++;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return { done, failed };
}

function mediaDuration(url: string, kind: "video" | "audio"): Promise<number> {
  return new Promise(resolve => {
    const el = document.createElement(kind);
    el.preload = "metadata";
    el.onloadedmetadata = () => resolve(Number.isFinite(el.duration) ? el.duration : 0);
    el.onerror = () => resolve(0);
    el.src = url;
  });
}
