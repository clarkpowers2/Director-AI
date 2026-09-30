/**
 * POST /api/avatar/render — start rendering one avatar scene (or a TEST RENDER).
 * The server picks the provider; keys never leave it. Returns a job id to poll at
 * /api/avatar/render/:jobId. Nothing here retries a paid render on another provider.
 */
import { json, type Env } from "../../../server/shared";
import { jobId, pickProvider } from "../../../server/avatar/service";
import { ProviderError, type BackgroundMode, type RenderQuality } from "../../../server/avatar/provider";

interface Body {
  projectId?: string; sceneId?: string; provider?: string;
  avatarId?: string; voiceId?: string; text?: string;
  gesture?: string; expressiveness?: "low" | "medium" | "high"; engine?: "avatar_v";
  quality?: RenderQuality; background?: BackgroundMode; test?: boolean;
}

const ID = /^[\w-]{1,120}$/;
/** About 10 seconds of speech */
export const TEST_MAX_CHARS = 220;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const b = (await request.json().catch(() => null)) as Body | null;
  if (!b?.avatarId || !ID.test(b.avatarId)) return json({ error: "Pick an avatar first." }, 400);
  const text = b.text?.trim();
  if (!text) return json({ error: "There's no text for the avatar to say." }, 400);
  const test = b.test === true;
  if (test && text.length > TEST_MAX_CHARS) return json({ error: `A test render is limited to ${TEST_MAX_CHARS} characters (about 10 seconds).` }, 400);
  if (text.length > 1500) return json({ error: "Each voiceover line must be under 1,500 characters." }, 400);
  if (b.voiceId && !ID.test(b.voiceId)) return json({ error: "Invalid voice." }, 400);
  const quality: RenderQuality = test ? "preview" : b.quality && ["preview", "standard", "high"].includes(b.quality) ? b.quality : "standard";
  const background: BackgroundMode = b.background === "provider" ? "provider" : "transparent";

  // DirectorAI's own id for this request, so a failed create can be traced in the logs
  const requestId = `dr-${crypto.randomUUID().slice(0, 8)}`;
  let providerId = b.provider ?? "auto";
  try {
    const provider = pickProvider(env, b.provider);
    providerId = provider.id;
    const started = await provider.renderAvatarScene(env, {
      avatarId: b.avatarId,
      voiceId: b.voiceId || undefined,
      text,
      motion: b.gesture ? {
        prompt: b.gesture.slice(0, 500),
        expressiveness: b.expressiveness && ["low", "medium", "high"].includes(b.expressiveness) ? b.expressiveness : undefined,
        engine: b.engine === "avatar_v" ? "avatar_v" : undefined
      } : undefined,
      quality, background, test,
      label: text.slice(0, 40)
    });
    const id = jobId(provider, started.providerJobId);
    console.log(JSON.stringify({ event: "render_created", requestId, jobId: id, provider: provider.id, providerJobId: started.providerJobId, quality, test, alpha: started.alpha, gestures: started.gestures, chars: text.length }));
    return json({
      jobId: id, requestId, provider: provider.id, providerJobId: started.providerJobId, status: started.status,
      alpha: started.alpha, gestures: started.gestures, quality, test
    });
  } catch (err) {
    if (err instanceof ProviderError) {
      console.warn(JSON.stringify({ event: "render_create_failed", requestId, provider: providerId, http: err.detail?.http ?? err.status, code: err.detail?.code, message: err.detail?.message }));
      return json({ error: err.message, kind: err.detail?.kind ?? null, detail: { ...(err.detail ?? { provider: providerId }), requestId } }, err.status);
    }
    console.warn(JSON.stringify({ event: "render_create_failed", requestId, provider: providerId, http: 500 }));
    return json({ error: "The avatar render couldn't start. Try again.", kind: "provider", detail: { provider: providerId, requestId } }, 500);
  }
};
