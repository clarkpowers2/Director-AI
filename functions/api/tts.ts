/**
 * Free text-to-speech — the avatar's voice for the animated-photo engine.
 * Goes through the VoiceProvider layer (Workers AI today). Returns MP3 audio.
 */
import { json, type Env } from "../../server/shared";
import { WorkersAIVoice } from "../../server/voice/provider";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!WorkersAIVoice.configured(env)) return json({ error: "The free voice isn't available on this server." }, 503);
  const body = (await request.json().catch(() => null)) as { text?: string; speaker?: string } | null;
  const text = body?.text?.trim();
  if (!text) return json({ error: "There's no text to speak." }, 400);
  if (text.length > 1500) return json({ error: "Each voiceover line must be under 1,500 characters." }, 400);

  try {
    const audio = await WorkersAIVoice.generateSpeech(env, text, body?.speaker ?? "");
    if (!audio?.body) return json({ error: "The voice service couldn't create this line. Try again shortly." }, 502);
    return new Response(audio.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch {
    return json({ error: "The voice service couldn't create this line. Try again shortly." }, 502);
  }
};
