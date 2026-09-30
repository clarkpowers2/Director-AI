/** One HeyGen look — used to wait for a new photo avatar to finish processing */
import { heygen, json, type Env } from "../../../../server/shared";
import { category } from "../catalog";

interface Look {
  id: string; name: string; avatar_type: "studio_avatar" | "digital_twin" | "photo_avatar"; gender: string | null;
  preview_image_url: string | null; preview_video_url: string | null; default_voice_id: string | null;
  tags: string[]; supported_api_engines: string[]; status: string | null;
}

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const id = String(params.id ?? "");
  if (!/^[\w-]{1,120}$/.test(id)) return json({ error: "Invalid avatar id." }, 400);
  const res = await heygen<Look>(env, `/v3/avatars/looks/${id}`);
  if (!res.ok) return res.response;
  const l = res.data;
  return json({
    id: l.id, name: l.name, type: l.avatar_type, gender: l.gender, image: l.preview_image_url, video: l.preview_video_url,
    voice: l.default_voice_id, tags: l.tags ?? [], engines: l.supported_api_engines ?? [], status: l.status ?? "completed",
    category: category(l.avatar_type, l.name)
  });
};
