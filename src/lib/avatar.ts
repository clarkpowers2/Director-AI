/**
 * Avatar voice + video generation. All calls go through this app's /api
 * functions, which hold the HeyGen and Anthropic keys — nothing secret reaches the browser.
 *
 *  heygen   → one avatar video per voiceover line via /api/avatar/render (the server
 *             picks the renderer; full body, gestures, transparent when supported)
 *  animated → free voice per line (Workers AI), the photo is animated from its loudness
 */
import {
  gestureSupport, VOICE_PRESETS, sceneClipKey,
  type AvatarClip, type AvatarSettings, type BackgroundMode, type HeyGenLook, type RenderQuality, type TargetRect, type VoiceSettings
} from "./project.ts";
import type { ParseResult, Scene } from "./parser.ts";
import { lineDirections, motionPlan, type MotionPlan } from "./gestures.ts";
import { audioEnvelope } from "./audio.ts";
import { putClipRecord } from "./storage.ts";

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

/** Sanitized provider diagnostics the server attaches to a failure — never credentials */
export interface ErrorDetail {
  provider?: string; endpoint?: string; http?: number; code?: string; message?: string;
  kind?: string; jobId?: string; requestId?: string; providerJobId?: string; retryAfter?: number;
}

export class ApiError extends Error {
  status: number;
  /** quota | rate_limit | auth | invalid | not_found | provider | network | not_configured */
  kind: string | null;
  detail: ErrorDetail | null;
  constructor(message: string, status: number, kind: string | null = null, detail: ErrorDetail | null = null) {
    super(message);
    this.status = status;
    this.kind = kind;
    this.detail = detail;
  }
}

/** Plain-English fallback messages — the server already words its own errors */
function fallbackMessage(status: number): string {
  if (status === 0) return "You're offline. Parsing still works; avatar voices and AI features need a connection.";
  if (status === 401) return "This browser isn't authorized to use avatar and AI features.";
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
    const body = await res.json().catch(() => ({})) as { error?: string; kind?: string; detail?: ErrorDetail };
    const message = typeof body.error === "string" && body.error.length < 300 && !/[{}<>]/.test(body.error) ? body.error : fallbackMessage(res.status);
    // a 401 from the provider arrives as detail.http 401; a 401 without detail is the studio access code
    const studioAuth = res.status === 401 && !body.detail?.http;
    throw new ApiError(studioAuth ? fallbackMessage(401) : message, res.status, body.kind ?? null, body.detail && typeof body.detail === "object" ? body.detail : null);
  }
  return res;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  return (await request(path, init)).json() as Promise<T>;
}

export interface ServerStatus { heygen: boolean; /** any avatar renderer configured */ avatar: boolean; anthropic: boolean; tts: boolean; accessRequired: boolean }

export async function getServerStatus(): Promise<ServerStatus | null> {
  try {
    const res = await fetch("/api/status");
    return res.ok ? ((await res.json()) as ServerStatus) : null;
  } catch {
    return null;
  }
}

// ---------- HeyGen gallery, voices and photo avatars ----------

export async function fetchLooks(ownership: "public" | "private", token?: string | null): Promise<{ looks: HeyGenLook[]; next: string | null }> {
  const q = new URLSearchParams({ ownership });
  if (token) q.set("token", token);
  return api(`/api/avatar/looks?${q}`);
}

export async function fetchLook(id: string): Promise<HeyGenLook> {
  return api(`/api/avatar/looks/${encodeURIComponent(id)}`);
}

export type LookTab = HeyGenLook["category"] | "all";

export type CatalogPage<T> =
  | { ready: true; items: T[]; total: number; all: number; counts?: Record<HeyGenLook["category"], number>; built: number; refreshing: boolean }
  | { ready: false; progress: { pages: number; items: number }; error: string | null };

/** Search the daily-cached HeyGen avatar library (all ~10,000 looks) */
export async function searchLooks(tab: LookTab, q: string, offset = 0, limit = 60): Promise<CatalogPage<HeyGenLook>> {
  const p = new URLSearchParams({ kind: "looks", tab, q, offset: String(offset), limit: String(limit) });
  const page = await api<CatalogPage<HeyGenLook>>(`/api/avatar/catalog?${p}`);
  // catalog entries are always completed public looks
  if (page.ready) page.items = page.items.map(l => ({ ...l, video: l.video ?? null, tags: l.tags ?? [], status: "completed" }));
  return page;
}

export interface HeyGenVoice { id: string; name: string; language: string; gender: string; preview: string | null; private?: boolean }

