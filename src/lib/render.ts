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
  currentPhoto, sceneClipKey, speechDuration, SPEED_RATE,
  type AvatarClip, type AvatarPosition, type AvatarSize, type RenderState
} from "./project.ts";

export interface Media {
  base: HTMLVideoElement | null;
  /** Noise-reduced base audio, played instead of the video's own track */
  baseAudio: HTMLAudioElement | null;
  music: HTMLAudioElement | null;
  /** clip key → D-ID video or free-voice audio */
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

const SIZE_FRACTION: Record<AvatarSize, number> = { small: 0.24, medium: 0.32, large: 0.42 };
const SIDE_FRACTION: Record<AvatarSize, number> = { small: 0.24, medium: 0.3, large: 0.36 };

export function avatarRect(W: number, H: number, k: number, position: AvatarPosition, size: AvatarSize): Rect {
  const s = H * SIZE_FRACTION[size];
  const margin = 36 * k, labelSpace = 52 * k;
  switch (position) {
    case "full": return { x: 0, y: 0, w: W, h: H };
    case "side": {
      const w = W * SIDE_FRACTION[size];
      return { x: W - w, y: 0, w, h: H };
    }
    case "floating": {
      const d = s * 0.85;
      return { x: W - margin - d, y: margin + 20 * k, w: d, h: d };
    }
    case "corner-right": return { x: W - margin - s, y: H - margin - labelSpace - s, w: s, h: s };
    default: return { x: margin, y: H - margin - labelSpace - s, w: s, h: s };
  }
}

export interface ActiveClip { key: string; clip: AvatarClip; offset: number }

/** The voiceover line being spoken at main time m (offset is in the clip's own seconds) */
export function activeClip(state: RenderState, m: number): ActiveClip | null {
  if (!state.parse) return null;
  const { avatar, voice } = state.project;
  const rate = SPEED_RATE[voice.speed];
  for (const scene of state.parse.scenes) {
    if (scene.start === null || !scene.spoken) continue;
    const key = sceneClipKey(avatar, voice, scene.spoken);
    const clip = key ? state.clips[key] : undefined;
    if (!key || clip?.status !== "done" || !clip.duration) continue;
    if (m >= scene.start && m < scene.start + clip.duration / rate) return { key, clip, offset: (m - scene.start) * rate };
  }
  return null;
}

function drawCover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, r: Rect) {
  const scale = Math.max(r.w / sw, r.h / sh);
  const w = sw * scale, h = sh * scale;
  ctx.drawImage(src, r.x + (r.w - w) / 2, r.y + (r.h - h) / 2, w, h);
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

  const showAvatar = avatar.enabled && !!currentPhoto(avatar);
  const aRect = avatarRect(W, H, k, avatar.position, avatar.size);
  const captionRight = showAvatar && avatar.position === "side" ? aRect.x : W;
  if (branding.captions.enabled && state.parse) drawCaptions(ctx, state, m, H, k, captionRight);
  if (showAvatar) drawAvatar(ctx, state, media, effects, m, t, W, H, k, aRect, content, opts.editTargets ?? false);

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

function drawCaptions(ctx: CanvasRenderingContext2D, state: RenderState, m: number, H: number, k: number, rightEdge: number) {
  const { branding, avatar, voice, translations } = state.project;
  const rate = SPEED_RATE[voice.speed];
  const scene = state.parse!.scenes.find(s => {
    if (!s.spoken || s.start === null) return false;
    const key = sceneClipKey(avatar, voice, s.spoken);
    return m >= s.start && m < s.start + speechDuration(s, key ? state.clips[key] : undefined, rate);
  });
  if (!scene) return;
  const lang = branding.captions.language;
  const text = lang !== "original" ? translations[lang]?.[scene.spoken] ?? scene.spoken : scene.spoken;
  const { size, color, position } = branding.captions;
  ctx.save();
  ctx.font = `600 ${size * k}px "${branding.font}", sans-serif`;
  const centerX = rightEdge / 2;
  const lines = wrapText(ctx, text, rightEdge * 0.72);
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

function drawAvatar(
  ctx: CanvasRenderingContext2D, state: RenderState, media: Media, effects: TimedEffect[],
  m: number, t: number, W: number, H: number, k: number, box: Rect, content: Rect, editing: boolean
) {
  const { avatar, branding } = state.project;
  const active = activeClip(state, m);
  const el = active ? media.clips.get(active.key) : undefined;
  const videoSrc = el instanceof HTMLVideoElement ? videoFrame(el) : null;
  const photo = media.avatarPhoto;
  const src: CanvasImageSource | null = videoSrc ?? photo;
  const sw = videoSrc ? videoSrc.width : photo?.naturalWidth ?? 0;
  const sh = videoSrc ? videoSrc.height : photo?.naturalHeight ?? 0;

  // Loudness drives the animated avatar and the label's level meter
  const env = active?.clip.envelope;
  const amp = env && active ? env[Math.min(env.length - 1, Math.floor(active.offset * ENVELOPE_FPS))] ?? 0 : 0;
  const speaking = !!active;
  const animatedPhoto = !videoSrc; // a still photo — we supply the motion

  const full = avatar.position === "full";
  let cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  if (avatar.position === "floating") cy += Math.sin(t * 1.3) * 6 * k;

  const g = full || editing
    ? { dx: 0, dy: 0, rotate: 0, scale: 1, alpha: 1, pointAt: null }
    : avatarGesture(effects, m, content, { x: cx, y: cy }, W, k);
  const side = avatar.position === "side";
  if (side) {
    // A full-height panel can't tilt or bob without showing its edges — it only shifts
    g.rotate = 0;
    g.dy = 0;
    g.scale = 1;
    g.dx = Math.max(0, g.dx);
  }

  // Idle breathing, plus a speaking bob for the animated photo
  let scale = g.scale, rotate = g.rotate, dy = g.dy;
  if (animatedPhoto && !side) {
    scale *= 1 + 0.008 * Math.sin((t * 2 * Math.PI) / 4);
    dy += 2 * k * Math.sin((t * 2 * Math.PI) / 4 + 1);
    rotate += 0.4 * Math.sin((t * 2 * Math.PI) / 6);
    if (speaking) {
      dy -= 7 * k * amp;
      rotate += 1.4 * Math.sin(t * 5.3) * amp;
      scale *= 1 + 0.02 * amp;
    }
  }
  cx += g.dx;
  cy += dy;

  // Pointing beam from the avatar toward the POINTS TO target
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
  ctx.translate(cx, cy);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.scale(scale, scale);
  const local: Rect = { x: -box.w / 2, y: -box.h / 2, w: box.w, h: box.h };
  const shape = () => {
    ctx.beginPath();
    if (avatar.position === "floating") ctx.arc(0, 0, box.w / 2, 0, Math.PI * 2);
    else if (avatar.position === "side") ctx.rect(local.x, local.y, local.w, local.h);
    else ctx.roundRect(local.x, local.y, local.w, local.h, 18 * k);
  };

  if (!full) {
    ctx.save();
    ctx.shadowColor = animatedPhoto && speaking ? branding.accent : "rgba(0,0,0,0.5)";
    ctx.shadowBlur = (animatedPhoto && speaking ? 18 + 40 * amp : 24) * k;
    shape();
    ctx.fillStyle = branding.primary;
    ctx.fill();
    ctx.restore();
    ctx.save();
    shape();
    ctx.clip();
    if (src && sw && sh) drawCover(ctx, src, sw, sh, local);
    ctx.restore();
    if (avatar.position !== "side") {
      ctx.strokeStyle = branding.accent;
      ctx.lineWidth = (4 + (animatedPhoto && speaking ? 3 * amp : 0)) * k;
      shape();
      ctx.stroke();
    }
  } else if (src && sw && sh) {
    drawCover(ctx, src, sw, sh, local);
  }
  ctx.restore();

  if (avatar.label) {
    drawAvatarLabel(ctx, { x: cx - box.w / 2, y: cy - box.h / 2, w: box.w, h: box.h }, W, H, k,
      avatar.position, avatar.label, avatar.labelColor, branding, speaking ? amp : -1, t, g.alpha);
  }
}

function drawAvatarLabel(
  ctx: CanvasRenderingContext2D, r: Rect, W: number, H: number, k: number, position: AvatarPosition,
  label: string, color: string, branding: RenderState["project"]["branding"], level: number, t: number, alpha: number
) {
  ctx.save();
  ctx.font = `600 ${26 * k}px "${branding.font}", sans-serif`;
  const meter = level >= 0 ? 44 * k : 0;
  const tw = ctx.measureText(label).width + 36 * k + meter;
  const h = 42 * k;
  let x = r.x + r.w / 2 - tw / 2;
  let y = r.y + r.h + 10 * k;
  if (position === "full" || position === "side") {
    x = r.x + 32 * k;
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
