/** AI prompter: project context for Claude, and applying the edits it returns. */
import { formatSeconds, type ParseResult } from "./parser.ts";
import { FONTS, type Project } from "./project.ts";

export type PageId = "editor" | "effects" | "advanced" | "audio" | "avatar" | "export" | "media" | "start" | "create" | "plan-review";
/** Pages outside the main tab bar */
export const EXTRA_PAGES: PageId[] = ["start", "create", "media", "plan-review"];

export interface CommandEdits {
  reply: string;
  script: string | null;
  effects: { keyword: string; text: string; at_seconds: number }[];
  avatar: { position: string | null; size: string | null; label: string | null; label_color: string | null; enabled: boolean | null } | null;
  voice: { speed: string | null; gesture: string | null } | null;
  branding: Record<string, string | number | boolean | null> | null;
  video: Record<string, number | boolean | null> | null;
  project_name: string | null;
  translate_captions_to: string | null;
  go_to_page: PageId | null;
}

/** A compact, readable snapshot of the project for the assistant */
export function buildContext(project: Project, parse: ParseResult, page: PageId, playhead: number, mainLength: number): string {
  const lines = project.script.split("\n").map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join("\n");
  const scenes = parse.scenes.map(s =>
    `- ${s.start === null ? "?" : formatSeconds(s.start)}${s.spoken ? ` says "${s.spoken}"` : ""}${s.directions.length ? ` [${s.directions.map(d => d.display).join("; ")}]` : ""}`
  ).join("\n");
  const { avatar, voice, branding: b, video } = project;
  return [
    `Name: ${project.name}`,
    `Current page: ${page}. Playhead: ${formatSeconds(playhead)} of ${formatSeconds(mainLength)} (main video).`,
    `Base video: ${project.base ? `${project.base.name}, ${formatSeconds(project.base.duration)}` : "none"}. Music: ${project.music?.name ?? "none"}.`,
    `Video: trim ${video.trimIn}s–${video.trimOut ?? "end"}, speed ${video.speed}×, volumes voice ${video.volumes.voice} video ${video.volumes.video} music ${video.volumes.music}.`,
    `Avatar: ${voice.engine === "heygen" ? `HeyGen "${avatar.heygen?.name ?? "none selected"}"` : "animated photo"}, position ${avatar.position}, size ${avatar.size}, label "${avatar.label}" (${avatar.labelColor}), ${avatar.enabled ? "shown" : "hidden"}. Voice speed ${voice.speed}, gesture style ${voice.gesture}.`,
    `Branding: primary ${b.primary}, accent ${b.accent}, font ${b.font}, logo ${b.logo ? b.logoPosition : "none"}, intro ${b.intro.enabled ? `"${b.intro.title}" ${b.intro.duration}s` : "off"}, outro ${b.outro.enabled ? `"${b.outro.cta}" ${b.outro.url} ${b.outro.duration}s` : "off"}, captions ${b.captions.enabled ? `${b.captions.size}px ${b.captions.color} ${b.captions.position}, language ${b.captions.language}` : "off"}.`,
    "",
    "SCRIPT (line numbers are for reference only — don't include them):",
    lines,
    "",
    "SCENES (timeline):",
    scenes
  ].join("\n");
}

const ENUMS = {
  position: ["left", "right", "bottom-center", "corner", "full"],
  size: ["small", "medium", "large"],
  speed: ["slow", "normal", "fast"],
  gesture: ["presenter", "teacher", "anchor", "casual"],
  logo_position: ["top-left", "top-right", "bottom-left", "bottom-right"],
  caption_position: ["top", "bottom"]
} as const;

const HEX = /^#[0-9a-f]{6}$/i;
const inRange = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null;
const oneOf = <T extends string>(v: unknown, list: readonly T[]) => (list as readonly string[]).includes(v as string) ? (v as T) : null;