export async function searchVoices(f: { q: string; gender: string; language: string; tone: string }, offset = 0, limit = 50): Promise<CatalogPage<HeyGenVoice>> {
  const p = new URLSearchParams({ kind: "voices", ...f, offset: String(offset), limit: String(limit) });
  return api<CatalogPage<HeyGenVoice>>(`/api/avatar/catalog?${p}`);
}

/** Your own photo → a HeyGen photo avatar (supports gesture prompts). Waits until it's ready. */
export async function createPhotoAvatar(photo: Blob, name: string, onStatus?: (s: string) => void): Promise<HeyGenLook> {
  const form = new FormData();
  form.append("image", photo, "presenter.png");
  form.append("name", name);
  onStatus?.("Uploading your photo…");
  const { look_id } = await api<{ look_id: string }>("/api/avatar/photo", { method: "POST", body: form });
  for (let i = 0; i < 100; i++) {
    const look = await fetchLook(look_id);
    if (look.status === "completed") return look;
    if (look.status === "failed") throw new ApiError("The avatar provider couldn't create an avatar from that photo. Use a clear, front-facing portrait.", 422);
    onStatus?.("Building your avatar…");
    await sleep(3000);
  }
  throw new ApiError("Building the avatar is taking a long time. Check again in a few minutes.", 504);
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(new RenderCancelled());
  const id = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => {
    clearTimeout(id);
    reject(new RenderCancelled());
  }, { once: true });
});

/** The user stopped this render */
export class RenderCancelled extends Error {
  constructor() {
    super("Cancelled");
  }
}

// ---------- Avatar renderers (provider-neutral: /api/avatar/render) ----------

export interface ProviderInfo {
  id: string;
  label: string;
  capabilities: { qualities: RenderQuality[]; backgrounds: BackgroundMode[]; gestures: boolean; cancel: boolean; paid: boolean };
}

export async function fetchProviders(): Promise<ProviderInfo[]> {
  return (await api<{ providers: ProviderInfo[] }>("/api/avatar/providers")).providers;
}

export interface RenderOptions {
  /** "auto" = the server's highest-priority renderer */
  provider: string;
  quality: RenderQuality;
  background: BackgroundMode;
  test?: boolean;
}

export interface RenderUpdate { jobId: string; provider: string; status: "queued" | "rendering"; progress: number | null }

interface RenderStarted { jobId: string; provider: string; providerJobId?: string; status: string; alpha: boolean; gestures: boolean }
interface RenderProgress {
  status: string; progress: number | null; mediaUrl: string | null; duration: number | null; error: string | null; detail?: ErrorDetail | null;
}

/** Polling problems that don't mean the render failed — the provider keeps rendering, so keep waiting */
const transient = (err: unknown) => err instanceof ApiError && (err.status === 0 || err.status === 429 || err.status >= 500 || err.kind === "rate_limit" || err.kind === "network");

/** Ask the renderer to stop a job. Returns a note when it can't (it may still use credits). */
export async function cancelRender(jobId: string): Promise<string | null> {
  try {
    const r = await api<{ cancelled: boolean; note: string | null }>(`/api/avatar/render/${encodeURIComponent(jobId)}`, { method: "DELETE" });
    return r.cancelled ? null : r.note;
  } catch {
    return null;
  }
}

