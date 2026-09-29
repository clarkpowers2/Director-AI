/**
 * Free text-to-speech via Cloudflare Workers AI (Deepgram Aura) — the avatar's
 * voice when D-ID isn't used. Returns MP3 audio.
 */
import { json, type Env } from "../../server/shared";

const SPEAKERS = new Set(["angus", "asteria", "arcas", "orion", "orpheus", "athena", "luna", "zeus", "perseus", "helios", "hera", "stella"]);

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.AI) return json({ error: "The free voice isn't available on this server." }, 503);
  const body = (await request.json().catch(() => null)) as { text?: string; speaker?: string } | null;
  const text = body?.text?.trim();
  if (!text) return json({ error: "There's no text to speak." }, 400);
  if (text.length > 1500) return json({ error: "Each voiceover line must be under 1,500 characters." }, 400);
  const speaker = body?.speaker && SPEAKERS.has(body.speaker) ? body.speaker : "asteria";

  try {
    // The bundled Ai types don't list Aura yet; call it through a narrow signature
    const ai = env.AI as unknown as { run(model: string, input: object, options: object): Promise<Response> };
    const audio = await ai.run("@cf/deepgram/aura-1", { text, speaker, encoding: "mp3" }, { returnRawResponse: true });
    if (!audio.ok || !audio.body) return json({ error: "The voice service couldn't create this line. Try again shortly." }, 502);
    return new Response(audio.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch {
    return json({ error: "The voice service couldn't create this line. Try again shortly." }, 502);
  }
};
