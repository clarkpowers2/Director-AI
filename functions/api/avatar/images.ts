/** Upload a presenter photo to D-ID. Returns { url } usable as a talk's source_url. */
import { didFetch, json, type Env } from "../../../server/shared";

const MAX_BYTES = 10 * 1024 * 1024;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const form = await request.formData().catch(() => null);
  const image = form?.get("image");
  if (!image || typeof image === "string") return json({ error: "Send the photo as multipart field 'image'." }, 400);
  if (!/^image\/(jpeg|png)$/.test(image.type)) return json({ error: "Use a JPG or PNG photo." }, 400);
  if (image.size > MAX_BYTES) return json({ error: "Photo must be under 10 MB." }, 400);

  // D-ID rejects file names with spaces and other characters ("invalid file name"),
  // so never pass the user's name through — send a safe one with the right extension
  const ext = image.type === "image/png" ? "png" : "jpg";
  const upstream = new FormData();
  upstream.append("image", image, `avatar-${Date.now()}.${ext}`);
  return didFetch(env, "/images", { method: "POST", body: upstream });
};
