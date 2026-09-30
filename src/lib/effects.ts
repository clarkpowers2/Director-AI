/**
 * Effects engine — timing and canvas drawing for scene directions.
 * The preview and the export both draw through these functions.
 */
import type { Direction, DirectionType, ParseResult } from "./parser.ts";
import { DEFAULT_TARGET, targetKey, type EffectStyle, type TargetRect } from "./project.ts";

/** Seconds each effect stays on screen */
export const EFFECT_DURATION: Record<DirectionType, number> = {
  ZOOM: 3, // 0.5 in, 2 hold, 0.5 out
  HIGHLIGHT: 2.6, // 0.3 in, 2 hold, 0.3 out
  PULSE: 1.5, // 3 × 0.5
  POINT: 2.4, // 3 bounces
  CALLOUT: 3,
  TITLE: 2.6,
  CAPTION: 3,
  "LOWER THIRD": 4,
  FADE: 1,
  TRANSITION: 1,
  GESTURE: 0,
  AVATAR: 0,
  ACTION: 0
};

export const EFFECT_ICON: Record<DirectionType, string> = {
  ZOOM: "🔍", HIGHLIGHT: "✨", POINT: "👆", PULSE: "💫", CALLOUT: "💬", TITLE: "📝", CAPTION: "🔤",
  "LOWER THIRD": "🪪", FADE: "🌅", TRANSITION: "🎞️", GESTURE: "🙌", AVATAR: "🧑‍💼", ACTION: "🎬"
};

export const EFFECT_COLOR: Record<DirectionType, string> = {
  ZOOM: "#38bdf8", HIGHLIGHT: "#c9a84c", POINT: "#f97316", PULSE: "#e879f9", CALLOUT: "#f472b6", TITLE: "#4ade80",
  CAPTION: "#a3e635", "LOWER THIRD": "#2dd4bf", FADE: "#94a3b8", TRANSITION: "#94a3b8", GESTURE: "#a78bfa", AVATAR: "#a78bfa", ACTION: "#64748b"
};

export const EFFECT_LABEL: Record<DirectionType, string> = {
  ZOOM: "Zoom", HIGHLIGHT: "Highlight", POINT: "Pointer", PULSE: "Pulse", CALLOUT: "Callout", TITLE: "Title card",
  CAPTION: "Caption card", "LOWER THIRD": "Lower third", FADE: "Fade", TRANSITION: "Transition",
  GESTURE: "Gesture", AVATAR: "Stage direction", ACTION: "Action"
};

/** Effects that land on a spot on the video */
export const TARGETED = new Set<DirectionType>(["ZOOM", "HIGHLIGHT", "PULSE", "POINT", "CALLOUT"]);
/** Effects with a color option */
export const COLORED = new Set<DirectionType>(["HIGHLIGHT", "PULSE", "POINT", "CALLOUT"]);
/** Avatar directions: acted out by HeyGen avatars that take gesture prompts; otherwise timeline-only */
export const V2_ONLY = new Set<DirectionType>(["GESTURE", "AVATAR", "ACTION"]);

export interface TimedEffect {
  direction: Direction;
  start: number;
  end: number;
  target: TargetRect;
  color: string | null;
}

