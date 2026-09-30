/**
 * GET /api/avatar/diagnostics[?avatarId=&voiceId=] — TEMPORARY developer view of the
 * real renderer's health. Read-only provider calls (no renders, no credits).
 * Returns whether a credential is configured, never the credential; no username or email.
 */
import { heygen, json, sanitize, type Env } from "../../../server/shared";
import { providers } from "../../../server/avatar/service";

const ID = /^[\w-]{1,120}$/;

interface Me {
  billing_type?: string | null;
  wallet?: { currency?: string; remaining_balance?: number | null; auto_reload?: { enabled?: boolean } } | null;
  subscription?: { plan?: string; credits?: { premium_credits?: { remaining?: number | null }; add_on_credits?: { remaining?: number | null } } } | null;
  usage_based?: { spending_current_usd?: number | null; spending_cap_usd?: number | null } | null;
}
interface Look { id: string; name: string; avatar_type: string; status: string | null; supported_api_engines?: string[]; default_voice_id?: string | null }
interface Video {
  id: string; title?: string | null; status: string; created_at?: number | null; duration?: number | null;
  failure_code?: string | null; failure_message?: string | null; video_url?: string | null;
}

const host = (u: string | null | undefined) => {
  try {
    return u ? new URL(u).hostname : null;
  } catch {
    return null;
  }
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const avatarId = url.searchParams.get("avatarId");
  const voiceId = url.searchParams.get("voiceId");
  const out: Record<string, unknown> = {
    credentialConfigured: !!env.HEYGEN_API_KEY,
    apiBaseOverridden: !!env.HEYGEN_API_BASE,
    mockEnabled: env.AVATAR_MOCK === "1",
    providerOrder: providers(env).map(p => p.id),
    autoSelects: providers(env)[0]?.id ?? null
  };
  if (!env.HEYGEN_API_KEY) return json(out);

  const [me, looks, voices, videos] = await Promise.all([
    heygen<Me>(env, "/v3/users/me"),
    heygen<Look[]>(env, "/v3/avatars/looks?ownership=private&limit=20"),
    heygen<unknown[]>(env, "/v3/voices?type=public&limit=1"),
    heygen<Video[]>(env, "/v3/videos?limit=15")
  ]);
  out.account = me.ok ? {
    http: me.status,
    billing_type: me.data.billing_type ?? null,
    wallet: me.data.wallet ? { currency: me.data.wallet.currency, remaining_balance: me.data.wallet.remaining_balance ?? null, auto_reload: !!me.data.wallet.auto_reload?.enabled } : null,
    subscription: me.data.subscription ? {
      plan: me.data.subscription.plan,
      premium_remaining: me.data.subscription.credits?.premium_credits?.remaining ?? null,
      add_on_remaining: me.data.subscription.credits?.add_on_credits?.remaining ?? null
    } : null,
    usage_based: me.data.usage_based ?? null
  } : { http: me.detail.http, code: me.detail.code, message: me.detail.message };
  out.privateAvatars = looks.ok
    ? { http: looks.status, count: Array.isArray(looks.data) ? looks.data.length : 0, items: (Array.isArray(looks.data) ? looks.data : []).map(l => ({ id: l.id, name: l.name, type: l.avatar_type, status: l.status, engines: l.supported_api_engines ?? [] })) }
    : { http: looks.detail.http, code: looks.detail.code, message: looks.detail.message };
  out.voicesList = voices.ok ? { http: voices.status } : { http: voices.detail.http, code: voices.detail.code, message: voices.detail.message };
  out.recentVideos = videos.ok
    ? (Array.isArray(videos.data) ? videos.data : []).map(v => ({
      id: v.id, title: (v.title ?? "").slice(0, 60), status: v.status, created_at: v.created_at ?? null, duration: v.duration ?? null,
      failure_code: v.failure_code ? sanitize(v.failure_code, env) : null, failure_message: v.failure_message ? sanitize(v.failure_message, env) : null,
      media_host: host(v.video_url)
    }))
    : { http: videos.detail.http, code: videos.detail.code, message: videos.detail.message };

  if (avatarId && ID.test(avatarId)) {
    const a = await heygen<Look>(env, `/v3/avatars/looks/${avatarId}`);
    out.avatarCheck = a.ok
      ? { http: a.status, id: a.data.id, name: a.data.name, type: a.data.avatar_type, status: a.data.status, engines: a.data.supported_api_engines ?? [], default_voice_id: a.data.default_voice_id ?? null }
      : { http: a.detail.http, code: a.detail.code, message: a.detail.message };
  }
  if (voiceId && ID.test(voiceId)) {
    // voices come from the daily public catalog plus the account's private voices
    const cached = await env.CATALOG?.get<{ items: { id: string; name: string; language: string }[] }>("catalog:voices", "json");
    const pub = cached?.items.find(v => v.id === voiceId);
    const priv = await heygen<{ voice_id: string; name: string }[]>(env, "/v3/voices?type=private&limit=100");
    const mine = priv.ok && Array.isArray(priv.data) ? priv.data.find(v => v.voice_id === voiceId) : undefined;
    out.voiceCheck = { inPublicCatalog: !!pub, publicCatalogLoaded: !!cached, inPrivateVoices: !!mine, name: pub?.name ?? mine?.name ?? null, language: pub?.language ?? null };
  }
  return json(out);
};
