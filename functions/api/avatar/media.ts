/**
 * Download a finished D-ID video through this origin, so the browser can draw it
 * on a canvas and export it (D-ID's storage doesn't send CORS headers).
 * Only D-ID hosts are allowed — this is not an open proxy.
 */
import { json, type Env } from "../../../server/shared";

function allowed(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  const host = url.hostname;
  return host === "d-id.com" || host.endsWith(".d-id.com") || /^d-id-[a-z0-9-]+\.s3[a-z0-9.-]*\.amazonaws\.com$/.test(host);
}

export const onRequestGet: PagesFunction<Env> = async ({ request }) => {
  const raw = new URL(request.url).searchParams.get("url");
  let target: URL;
  try {
    target = new URL(raw ?? "");
  } catch {
    return json({ error: "Missing or invalid url." }, 400);
  }
  if (!allowed(target)) return json({ error: "Only D-ID result URLs can be fetched." }, 400);

  const res = await fetch(target.toString());
  if (!res.ok || !res.body) return json({ error: `Could not fetch video (${res.status}).` }, 502);
  return new Response(res.body, {
    headers: { "Content-Type": res.headers.get("Content-Type") ?? "video/mp4", "Cache-Control": "private, max-age=3600" }
  });
};
