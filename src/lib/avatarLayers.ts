/**
 * Avatar layers — the avatar as a composition element. Each voiceover line's
 * rendered clip is placed, sized, shown/hidden and timed here. Everything in this
 * module edits or reads project data only: it never renders avatar footage and
 * never calls an avatar provider, so every change is free.
 *
 * Placement is resolution independent: x/y are the avatar's center as a share of
 * the frame (0..1), scale is its width as a share of the frame width.
 */
import type { ParseResult } from "./parser.ts";
import {
  AVATAR_PRESETS, layoutFor, lineKey, speechSchedule,
  type AvatarClip, type AvatarLayout, type AvatarPreset, type Project
} from "./project.ts";

export interface Rect { x: number; y: number; w: number; h: number }
export type Format = Project["format"];

/** Seconds an entrance or exit takes */
export const MOTION_SECONDS = 0.4;
export const MIN_SCALE = 0.08;
export const MIN_WINDOW = 0.25;

export interface AvatarSegment {
  /** Layout key (lineKey of the spoken text) */
  key: string;
  /** Position among the avatar lines, 0-based ("Scene 1" is 0) */
  index: number;
  sceneIndex: number;
  spoken: string;
  clipKey: string | null;
  clip?: AvatarClip;
  layout: AvatarLayout;
  /** On-screen window on the main timeline */
  start: number;
  end: number;
  /** The window before any manual start/end */
  autoStart: number;
  autoEnd: number;
  /** When this line's speech plays */
  speechStart: number;
  speechEnd: number;
  /** No entrance/exit animation where the avatar simply continues in the same spot */
  continuesFromPrevious: boolean;
  continuesToNext: boolean;
}

const EPS = 0.02;
const samePlace = (a: AvatarLayout, b: AvatarLayout) =>
  a.visible && b.visible && a.preset === b.preset && Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS &&
  Math.abs(a.scale - b.scale) < EPS && Math.abs(a.opacity - b.opacity) < EPS;

let cache: { parse: ParseResult; project: Project; clips: Record<string, AvatarClip>; main: number; segments: AvatarSegment[] } | null = null;

/** Every avatar line as a timed, placed layer (memoized per parse/project/clips) */
export function avatarSegments(
  parse: ParseResult | null, project: Project, clips: Record<string, AvatarClip>, mainSeconds: number
): AvatarSegment[] {
  if (!parse) return [];
  if (cache && cache.parse === parse && cache.project === project && cache.clips === clips && cache.main === mainSeconds) return cache.segments;
  const slots = speechSchedule(parse, project, clips);
  const segments = slots.map((slot, i): AvatarSegment => {
    const spoken = parse.scenes[slot.sceneIndex].spoken;
    const layout = layoutFor(project, spoken);
    const autoStart = slot.start;
    const autoEnd = Math.max(autoStart + MIN_WINDOW, i + 1 < slots.length ? slots[i + 1].start : Math.max(mainSeconds, slot.end));
    const start = clamp(layout.start ?? autoStart, 0, Math.max(0, mainSeconds - MIN_WINDOW));
    const end = Math.max(start + MIN_WINDOW, layout.end ?? autoEnd);
    return {
      key: lineKey(spoken), index: i, sceneIndex: slot.sceneIndex, spoken, clipKey: slot.key, clip: slot.clip, layout,
      start, end, autoStart, autoEnd, speechStart: slot.start, speechEnd: slot.end,
      continuesFromPrevious: false, continuesToNext: false
    };
  });
  for (let i = 1; i < segments.length; i++) {
    const a = segments[i - 1], b = segments[i];
    if (Math.abs(a.end - b.start) < 0.05 && samePlace(a.layout, b.layout)) a.continuesToNext = b.continuesFromPrevious = true;
  }
  cache = { parse, project, clips, main: mainSeconds, segments };
  return segments;
}

/** The layer on screen at main time m (the latest-starting window that contains m) */
export function activeSegment(segments: AvatarSegment[], m: number): AvatarSegment | null {
  let found: AvatarSegment | null = null;
  for (const s of segments) if (m >= s.start && m < s.end && (!found || s.start >= found.start)) found = s;
  return found;
}

// ───────── presets & geometry ─────────

/** Preset sizes per frame shape: a corner avatar needs a bigger share of a narrow 9:16 frame */
const PRESET_SCALE: Record<Format, Record<"corner" | "center", number>> = {
  "16:9": { corner: 0.24, center: 0.4 },
  "9:16": { corner: 0.45, center: 0.7 },
  "1:1": { corner: 0.32, center: 0.5 }
};

export const PRESET_ORDER: Exclude<AvatarPreset, "custom">[] = ["full", "bottom-right", "bottom-left", "top-right", "top-left", "center"];

