/**
 * AI production plans: the shape /api/plan returns, and turning an (edited) plan
 * into an ordinary DirectorAI project — a Director's Script plus per-line avatar
 * layouts. Nothing here generates media; the result is reviewed in Studio first.
 */
import { formatSeconds, parseScript } from "./parser.ts";
import { lineKey, presetLayout, type AvatarLayout, type AvatarPreset, type Project } from "./project.ts";

export type Placement = Exclude<AvatarPreset, "custom">;

export interface PlanScene {
  start_seconds: number;
  end_seconds: number;
  purpose: string;
  voiceover: string;
  avatar: { appears: boolean; placement: Placement; scale_percent: number; direction: string };
  visual: string;
  overlays: { type: "TITLE" | "CAPTION" | "LOWER THIRD" | "CALLOUT"; text: string }[];
  effects: { type: "ZOOM" | "HIGHLIGHT" | "PULSE" | "POINTS TO"; target: string }[];
  transition: string | null;
  broll: string | null;
}

export interface ProductionPlan {
  title: string;
  objective: string;
  audience: string;
  estimated_duration_seconds: number;
  scenes: PlanScene[];
  captions: boolean;
  outro: { cta: string; url: string } | null;
}

export interface CreatorSettings {
  prompt: string;
  duration: number;
  format: Project["format"];
  style: string;
  /** Presenter name, or null for no presenter */
  presenter: string | null;
  usage: "Full video" | "Intro + Outro" | "Selected scenes" | "DirectorAI decides";
  voice: string;
}

/** One line, safe for the parser: no line breaks, no stray brackets */
const oneLine = (s: string) => s.replace(/\s+/g, " ").replace(/[[\]]/g, "").trim();
/** Remove common presenter/camera/production directions accidentally returned in speech fields. */
export function spokenOnly(s: string): string {
  return s.split(/(?<=[.!?])\s+/).filter(sentence =>
    !/^\s*(?:\[[^\]]+\]|(?:the\s+)?(?:presenter|avatar|camera|screen)\s+|(?:Victor|ARIA|presenter|avatar)\s+(?:gestures?|smiles?|points?|looks?|turns?|walks?|moves?|nods?|waves?|faces?)\b)/i.test(sentence)
  ).join(" ").replace(/\[(?:visual|scene|b-?roll|stage direction|direction)[^\]]*\]/gi, "").trim();
}
/** Spoken text goes inside double quotes, so keyword-like words can't be read as directions */
const quoted = (s: string) => `"${oneLine(s).replace(/"/g, "”")}"`;

/** Scene timestamps kept in order and inside the video */
export function normalizeScenes(scenes: PlanScene[], total: number): PlanScene[] {
  const ordered = [...scenes].sort((a, b) => a.start_seconds - b.start_seconds);
  const weights = ordered.map(s => Math.max(0.1, s.end_seconds - s.start_seconds));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  let cursor = 0;
  return ordered.map((s, i) => {
    const start = cursor;
    const end = i === ordered.length - 1 ? total : Math.min(total, start + total * weights[i] / weightTotal);
    cursor = end;
    return { ...s, start_seconds: start, end_seconds: end };
  });
}

export function planToScript(plan: ProductionPlan, presenter: string | null): string {
  const total = Math.max(5, plan.estimated_duration_seconds);
  const out: string[] = [];
  for (const s of normalizeScenes(plan.scenes, total)) {
    out.push(`[${formatSeconds(s.start_seconds)}]`);
    if (s.purpose.trim()) out.push(`[Scene: ${oneLine(s.purpose)}]`);
    const speech = spokenOnly(s.voiceover);
    if (speech) out.push(`VOICEOVER: ${quoted(speech)}`);
    const stage = [s.avatar.direction, s.voiceover.split(/(?<=[.!?])\s+/).filter(sentence => sentence !== spokenOnly(sentence)).join(" ")].filter(Boolean).join(" ");
    if (presenter && s.avatar.appears && stage.trim()) {
      const d = oneLine(stage).replace(/\.$/, "");
      out.push(`AVATAR: ${d.toLowerCase().startsWith(presenter.toLowerCase()) ? d : `${presenter} ${d.charAt(0).toLowerCase()}${d.slice(1)}`}`);
    }
    if (s.visual.trim()) out.push(`[Visual: ${oneLine(s.visual)}]`);
    for (const o of s.overlays) if (o.text.trim()) out.push(`${o.type}: ${oneLine(o.text)}`);
    for (const e of s.effects) if (e.target.trim()) out.push(`${e.type}: ${oneLine(e.target).replace(/\.$/, "")}`);
    if (s.broll?.trim()) out.push(`[B-roll: ${oneLine(s.broll)}]`);
    if (s.transition?.trim()) out.push(`TRANSITION: ${oneLine(s.transition)}`);
    out.push("");
  }
  return out.join("\n").trim() + "\n";
}

/** Per-line avatar layouts from the plan: shown/hidden, placement and size for each voiceover line */
export function planLayouts(plan: ProductionPlan, presenter: string | null): Record<string, Partial<AvatarLayout>> {
  const layouts: Record<string, Partial<AvatarLayout>> = {};
  for (const s of plan.scenes) {
    if (!s.voiceover.trim()) continue;
    // the key must match what the parser reads back (quotes normalized)
    const spoken = oneLine(s.voiceover).replace(/"/g, "”");
    const scale = Math.min(0.6, Math.max(0.15, (s.avatar.scale_percent || 27) / 100));
    layouts[lineKey(spoken)] = {
      visible: !!presenter && s.avatar.appears,
      ...presetLayout(s.avatar.placement, scale)
    };
  }
  return layouts;
}

/** The plan as a new project (built on `base`, a fresh project) */
export function planToProject(plan: ProductionPlan, settings: CreatorSettings, base: Project): Project {
  const script = planToScript(plan, settings.presenter);
  const p: Project = {
    ...base,
    name: plan.title.slice(0, 80) || "AI production",
    startedWith: "ai",
    script,
    avatarName: settings.presenter || "Presenter",
    voice: {
      ...base.voice,
      preset: (["pro-male", "pro-female", "casual-male", "casual-female"].includes(settings.voice) ? settings.voice : base.voice.preset) as typeof base.voice.preset,
      engine: (["pro-male", "pro-female", "casual-male", "casual-female"].includes(settings.voice) ? "animated" : base.voice.engine)
    },
    durationInput: Math.round(plan.estimated_duration_seconds),
    format: settings.format,
    avatarLayouts: planLayouts(plan, settings.presenter),
    avatar: { ...base.avatar, enabled: !!settings.presenter, label: settings.presenter ? `${settings.presenter} · DirectorAI™` : base.avatar.label },
    branding: {
      ...base.branding,
      captions: { ...base.branding.captions, enabled: plan.captions },
      outro: plan.outro ? { ...base.branding.outro, enabled: true, cta: plan.outro.cta, url: plan.outro.url } : { ...base.branding.outro, enabled: false }
    },
    plan
  };
  return p;
}

/** Sanity check used by tests and the review screen: every voiceover line parses back as speech, nothing else does */
export function spokenLines(project: Project): string[] {
  return parseScript(project.script, project.avatarName, project.durationInput).scenes.map(s => s.spoken).filter(Boolean);
}
