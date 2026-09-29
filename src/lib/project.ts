/** Project state shared by every section, the renderer, the player and export. */
import type { Direction, ParseResult } from "./parser.ts";

// ---------- Avatar ----------

export type PresenterId = "professional" | "creator" | "anchor" | "tech" | "custom";
export type OutfitId = "formal" | "casual" | "creative" | "custom";
export type AvatarPosition = "corner-left" | "corner-right" | "side" | "full" | "floating";
export type AvatarSize = "small" | "medium" | "large";

export const PRESENTERS: Record<PresenterId, {
  name: string; description: string; outfit: OutfitId; voice: VoicePreset; tone: VoiceTone; position: AvatarPosition;
}> = {
  professional: { name: "Professional presenter", description: "Business demos, sales outreach", outfit: "formal", voice: "pro-male", tone: "authoritative", position: "corner-left" },
  creator: { name: "YouTube creator", description: "Casual explainers, talking head", outfit: "creative", voice: "casual-female", tone: "warm", position: "corner-right" },
  anchor: { name: "News anchor", description: "Announcements, briefings", outfit: "formal", voice: "pro-female", tone: "authoritative", position: "side" },
  tech: { name: "Tech demo presenter", description: "Product walkthroughs, onboarding", outfit: "casual", voice: "casual-male", tone: "neutral", position: "floating" },
  custom: { name: "Custom", description: "Your own presenter photo", outfit: "custom", voice: "pro-female", tone: "neutral", position: "corner-left" }
};

export const OUTFITS: Record<OutfitId, string> = {
  formal: "Business formal (navy suit)",
  casual: "Business casual",
  creative: "Creative / casual",
  custom: "Custom"
};

/** A presenter photo. The full image lives in IndexedDB; D-ID gets its own upload when first needed. */
export interface AvatarImage {
  mediaId: string;
  thumbnail: string;
  didUrl?: string;
}

export interface AvatarSettings {
  presenter: PresenterId;
  outfit: OutfitId;
  /** key: `${presenter}:${outfit}` */
  photos: Record<string, AvatarImage>;
  enabled: boolean;
  position: AvatarPosition;
  size: AvatarSize;
  label: string;
  labelColor: string;
}

export const photoKey = (a: Pick<AvatarSettings, "presenter" | "outfit">) => `${a.presenter}:${a.outfit}`;
export const currentPhoto = (a: AvatarSettings): AvatarImage | undefined => a.photos[photoKey(a)];

// ---------- Voice ----------

export type VoicePreset = "pro-male" | "pro-female" | "casual-male" | "casual-female";
export type VoiceSpeed = "slow" | "normal" | "fast";
export type VoiceTone = "warm" | "neutral" | "authoritative";
/** did = photoreal lip-sync via D-ID; animated = free voice (Workers AI) + animated photo */
export type VoiceEngine = "did" | "animated";

export interface VoiceSettings {
  preset: VoicePreset;
  speed: VoiceSpeed;
  tone: VoiceTone;
  engine: VoiceEngine;
}

export const VOICE_PRESETS: Record<VoicePreset, { label: string; did: string; aura: string }> = {
  "pro-male": { label: "Professional male (Victor)", did: "en-US-GuyNeural", aura: "orion" },
  "pro-female": { label: "Professional female (ARIA)", did: "en-US-AriaNeural", aura: "athena" },
  "casual-male": { label: "Casual male", did: "en-US-DavisNeural", aura: "arcas" },
  "casual-female": { label: "Casual female", did: "en-US-JennyNeural", aura: "luna" }
};

/** Microsoft speaking style per tone (D-ID only; the free voice has no tone control) */
const TONE_STYLES: Record<VoiceTone, Record<string, string>> = {
  warm: { "en-US-GuyNeural": "friendly", "en-US-AriaNeural": "friendly", "en-US-DavisNeural": "friendly", "en-US-JennyNeural": "friendly" },
  neutral: {},
  authoritative: { "en-US-GuyNeural": "newscast", "en-US-AriaNeural": "newscast-formal", "en-US-JennyNeural": "newscast" }
};

