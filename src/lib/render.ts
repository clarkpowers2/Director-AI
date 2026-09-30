/**
 * Frame compositor — draws one frame of the program at time t. Layer order:
 * base video (+zoom, targeted effects) → B-roll → overlays → captions → avatar →
 * logo → fades/slides. Intro and outro cards replace the main layers.
 */
import {
  avatarGesture, drawOverlays, drawTargetEffects, drawTransitions, mapTarget, wrapText, zoomAt, TARGETED,
  type Rect, type TimedEffect
} from "./effects.ts";
import { ENVELOPE_FPS } from "./audio.ts";
import {
  currentPhoto, gestureSupport, speechSchedule, SPEED_RATE,
  type AvatarClip, type AvatarPosition, type AvatarSize, type RenderState
} from "./project.ts";

export interface Media {
  base: HTMLVideoElement | null;
  /** Noise-reduced base audio, played instead of the video's own track */
  baseAudio: HTMLAudioElement | null;
  music: HTMLAudioElement | null;
  /** clip key → HeyGen video or free-voice audio */
  clips: Map<string, HTMLVideoElement | HTMLAudioElement>;
  /** B-roll id → video */
  broll: Map<string, HTMLVideoElement>;
  avatarPhoto: HTMLImageElement | null;
  logo: HTMLImageElement | null;
}

export const emptyMedia = (): Media => ({
  base: null, baseAudio: null, music: null, clips: new Map(), broll: new Map(), avatarPhoto: null, logo: null
});

export interface FrameOptions {
  /** Target-editing mode: no zoom, dashed boxes around targeted effects */
  editTargets?: boolean;
  selectedDirectionId?: string | null;
}

export function contentRect(W: number, H: number, aspect: number | null): Rect {
  if (!aspect) return { x: 0, y: 0, w: W, h: H };
  if (aspect > W / H) {
    const h = W / aspect;
    return { x: 0, y: (H - h) / 2, w: W, h };
  }
  const w = H * aspect;
  return { x: (W - w) / 2, y: 0, w, h: H };
}

export function baseAspect(media: Media): number | null {
  const v = media.base;
  return v && v.videoWidth ? v.videoWidth / v.videoHeight : null;
}

/** A seeking video has no frame; keep each video's last good frame so nothing flashes */
const lastFrames = new WeakMap<HTMLVideoElement, HTMLCanvasElement>();

/** Whether a video can be drawn (now, or from its last good frame) — without copying anything */
export function hasFrame(v: HTMLVideoElement): boolean {
  return lastFrames.has(v) || (v.readyState >= 2 && v.videoWidth > 0);
}

export function videoFrame(v: HTMLVideoElement): HTMLCanvasElement | null {
  let snap = lastFrames.get(v);
  if (v.readyState >= 2 && v.videoWidth) {
    if (!snap) {
      snap = document.createElement("canvas");
      lastFrames.set(v, snap);
    }
    if (snap.width !== v.videoWidth || snap.height !== v.videoHeight) {
      snap.width = v.videoWidth;
      snap.height = v.videoHeight;
    }
    snap.getContext("2d")!.drawImage(v, 0, 0);
  }
  return snap ?? null;
}

/** Avatar width as a share of the screen: 25% / 33% / 50% */
export const WIDTH_FRACTION: Record<AvatarSize, number> = { small: 0.25, medium: 0.33, large: 0.5 };

/**
 * Where the avatar goes. `aspect` is the avatar's width/height (a cropped
 * transparent clip, or a portrait card for framed video and photos).
 * Transparent avatars stand on the bottom edge; framed ones float above it.
 */
export function avatarRect(
  W: number, H: number, k: number, position: AvatarPosition, size: AvatarSize, aspect: number, framed: boolean
): Rect {
  if (position === "full") return { x: 0, y: 0, w: W, h: H };
  const margin = 36 * k, labelSpace = framed ? 52 * k : 0;
  let w = W * WIDTH_FRACTION[size];
  let h = w / aspect;
  const maxH = H - (framed ? margin + labelSpace + 20 * k : 10 * k);
  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }
  const y = framed ? H - margin - labelSpace - h : H - h;
  const x = position === "left" ? (framed ? margin : 0)
    : position === "right" || position === "corner" ? W - w - (framed ? margin : 0)
    : (W - w) / 2;
  return { x, y, w, h };
}

