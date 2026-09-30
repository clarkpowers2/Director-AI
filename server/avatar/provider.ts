/**
 * The avatar rendering contract. DirectorAI™ owns the workflow; a provider only
 * turns one line of speech into one avatar clip. Everything above this layer
 * (functions/api/avatar/render*, the studio) talks to AvatarService, never to a vendor.
 */
import type { Env, ProviderErrorDetail } from "../shared";

export type RenderQuality = "preview" | "standard" | "high";
/** transparent = cut-out presenter when the avatar supports it; provider = the provider's own background */
export type BackgroundMode = "transparent" | "provider";
export type RenderStatus = "queued" | "rendering" | "completed" | "failed" | "cancelled";

export interface RenderRequest {
  avatarId: string;
  /** Provider voice id; omitted = the avatar's own voice */
  voiceId?: string;
  /** Spoken text only — stage directions never go here */
  text: string;
  /** Gesture direction for avatars that accept it */
  motion?: { prompt: string; expressiveness?: "low" | "medium" | "high"; engine?: "avatar_v" };
  quality: RenderQuality;
  background: BackgroundMode;
  /** Short test clip (TEST RENDER) rather than a production scene */
  test: boolean;
  /** For the provider-side title only */
  label: string;
}

export interface RenderStarted {
  /** Provider's own job id (AvatarService prefixes it with the provider id) */
  providerJobId: string;
  status: RenderStatus;
  /** Clip will have an alpha channel */
  alpha: boolean;
  /** Gesture direction was accepted */
  gestures: boolean;
}

export interface RenderProgress {
  status: RenderStatus;
  /** 0..1 when the provider reports it */
  progress: number | null;
  /** Same-origin URL the studio downloads the finished clip from */
  mediaUrl: string | null;
  duration: number | null;
  /** Safe to show users — never a raw provider response */
  error: string | null;
  /** Sanitized provider failure code/message, when the render failed */
  detail?: ProviderErrorDetail | null;
  /** Provider's own job id, for diagnostics */
  providerJobId?: string;
}

export interface ProviderAvatar { id: string; name: string; image: string | null }
export interface ProviderVoice { id: string; name: string; language: string; gender: string }

export interface ProviderCapabilities {
  qualities: RenderQuality[];
  backgrounds: BackgroundMode[];
  gestures: boolean;
  /** Can stop a render already in progress (and so stop it using credits) */
  cancel: boolean;
  /** Renders cost provider credits */
  paid: boolean;
}

/** A failure whose message is safe to return to the browser */
export class ProviderError extends Error {
  status: number;
  detail: ProviderErrorDetail | null;
  constructor(message: string, status = 502, detail: ProviderErrorDetail | null = null) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export interface AvatarProvider {
  /** Stable id used in job ids — lowercase letters only */
  id: string;
  /** Neutral name shown in the studio (no vendor branding) */
  label: string;
  capabilities: ProviderCapabilities;
  configured(env: Env): boolean;
  renderAvatarScene(env: Env, req: RenderRequest): Promise<RenderStarted>;
  getRenderStatus(env: Env, providerJobId: string): Promise<RenderProgress>;
  getAvailableAvatars(env: Env): Promise<ProviderAvatar[]>;
  getAvailableVoices(env: Env): Promise<ProviderVoice[]>;
  /** The finished clip, looked up server-side by job id (the browser never supplies a URL) */
  fetchRenderedMedia(env: Env, providerJobId: string): Promise<Response>;
  /** true if the provider stopped it; false if it can't be stopped (it may still use credits) */
  cancelRender(env: Env, providerJobId: string): Promise<boolean>;
}
