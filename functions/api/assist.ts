/**
 * AI Assist: turn free-form notes into a DirectorAI™ director's script.
 * Parsing itself happens offline in the browser; this only rewrites notes
 * into the syntax the parser understands.
 */
import Anthropic from "@anthropic-ai/sdk";
import { json, type Env } from "../../server/shared";
import { aiFailure, claude, MODEL, SCRIPT_SYNTAX } from "../../server/ai";


const SYSTEM = `You convert rough video notes into a DirectorAI™ Director's Script.
${SCRIPT_SYNTAX}
Output ONLY the script — no preamble, code fences or commentary. Use the presenter name given. Keep speech natural and concise, and preserve product and brand names exactly.`;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.ANTHROPIC_API_KEY) return json({ error: "AI Assist is not configured on the server (ANTHROPIC_API_KEY missing)." }, 503);

  const body = (await request.json().catch(() => null)) as { notes?: string; avatar_name?: string; video_duration_seconds?: number } | null;
  const notes = body?.notes?.trim();
  if (!notes) return json({ error: "Write some notes first." }, 400);
  if (notes.length > 20_000) return json({ error: "Notes must be under 20,000 characters." }, 400);

  const name = (body?.avatar_name || "Victor").slice(0, 60);
  const duration = body?.video_duration_seconds;
  const context = `Presenter name: ${name}${duration ? `\nVideo length: ${Math.round(duration)} seconds` : ""}`;

  const client = claude(env);
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      messages: [{ role: "user", content: `${context}\n\nNotes:\n${notes}` }]
    });

    if (response.stop_reason === "refusal") {
      return json({ error: "Claude declined to rewrite these notes." }, 422);
    }
    const script = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map(b => b.text)
      .join("")
      .replace(/^```\w*\n?|\n?```$/g, "")
      .trim();
    if (!script) return json({ error: "Claude returned an empty script. Try adding more detail to your notes." }, 502);
    return json({ script, truncated: response.stop_reason === "max_tokens" });
  } catch (error) {
    return aiFailure(error, "AI Assist");
  }
};