/** Render one line through the server's avatar renderer and download the finished clip */
async function renderClip(
  look: HeyGenLook, voice: VoiceSettings, text: string, plan: MotionPlan | null, opts: RenderOptions,
  onUpdate: (u: RenderUpdate) => void, signal?: AbortSignal
): Promise<{ blob: Blob; alpha: boolean; motion: string; provider: string; jobId: string }> {
  const support = gestureSupport(look);
  const started = await api<RenderStarted>("/api/avatar/render", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      avatarId: look.id,
      voiceId: voice.heygenVoice?.id || undefined,
      text,
      provider: opts.provider,
      quality: opts.quality,
      background: opts.background,
      test: !!opts.test,
      ...(plan && support.supported ? { gesture: plan.prompt, expressiveness: plan.expressiveness, engine: support.engine } : {})
    }),
    signal
  });
  const { jobId, provider } = started;
  onUpdate({ jobId, provider, status: "queued", progress: 0 });
  try {
    // Real renders take minutes per line; the mock renderer finishes in seconds
    let hiccups = 0, wait = 0;
    for (let attempt = 0; attempt < 300; attempt++) {
      await sleep(wait || (provider === "mock" ? 1000 : attempt < 6 ? 5000 : 8000), signal);
      wait = 0;
      let st: RenderProgress;
      try {
        st = await api<RenderProgress>(`/api/avatar/render/${encodeURIComponent(jobId)}`, { signal });
        hiccups = 0;
      } catch (err) {
        // A status check failing isn't the render failing: back off and ask again, never re-render
        if (!transient(err) || ++hiccups > 8) throw err;
        wait = Math.min(60_000, ((err as ApiError).detail?.retryAfter ?? 5 * hiccups) * 1000);
        continue;
      }
      if (st.status === "completed" && st.mediaUrl) {
        let blob: Blob | null = null;
        for (let tries = 0; !blob; tries++) {
          try {
            blob = await (await request(st.mediaUrl, { signal })).blob();
          } catch (err) {
            if (!transient(err) || tries >= 3) throw err;
            await sleep(3000 * (tries + 1), signal);
          }
        }
        return { blob, alpha: started.alpha, motion: started.gestures && plan ? plan.prompt : "", provider, jobId };
      }
      if (st.status === "failed") {
        throw new ApiError(st.error ?? "The avatar renderer couldn't render this line. Try rewording it or picking another avatar.", 502, st.detail?.kind ?? "provider", { ...st.detail, jobId });
      }
      if (st.status === "cancelled") throw new RenderCancelled();
      onUpdate({ jobId, provider, status: st.status === "rendering" ? "rendering" : "queued", progress: st.progress });
    }
    throw new ApiError("The avatar renderer took too long on this line. Try again.", 504);
  } catch (err) {
    if (signal?.aborted || err instanceof RenderCancelled || (err as Error)?.name === "AbortError") {
      void cancelRender(jobId);
      throw new RenderCancelled();
    }
    // keep the job ids on every failure, so it can be traced (and isn't mistaken for "never started")
    if (err instanceof ApiError) throw new ApiError(err.message, err.status, err.kind, { ...err.detail, jobId, providerJobId: started.providerJobId });
    throw err;
  }
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

export interface ClipJob { key: string; text: string; scene: Scene; plan: MotionPlan | null }

/** The gesture prompt each line should use right now (avatars that accept gesture direction) */
export function plannedMotion(
  parse: ParseResult, avatar: AvatarSettings, voice: VoiceSettings, targets: Record<string, TargetRect>
): Map<number, MotionPlan> {
  const out = new Map<number, MotionPlan>();
  if (voice.engine !== "heygen" || !gestureSupport(avatar.heygen).supported) return out;
  const byLine = lineDirections(parse);
  for (const scene of parse.scenes) {
    if (scene.spoken) out.set(scene.index, motionPlan(scene, byLine.get(scene.index) ?? [], voice.gesture, targets, avatar.position));
  }
  return out;
}

/**
 * One job per distinct line. By default only lines with no finished clip;
 * `keys` picks exact lines instead (including finished ones — a regeneration);
 * includeStale adds finished clips whose gestures no longer match the script.
 */
export function pendingClipJobs(
  parse: ParseResult, avatar: AvatarSettings, voice: VoiceSettings, clips: Record<string, AvatarClip>,
  targets: Record<string, TargetRect>, includeStale = false, keys?: Set<string>
): ClipJob[] {
  const plans = plannedMotion(parse, avatar, voice, targets);
  const jobs: ClipJob[] = [];
  const seen = new Set<string>();
  for (const scene of parse.scenes) {
    const key = sceneClipKey(avatar, voice, scene.spoken);
    if (!key || seen.has(key)) continue;
    const plan = plans.get(scene.index) ?? null;
    const clip = clips[key];
    if (keys) {
      if (!keys.has(key)) continue;
    } else {
      const stale = clip?.status === "done" && !!plan && clip.motion !== undefined && clip.motion !== "" && clip.motion !== plan.prompt;
      if (clip?.status === "done" && !(includeStale && stale)) continue;
    }
    seen.add(key);
    jobs.push({ key, text: scene.spoken, scene, plan });
  }
  return jobs;
}

export function staleGestureCount(parse: ParseResult, avatar: AvatarSettings, voice: VoiceSettings, clips: Record<string, AvatarClip>, targets: Record<string, TargetRect>): number {
  const all = pendingClipJobs(parse, avatar, voice, clips, targets, true).length;
  const missing = pendingClipJobs(parse, avatar, voice, clips, targets, false).length;
  return all - missing;
}