export function timedEffects(
  parse: ParseResult | null, targets: Record<string, TargetRect>, styles: Record<string, EffectStyle> = {}
): TimedEffect[] {
  if (!parse) return [];
  const out: TimedEffect[] = [];
  for (const scene of parse.scenes) {
    if (scene.start === null) continue;
    for (const d of scene.directions) {
      const key = targetKey(d);
      out.push({
        direction: d, start: scene.start, end: scene.start + EFFECT_DURATION[d.type],
        target: targets[key] ?? DEFAULT_TARGET, color: styles[key]?.color ?? null
      });
    }
  }
  return out;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeInOut = (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

/** 0→1 over fadeIn, hold, 1→0 over fadeOut */
export function envelope(local: number, duration: number, fadeIn: number, fadeOut: number): number {
  if (local < 0 || local > duration) return 0;
  if (local < fadeIn) return easeInOut(local / fadeIn);
  if (local > duration - fadeOut) return easeInOut((duration - local) / fadeOut);
  return 1;
}

export interface Rect { x: number; y: number; w: number; h: number }

export function mapTarget(t: TargetRect, content: Rect): Rect {
  return { x: content.x + t.x * content.w, y: content.y + t.y * content.h, w: t.w * content.w, h: t.h * content.h };
}

/** Zoom transform at main time m: 150% about the target's center */
export function zoomAt(effects: TimedEffect[], m: number, content: Rect): { scale: number; cx: number; cy: number } | null {
  for (const e of effects) {
    if (e.direction.type !== "ZOOM" || m < e.start || m > e.end) continue;
    const env = envelope(m - e.start, e.end - e.start, 0.5, 0.5);
    const r = mapTarget(e.target, content);
    return { scale: 1 + 0.5 * env, cx: r.x + r.w / 2, cy: r.y + r.h / 2 };
  }
  return null;
}

/** Map a point through the active zoom so overlays drawn outside the zoom still line up */
export function zoomPoint(x: number, y: number, zoom: { scale: number; cx: number; cy: number } | null) {
  if (!zoom) return { x, y };
  return { x: zoom.cx + (x - zoom.cx) * zoom.scale, y: zoom.cy + (y - zoom.cy) * zoom.scale };
}

function roundRect(ctx: CanvasRenderingContext2D, r: Rect, radius: number) {
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, Math.max(0, Math.min(radius, r.w / 2, r.h / 2)));
}

/** HIGHLIGHT, PULSE and POINT — drawn inside the zoom transform so they track the element */
export function drawTargetEffects(
  ctx: CanvasRenderingContext2D, effects: TimedEffect[], m: number, content: Rect, k: number, accent: string
) {
  for (const e of effects) {
    if (m < e.start || m > e.end) continue;
    const local = m - e.start;
    const r = mapTarget(e.target, content);
    const color = e.color ?? accent;

    if (e.direction.type === "HIGHLIGHT") {
      ctx.save();
      ctx.globalAlpha = envelope(local, e.end - e.start, 0.3, 0.3);
      ctx.strokeStyle = color;
      ctx.lineWidth = 4 * k;
      ctx.shadowColor = color;
      ctx.shadowBlur = 18 * k;
      roundRect(ctx, r, 8 * k);
      ctx.stroke();
      ctx.restore();
    }

    if (e.direction.type === "PULSE") {
      const phase = (local % 0.5) / 0.5;
      const grow = 36 * k * phase;
      ctx.save();
      ctx.globalAlpha = (1 - phase) * 0.9;
      ctx.strokeStyle = color;
      ctx.lineWidth = 6 * k * (1 - phase) + 1;
      ctx.shadowColor = color;
      ctx.shadowBlur = 30 * k;
      roundRect(ctx, { x: r.x - grow, y: r.y - grow, w: r.w + 2 * grow, h: r.h + 2 * grow }, 12 * k + grow);
      ctx.stroke();
      ctx.globalAlpha = 0.18 * (1 - phase);
      ctx.fillStyle = color;
      roundRect(ctx, r, 8 * k);
      ctx.fill();
      ctx.restore();
    }

    if (e.direction.type === "POINT") {
      const dur = e.end - e.start;
      const bounce = Math.abs(Math.sin((Math.PI * 3 * local) / dur)) * 22 * k;
      const below = e.target.y < 0.22;
      const tipX = r.x + r.w / 2;
      const tipY = below ? r.y + r.h + 6 * k + bounce : r.y - 6 * k - bounce;
      drawArrow(ctx, tipX, tipY, below ? -1 : 1, k, color, envelope(local, dur, 0.25, 0.25));
    }
  }
}

function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, dir: 1 | -1, k: number, color: string, alpha: number) {
  const head = 34 * k, shaft = 70 * k, width = 14 * k;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.scale(1, dir);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-head * 0.75, -head);
  ctx.lineTo(-width / 2, -head);
  ctx.lineTo(-width / 2, -head - shaft);
  ctx.lineTo(width / 2, -head - shaft);
  ctx.lineTo(width / 2, -head);
  ctx.lineTo(head * 0.75, -head);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 10 * k;
  ctx.fill();
  ctx.lineWidth = 3 * k;
  ctx.strokeStyle = "#1a2744";
  ctx.stroke();
  ctx.restore();
}

export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export interface CardStyle { primary: string; accent: string; font: string }

/**
 * Overlays drawn above the video, outside the zoom: CALLOUT bubbles (positioned
 * through the zoom), TITLE cards, CAPTION cards and LOWER THIRD strips.
 */
