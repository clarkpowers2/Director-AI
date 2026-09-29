/** Create a D-ID talk: the presenter photo speaks one voiceover line. */
import { didFetch, json, type Env } from "../../../server/shared";

/** Microsoft voices and the speaking styles each one supports */
const VOICES: Record<string, string[]> = {
  "en-US-GuyNeural": ["friendly", "newscast"],
  "en-US-AriaNeural": ["friendly", "newscast-formal", "empathetic"],
  "en-US-DavisNeural": ["friendly", "chat"],
  "en-US-JennyNeural": ["friendly", "newscast", "assistant"],
  "en-GB-RyanNeural": [],
  "en-GB-SoniaNeural": []
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json().catch(() => null)) as { source_url?: string; text?: string; voice_id?: string; style?: string } | null;
  if (!body?.source_url || !body.text?.trim()) return json({ error: "source_url and text are required." }, 400);
  if (body.text.length > 1500) return json({ error: "Each voiceover line must be under 1,500 characters." }, 400);
  const voice = body.voice_id && body.voice_id in VOICES ? body.voice_id : "en-US-JennyNeural";
  const style = body.style && VOICES[voice].includes(body.style) ? body.style : undefined;

  return didFetch(env, "/talks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source_url: body.source_url,
      script: {
        type: "text",
        input: body.text,
        provider: { type: "microsoft", voice_id: voice, ...(style ? { voice_config: { style } } : {}) }
      },
      config: { stitch: true }
    })
  });
};
