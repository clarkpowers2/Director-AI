/**
 * AvatarScene — one voiceover line as an avatar render: what the avatar says,
 * when, how it moves, and where its render stands. Built from the parsed script
 * plus the rendered clips; only the spoken text ever goes to a renderer, never
 * the stage directions (those become the gesture).
 */
import type { ParseResult } from "./parser.ts";
import { lineDirections } from "./gestures.ts";
import {
  sceneClipKey, speechSchedule, SPEED_RATE,
  type AvatarClip, type AvatarPosition, type BackgroundMode, type Project
} from "./project.ts";

export type AvatarSceneStatus = "draft" | "queued" | "rendering" | "completed" | "failed" | "cancelled";

export interface AvatarScene {
  id: string;
  projectId: string;
  sceneId: number;
  avatarId: string | null;
  avatarName: string;
  voiceId: string | null;
  voiceoverText: string;
  /** Scripted start on the main timeline, seconds */
  startTime: number;
  /** Seconds until the next line is scripted to start */
  expectedDuration: number;
  /** Stage directions for the avatar ("gestures toward the screen") — not spoken */
  gesture: string;
  position: AvatarPosition;
  /** Share of screen width */
  scale: number;
  backgroundMode: BackgroundMode;
  status: AvatarSceneStatus;
  provider: string | null;
  providerJobId: string | null;
  renderedVideoUrl: string | null;
  renderedAudioUrl: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  // ---- studio-side extras ----
  /** Clip cache key (lines with identical text share one render) */
  key: string | null;
  clip?: AvatarClip;
  /** Rendered length at the chosen voice speed */
  actualDuration: number | null;
  /** actual − expected, when rendered; > 0 means it runs into the next line */
  timingDifference: number | null;
  error: string | null;
  progress: number | null;
}

const SCALE: Record<Project["avatar"]["size"], number> = { small: 0.25, medium: 0.33, large: 0.5 };

function status(clip: AvatarClip | undefined): AvatarSceneStatus {
  switch (clip?.status) {
    case "queued": return "queued";
    case "generating": return "rendering";
    case "done": return "completed";
    case "error": return "failed";
    case "cancelled": return "cancelled";
    default: return "draft";
  }
}

/** "AVATAR: Victor" or "Victor gestures…" names the speaker when it's one capitalized word */
function speakerName(directions: { type: string; text: string }[], fallback: string): string {
  for (const d of directions) {
    if (d.type !== "AVATAR") continue;
    const name = d.text.match(/^([A-Z][\w'-]{1,30})(?:\s|$)/)?.[1];
    if (name) return name;
  }
  return fallback;
}

export function buildAvatarScenes(
  parse: ParseResult | null, project: Project, clips: Record<string, AvatarClip>, mainSeconds: number
): AvatarScene[] {
  if (!parse) return [];
  const { avatar, voice } = project;
  const rate = SPEED_RATE[voice.speed];
  const byLine = lineDirections(parse);
  const spoken = parse.scenes.filter(s => s.spoken && s.start !== null);
  const slots = new Map(speechSchedule(parse, project, clips).map(s => [s.sceneIndex, s]));
  const heygen = voice.engine === "heygen";

  return spoken.map((scene, i) => {
    const key = sceneClipKey(avatar, voice, scene.spoken);
    const clip = key ? clips[key] : undefined;
    const next = spoken[i + 1];
    const expected = Math.max(0, (next ? (next.start as number) : mainSeconds) - (scene.start as number));
    const actual = clip?.status === "done" && clip.duration ? clip.duration / rate : null;
    const directions = byLine.get(scene.index) ?? scene.directions;
    const gesture = directions
      .filter(d => d.type === "AVATAR" || d.type === "GESTURE" || d.type === "ACTION" || d.type === "POINT")
      .map(d => (d.type === "POINT" ? `points to ${d.text}` : d.text))
      .filter(Boolean)
      .join("; ");
    return {
      id: `${project.id}:${scene.index}`,
      projectId: project.id,
      sceneId: scene.index,
      avatarId: heygen ? avatar.heygen?.id ?? null : `photo:${avatar.presenter}`,
      avatarName: speakerName(directions, project.avatarName || "Presenter"),
      voiceId: heygen ? voice.heygenVoice?.id || null : voice.preset,
      voiceoverText: scene.spoken,
      startTime: slots.get(scene.index)?.scripted ?? (scene.start as number),
      expectedDuration: expected,
      gesture,
      position: avatar.position,
      scale: avatar.position === "full" ? 1 : SCALE[avatar.size],
      backgroundMode: project.avatarRender.background,
      status: status(clip),
      provider: clip?.provider ?? null,
      providerJobId: clip?.jobId ?? null,
      renderedVideoUrl: clip?.status === "done" && clip.kind === "video" ? clip.url ?? null : null,
      renderedAudioUrl: clip?.status === "done" && clip.kind === "audio" ? clip.url ?? null : null,
      createdAt: clip?.startedAt ?? null,
      updatedAt: null,
      key, clip,
      actualDuration: actual,
      timingDifference: actual === null ? null : actual - expected,
      error: clip?.status === "error" ? clip.error ?? "This line couldn't be rendered." : null,
      progress: clip?.progress ?? null
    };
  });
}

/** Rough speech length before rendering — the same pace the timeline uses */
export const estimateSeconds = (text: string, rate = 1) => text.split(/\s+/).filter(Boolean).length / (2.6 * rate);