/** Layout fields for a preset in this frame shape (keeps an explicit scale if given) */
export function applyPreset(preset: Exclude<AvatarPreset, "custom">, format: Format = "16:9", scale?: number): Pick<AvatarLayout, "preset" | "x" | "y" | "scale"> {
  const p = AVATAR_PRESETS[preset];
  if (preset === "full") return { preset, x: 0.5, y: 0.5, scale: 1 };
  const size = scale ?? PRESET_SCALE[format][preset === "center" ? "center" : "corner"];
  return { preset, x: p.x, y: p.y, scale: clamp(size, MIN_SCALE, 1) };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Pixel box for a layout in a W×H frame. `aspect` is the avatar image's width/height.
 * Keeps the aspect ratio and the whole avatar inside the frame. Full screen fills the frame.
 */
export function layoutBox(layout: Pick<AvatarLayout, "preset" | "x" | "y" | "scale">, W: number, H: number, aspect: number): Rect {
  if (layout.preset === "full") return { x: 0, y: 0, w: W, h: H };
  let w = clamp(layout.scale, MIN_SCALE, 1) * W;
  let h = w / aspect;
  if (h > H) { h = H; w = h * aspect; }
  const x = clamp(layout.x * W - w / 2, 0, W - w);
  const y = clamp(layout.y * H - h / 2, 0, H - h);
  return { x, y, w, h };
}

/** Normalized center for a box whose top-left is moved to (left, top) — kept inside the frame */
export function dragTo(box: Rect, left: number, top: number, W: number, H: number): Pick<AvatarLayout, "preset" | "x" | "y"> {
  const x = clamp(left, 0, W - box.w), y = clamp(top, 0, H - box.h);
  return { preset: "custom", x: (x + box.w / 2) / W, y: (y + box.h / 2) / H };
}

/**
 * Resize from the bottom-right corner, top-left fixed, aspect ratio kept and the
 * box kept inside the frame. Returns the new normalized layout fields.
 */
export function resizeTo(box: Rect, pointerX: number, pointerY: number, W: number, H: number): Pick<AvatarLayout, "preset" | "x" | "y" | "scale"> {
  const aspect = box.w / box.h;
  let w = Math.max(pointerX - box.x, (pointerY - box.y) * aspect);
  w = clamp(w, MIN_SCALE * W, Math.min(W - box.x, (H - box.y) * aspect));
  const h = w / aspect;
  return { preset: "custom", x: (box.x + w / 2) / W, y: (box.y + h / 2) / H, scale: w / W };
}

// ───────── entrance / exit ─────────

export interface Motion { alpha: number; dx: number; scale: number }

const ease = (p: number) => 1 - Math.pow(1 - clamp(p, 0, 1), 3);

/** Opacity, horizontal offset (px) and scale for a layer at main time m */
export function motionAt(segment: AvatarSegment, m: number, W: number): Motion {
  const { layout } = segment;
  let alpha = layout.opacity, dx = 0, scale = 1;
  const edge = layout.x >= 0.5 ? 1 : -1;
  const apply = (kind: AvatarLayout["entrance"], p: number) => {
    const e = ease(p);
    if (kind === "fade") alpha *= e;
    else if (kind === "slide") dx += (1 - e) * W * 0.35 * edge;
    else if (kind === "pop") { scale *= 0.85 + 0.15 * e; alpha *= e; }
  };
  if (!segment.continuesFromPrevious) apply(layout.entrance, (m - segment.start) / MOTION_SECONDS);
  if (!segment.continuesToNext) apply(layout.exit, (segment.end - m) / MOTION_SECONDS);
  return { alpha: clamp(alpha, 0, 1), dx, scale };
}

// ───────── editing helpers (pure) ─────────

/** New avatarLayouts with `change` applied to one line; the first edit copies the line's current layout */
export function withLayout(project: Project, key: string, spoken: string, change: Partial<AvatarLayout>): Project["avatarLayouts"] {
  return { ...project.avatarLayouts, [key]: { ...layoutFor(project, spoken), ...change } };
}

/** Move a whole layer (window and speech) by `delta` seconds */
export function moveSegment(segment: AvatarSegment, delta: number, mainSeconds: number): Partial<AvatarLayout> {
  const d = clamp(delta, -segment.start, Math.max(0, mainSeconds - segment.end));
  return { start: round(segment.start + d), end: round(segment.end + d), shift: round((segment.layout.shift || 0) + d) };
}

/** Trim a layer's on-screen window (speech timing unchanged) */
export function trimSegment(segment: AvatarSegment, edge: "start" | "end", time: number, mainSeconds: number): Partial<AvatarLayout> {
  if (edge === "start") return { start: round(clamp(time, 0, segment.end - MIN_WINDOW)) };
  return { end: round(clamp(time, segment.start + MIN_WINDOW, Math.max(mainSeconds, segment.start + MIN_WINDOW))) };
}

const round = (v: number) => Math.round(v * 100) / 100;
