/** Project state shared by every section, the renderer, the player and export. */
import type { Direction, ParseResult } from "./parser.ts";

// ---------- Avatar ----------

export type PresenterId = "professional" | "creator" | "anchor" | "tech" | "custom";
export type OutfitId = "formal" | "casual" | "creative" | "custom";
export type AvatarPosition = "left" | "right" | "bottom-center" | "corner" | "full";
export type AvatarSize = "small" | "medium" | "large";

export const PRESENTERS: Record<PresenterId, {
  name: string; description: string; outfit: OutfitId; voice: VoicePreset; gesture: GestureStyle; position: AvatarPosition;
}> = {
  professional: { name: "Professional presenter", description: "Business demos, sales outreach", outfit: "formal", voice: "pro-male", gesture: "presenter", position: "left" },
  creator: { name: "YouTube creator", description: "Casual explainers, talking head", outfit: "creative", voice: "casual-female", gesture: "casual", position: "right" },
  anchor: { name: "News anchor", description: "Announcements, briefings", outfit: "formal", voice: "pro-female", gesture: "anchor", position: "right" },
  tech: { name: "Tech demo presenter", description: "Product walkthroughs, onboarding", outfit: "casual", voice: "casual-male", gesture: "teacher", position: "right" },
  custom: { name: "Custom", description: "Your own presenter photo", outfit: "custom", voice: "pro-female", gesture: "presenter", position: "left" }
};

export const OUTFITS: Record<OutfitId, string> = {
  formal: "Business formal (navy suit)",
  casual: "Business casual",
  creative: "Creative / casual",
  custom: "Custom"
};

/** A presenter photo (animated engine). The full image lives in IndexedDB. */
export interface AvatarImage {
  mediaId: string;
  thumbnail: string;
}

/** A HeyGen avatar look, as shown in the gallery */
export interface HeyGenLook {
  id: string;
  name: string;
  type: "studio_avatar" | "digital_twin" | "photo_avatar";
  image: string | null;
  video: string | null;
  voice: string | null;
  tags: string[];
  engines: string[];
  status: string;
  /** Gallery tab, from HeyGen's avatar_type (studio avatars split by "Standing"/"Full Body" in the name) */
  category: "full_body" | "studio" | "digital_twin" | "talking_head";
}

/** Photo avatars take gesture prompts on the default engine; video avatars only on Avatar V */
export function gestureSupport(look: HeyGenLook | null): { supported: boolean; engine?: "avatar_v" } {
  if (!look) return { supported: false };
  if (look.type === "photo_avatar") return { supported: true };
  if (look.engines.includes("avatar_v")) return { supported: true, engine: "avatar_v" };
  return { supported: false };
}

