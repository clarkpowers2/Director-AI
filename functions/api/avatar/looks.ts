/**
 * Live HeyGen look list — used for "My avatars" (your own, few and changing).
 * The public library is served from the daily cache in ./catalog.
 */
import { heygen, json, type Env } from "../../../server/shared";
import { category } from "./catalog";

interface Look {
  id: string; name: string; avatar_type: "studio_avatar" | "digital_twin" | "photo_avatar";
  gender: string | null; preview_image_url: string | null; preview_video_url: string | null;
  default_voice_id: string | null; tags: string[]; supported_api_engines: string[]; status: string | null;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const ownership = url.searchParams.get("ownership") === "private" ? "private" : "public";
  const params = new URLSearchParams({ ownership, limit: "50" });
  const token = url.searchParams.get("token");
  if (token) params.set("token", token);
  const type = url.searchParams.get("avatar_type");
  if (type && ["studio_avatar", "digital_twin", "photo_avatar"].includes(type)) params.set("avatar_type", type);

  const res = await heygen<Look[]>(env, `/v3/avatars/looks?${params}`);
  if (!res.ok) return res.response;
  const looks = (Array.isArray(res.data) ? res.data : []).filter(l => !l.status || l.status === "completed" || l.status === "processing");
  return json({
    looks: looks.map(l => ({
      id: l.id, name: l.name, type: l.avatar_type, gender: l.gender, image: l.preview_image_url, video: l.preview_video_url,
      voice: l.default_voice_id, tags: l.tags ?? [], engines: l.supported_api_engines ?? [], status: l.status ?? "completed",
      category: category(l.avatar_type, l.name)
    })),
    next: res.raw.has_more ? (res.raw.next_token as string | undefined) ?? null : null
  });
};
