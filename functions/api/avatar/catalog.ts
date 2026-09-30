/**
 * Search the cached HeyGen catalogs.
 *   ?kind=looks&tab=full_body|studio|digital_twin|talking_head|all&q=&offset=&limit=
 *   ?kind=voices&q=&gender=all|male|female&language=English|Spanish|French|Portuguese|Other|all&tone=warm|authoritative&offset=&limit=
 * While the first index is being built, returns { ready: false, progress }.
 */
import { getCatalog, type CatalogSpec } from "../../../server/catalog";
import { heygen, json, type Env } from "../../../server/shared";

export type LookCategory = "full_body" | "studio" | "digital_twin" | "talking_head";

interface RawLook {
  id: string; name: string; avatar_type: "studio_avatar" | "digital_twin" | "photo_avatar"; gender: string | null;
  preview_image_url: string | null; default_voice_id: string | null; supported_api_engines: string[]; status: string | null;
}
export interface CatalogLook {
  id: string; name: string; type: RawLook["avatar_type"]; gender: string | null; image: string | null;
  voice: string | null; engines: string[]; category: LookCategory;
}

/** HeyGen's own avatar_type decides the tab; only studio avatars are split by name */
export function category(type: RawLook["avatar_type"], name: string): LookCategory {
  if (type === "photo_avatar") return "talking_head";
  if (type === "digital_twin") return "digital_twin";
  return /\b(full[\s_-]?body|standing|walking)\b/i.test(name) ? "full_body" : "studio";
}

const LOOKS: CatalogSpec<RawLook, CatalogLook> = {
  kind: "looks",
  path: "/v3/avatars/looks?ownership=public",
  pageSize: 50,
  id: l => l.id,
  map: l => ({
    id: l.id, name: l.name, type: l.avatar_type, gender: l.gender, image: l.preview_image_url,
    voice: l.default_voice_id, engines: l.supported_api_engines ?? [], category: category(l.avatar_type, l.name)
  })
};

interface RawVoice { voice_id: string; name: string; language: string; gender: string; preview_audio_url: string | null }
export interface CatalogVoice { id: string; name: string; language: string; gender: string; preview: string | null; private?: boolean }

const VOICES: CatalogSpec<RawVoice, CatalogVoice> = {
  kind: "voices",
  path: "/v3/voices?type=public",
  pageSize: 100,
  id: v => v.id,
  map: v => ({ id: v.voice_id, name: v.name, language: v.language || "Unknown", gender: (v.gender || "unknown").toLowerCase(), preview: v.preview_audio_url })
};

const MAIN_LANGUAGES = ["English", "Spanish", "French", "Portuguese"];

/** HeyGen names describe each voice's style ("Orson - Firm & Measured"); tone filters on those words */
const TONE_WORDS: Record<string, RegExp> = {
  warm: /\b(warm|friendly|soothing|gentle|cheerful|caring|kind|soft|calm)\b/i,
  authoritative: /\b(firm|serious|authoritative|confident|professional|measured|commanding|deep|assertive|bold)\b/i
};
const num = (v: string | null, d: number, max: number) => Math.max(0, Math.min(max, Number.parseInt(v ?? "", 10) || d));

export const onRequestGet: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  if (!env.HEYGEN_API_KEY) return json({ error: "The avatar renderer isn't set up on the server yet." }, 503);
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") === "voices" ? "voices" : "looks";
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 80);
  const offset = num(url.searchParams.get("offset"), 0, 100_000);
  const limit = num(url.searchParams.get("limit"), kind === "looks" ? 60 : 50, 200);

  if (kind === "looks") {
    const state = await getCatalog(env, LOOKS, waitUntil);
    if (!state.ready) return json({ ready: false, progress: { pages: state.pages, items: state.items }, error: state.error ?? null });
    const tab = url.searchParams.get("tab") ?? "full_body";
    const matchesQ = state.items.filter(l => !q || l.name.toLowerCase().includes(q));
    const counts = { full_body: 0, studio: 0, digital_twin: 0, talking_head: 0 } as Record<LookCategory, number>;
    for (const l of matchesQ) counts[l.category]++;
    const list = tab === "all" ? matchesQ : matchesQ.filter(l => l.category === tab);
    return json({ ready: true, items: list.slice(offset, offset + limit), total: list.length, counts, all: matchesQ.length, built: state.built, refreshing: state.refreshing });
  }

  const state = await getCatalog(env, VOICES, waitUntil);
  if (!state.ready) return json({ ready: false, progress: { pages: state.pages, items: state.items }, error: state.error ?? null });
  const gender = url.searchParams.get("gender") ?? "all";
  const tone = TONE_WORDS[url.searchParams.get("tone") ?? ""];
  const language = url.searchParams.get("language") ?? "all";
  // Your own cloned voices are few and change often — fetched live, listed first
  let mine: CatalogVoice[] = [];
  const priv = await heygen<RawVoice[]>(env, "/v3/voices?type=private&limit=100");
  if (priv.ok && Array.isArray(priv.data)) mine = priv.data.map(v => ({ ...VOICES.map(v), private: true }));
  const list = [...mine, ...state.items].filter(v =>
    (!q || v.name.toLowerCase().includes(q) || v.language.toLowerCase().includes(q))
    && (gender === "all" || v.gender === gender)
    && (!tone || tone.test(v.name))
    && (language === "all" || (language === "Other" ? !MAIN_LANGUAGES.includes(v.language) : v.language === language))
  );
  return json({ ready: true, items: list.slice(offset, offset + limit), total: list.length, all: state.items.length + mine.length, built: state.built, refreshing: state.refreshing });
};
