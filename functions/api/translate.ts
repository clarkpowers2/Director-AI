/** Translate caption lines with Claude, one output line per input line. */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { json, type Env } from "../../server/shared";
import { claude, MODEL } from "../../server/ai";


export const LANGUAGES = [
  "Spanish", "French", "German", "Italian", "Portuguese", "Chinese (Simplified)", "Japanese", "Korean",
  "Arabic", "Hindi", "Russian", "Haitian Creole", "Tagalog", "Vietnamese"
];

const Translation = z.object({ translations: z.array(z.string()) });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.ANTHROPIC_API_KEY) return json({ error: "Translation isn't set up on the server yet." }, 503);
  const body = (await request.json().catch(() => null)) as { lines?: unknown; language?: string } | null;
  const lines = Array.isArray(body?.lines) ? body!.lines.filter((l): l is string => typeof l === "string") : [];
  const language = body?.language ?? "";
  if (!LANGUAGES.includes(language)) return json({ error: "Pick a language from the list." }, 400);
  if (lines.length === 0) return json({ error: "There are no captions to translate yet." }, 400);
  if (lines.length > 500 || lines.join("").length > 40_000) return json({ error: "That script is too long to translate at once." }, 400);

  const client = claude(env);
  try {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      system: `Translate video captions into ${language}. Return exactly one translation per input line, in the same order. Keep product names, brand names and people's names unchanged. Keep each line natural and concise for on-screen captions.`,
      messages: [{ role: "user", content: JSON.stringify({ lines }) }],
      output_config: { format: zodOutputFormat(Translation) }
    });
    if (response.stop_reason === "refusal") return json({ error: "The translator declined these captions." }, 422);
    const out = response.parsed_output?.translations;
    if (!out || out.length !== lines.length) return json({ error: "The translation came back incomplete. Try again." }, 502);
    return json({ language, translations: out });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return json({ error: "The translator is busy. Try again in a minute." }, 429);
    if (error instanceof Anthropic.AuthenticationError) return json({ error: "Translation isn't set up correctly on the server." }, 502);
    return json({ error: "Translation failed. Try again shortly." }, 502);
  }
};
