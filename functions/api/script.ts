/**
 * POST /api/script — AI Script Assistant: write, improve, shorten, expand, change
 * tone, add a hook/CTA, add avatar/visual/B-roll directions, split into scenes.
 * Always returns a complete Director's Script in DirectorAI™ syntax.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { json, type Env } from "../../server/shared";
import { aiFailure, claude, MODEL, SCRIPT_SYNTAX } from "../../server/ai";

export const ACTIONS = {
  write: "Write a complete new script from the user's notes or instruction (the current script may be empty or rough notes).",
  improve: "Improve clarity, flow and persuasiveness. Keep the structure, timing and all directions.",
  shorten: "Shorten the spoken lines by about a third while keeping every key point. Keep directions; retime timestamps to fit.",
  expand: "Expand the spoken lines with useful detail and examples, about a third longer. Keep directions; retime timestamps.",
  tone: "Rewrite the spoken lines in the tone the user asks for. Keep structure and directions.",
  hook: "Add or replace the opening with a strong 1-2 sentence hook at [0:00]. Shift later timestamps if needed.",
  cta: "Add or replace the closing with a clear call to action (include any URL the script or user mentions).",
  avatar_directions: "Add presenter stage directions (AVATAR: lines) where a gesture, look or movement would help. Do not change spoken words.",
  visual_directions: "Add visual directions (ZOOM, HIGHLIGHT, PULSE, POINTS TO, CALLOUT, TITLE, LOWER THIRD, TRANSITION) at the right moments. Do not change spoken words.",
  broll_directions: "Add B-roll suggestions in [B-roll: ...] brackets where footage would support the narration. Do not change spoken words.",
  split_scenes: "Split the script into clear scenes with [m:ss] timestamps on every scene, one idea per scene. Do not change spoken words."
} as const;
type Action = keyof typeof ACTIONS;

const Result = z.object({
  script: z.string().describe("The complete Director's Script after the change"),
  summary: z.string().describe("One sentence telling the user what changed")
});

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.ANTHROPIC_API_KEY) return json({ error: "The AI Script Assistant isn't set up on the server yet." }, 503);
  const b = (await request.json().catch(() => null)) as { action?: string; script?: string; instruction?: string; presenter?: string; duration_seconds?: number } | null;
  const action = b?.action as Action;
  if (!action || !(action in ACTIONS)) return json({ error: "Pick a script action." }, 400);
  const script = (b?.script ?? "").trim();
  const instruction = (b?.instruction ?? "").trim().slice(0, 1000);
  if (!script && action !== "write") return json({ error: "Write or paste a script first." }, 400);
  if (action === "write" && !script && !instruction) return json({ error: "Describe what the script should say." }, 400);
  if (script.length > 20_000) return json({ error: "The script must be under 20,000 characters." }, 400);

  const context = [
    `Presenter name: ${(b?.presenter || "Victor").slice(0, 60)}`,
    b?.duration_seconds ? `Video length: ${Math.round(b.duration_seconds)} seconds` : "",
    `Task: ${ACTIONS[action]}`,
    instruction ? `User's instruction: ${instruction}` : ""
  ].filter(Boolean).join("\n");

  try {
    const response = await claude(env).messages.parse({
      model: MODEL,
      max_tokens: 16000,
      system: `You edit video scripts inside DirectorAI™, a production studio by HCCGSA LLC™.\n\n${SCRIPT_SYNTAX}\n\nReturn the COMPLETE script after your change, in this syntax. Keep product and brand names exactly as written, including ™ marks.`,
      messages: [{ role: "user", content: `${context}\n\nCURRENT SCRIPT\n${script || "(empty)"}` }],
      output_config: { format: zodOutputFormat(Result) }
    });
    if (response.stop_reason === "refusal") return json({ error: "The Script Assistant declined that request." }, 422);
    const out = response.parsed_output;
    if (!out?.script.trim()) return json({ error: "The Script Assistant returned an empty script. Try again." }, 502);
    return json({ script: out.script.replace(/^```\w*\n?|\n?```$/g, "").trim(), summary: out.summary, truncated: response.stop_reason === "max_tokens" });
  } catch (error) {
    if (error instanceof Anthropic.APIError || !(error instanceof Error)) return aiFailure(error, "The Script Assistant");
    return json({ error: "The Script Assistant's answer couldn't be read. Try again." }, 502);
  }
};