export interface AvatarSettings {
  presenter: PresenterId;
  outfit: OutfitId;
  /** key: `${presenter}:${outfit}` */
  photos: Record<string, AvatarImage>;
  /** Selected HeyGen look (HeyGen engine) */
  heygen: HeyGenLook | null;
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
export type GestureStyle = "presenter" | "teacher" | "anchor" | "casual";
/** heygen = HeyGen avatar video (full body, gestures); animated = free voice (Workers AI) + animated photo */
export type VoiceEngine = "heygen" | "animated";

export interface VoiceSettings {
  /** Free-voice preset (animated engine) */
  preset: VoicePreset;
  speed: VoiceSpeed;
  gesture: GestureStyle;
  engine: VoiceEngine;
  /** HeyGen voice; id "" = the avatar's own default voice */
  heygenVoice: { id: string; name: string } | null;
}

export const VOICE_PRESETS: Record<VoicePreset, { label: string; aura: string }> = {
  "pro-male": { label: "Professional male (Victor)", aura: "orion" },
  "pro-female": { label: "Professional female (ARIA)", aura: "athena" },
  "casual-male": { label: "Casual male", aura: "arcas" },
  "casual-female": { label: "Casual female", aura: "luna" }
};

/** Default HeyGen voice: "Victor", English, professional male */
export const DEFAULT_HEYGEN_VOICE = { id: "dbb793080e5b4733bf2cba6a66a4909d", name: "Victor" };

export const GESTURE_STYLES: Record<GestureStyle, { label: string; detail: string }> = {
  presenter: { label: "Presenter", detail: "Pointing, purposeful gestures" },
  teacher: { label: "Teacher", detail: "Steps, demonstrates with hands" },
  anchor: { label: "Anchor", detail: "Composed and formal" },
  casual: { label: "Casual", detail: "Relaxed, conversational" }
};

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

export type ClipStatus = "queued" | "generating" | "done" | "error" | "cancelled";
export interface AvatarClip {
  key: string;
  status: ClipStatus;
  /** Renderer that made (or is making) it, and its job id — never a credential */
  provider?: string;
  jobId?: string;
  /** 0..1 while rendering, when the renderer reports it */
  progress?: number | null;
  startedAt?: number;
  /** How many times this line has been rendered successfully (1 = first render) */
  version?: number;
  /** Sanitized provider diagnostics for a failed render (HTTP status, provider code/message, job ids) */
  errorDetail?: { provider?: string; endpoint?: string; http?: number; code?: string; message?: string; kind?: string; jobId?: string; requestId?: string; providerJobId?: string };
  /** video = HeyGen avatar; audio = free voice driving the animated photo */
  kind?: "video" | "audio";
  /** HeyGen clip rendered with a transparent background (WebM with alpha) */
  alpha?: boolean;
  /** Gesture prompt this clip was rendered with (HeyGen), to flag out-of-date gestures */
  motion?: string;
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
  if (voice.engine === "heygen") {
    if (!avatar.heygen) return null;
    return `h-${hash(`${avatar.heygen.id}|${voice.heygenVoice?.id || "default"}|${spoken}`)}`;
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

/** One voiceover line on the program's speaking track */
export interface SpeechSlot {
  sceneIndex: number;
  key: string | null;
  clip?: AvatarClip;
  /** Where the script puts it */
  scripted: number;
  /** Where it actually plays: a rendered line is never cut, so a long one pushes the next back */
  start: number;
  length: number;
  end: number;
}

let scheduleCache: { parse: ParseResult; clips: Record<string, AvatarClip>; avatar: AvatarSettings; voice: VoiceSettings; slots: SpeechSlot[] } | null = null;

/**
 * The speaking track. Rendered audio is the authority on length: when a line
 * runs past the next line's timestamp, the next line starts when it ends
 * instead of cutting either one off. The Avatar page flags those lines.
 */
export function speechSchedule(parse: ParseResult | null, project: Pick<Project, "avatar" | "voice">, clips: Record<string, AvatarClip>): SpeechSlot[] {
  if (!parse) return [];
  const { avatar, voice } = project;
  const c = scheduleCache;
  if (c && c.parse === parse && c.clips === clips && c.avatar === avatar && c.voice === voice) return c.slots;
  const rate = SPEED_RATE[voice.speed];
  const slots: SpeechSlot[] = [];
  let prevEnd = -Infinity;
  for (const scene of parse.scenes) {
    if (!scene.spoken || scene.start === null) continue;
    const key = sceneClipKey(avatar, voice, scene.spoken);
    const clip = key ? clips[key] : undefined;
    const length = speechDuration(scene, clip, rate);
    const start = Math.max(scene.start, prevEnd);
    slots.push({ sceneIndex: scene.index, key, clip, scripted: scene.start, start, length, end: start + length });
    prevEnd = start + length;
  }
  scheduleCache = { parse, clips, avatar, voice, slots };
  return slots;
}

// ---------- Program ----------

/** Program timeline = optional intro card + main video + optional outro card */
export interface ProgramTiming { intro: number; main: number; outro: number; total: number }

export function programTiming(branding: Branding, mainDuration: number): ProgramTiming {
  const intro = branding.intro.enabled ? Math.max(0, branding.intro.duration) : 0;
  const outro = branding.outro.enabled ? Math.max(0, branding.outro.duration) : 0;
  return { intro, main: mainDuration, outro, total: intro + mainDuration + outro };
}

/** How avatar scenes are rendered (see /api/avatar/providers) */
export type RenderQuality = "preview" | "standard" | "high";
export type BackgroundMode = "transparent" | "provider";
export interface AvatarRenderSettings {
  /** "auto" = the server's highest-priority renderer */
  provider: string;
  quality: RenderQuality;
  background: BackgroundMode;
}

export interface Project {
  version: 3;
  /** Stable id (project list, generation history) */
  id: string;
  /** How the project began — shown in the project list */
  startedWith?: "ai" | "upload" | "script";
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
  avatarRender: AvatarRenderSettings;
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
    version: 3,
    id: newProjectId(),
    name: "Untitled production",
    script: DEFAULT_SCRIPT,
    avatarName: "Victor",
    durationInput: null,
    avatar: {
      presenter: "professional",
      outfit: "formal",
      photos: {},
      heygen: null,
      enabled: true,
      position: "left",
      size: "medium",
      label: "Victor · DirectorAI™",
      labelColor: "#c9a84c"
    },
    voice: { preset: "pro-male", speed: "normal", gesture: "presenter", engine: "heygen", heygenVoice: DEFAULT_HEYGEN_VOICE },
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
    translations: {},
    avatarRender: { provider: "auto", quality: "standard", background: "transparent" }
  };
}

export const newProjectId = () => `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

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
  if (!saved || typeof saved !== "object") return d;
  const version = (saved as { version?: number }).version;
  if (version !== 2 && version !== 3) return d;
  const s = saved as Partial<Project>;
  if (version === 2) {
    // v2 used D-ID and different positions; keep everything else
    const oldPos = (s.avatar as { position?: string } | undefined)?.position;
    const pos: AvatarPosition = oldPos === "corner-left" ? "left" : oldPos === "full" ? "full" : "right";
    s.avatar = { ...d.avatar, ...s.avatar, position: pos, heygen: null };
    const oldEngine = (s.voice as { engine?: string } | undefined)?.engine;
    s.voice = { ...d.voice, ...s.voice, engine: oldEngine === "animated" ? "animated" : "heygen", gesture: "presenter", heygenVoice: null };
  }
  // No voice chosen yet → Victor; looks saved before categories existed get one from their type
  if (s.voice && !s.voice.heygenVoice) s.voice = { ...s.voice, heygenVoice: DEFAULT_HEYGEN_VOICE };
  if (s.avatar?.heygen && !s.avatar.heygen.category) {
    const t = s.avatar.heygen.type;
    s.avatar = { ...s.avatar, heygen: { ...s.avatar.heygen, category: t === "photo_avatar" ? "talking_head" : t === "digital_twin" ? "digital_twin" : "studio" } };
  }
  return {
    ...d, ...s, version: 3,
    id: typeof s.id === "string" && s.id ? s.id : d.id,
    avatarRender: { ...d.avatarRender, ...s.avatarRender },
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
