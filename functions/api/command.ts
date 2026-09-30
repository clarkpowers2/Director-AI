/**
 * AI prompter: turn a plain-English request ("move the avatar right and make it
 * bigger", "add a zoom on the dashboard at 0:12") into a set of project edits.
 * Claude returns structured edits; the studio applies them (with undo).
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { json, type Env } from "../../server/shared";
import { claude, MODEL, SCRIPT_SYNTAX } from "../../server/ai";


const Edits = z.object({
  reply: z.string().describe("One or two friendly sentences telling the user what you changed, or answering their question."),
  script: z.string().nullable().describe("The COMPLETE new director's script if the script should change, else null."),
  effects: z.array(z.object({
    keyword: z.enum(["ZOOM", "HIGHLIGHT", "PULSE", "POINTS TO", "CALLOUT", "TITLE", "CAPTION", "LOWER THIRD", "FADE", "TRANSITION"]),
    text: z.string(),
    at_seconds: z.number().describe("Where on the main video timeline, in seconds")
  })).describe("Effects to add at specific times without rewriting the script. Empty if none."),
  avatar: z.object({
    position: z.enum(["left", "right", "bottom-center", "corner", "full"]).nullable(),
    size: z.enum(["small", "medium", "large"]).nullable(),
    label: z.string().nullable(),
    label_color: z.string().nullable(),
    enabled: z.boolean().nullable()
  }).nullable(),
  voice: z.object({
    speed: z.enum(["slow", "normal", "fast"]).nullable(),
    gesture: z.enum(["presenter", "teacher", "anchor", "casual"]).nullable()
  }).nullable(),
  branding: z.object({
    primary: z.string().nullable(), accent: z.string().nullable(),
    font: z.enum(["Inter", "Playfair Display", "Montserrat", "Poppins", "Lora"]).nullable(),
    logo_position: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]).nullable(),
    intro_enabled: z.boolean().nullable(), intro_title: z.string().nullable(), intro_subtitle: z.string().nullable(), intro_duration: z.number().nullable(),
    outro_enabled: z.boolean().nullable(), outro_cta: z.string().nullable(), outro_url: z.string().nullable(), outro_duration: z.number().nullable(),
    captions_enabled: z.boolean().nullable(), caption_size: z.number().nullable(), caption_color: z.string().nullable(),
    caption_position: z.enum(["top", "bottom"]).nullable()
  }).nullable(),
  video: z.object({
    trim_in: z.number().nullable(), trim_out: z.number().nullable(), speed: z.number().nullable(),
    volume_voice: z.number().nullable(), volume_video: z.number().nullable(), volume_music: z.number().nullable(),
    music_loop: z.boolean().nullable()
  }).nullable(),
  project_name: z.string().nullable(),
  translate_captions_to: z.string().nullable().describe("A caption language to translate to, or null"),
  go_to_page: z.enum(["editor", "effects", "advanced", "audio", "avatar", "export"]).nullable()
});

const SYSTEM = `You are the built-in assistant of DirectorAI™ Studio, a video production app. The user describes what they want; you return edits to their project. Only change what they asked for — every field you don't need to change must be null (or an empty array for effects).

${SCRIPT_SYNTAX}

Rules:
- To reword, reorder, add or delete lines, return the complete updated script in "script" (keep everything else as it was).
- To add an effect at a moment ("at 0:12", "when she mentions the dashboard"), prefer "effects" with at_seconds (use the scene times you're given) instead of rewriting the script.
- Volumes are 0–1. Video speed is 0.5–2. Colors are hex like #1a2744. Durations are seconds.
- Caption languages you may use: Spanish, French, German, Italian, Portuguese, Chinese (Simplified), Japanese, Korean, Arabic, Hindi, Russian, Haitian Creole, Tagalog, Vietnamese.
- You can't upload files, generate avatar videos or export — if asked, say which button does it (and use go_to_page to take them there).
- If the request is unclear, change nothing and ask a short question in "reply".`;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.ANTHROPIC_API_KEY) return json({ error: "The AI prompter isn't set up on the server yet." }, 503);
  const body = (await request.json().catch(() => null)) as { prompt?: string; context?: string } | null;
  const prompt = body?.prompt?.trim();
  if (!prompt) return json({ error: "Type what you'd like to change." }, 400);
  if (prompt.length > 2000 || (body?.context?.length ?? 0) > 60_000) return json({ error: "That request is too long." }, 400);

  const client = claude(env);
  try {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: "user", content: `PROJECT\n${body?.context ?? ""}\n\nREQUEST\n${prompt}` }],
      output_config: { format: zodOutputFormat(Edits) }
    });
    if (response.stop_reason === "refusal") return json({ error: "The assistant declined that request." }, 422);
    if (!response.parsed_output) return json({ error: "The assistant's answer came back incomplete. Try rephrasing." }, 502);
    return json(response.parsed_output);
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return json({ error: "The assistant is busy. Try again in a minute." }, 429);
    if (error instanceof Anthropic.AuthenticationError) return json({ error: "The assistant isn't set up correctly on the server." }, 502);
    return json({ error: "The assistant couldn't finish that. Try again." }, 502);
  }
};
