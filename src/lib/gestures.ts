/**
 * Gesture sync for HeyGen: turns a scene's directions into a motion_prompt for
 * that line's clip. HeyGen takes one prompt per clip (it can't time a gesture to
 * a word), and the app renders one clip per voiceover line — so each line gets
 * the gesture its scene calls for.
 */
import type { Direction, ParseResult, Scene } from "./parser.ts";
import {
  DEFAULT_TARGET, targetKey,
  type AvatarPosition, type GestureStyle, type TargetRect
} from "./project.ts";

const STYLE_BASE: Record<GestureStyle, { text: string; expressiveness: "low" | "medium" | "high" }> = {
  presenter: { text: "Confident presenter with natural, purposeful hand gestures while speaking.", expressiveness: "medium" },
  teacher: { text: "Engaged teacher: takes a small step, explains with open-hand gestures and demonstrates with the hands.", expressiveness: "high" },
  anchor: { text: "Formal news anchor: composed, steady posture, minimal hand movement, direct eye contact.", expressiveness: "low" },
  casual: { text: "Relaxed and conversational: easy posture, light natural gestures, friendly expression.", expressiveness: "medium" }
};

/**
 * Where the target sits relative to the presenter, in the presenter's own terms.
 * The presenter faces the camera, so the viewer's right is the presenter's left.
 */
export function directionPhrase(target: TargetRect, position: AvatarPosition): string {
  const cx = target.x + target.w / 2, cy = target.y + target.h / 2;
  const avatarX = position === "left" ? 0.15 : position === "right" || position === "corner" ? 0.85 : 0.5;
  const dx = cx - avatarX;
  const vertical = cy < 0.33 ? "up and " : cy > 0.7 ? "down and " : "";
  if (Math.abs(dx) < 0.12) return vertical ? `${vertical.replace(" and ", "")} in front of them` : "in front of them";
  return dx > 0 ? `${vertical}off to their left (the viewer's right)` : `${vertical}off to their right (the viewer's left)`;
}

/** Production notes in brackets ([Scene: …], [Visual: …], [B-roll: …]) — for editors, never presenter body language */
export const isProductionNote = (d: Pick<Direction, "type" | "text">) =>
  d.type === "ACTION" && /^(scene|visual|b-?roll|note|music|sfx)\s*:/i.test(d.text);

function cue(d: Direction, style: GestureStyle, where: string): string | null {
  if (isProductionNote(d)) return null;
  const thing = d.text ? ` the ${d.text}` : "";
  const subtle = style === "anchor";
  switch (d.type) {
    case "POINT": return subtle ? `Briefly gestures ${where} toward${thing}.` : `Partway through, raises a hand and points ${where} toward${thing}.`;
    case "ZOOM": return `Turns their head and gestures ${where} toward${thing}.`;
    case "CALLOUT":
    case "HIGHLIGHT":
    case "PULSE": return subtle ? `Glances ${where} toward${thing}.` : `Gestures ${where} to draw attention to${thing}.`;
    case "TITLE": return subtle ? "Pauses and nods as a title appears." : "Steps back slightly and makes a broad, sweeping open-arm gesture.";
    case "TRANSITION":
    case "FADE": return "Begins by turning to face the camera, as if moving to a new topic.";
    case "GESTURE":
    case "AVATAR":
    case "ACTION": {
      // Stage directions from the script, e.g. "[GESTURE: wave]" or "Victor walks in"
      const text = d.text.replace(/^[A-Z][\w.'-]*\s+(?=[a-z])/, "").replace(/\.$/, "").trim();
      return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}.` : null;
    }
    default: return null;
  }
}

export interface MotionPlan { prompt: string; expressiveness: "low" | "medium" | "high" }

/**
 * Directions for each voiceover line: its own, plus action-only lines. An
 * untimed action line belongs to the line it follows; a timestamped one starts
 * a new section, so it belongs to the next line.
 */
export function lineDirections(parse: ParseResult): Map<number, Direction[]> {
  const spoken = parse.scenes.filter(s => s.spoken);
  const out = new Map<number, Direction[]>(spoken.map(s => [s.index, [...s.directions]]));
  if (!spoken.length) return out;
  for (const scene of parse.scenes) {
    if (scene.spoken || !scene.directions.length) continue;
    const owner = scene.timestamp
      ? spoken.find(s => s.index > scene.index) ?? spoken[spoken.length - 1]
      : [...spoken].reverse().find(s => s.index < scene.index) ?? spoken[0];
    out.get(owner.index)!.push(...scene.directions);
  }
  return out;
}

export function motionPlan(
  scene: Scene, directions: Direction[], style: GestureStyle, targets: Record<string, TargetRect>, position: AvatarPosition
): MotionPlan {
  const base = STYLE_BASE[style];
  const cues: string[] = [];
  if (scene.timestamp && scene.index > 0) cues.push("Starts by turning to the camera as the new section begins.");
  for (const d of directions) {
    const where = directionPhrase(targets[targetKey(d)] ?? DEFAULT_TARGET, position);
    const c = cue(d, style, where);
    if (c && !cues.includes(c)) cues.push(c);
  }
  return { prompt: [base.text, ...cues.slice(0, 3)].join(" "), expressiveness: base.expressiveness };
}
