/**
 * HeyGen v3 behind the AvatarProvider contract. One HeyGen video per voiceover
 * line; asks for a transparent WebM first and steps down to MP4 when the avatar
 * isn't trained with matting, and drops gesture direction when the avatar can't take it.
 * Validation rejections like these are refused before rendering, so the retry costs nothing.
 */
import { errorKind, heygen, sanitize, type HeyGenFailure } from "../shared";
import { ProviderError, type AvatarProvider, type RenderProgress, type RenderStatus } from "./provider";

const RESOLUTION = { preview: "720p", standard: "1080p" } as const;

interface Video {
  id?: string; status: string; video_url?: string | null; duration?: number | null;
  failure_code?: string | null; failure_message?: string | null;
}

async function fail(res: HeyGenFailure): Promise<never> {
  // shared.heygen already turned HeyGen's error into a plain-English message plus a sanitized detail
  const body = (await res.response.clone().json().catch(() => ({}))) as { error?: string };
  throw new ProviderError(body.error ?? "The avatar provider couldn't process that request.", res.response.status, res.detail);
}

function status(s: string): RenderStatus {
  if (s === "completed") return "completed";
  if (s === "failed") return "failed";
  if (s === "processing") return "rendering";
  return "queued"; // pending, waiting
}

export const HeyGenProvider: AvatarProvider = {
  id: "heygen",
  label: "Studio renderer",
  capabilities: { qualities: ["preview", "standard"], backgrounds: ["transparent", "provider"], gestures: true, cancel: false, paid: true },

  configured: env => !!env.HEYGEN_API_KEY,

  async renderAvatarScene(env, req) {
    if (req.quality === "high") throw new ProviderError("This renderer doesn't offer High quality. Use Standard (1080p).", 400);
    const payload: Record<string, unknown> = {
      type: "avatar",
      avatar_id: req.avatarId,
      script: req.text,
      title: `${req.test ? "DirectorAI test" : "DirectorAI"} · ${req.label}`.slice(0, 80),
      resolution: RESOLUTION[req.quality],
      aspect_ratio: "16:9"
    };
    if (req.voiceId) payload.voice_id = req.voiceId;
    const m = req.motion;
    if (m?.prompt) {
      payload.motion_prompt = m.prompt.slice(0, 500);
      if (m.expressiveness && m.engine !== "avatar_v") payload.expressiveness = m.expressiveness;
    }

    // v3 renders with Avatar IV unless told otherwise, and many library avatars only support
    // older engines ("This video avatar does not support Avatar IV") — ask the avatar (free GET).
    const look = await heygen<{ supported_api_engines?: string[] }>(env, `/v3/avatars/looks/${req.avatarId}`);
    if (!look.ok && look.detail.http === 404) throw new ProviderError("That avatar isn't available through the provider's API. Pick another avatar.", 400, look.detail);
    const engines = look.ok ? look.data.supported_api_engines ?? [] : [];
    const baseEngine = !engines.length || engines.includes("avatar_iv") ? null
      : engines.includes("avatar_iii") ? "avatar_iii" : engines[0];
    const motionEngine = m?.engine === "avatar_v" && (!engines.length || engines.includes("avatar_v")) ? "avatar_v" : null;

    const create = (format: "webm" | "mp4", withMotion: boolean) => {
      const body: Record<string, unknown> = { ...payload, output_format: format };
      if (!withMotion) {
        delete body.motion_prompt;
        delete body.expressiveness;
      }
      const engine = withMotion && motionEngine ? motionEngine : baseEngine;
      if (engine) body.engine = { type: engine };
      return heygen<{ video_id: string }>(env, "/v3/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
    };

    let format: "webm" | "mp4" = req.background === "transparent" ? "webm" : "mp4";
    let gestures = !!payload.motion_prompt;
    let res = await create(format, gestures);
    if (!res.ok && format === "webm" && /matting|webm/i.test(`${res.code} ${res.message}`)) {
      format = "mp4";
      res = await create(format, gestures);
    }
    if (!res.ok && gestures && /motion_prompt|expressiveness|engine/i.test(`${res.code} ${res.message}`)) {
      gestures = false;
      res = await create(format, gestures);
    }
    if (!res.ok) return fail(res);
    return { providerJobId: res.data.video_id, status: "queued", alpha: format === "webm", gestures };
  },

  async getRenderStatus(env, id): Promise<RenderProgress> {
    const res = await heygen<Video>(env, `/v3/videos/${id}`);
    if (!res.ok) return fail(res);
    const v = res.data;
    const s = status(v.status);
    const failed = s === "failed";
    const code = failed ? sanitize(v.failure_code ?? "", env) : "";
    const message = failed ? sanitize(v.failure_message ?? "", env) : "";
    return {
      status: s,
      progress: null, // HeyGen doesn't report progress
      // the studio downloads through /api/avatar/render/:jobId/media, which looks the URL up again server-side
      mediaUrl: s === "completed" && v.video_url ? "ready" : null,
      duration: v.duration ?? null,
      providerJobId: id,
      error: failed ? `The avatar provider couldn't render this line${message ? `: ${message}` : "."}` : null,
      detail: failed ? { provider: "heygen", endpoint: "GET /v3/videos/{id}", http: res.status, code, message, kind: errorKind(res.status, `${code} ${message}`.toLowerCase()) } : null
    };
  },

  async getAvailableAvatars(env) {
    const res = await heygen<{ id: string; name: string; preview_image_url: string | null }[]>(env, "/v3/avatars/looks?ownership=private&limit=50");
    if (!res.ok) return fail(res);
    return (Array.isArray(res.data) ? res.data : []).map(l => ({ id: l.id, name: l.name, image: l.preview_image_url }));
  },

  async getAvailableVoices(env) {
    const res = await heygen<{ voice_id: string; name: string; language: string; gender: string }[]>(env, "/v3/voices?type=private&limit=100");
    if (!res.ok) return fail(res);
    return (Array.isArray(res.data) ? res.data : []).map(v => ({ id: v.voice_id, name: v.name, language: v.language, gender: v.gender }));
  },

  async fetchRenderedMedia(env, id) {
    const res = await heygen<Video>(env, `/v3/videos/${id}`);
    if (!res.ok) return fail(res);
    if (res.data.status !== "completed" || !res.data.video_url) throw new ProviderError("This render isn't finished yet.", 409);
    let file: Response;
    try {
      file = await fetch(res.data.video_url); // presigned URL — no credentials attached
    } catch {
      throw new ProviderError("Couldn't download the finished clip. Try again.", 502);
    }
    if (!file.ok || !file.body) {
      const detail = { provider: "heygen", endpoint: "GET video_url", http: file.status, code: "download_failed", message: "", kind: errorKind(file.status, "") };
      console.warn(JSON.stringify({ event: "provider_error", providerJobId: id, ...detail }));
      throw new ProviderError("Couldn't download the finished clip. Try again.", 502, detail);
    }
    return new Response(file.body, {
      headers: { "Content-Type": file.headers.get("Content-Type") ?? "video/mp4", "Cache-Control": "private, no-store" }
    });
  },

  // HeyGen has no documented way to stop a started render; the studio stops waiting for it
  cancelRender: async () => false
};