/** Apply the edits to a project copy. Unknown or out-of-range values are ignored. */
export function applyEdits(project: Project, e: CommandEdits): { project: Project; effects: CommandEdits["effects"]; changed: string[] } {
  const p: Project = structuredClone(project);
  const changed: string[] = [];

  if (e.script !== null && e.script.trim() && e.script !== p.script) {
    p.script = e.script.replace(/^\s*\d+\|\s?/gm, "");
    changed.push("script");
  }
  if (e.project_name?.trim()) {
    p.name = e.project_name.trim().slice(0, 80);
    changed.push("name");
  }
  if (e.avatar) {
    const pos = oneOf(e.avatar.position, ENUMS.position);
    const size = oneOf(e.avatar.size, ENUMS.size);
    if (pos) p.avatar.position = pos;
    if (size) p.avatar.size = size;
    if (e.avatar.label !== null) p.avatar.label = e.avatar.label.slice(0, 60);
    if (e.avatar.label_color && HEX.test(e.avatar.label_color)) p.avatar.labelColor = e.avatar.label_color;
    if (typeof e.avatar.enabled === "boolean") p.avatar.enabled = e.avatar.enabled;
    changed.push("avatar");
  }
  if (e.voice) {
    const sp = oneOf(e.voice.speed, ENUMS.speed);
    const g = oneOf(e.voice.gesture, ENUMS.gesture);
    if (sp) p.voice.speed = sp;
    if (g) p.voice.gesture = g;
    changed.push("voice");
  }
  if (e.branding) {
    const b = e.branding, br = p.branding;
    if (typeof b.primary === "string" && HEX.test(b.primary)) br.primary = b.primary;
    if (typeof b.accent === "string" && HEX.test(b.accent)) br.accent = b.accent;
    const font = oneOf(b.font, FONTS);
    if (font) br.font = font;
    const lp = oneOf(b.logo_position, ENUMS.logo_position);
    if (lp) br.logoPosition = lp;
    if (typeof b.intro_enabled === "boolean") br.intro.enabled = b.intro_enabled;
    if (typeof b.intro_title === "string") br.intro.title = b.intro_title;
    if (typeof b.intro_subtitle === "string") br.intro.subtitle = b.intro_subtitle;
    const id = inRange(b.intro_duration, 1, 10);
    if (id !== null) br.intro.duration = id;
    if (typeof b.outro_enabled === "boolean") br.outro.enabled = b.outro_enabled;
    if (typeof b.outro_cta === "string") br.outro.cta = b.outro_cta;
    if (typeof b.outro_url === "string") br.outro.url = b.outro_url;
    const od = inRange(b.outro_duration, 1, 10);
    if (od !== null) br.outro.duration = od;
    if (typeof b.captions_enabled === "boolean") br.captions.enabled = b.captions_enabled;
    const cs = inRange(b.caption_size, 24, 72);
    if (cs !== null) br.captions.size = cs;
    if (typeof b.caption_color === "string" && HEX.test(b.caption_color)) br.captions.color = b.caption_color;
    const cp = oneOf(b.caption_position, ENUMS.caption_position);
    if (cp) br.captions.position = cp;
    changed.push("branding");
  }
  if (e.video) {
    const v = e.video, pv = p.video;
    const dur = p.base?.duration ?? Infinity;
    const ti = inRange(v.trim_in, 0, dur);
    if (ti !== null) pv.trimIn = ti;
    const to = inRange(v.trim_out, 0.5, dur);
    if (to !== null && to > pv.trimIn) pv.trimOut = to >= dur ? null : to;
    const sp = inRange(v.speed, 0.5, 2);
    if (sp !== null) pv.speed = sp;
    for (const [k, key] of [["volume_voice", "voice"], ["volume_video", "video"], ["volume_music", "music"]] as const) {
      const vol = inRange(v[k], 0, 1);
      if (vol !== null) pv.volumes[key] = vol;
    }
    if (typeof v.music_loop === "boolean") pv.musicLoop = v.music_loop;
    changed.push("video");
  }
  return { project: p, effects: e.effects ?? [], changed };
}
