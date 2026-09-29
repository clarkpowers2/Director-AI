/**
 * AI Assist: turn free-form notes into a DirectorAI™ director's script.
 * Parsing itself happens offline in the browser; this only rewrites notes
 * into the syntax the parser understands.
 */
import Anthropic from "@anthropic-ai/sdk";
import { json, type Env } from "../../server/shared";

const MODEL = "claude-sonnet-4-6";

const SYSTEM = `You convert rough video notes into a DirectorAI™ director's script for a screen-recording demo with an AI avatar presenter.

Output ONLY the script — no preamble, no code fences, no commentary.

Syntax (one beat per line):
- Timestamps at the start of a line: [0:00], [0:15], [1:05]. Use them when the notes give timing; otherwise omit them.
- Speech with a stage direction: <Name> <action> and says: "Spoken line."  (e.g. Victor points to the dashboard and says: "Here's your overview.")
- Plain speech: just the sentence on its own line.
- Effects on their own line, keyword first, then the on-screen element or text:
  ZOOM: <element>   HIGHLIGHT: <element>   PULSE: <element>   POINTS TO: <element>
  TITLE: <text>     CAPTION: <text>        FADE: in | out     TRANSITION: <description>
- Effects can be chained on one line: ZOOM: Haven logo. HIGHLIGHT: gold border.
- Other actions can go in square brackets: [Victor smiles]

Rules:
- Keep the presenter's spoken lines natural and concise (one or two sentences each).
- Name on-screen elements exactly as the notes describe them.
- Never put effect keywords in the middle of a spoken sentence.
- Use the presenter name you are given.`;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.ANTHROPIC_API_KEY) return json({ error: "AI Assist is not configured on the server (ANTHROPIC_API_KEY missing)." }, 503);

  const body = (await request.json().catch(() => null)) as { notes?: string; avatar_name?: string; video_duration_seconds?: number } | null;
  const notes = body?.notes?.trim();
  if (!notes) return json({ error: "Write some notes first." }, 400);
  if (notes.length > 20_000) return json({ error: "Notes must be under 20,000 characters." }, 400);

  const name = (body?.avatar_name || "Victor").slice(0, 60);
  const duration = body?.video_duration_seconds;
  const context = `Presenter name: ${name}${duration ? `\nVideo length: ${Math.round(duration)} seconds` : ""}`;

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
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
    if (error instanceof Anthropic.AuthenticationError) return json({ error: "The server's Anthropic API key is invalid." }, 502);
    if (error instanceof Anthropic.RateLimitError) return json({ error: "AI Assist is busy — try again in a minute." }, 429);
    if (error instanceof Anthropic.BadRequestError) return json({ error: `Claude rejected the request: ${error.message}` }, 400);
    if (error instanceof Anthropic.APIError) return json({ error: `Claude API error (${error.status}).` }, 502);
    return json({ error: "Could not reach Claude." }, 502);
  }
};