export function drawOverlays(
  ctx: CanvasRenderingContext2D, effects: TimedEffect[], m: number, W: number, H: number, k: number,
  style: CardStyle, content: Rect, zoom: { scale: number; cx: number; cy: number } | null
) {
  for (const e of effects) {
    if (m < e.start || m > e.end) continue;
    const local = m - e.start;
    const dur = e.end - e.start;
    const text = e.direction.text || e.direction.display;
    const type = e.direction.type;

    if (type === "CALLOUT") {
      const a = envelope(local, dur, 0.25, 0.25);
      const r = mapTarget(e.target, content);
      const anchor = zoomPoint(r.x + r.w / 2, r.y, zoom);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = `600 ${32 * k}px "${style.font}", sans-serif`;
      const lines = wrapText(ctx, text, 460 * k);
      const lineH = 40 * k;
      const bw = Math.max(...lines.map(l => ctx.measureText(l).width)) + 48 * k;
      const bh = lines.length * lineH + 28 * k;
      const above = anchor.y - bh - 40 * k > 10 * k;
      const bx = Math.min(W - bw - 16 * k, Math.max(16 * k, anchor.x - bw / 2));
      const by = above ? anchor.y - bh - 36 * k : anchor.y + zoomedHeight(r, zoom) + 36 * k;
      const pop = 0.85 + 0.15 * Math.min(1, local / 0.25);
      ctx.translate(anchor.x, anchor.y);
      ctx.scale(pop, pop);
      ctx.translate(-anchor.x, -anchor.y);
      ctx.fillStyle = style.primary;
      ctx.strokeStyle = e.color ?? style.accent;
      ctx.lineWidth = 3 * k;
      ctx.shadowColor = "rgba(0,0,0,0.4)";
      ctx.shadowBlur = 16 * k;
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, 14 * k);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.stroke();
      // tail
      const tailX = Math.min(bx + bw - 30 * k, Math.max(bx + 30 * k, anchor.x));
      const tailBaseY = above ? by + bh : by;
      const tipY = above ? anchor.y - 6 * k : anchor.y + zoomedHeight(r, zoom) + 6 * k;
      ctx.beginPath();
      ctx.moveTo(tailX - 14 * k, tailBaseY);
      ctx.lineTo(anchor.x, tipY);
      ctx.lineTo(tailX + 14 * k, tailBaseY);
      ctx.closePath();
      ctx.fillStyle = e.color ?? style.accent;
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.textBaseline = "middle";
      lines.forEach((l, i) => ctx.fillText(l, bx + 24 * k, by + 14 * k + lineH * (i + 0.5)));
      ctx.restore();
    }

    if (type === "TITLE") {
      const a = envelope(local, dur, 0.3, 0.3);
      ctx.save();
      ctx.font = `700 ${72 * k}px "${style.font}", sans-serif`;
      const lines = wrapText(ctx, text, W * 0.8);
      const lineH = 86 * k;
      const bandH = Math.max(H * 0.26, lines.length * lineH + 80 * k);
      const y = (H - bandH) / 2;
      ctx.globalAlpha = a * 0.94;
      ctx.fillStyle = style.primary;
      ctx.fillRect(0, y, W, bandH);
      ctx.globalAlpha = a;
      ctx.fillStyle = style.accent;
      ctx.fillRect(0, y, W, 4 * k);
      ctx.fillRect(0, y + bandH - 4 * k, W, 4 * k);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      lines.forEach((l, i) => ctx.fillText(l, W / 2, y + bandH / 2 + (i - (lines.length - 1) / 2) * lineH));
      ctx.restore();
    }

    if (type === "CAPTION") {
      const a = envelope(local, dur, 0.3, 0.3);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = `600 ${44 * k}px "${style.font}", sans-serif`;
      const lines = wrapText(ctx, text, W * 0.6);
      const lineH = 54 * k;
      const boxH = lines.length * lineH + 36 * k;
      const boxW = Math.min(W * 0.66, Math.max(...lines.map(l => ctx.measureText(l).width)) + 72 * k);
      const x = 60 * k, y = H * 0.18 - boxH / 2;
      ctx.globalAlpha = a * 0.92;
      ctx.fillStyle = style.primary;
      ctx.fillRect(x, y, boxW, boxH);
      ctx.globalAlpha = a;
      ctx.fillStyle = style.accent;
      ctx.fillRect(x, y, 8 * k, boxH);
      ctx.fillStyle = "#ffffff";
      ctx.textBaseline = "middle";
      lines.forEach((l, i) => ctx.fillText(l, x + 36 * k, y + 18 * k + lineH * (i + 0.5)));
      ctx.restore();
    }

    if (type === "LOWER THIRD") {
      const [name, ...rest] = text.split(/\s*[|—–]\s*/);
      const title = rest.join(" · ");
      const slide = easeInOut(clamp01(local / 0.4)) * (1 - easeInOut(clamp01((local - (dur - 0.4)) / 0.4)));
      ctx.save();
      ctx.font = `700 ${46 * k}px "${style.font}", sans-serif`;
      const nameW = ctx.measureText(name).width;
      ctx.font = `500 ${30 * k}px "${style.font}", sans-serif`;
      const titleW = title ? ctx.measureText(title).width : 0;
      const w = Math.max(nameW, titleW) + 80 * k;
      const h = (title ? 118 : 80) * k;
      const x = 60 * k - (1 - slide) * (w + 80 * k);
      const y = H * 0.72 - h / 2;
      ctx.globalAlpha = Math.min(1, slide * 1.5);
      ctx.fillStyle = style.primary;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = style.accent;
      ctx.fillRect(x, y, 10 * k, h);
      ctx.textBaseline = "middle";
      ctx.fillStyle = style.accent;
      ctx.font = `700 ${46 * k}px "${style.font}", sans-serif`;
      ctx.fillText(name, x + 40 * k, y + (title ? 42 : 40) * k);
      if (title) {
        ctx.fillStyle = "#ffffff";
        ctx.font = `500 ${30 * k}px "${style.font}", sans-serif`;
        ctx.fillText(title, x + 40 * k, y + 88 * k);
      }
      ctx.restore();
    }
  }
}