export function didVoice(v: VoiceSettings): { voice_id: string; style?: string } {
  const voice_id = VOICE_PRESETS[v.preset].did;
  return { voice_id, style: TONE_STYLES[v.tone][voice_id] };
}

export const SPEED_RATE: Record<VoiceSpeed, number> = { slow: 0.85, normal: 1, fast: 1.15 };

// ---------- Branding ----------

export type LogoPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export const FONTS = ["Inter", "Playfair Display", "Montserrat", "Poppins", "Lora"] as const;
export type BrandFont = (typeof FONTS)[number];

export interface Branding {
  primary: string;
  accent: string;
  font: BrandFont;
  logo: string | null; // data URL
  logoPosition: LogoPosition;
  logoSize: number; // px at 1080p
  intro: { enabled: boolean; title: string; subtitle: string; duration: number };
  outro: { enabled: boolean; cta: string; url: string; duration: number };
  captions: { enabled: boolean; size: number; color: string; position: "bottom" | "top"; language: string };
}

// ---------- Video / media ----------

export interface VideoSettings {
  trimIn: number;
  trimOut: number | null;
  speed: number;
  volumes: { video: number; voice: number; music: number };
  musicLoop: boolean;
  /** Play a noise-reduced copy of the base video's audio instead of the original */
  cleanBaseAudio: boolean;
}

export interface MediaRef {
  mediaId: string;
  name: string;
  duration: number;
}

export interface BrollClip extends MediaRef {
  id: string;
  /** Start on the main timeline, seconds */
  start: number;
  /** How long it plays (≤ its own duration) */
  length: number;
  mode: "full" | "pip";
}

export const MAX_VIDEO_SECONDS = 30 * 60;

// ---------- Effects ----------

/** Where an effect lands on the base video, normalized 0..1 */
export interface TargetRect { x: number; y: number; w: number; h: number }
export interface EffectStyle { color?: string }

/** Effects that name the same element share one placement and style */
export function targetKey(d: Direction): string {
  const shared = ["POINT", "ZOOM", "HIGHLIGHT", "PULSE", "CALLOUT"].includes(d.type);
  return `${shared ? "el" : d.type}:${d.text.toLowerCase().trim()}`;
}

export const DEFAULT_TARGET: TargetRect = { x: 0.35, y: 0.3, w: 0.3, h: 0.3 };

// ---------- Avatar clips ----------