/** Downloaded clip → a finished AvatarClip (cached in IndexedDB) */
async function finishClip(key: string, blob: Blob, kind: "video" | "audio", extra: Partial<AvatarClip>): Promise<AvatarClip> {
  const { envelope, duration } = await audioEnvelope(blob).catch(() => ({ envelope: undefined, duration: 0 }));
  const url = URL.createObjectURL(blob);
  const finalDuration = duration || (await mediaDuration(url, kind));
  await putClipRecord(key, blob, { kind, duration: finalDuration, envelope, alpha: extra.alpha, motion: extra.motion });
  return { ...extra, key, status: "done", kind, blob, url, duration: finalDuration, envelope, progress: 1 };
}

/**
 * Render the given lines (two at a time). Each job gets its own AbortController in
 * `controllers`, so one line can be cancelled without stopping the rest. A failed
 * line is reported, never retried here — paid retries need the user's say-so.
 */
export async function runClipJobs(
  jobs: ClipJob[], avatar: AvatarSettings, voice: VoiceSettings, opts: RenderOptions,
  update: (key: string, clip: AvatarClip) => void, controllers: Map<string, AbortController>,
  onFinished?: (job: ClipJob, clip: AvatarClip) => void, concurrency = 2
): Promise<{ done: number; failed: number; cancelled: number }> {
  if (voice.engine === "heygen" && !avatar.heygen) throw new ApiError("Pick an avatar first.", 400);
  let next = 0, done = 0, failed = 0, cancelled = 0;
  /** Out of credits or rate-limited: stop starting new renders — the user decides what happens next */
  let halt: string | null = null;
  for (const j of jobs) {
    if (!controllers.has(j.key)) controllers.set(j.key, new AbortController());
    update(j.key, { key: j.key, status: "queued", progress: 0 });
  }

  const finish = (job: ClipJob, clip: AvatarClip) => {
    update(job.key, clip);
    controllers.delete(job.key);
    onFinished?.(job, clip);
  };

  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next++];
      const signal = controllers.get(job.key)?.signal;
      const startedAt = Date.now();
      if (signal?.aborted || halt) {
        cancelled++;
        finish(job, { key: job.key, status: "cancelled", startedAt, error: halt ?? undefined });
        continue;
      }
      let meta: Partial<AvatarClip> = { startedAt, provider: voice.engine === "heygen" ? undefined : "free-voice" };
      update(job.key, { key: job.key, status: "generating", progress: 0, ...meta });
      try {
        let clip: AvatarClip;
        if (voice.engine === "heygen") {
          const r = await renderClip(avatar.heygen!, voice, job.text, job.plan, opts, u => {
            meta = { ...meta, provider: u.provider, jobId: u.jobId };
            update(job.key, { key: job.key, status: "generating", progress: u.progress, ...meta });
          }, signal);
          clip = await finishClip(job.key, r.blob, "video", { ...meta, provider: r.provider, jobId: r.jobId, alpha: r.alpha, motion: r.motion });
        } else {
          clip = await finishClip(job.key, await freeVoice(voice, job.text, signal), "audio", meta);
        }
        done++;
        finish(job, clip);
      } catch (err) {
        if (err instanceof RenderCancelled || signal?.aborted) {
          cancelled++;
          finish(job, { key: job.key, status: "cancelled", ...meta });
        } else {
          failed++;
          const api = err instanceof ApiError ? err : null;
          if (api?.kind === "quota") halt = "Not started: the provider reported the account is out of credits or balance.";
          else if (api?.kind === "rate_limit") halt = "Not started: the provider is rate-limiting requests. Retry when you're ready.";
          finish(job, {
            key: job.key, status: "error", ...meta,
            error: api ? api.message : "This line couldn't be rendered. Try again.",
            errorDetail: api?.detail ? { ...api.detail, kind: api.detail.kind ?? api.kind ?? undefined } : undefined
          });
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return { done, failed, cancelled };
}

export interface TestRenderResult { blob: Blob; url: string; duration: number; provider: string; jobId: string; alpha: boolean }

/** TEST RENDER: a short clip to check avatar, voice and look — never placed on the timeline */
export async function renderTest(
  look: HeyGenLook, voice: VoiceSettings, text: string, opts: RenderOptions,
  onUpdate: (u: RenderUpdate) => void, signal?: AbortSignal
): Promise<TestRenderResult> {
  const r = await renderClip(look, voice, text, null, { ...opts, quality: "preview", test: true }, onUpdate, signal);
  const url = URL.createObjectURL(r.blob);
  return { blob: r.blob, url, duration: await mediaDuration(url, "video"), provider: r.provider, jobId: r.jobId, alpha: r.alpha };
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