function zoomedHeight(r: Rect, zoom: { scale: number } | null) {
  return r.h * (zoom?.scale ?? 1);
}

/**
 * Full-screen brand-color overlays from FADE and TRANSITION: returns the fade
 * opacity, and draws slide wipes directly.
 */
export function drawTransitions(ctx: CanvasRenderingContext2D, effects: TimedEffect[], m: number, W: number, H: number, primary: string, accent: string): void {
  let level = 0; // held state from FADE: out / FADE: in
  let dip = 0;
  const fades = effects.filter(e => e.direction.type === "FADE" || e.direction.type === "TRANSITION").sort((a, b) => a.start - b.start);
  for (const e of fades) {
    if (e.start > m) break;
    const p = clamp01((m - e.start) / (e.end - e.start));
    const text = e.direction.text.toLowerCase();
    if (e.direction.type === "FADE" && /\bout\b/.test(text)) level = p;
    else if (e.direction.type === "FADE" && /\bin\b/.test(text)) level = 1 - p;
    else if (/\b(slide|wipe|push)\b/.test(text)) {
      if (p > 0 && p < 1) {
        // panel sweeps in from the left, then out to the right
        const x = p < 0.5 ? -W + easeInOut(p * 2) * W : easeInOut((p - 0.5) * 2) * W;
        ctx.save();
        ctx.fillStyle = primary;
        ctx.fillRect(x, 0, W, H);
        ctx.fillStyle = accent;
        ctx.fillRect(p < 0.5 ? x + W - 8 : x, 0, 8, H);
        ctx.restore();
      }
    } else if (p < 1) {
      dip = Math.max(dip, 1 - Math.abs(2 * p - 1));
    }
  }
  const a = Math.max(level, dip);
  if (a > 0) {
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = primary;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}

/**
 * The avatar's "body language" from the script: it leans toward whatever is being
 * pointed at, zoomed or called out, and steps aside for title cards.
 */
export interface Gesture { dx: number; dy: number; rotate: number; scale: number; alpha: number; pointAt: { x: number; y: number; strength: number } | null }

export function avatarGesture(
  effects: TimedEffect[], m: number, content: Rect, avatarCenter: { x: number; y: number }, W: number, k: number
): Gesture {
  const g: Gesture = { dx: 0, dy: 0, rotate: 0, scale: 1, alpha: 1, pointAt: null };
  for (const e of effects) {
    if (m < e.start || m > e.end) continue;
    const dur = e.end - e.start;
    const type = e.direction.type;
    if (type === "POINT" || type === "ZOOM" || type === "CALLOUT") {
      const env = envelope(m - e.start, dur, 0.35, 0.35);
      const r = mapTarget(e.target, content);
      const tx = r.x + r.w / 2, ty = r.y + r.h / 2;
      const dxRaw = tx - avatarCenter.x, dyRaw = ty - avatarCenter.y;
      const len = Math.hypot(dxRaw, dyRaw) || 1;
      g.dx += (dxRaw / len) * 16 * k * env;
      g.dy += (dyRaw / len) * 8 * k * env;
      g.rotate += Math.sign(dxRaw) * 3 * env;
      if (type === "POINT") g.pointAt = { x: tx, y: r.y, strength: env };
    }
    if (type === "TITLE") {
      const env = envelope(m - e.start, dur, 0.3, 0.3);
      const toEdge = avatarCenter.x < W / 2 ? -1 : 1;
      g.dx += toEdge * 60 * k * env;
      g.scale *= 1 - 0.18 * env;
      g.alpha *= 1 - 0.35 * env;
    }
  }
  return g;
}
