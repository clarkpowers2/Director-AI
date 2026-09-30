/**
 * POST /api/plan — AI Video Creator: a structured, editable production plan from
 * a description. Only a plan: no avatar or video generation happens here.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { json, type Env } from "../../server/shared";
import { aiFailure, claude, MODEL } from "../../server/ai";

const PLACEMENTS = ["full", "bottom-right", "bottom-left", "top-right", "top-left", "center"] as const;

const Plan = z.object({
  title: z.string().describe("Project title"),
  objective: z.string().describe("One sentence: what the video must achieve"),
  audience: z.string().describe("Who the video is for"),
  estimated_duration_seconds: z.number(),
  scenes: z.array(z.object({
    start_seconds: z.number(),
    end_seconds: z.number(),
    purpose: z.string().describe("Short label, e.g. 'Hook', 'Problem', 'Demo: dashboard', 'Call to action'"),
    voiceover: z.string().describe("ONLY the words spoken aloud in this scene. No stage directions, no visual notes. Empty string if silent."),
    avatar: z.object({
      appears: z.boolean().describe("Whether the presenter is on screen in this scene"),
      placement: z.enum(PLACEMENTS),
      scale_percent: z.number().describe("Presenter width as a percent of the frame, 15-60; ignored for full"),
      direction: z.string().describe("Presenter body language/gesture for this scene, never spoken. Empty if none.")
    }),
    visual: z.string().describe("What is on screen besides the presenter (product UI, screen recording, graphic)"),
    overlays: z.array(z.object({ type: z.enum(["TITLE", "CAPTION", "LOWER THIRD", "CALLOUT"]), text: z.string() })),
    effects: z.array(z.object({ type: z.enum(["ZOOM", "HIGHLIGHT", "PULSE", "POINTS TO"]), target: z.string() })),
    transition: z.string().nullable().describe("Transition into the next scene, e.g. 'fade', 'slide to dashboard'"),
    broll: z.string().nullable().describe("Suggested B-roll footage, or null")
  })),
  captions: z.boolean(),
  outro: z.object({ cta: z.string(), url: z.string() }).nullable()
});
export type ProductionPlan = z.infer<typeof Plan>;

const SYSTEM = `You are the production planner inside DirectorAI™, a video production studio made by HCCGSA LLC™. The user describes a video; you return a complete, realistic production plan they will review and edit before anything is generated.

Planning rules:
- Scenes must be contiguous, start at 0, and end at the requested duration. Narration pace is about 2.5 words per second — size each voiceover to fit its scene with a little breathing room.
- voiceover contains ONLY the words spoken aloud. Put gestures and body language in avatar.direction, what's on screen in visual, and on-screen text in overlays. Never mix them.
- Respect the presenter settings: if there is no presenter, set avatar.appears false everywhere. For "Intro + Outro", the presenter appears only in the first and last scenes. For "Full video", in every scene. For "DirectorAI decides", use the presenter where a human guide helps (openings, key claims, closings) and hide them during product demonstrations.
- Use "full" placement for presenter-led openings and closings; use a corner placement at 20-30% while a product or screen is being shown.
- Effects and callouts must name concrete on-screen elements from the visual description.
- Include an outro with the call to action and URL when the user gives one.
- Keep product and brand names exactly as written, including ™ marks.`;

interface Body {
  prompt?: string; duration_seconds?: number; format?: string; style?: string;
  presenter?: string | null; avatar_usage?: string; voice?: string; has_video?: boolean;
}

export async function createPlan(body: Body | null, env: Env, client = claude(env)) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: "The AI Video Creator isn't set up on the server yet." }, 503);
  const b = body;
  const prompt = b?.prompt?.trim();
  if (!prompt) return json({ error: "Describe the video you want to make." }, 400);
  if (prompt.length > 6000) return json({ error: "That description is too long. Keep it under 6,000 characters." }, 400);
  const duration = Math.round(Math.min(600, Math.max(10, Number(b?.duration_seconds) || 60)));
  const brief = [
    `Requested duration: ${duration} seconds`,
    `Format: ${["16:9", "9:16", "1:1"].includes(b?.format ?? "") ? b!.format : "16:9"}`,
    `Style: ${(b?.style ?? "Professional").slice(0, 60)}`,
    `Presenter: ${b?.presenter ? b.presenter.slice(0, 60) : "none — no presenter on screen"}`,
    `Presenter usage: ${(b?.avatar_usage ?? "DirectorAI decides").slice(0, 60)}`,
    `Voice: ${(b?.voice ?? "default").slice(0, 60)}`,
    `The user ${b?.has_video ? "has" : "does not yet have"} screen recording / product footage.`
  ].join("\n");

  try {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: "user", content: `${brief}\n\nVIDEO REQUEST\n${prompt}` }],
      output_config: { format: zodOutputFormat(Plan) }
    });
    if (response.stop_reason === "refusal") return json({ error: "The AI Video Creator declined that request." }, 422);
    const plan = response.parsed_output;
    if (!plan || !plan.scenes.length) return json({ error: "The plan came back incomplete. Try again or add detail." }, 502);
    // The requested length is authoritative. Conversion later makes scene boundaries contiguous.
    return json({ plan: { ...plan, estimated_duration_seconds: duration }, truncated: response.stop_reason === "max_tokens" });
  } catch (error) {
    if (error instanceof Anthropic.APIError || !(error instanceof Error)) return aiFailure(error, "The AI Video Creator");
    return json({ error: "The plan couldn't be read. Try again." }, 502);
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) =>
  createPlan(await request.json().catch(() => null) as Body | null, env);