export type ClipStatus = "queued" | "generating" | "done" | "error";
export interface AvatarClip {
  key: string;
  status: ClipStatus;
  /** video = D-ID talking head; audio = free voice driving the animated photo */
  kind?: "video" | "audio";
  url?: string;
  blob?: Blob;
  /** Natural length at 1× speed */
  duration?: number;
  /** Loudness per 1/30 s, 0..1 — drives the animated avatar */
  envelope?: number[];
  error?: string;
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Cache key for one voiceover line's clip (speed isn't part of it — it's applied at playback) */
export function sceneClipKey(avatar: AvatarSettings, voice: VoiceSettings, spoken: string): string | null {
  if (!spoken) return null;
  if (voice.engine === "did") {
    const photo = currentPhoto(avatar);
    if (!photo) return null;
    const v = didVoice(voice);
    return `d-${hash(`${photo.mediaId}|${v.voice_id}|${v.style ?? ""}|${spoken}`)}`;
  }
  return `a-${hash(`${VOICE_PRESETS[voice.preset].aura}|${spoken}`)}`;
}

/** Seconds a voiceover line is on screen: its clip at the chosen speed, or an estimate */
export function speechDuration(
  scene: { spoken: string; duration: number | null }, clip?: AvatarClip, rate = 1
): number {
  if (clip?.status === "done" && clip.duration) return clip.duration / rate;
  const estimate = scene.spoken.split(/\s+/).filter(Boolean).length / (2.6 * rate) + 1;
  return Math.max(0.5, scene.duration ? Math.min(scene.duration, estimate) : estimate);
}

// ---------- Program ----------

/** Program timeline = optional intro card + main video + optional outro card */
export interface ProgramTiming { intro: number; main: number; outro: number; total: number }

export function programTiming(branding: Branding, mainDuration: number): ProgramTiming {
  const intro = branding.intro.enabled ? Math.max(0, branding.intro.duration) : 0;
  const outro = branding.outro.enabled ? Math.max(0, branding.outro.duration) : 0;
  return { intro, main: mainDuration, outro, total: intro + mainDuration + outro };
}

export interface Project {
  version: 2;
  name: string;
  script: string;
  avatarName: string;
  durationInput: number | null;
  avatar: AvatarSettings;
  voice: VoiceSettings;
  branding: Branding;
  video: VideoSettings;
  base: MediaRef | null;
  music: MediaRef | null;
  cleanedAudio: MediaRef | null;
  broll: BrollClip[];
  targets: Record<string, TargetRect>;
  effectStyles: Record<string, EffectStyle>;
  /** language → source line → translation */
  translations: Record<string, Record<string, string>>;
}

/** Everything the renderer and player need for one frame */
export interface RenderState {
  parse: ParseResult | null;
  project: Project;
  clips: Record<string, AvatarClip>;
  timing: ProgramTiming;
}

export const DEFAULT_SCRIPT = `[0:00] Victor walks in and says: "Welcome to Haven Memory OS."
ZOOM: Haven logo. HIGHLIGHT: gold border.
LOWER THIRD: Victor | Guest Experience Lead

[0:10] Victor points to the Promises tile and says:
"Right here — 3 open promises Haven is tracking."
CALLOUT: Promises tile
[Gold pulse effect on tile]

[0:25] Victor shakes head and says:
"Most hotels lose this at shift change. Not Haven."
TRANSITION: slide to issues view
TITLE: 60-Day Free Pilot`;

export function defaultProject(): Project {
  return {
    version: 2,
    name: "Untitled production",
    script: DEFAULT_SCRIPT,
    avatarName: "Victor",
    durationInput: null,
    avatar: {
      presenter: "professional",
      outfit: "formal",
      photos: {},
      enabled: true,
      position: "corner-left",
      size: "medium",
      label: "Victor · DirectorAI™",
      labelColor: "#c9a84c"
    },
    voice: { preset: "pro-male", speed: "normal", tone: "authoritative", engine: "did" },
    branding: {
      primary: "#1a2744",
      accent: "#c9a84c",
      font: "Inter",
      logo: null,
      logoPosition: "top-right",
      logoSize: 120,
      intro: { enabled: false, title: "Haven Memory OS", subtitle: "A DirectorAI™ production", duration: 3 },
      outro: { enabled: false, cta: "Start your 60-Day Free Pilot", url: "haven-mos.org", duration: 4 },
      captions: { enabled: true, size: 40, color: "#ffffff", position: "bottom", language: "original" }
    },
    video: { trimIn: 0, trimOut: null, speed: 1, volumes: { video: 1, voice: 1, music: 0.3 }, musicLoop: true, cleanBaseAudio: false },
    base: null,
    music: null,
    cleanedAudio: null,
    broll: [],
    targets: {},
    effectStyles: {},
    translations: {}
  };
}

/** Length of the main timeline: trimmed base video at its speed, or the typed duration */
export function mainDuration(p: Project): number {
  if (p.base) {
    const out = Math.min(p.video.trimOut ?? p.base.duration, p.base.duration);
    return Math.max(0.5, (out - Math.min(p.video.trimIn, out - 0.5)) / p.video.speed);
  }
  return p.durationInput ?? 60;
}

/** Deep-merge a saved project over the defaults so new fields always exist */
export function hydrateProject(saved: unknown): Project {
  const d = defaultProject();
  if (!saved || typeof saved !== "object" || (saved as Project).version !== 2) return d;
  const s = saved as Partial<Project>;
  return {
    ...d, ...s,
    avatar: { ...d.avatar, ...s.avatar },
    voice: { ...d.voice, ...s.voice },
    branding: {
      ...d.branding, ...s.branding,
      intro: { ...d.branding.intro, ...s.branding?.intro },
      outro: { ...d.branding.outro, ...s.branding?.outro },
      captions: { ...d.branding.captions, ...s.branding?.captions }
    },
    video: { ...d.video, ...s.video, volumes: { ...d.video.volumes, ...s.video?.volumes } }
  };
}
