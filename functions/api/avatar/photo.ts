/**
 * Turn your own photo into a HeyGen photo avatar: upload it as an asset, then
 * POST /v3/avatars type "photo". Photo avatars accept motion_prompt gestures.
 */
import { heygen, json, type Env } from "../../../server/shared";

const MAX_BYTES = 10 * 1024 * 1024;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const form = await request.formData().catch(() => null);
  const image = form?.get("image");
  const name = String(form?.get("name") ?? "DirectorAI presenter").slice(0, 60);
  if (!image || typeof image === "string") return json({ error: "Send the photo as multipart field 'image'." }, 400);
  if (!/^image\/(jpeg|png)$/.test(image.type)) return json({ error: "Use a JPG or PNG photo." }, 400);
  if (image.size > MAX_BYTES) return json({ error: "Photo must be under 10 MB." }, 400);

  // Safe file name — providers reject names with spaces
  const upload = new FormData();
  upload.append("file", image, `presenter-${Date.now()}.${image.type === "image/png" ? "png" : "jpg"}`);
  const asset = await heygen<{ asset_id: string }>(env, "/v3/assets", { method: "POST", body: upload });
  if (!asset.ok) return asset.response;

  const created = await heygen<{ avatar_item?: { id: string }; id?: string }>(env, "/v3/avatars", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "photo", name, file: { type: "asset_id", asset_id: asset.data.asset_id } })
  });
  if (!created.ok) return created.response;
  const lookId = created.data.avatar_item?.id ?? created.data.id;
  if (!lookId) return json({ error: "The avatar provider didn't return the new avatar. Try again." }, 502);
  return json({ look_id: lookId });
};
