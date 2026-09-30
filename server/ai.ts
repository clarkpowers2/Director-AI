/** Shared Claude client for the AI endpoints (script, plan, command, translate, assist). */
import Anthropic from "@anthropic-ai/sdk";
import { json, type Env } from "./shared";

/** The model the user chose for DirectorAI's AI features */
export const MODEL = "claude-sonnet-4-6";

export const claude = (env: Env) =>
  new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_API_BASE || undefined });

/** Plain-English response for a failed Claude call — never the raw API error */
export function aiFailure(error: unknown, feature: string): Response {
  if (error instanceof Anthropic.RateLimitError) return json({ error: `${feature} is busy. Try again in a minute.` }, 429);
  if (error instanceof Anthropic.AuthenticationError) return json({ error: `${feature} isn't set up correctly on the server.` }, 502);
  if (error instanceof Anthropic.BadRequestError) return json({ error: `${feature} couldn't process that request.` }, 400);
  if (error instanceof Anthropic.APIError) return json({ error: `${feature} had a problem (${error.status}). Try again.` }, 502);
  return json({ error: `Couldn't reach ${feature}. Try again shortly.` }, 502);
}

/** Director's Script syntax, shared by every endpoint that writes scripts */
export const SCRIPT_SYNTAX = `DirectorAI™ Director's Script syntax (one beat per line):
- Timestamps at the start of a line: [0:00], [0:15], [1:05].
- Spoken voiceover ALWAYS in quotes after a VOICEOVER: label, e.g. VOICEOVER: "Welcome to Haven Memory OS."
- Presenter stage directions (never spoken) on their own line: AVATAR: Victor gestures toward the screen
- Effects on their own line, keyword first: ZOOM: <element> · HIGHLIGHT: <element> · PULSE: <element> · POINTS TO: <element> · CALLOUT: <text>
- Text on screen: TITLE: <text> · CAPTION: <text> · LOWER THIRD: <Name> | <Role>
- Transitions: TRANSITION: <description> · FADE: in | out
- B-roll and other visual notes in square brackets: [B-roll: hotel lobby at night]
Rules:
- Only words the presenter should actually say go inside VOICEOVER quotes. Stage directions, gestures, camera notes and visual descriptions must NEVER be inside quotes.
- Never put an effect keyword in the middle of a spoken sentence.
- Keep each voiceover line to one or two natural sentences.`;