/** Bounding box of the visible (non-transparent) pixels in a frame, normalized, grown over time */
const alphaBoxes = new WeakMap<HTMLVideoElement, { box: Rect; samples: number; last: number }>();
const probe = typeof document !== "undefined" ? document.createElement("canvas") : null;

export function alphaBounds(el: HTMLVideoElement, frame: HTMLCanvasElement, now: number): Rect | null {
  const cached = alphaBoxes.get(el);
  if (cached && (cached.samples >= 12 || now - cached.last < 400)) return cached.box;
  if (!probe) return cached?.box ?? null;
  const pw = 160, ph = Math.max(1, Math.round((160 * frame.height) / frame.width));
  probe.width = pw;
  probe.height = ph;
  const pctx = probe.getContext("2d", { willReadFrequently: true })!;
  pctx.clearRect(0, 0, pw, ph);
  pctx.drawImage(frame, 0, 0, pw, ph);
  const data = pctx.getImageData(0, 0, pw, ph).data;
  let x0 = pw, y0 = ph, x1 = -1, y1 = -1;
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      if (data[(y * pw + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return cached?.box ?? null;
  const pad = 2;
  let box: Rect = {
    x: Math.max(0, x0 - pad) / pw, y: Math.max(0, y0 - pad) / ph,
    w: (Math.min(pw, x1 + pad + 1) - Math.max(0, x0 - pad)) / pw, h: (Math.min(ph, y1 + pad + 1) - Math.max(0, y0 - pad)) / ph
  };
  if (cached) {
    // union with earlier samples — the presenter may step or gesture wider later
    const nx = Math.min(cached.box.x, box.x), ny = Math.min(cached.box.y, box.y);
    box = { x: nx, y: ny, w: Math.max(cached.box.x + cached.box.w, box.x + box.w) - nx, h: Math.max(cached.box.y + cached.box.h, box.y + box.h) - ny };
  }
  alphaBoxes.set(el, { box, samples: (cached?.samples ?? 0) + 1, last: now });
  return box;
}

export interface ActiveClip { key: string; clip: AvatarClip; offset: number }

/** The voiceover line being spoken at main time m (offset is in the clip's own seconds) */
export function activeClip(state: RenderState, m: number): ActiveClip | null {
  const rate = SPEED_RATE[state.project.voice.speed];
  for (const slot of speechSchedule(state.parse, state.project, state.clips)) {
    const { key, clip } = slot;
    if (!key || clip?.status !== "done" || !clip.duration) continue;
    if (m >= slot.start && m < slot.end) return { key, clip, offset: (m - slot.start) * rate };
  }
  return null;
}

function drawCard(
  ctx: CanvasRenderingContext2D, W: number, H: number, k: number, state: RenderState, media: Media,
  big: string, small: string, smallAccent: boolean, alpha: number
) {
  const { primary, accent, font } = state.project.branding;
  ctx.save();
  ctx.fillStyle = primary;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = alpha;
  let y = H * 0.42;
  if (media.logo) {
    const lw = 180 * k, lh = lw * (media.logo.naturalHeight / media.logo.naturalWidth || 1);
    ctx.drawImage(media.logo, (W - lw) / 2, H * 0.3 - lh, lw, lh);
    y = H * 0.48;
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = accent;
  ctx.font = `700 ${84 * k}px "${font}", serif`;
  const lines = wrapText(ctx, big, W * 0.8);
  lines.forEach((l, i) => ctx.fillText(l, W / 2, y + i * 96 * k));
  const after = y + lines.length * 96 * k;
  ctx.fillRect(W / 2 - 60 * k, after - 20 * k, 120 * k, 4 * k);
  ctx.fillStyle = smallAccent ? accent : "#ffffff";
  ctx.font = `${smallAccent ? 600 : 500} ${40 * k}px "${font}", sans-serif`;
  ctx.fillText(small, W / 2, after + 40 * k);
  ctx.restore();
}

export function renderFrame(
  ctx: CanvasRenderingContext2D, W: number, H: number, t: number,
  state: RenderState, media: Media, effects: TimedEffect[], opts: FrameOptions = {}
) {
  const k = H / 1080;
  const { branding, avatar } = state.project;
  const timing = state.timing;
  ctx.save();
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, W, H);

  const cardFade = (local: number, dur: number) => Math.min(1, local / 0.4, (dur - local) / 0.4);
  if (t < timing.intro) {
    drawCard(ctx, W, H, k, state, media, branding.intro.title, branding.intro.subtitle, false, cardFade(t, timing.intro));
    ctx.restore();
    return;
  }
  const m = t - timing.intro;
  if (m >= timing.main && timing.outro > 0) {
    drawCard(ctx, W, H, k, state, media, branding.outro.cta, branding.outro.url, true, cardFade(m - timing.main, timing.outro));
    ctx.restore();
    return;
  }

  // Base video with zoom and targeted effects
  const content = contentRect(W, H, baseAspect(media));
  const zoom = opts.editTargets ? null : zoomAt(effects, m, content);
  ctx.save();
  ctx.beginPath();
  ctx.rect(content.x, content.y, content.w, content.h);
  ctx.clip();
  if (zoom) ctx.setTransform(zoom.scale, 0, 0, zoom.scale, zoom.cx * (1 - zoom.scale), zoom.cy * (1 - zoom.scale));
  const baseFrame = media.base ? videoFrame(media.base) : null;
  if (baseFrame) ctx.drawImage(baseFrame, content.x, content.y, content.w, content.h);
  else {
    ctx.fillStyle = branding.primary;
    ctx.fillRect(content.x, content.y, content.w, content.h);
  }
  if (!opts.editTargets) drawTargetEffects(ctx, effects, m, content, k, branding.accent);
  ctx.restore();

  drawBroll(ctx, W, H, k, m, state, media, branding.accent);

  if (opts.editTargets) drawTargetBoxes(ctx, effects, content, k, opts.selectedDirectionId ?? null, branding.accent);
  else drawOverlays(ctx, effects, m, W, H, k, branding, content, zoom);

  const heygen = state.project.voice.engine === "heygen";
  const showAvatar = avatar.enabled && (heygen ? !!avatar.heygen : !!currentPhoto(avatar));
  const look = showAvatar ? avatarLook(state, media, m, t) : null;
  const aRect = look ? avatarRect(W, H, k, avatar.position, avatar.size, look.aspect, look.framed) : null;
  if (branding.captions.enabled && state.parse) {
    // keep captions clear of the avatar
    let left = 0, right = W, forceTop = false;
    if (aRect && avatar.position === "left") left = aRect.x + aRect.w;
    if (aRect && avatar.position === "right") right = aRect.x;
    if (aRect && avatar.position === "bottom-center") forceTop = true;
    drawCaptions(ctx, state, m, H, k, left, right, forceTop);
  }
  if (look && aRect) drawAvatar(ctx, state, effects, m, t, W, H, k, aRect, content, look, opts.editTargets ?? false);

  if (media.logo) {
    const lw = branding.logoSize * k;
    const lh = lw * (media.logo.naturalHeight / media.logo.naturalWidth || 1);
    const margin = 32 * k;
    const x = branding.logoPosition.endsWith("left") ? margin : W - margin - lw;
    const y = branding.logoPosition.startsWith("top") ? margin : H - margin - lh;
    ctx.drawImage(media.logo, x, y, lw, lh);
  }

  if (!opts.editTargets) drawTransitions(ctx, effects, m, W, H, branding.primary, branding.accent);
  ctx.restore();
}

function drawBroll(ctx: CanvasRenderingContext2D, W: number, H: number, k: number, m: number, state: RenderState, media: Media, accent: string) {
  for (const b of state.project.broll) {
    if (m < b.start || m >= b.start + b.length) continue;
    const el = media.broll.get(b.id);
    const frame = el ? videoFrame(el) : null;
    if (!frame) continue;
    const fade = Math.min(1, (m - b.start) / 0.3, (b.start + b.length - m) / 0.3);
    ctx.save();
    ctx.globalAlpha = fade;
    if (b.mode === "full") {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      const r = contentRect(W, H, frame.width / frame.height);
      ctx.drawImage(frame, r.x, r.y, r.w, r.h);
    } else {
      const w = W * 0.36, h = w * (frame.height / frame.width);
      const r = { x: 36 * k, y: 36 * k, w, h };
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 20 * k;
      ctx.drawImage(frame, r.x, r.y, r.w, r.h);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 3 * k;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
    ctx.restore();
  }
}

function drawCaptions(ctx: CanvasRenderingContext2D, state: RenderState, m: number, H: number, k: number, leftEdge: number, rightEdge: number, forceTop: boolean) {
  const { branding, translations } = state.project;
  const slot = speechSchedule(state.parse, state.project, state.clips).find(s => m >= s.start && m < s.end);
  const scene = slot ? state.parse!.scenes[slot.sceneIndex] : undefined;
  if (!scene) return;
  const lang = branding.captions.language;
  const text = lang !== "original" ? translations[lang]?.[scene.spoken] ?? scene.spoken : scene.spoken;
  const { size, color } = branding.captions;
  const position = forceTop ? "top" : branding.captions.position;
  ctx.save();
  ctx.font = `600 ${size * k}px "${branding.font}", sans-serif`;
  const centerX = (leftEdge + rightEdge) / 2;
  const lines = wrapText(ctx, text, (rightEdge - leftEdge) * 0.8);
  const lineH = size * 1.3 * k;
  const boxH = lines.length * lineH + 24 * k;
  const boxW = Math.max(...lines.map(l => ctx.measureText(l).width)) + 48 * k;
  const y = position === "top" ? 40 * k : H - 40 * k - boxH;
  ctx.fillStyle = "rgba(0,0,0,0.62)";
  ctx.beginPath();
  ctx.roundRect(centerX - boxW / 2, y, boxW, boxH, 10 * k);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((l, i) => ctx.fillText(l, centerX, y + 12 * k + lineH * (i + 0.5)));
  ctx.restore();
}

interface AvatarLook {
  /** What to draw: a video frame, a crop of a transparent frame, or the photo */
  src: CanvasImageSource | null;
  /** Source crop in pixels */
  crop: Rect;
  aspect: number;
  /** Framed card (photo, or HeyGen video with a background) vs. free-standing transparent avatar */
  framed: boolean;
  speaking: boolean;
  amp: number;
  /** A still image we animate ourselves (photo, or a HeyGen frame between lines) */
  still: boolean;
}

const CARD_ASPECT = 0.8;

/** Pick the avatar's frame for time m: the speaking clip, or a still between lines */
function avatarLook(state: RenderState, media: Media, m: number, t: number): AvatarLook | null {
  const heygen = state.project.voice.engine === "heygen";
  const active = activeClip(state, m);
  const env = active?.clip.envelope;
  const amp = env && active ? env[Math.min(env.length - 1, Math.floor(active.offset * ENVELOPE_FPS))] ?? 0 : 0;

  let el = active ? media.clips.get(active.key) : undefined;
  let clip = active?.clip;
  let still = false;
  // The speaking clip may not have a decoded frame yet — hold the nearest one instead of vanishing
  if (heygen && el instanceof HTMLVideoElement && !hasFrame(el)) el = undefined;
  if (heygen && !(el instanceof HTMLVideoElement)) {
    // Between lines: hold the frame of the nearest HeyGen line (last one played, else the next)
    const near = nearestClip(state, m, media);
    el = near ? media.clips.get(near.key) : undefined;
    clip = near?.clip;
    still = true;
  }
  if (el instanceof HTMLVideoElement) {
    const frame = videoFrame(el);
    if (frame) {
      if (clip?.alpha && state.project.avatar.position !== "corner") {
        const b = alphaBounds(el, frame, t * 1000);
        if (b) {
          const crop = { x: b.x * frame.width, y: b.y * frame.height, w: b.w * frame.width, h: b.h * frame.height };
          return { src: frame, crop, aspect: crop.w / crop.h, framed: false, speaking: !!active, amp, still };
        }
      }
      return { src: frame, crop: coverCrop(frame.width, frame.height, CARD_ASPECT), aspect: CARD_ASPECT, framed: true, speaking: !!active, amp, still };
    }
  }
  if (heygen) return null; // nothing generated yet
  const photo = media.avatarPhoto;
  if (!photo || !photo.naturalWidth) return null;
  return {
    src: photo, crop: coverCrop(photo.naturalWidth, photo.naturalHeight, CARD_ASPECT), aspect: CARD_ASPECT,
    framed: true, speaking: !!active, amp, still: true
  };
}

function coverCrop(sw: number, sh: number, aspect: number): Rect {
  if (sw / sh > aspect) {
    const w = sh * aspect;
    return { x: (sw - w) / 2, y: 0, w, h: sh };
  }
  const h = sw / aspect;
  return { x: 0, y: Math.max(0, (sh - h) * 0.25), w: sw, h };
}

/** The closest generated line with a decoded frame: the last one before m, else the next */
function nearestClip(state: RenderState, m: number, media: Media): { key: string; clip: AvatarClip } | null {
  let before: { key: string; clip: AvatarClip; start: number } | null = null;
  let after: { key: string; clip: AvatarClip; start: number } | null = null;
  for (const s of speechSchedule(state.parse, state.project, state.clips)) {
    const { key, clip } = s;
    if (!key || !clip || clip.status !== "done") continue;
    const el = media.clips.get(key);
    if (!(el instanceof HTMLVideoElement) || !hasFrame(el)) continue;
    if (s.start <= m && (!before || s.start >= before.start)) before = { key, clip, start: s.start };
    if (s.start > m && (!after || s.start < after.start)) after = { key, clip, start: s.start };
  }
  return before ?? after;
}

function drawAvatar(
  ctx: CanvasRenderingContext2D, state: RenderState, effects: TimedEffect[],
  m: number, t: number, W: number, H: number, k: number, box: Rect, content: Rect, look: AvatarLook, editing: boolean
) {
  const { avatar, branding, voice } = state.project;
  const full = avatar.position === "full";
  const heygenGestures = voice.engine === "heygen" && gestureSupport(avatar.heygen).supported;
  const { amp, speaking } = look;

  let cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  // Canvas "body language" only when HeyGen isn't already acting the direction out
  const g = full || editing || heygenGestures || !look.framed
    ? { dx: 0, dy: 0, rotate: 0, scale: 1, alpha: 1, pointAt: null as { x: number; y: number; strength: number } | null }
    : avatarGesture(effects, m, content, { x: cx, y: cy }, W, k);
  if (!full && !editing && !heygenGestures && !look.framed) {
    // free-standing avatar without gesture control: keep the pointing beam
    const p = avatarGesture(effects, m, content, { x: cx, y: cy }, W, k).pointAt;
    g.pointAt = p;
  }

  let scale = g.scale, rotate = g.rotate, dy = g.dy;
  if (look.still) {
    // idle breathing so a still never looks frozen
    scale *= 1 + (look.framed ? 0.008 : 0.004) * Math.sin((t * 2 * Math.PI) / 4);
    dy += (look.framed ? 2 : 1) * k * Math.sin((t * 2 * Math.PI) / 4 + 1);
    if (look.framed) rotate += 0.4 * Math.sin((t * 2 * Math.PI) / 6);
    if (speaking) {
      dy -= 7 * k * amp;
      rotate += 1.4 * Math.sin(t * 5.3) * amp;
      scale *= 1 + 0.02 * amp;
    }
  }
  cx += g.dx;
  cy += dy;

  if (g.pointAt && g.pointAt.strength > 0.05) {
    ctx.save();
    ctx.globalAlpha = 0.85 * g.pointAt.strength;
    ctx.strokeStyle = branding.accent;
    ctx.lineWidth = 4 * k;
    ctx.setLineDash([2 * k, 12 * k]);
    ctx.lineCap = "round";
    const sx = cx + Math.sign(g.pointAt.x - cx) * box.w * 0.45, sy = cy - box.h * 0.15;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo((sx + g.pointAt.x) / 2, Math.min(sy, g.pointAt.y) - 80 * k, g.pointAt.x, g.pointAt.y - 70 * k);
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.globalAlpha = g.alpha;
  // scale about the feet for free-standing avatars, the center for cards
  const pivotY = look.framed ? cy : box.y + box.h;
  ctx.translate(cx, pivotY);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.scale(scale, scale);
  const local: Rect = { x: -box.w / 2, y: look.framed ? -box.h / 2 : -box.h, w: box.w, h: box.h };
  const c = look.crop;

  if (full) {
    if (look.src) ctx.drawImage(look.src, c.x, c.y, c.w, c.h, local.x, local.y, local.w, local.h);
  } else if (!look.framed) {
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 18 * k;
    if (look.src) ctx.drawImage(look.src, c.x, c.y, c.w, c.h, local.x, local.y, local.w, local.h);
  } else {
    const shape = () => {
      ctx.beginPath();
      ctx.roundRect(local.x, local.y, local.w, local.h, 18 * k);
    };
    ctx.save();
    ctx.shadowColor = look.still && speaking ? branding.accent : "rgba(0,0,0,0.5)";
    ctx.shadowBlur = (look.still && speaking ? 18 + 40 * amp : 24) * k;
    shape();
    ctx.fillStyle = branding.primary;
    ctx.fill();
    ctx.restore();
    ctx.save();
    shape();
    ctx.clip();
    if (look.src) ctx.drawImage(look.src, c.x, c.y, c.w, c.h, local.x, local.y, local.w, local.h);
    ctx.restore();
    ctx.strokeStyle = branding.accent;
    ctx.lineWidth = (4 + (look.still && speaking ? 3 * amp : 0)) * k;
    shape();
    ctx.stroke();
  }
  ctx.restore();

  if (avatar.label) {
    const r = { x: cx - box.w / 2, y: box.y + (cy - box.y - box.h / 2), w: box.w, h: box.h };
    drawAvatarLabel(ctx, r, W, H, k, avatar.position, look.framed, avatar.label, avatar.labelColor, branding, speaking ? amp : -1, t, g.alpha);
  }
}

function drawAvatarLabel(
  ctx: CanvasRenderingContext2D, r: Rect, W: number, H: number, k: number, position: AvatarPosition, framed: boolean,
  label: string, color: string, branding: RenderState["project"]["branding"], level: number, t: number, alpha: number
) {
  ctx.save();
  ctx.font = `600 ${26 * k}px "${branding.font}", sans-serif`;
  const meter = level >= 0 ? 44 * k : 0;
  const tw = ctx.measureText(label).width + 36 * k + meter;
  const h = 42 * k;
  let x = r.x + r.w / 2 - tw / 2;
  // under a card; over the lower legs of a free-standing avatar
  let y = framed ? r.y + r.h + 10 * k : H - h - 28 * k;
  if (position === "full") {
    x = 40 * k;
    y = H - 40 * k - h;
  }
  x = Math.max(8 * k, Math.min(W - tw - 8 * k, x));
  ctx.globalAlpha = alpha * 0.92;
  ctx.fillStyle = branding.primary;
  ctx.beginPath();
  ctx.roundRect(x, y, tw, h, h / 2);
  ctx.fill();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + 18 * k, y + h / 2 + 1);
  if (level >= 0) {
    const bx = x + tw - meter + 4 * k;
    for (let i = 0; i < 4; i++) {
      const bh = (6 + 18 * Math.max(0.15, level) * (0.6 + 0.4 * Math.abs(Math.sin(t * 9 + i * 1.7)))) * k;
      ctx.fillRect(bx + i * 8 * k, y + h / 2 - bh / 2, 4 * k, bh);
    }
  }
  ctx.restore();
}

function drawTargetBoxes(
  ctx: CanvasRenderingContext2D, effects: TimedEffect[], content: Rect, k: number, selectedId: string | null, accent: string
) {
  const seen = new Set<string>();
  for (const e of effects) {
    if (!TARGETED.has(e.direction.type)) continue;
    const r = mapTarget(e.target, content);
    const id = `${r.x}|${r.y}|${r.w}|${r.h}`;
    const selected = e.direction.id === selectedId;
    if (seen.has(id) && !selected) continue;
    seen.add(id);
    ctx.save();
    ctx.setLineDash(selected ? [] : [10 * k, 8 * k]);
    ctx.lineWidth = (selected ? 4 : 2) * k;
    ctx.strokeStyle = selected ? accent : "rgba(255,255,255,0.7)";
    ctx.fillStyle = selected ? "rgba(201,168,76,0.18)" : "rgba(255,255,255,0.06)";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.font = `600 ${22 * k}px Inter, sans-serif`;
    ctx.fillStyle = selected ? accent : "#ffffff";
    ctx.fillText(e.direction.text || e.direction.type, r.x + 6 * k, r.y - 8 * k);
    ctx.restore();
  }
}
