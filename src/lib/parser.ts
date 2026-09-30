/**
 * DirectorAI™ — script parser
 * Ported from directorai-plugin/src/parser.js. Text outputs match the API at
 * directorai.hccgsa.com/parse; this version also returns structured scenes for
 * the timeline and effects engine. Runs fully offline.
 */

export type DirectionType =
  | "ZOOM" | "HIGHLIGHT" | "POINT" | "PULSE" | "TITLE" | "CAPTION" | "CALLOUT" | "LOWER THIRD"
  | "FADE" | "TRANSITION" | "GESTURE" | "AVATAR" | "ACTION";

export interface Direction {
  id: string;
  type: DirectionType;
  /** What the editor shows, e.g. "ZOOM: Haven logo" */
  display: string;
  /** The target or text of the direction, e.g. "Haven logo" */
  text: string;
  sceneIndex: number;
}

export interface Scene {
  index: number;
  /** Timestamp as written in the script, if any */
  timestamp: string | null;
  /** Start in seconds on the main video timeline (null only when no duration is known) */
  start: number | null;
  duration: number | null;
  estimated: boolean;
  spoken: string;
  directions: Direction[];
  /** Script line indices (0-based, blank lines included) this scene came from */
  lines: number[];
  /** Script line that holds the spoken text, for inline editing */
  spokenLine: number | null;
}

export interface ParseResult {
  scenes: Scene[];
  voiceover_script: string;
  scene_directions: string;
  summary: string;
  veed_instructions: string;
  capcut_instructions: string;
  counts: { voiceover: number; directions: number; visual: number; text: number };
}

const KEYWORD = String.raw`ZOOM|HIGHLIGHT|POINTS?\s+(?:TO|AT)|POINT|GESTURE|FADE|TRANSITION|AVATAR|PULSE|TITLE|CAPTION|CALLOUT|LOWER[\s_-]?THIRD|ACTION`;

// Line-start keyword: "ZOOM: chart" (any case, colon required) or "POINTS TO chart" (all caps, colon optional).
// The action runs to the first sentence-ending period; anything after it is spoken.
const LINE_KEYWORD_PATTERN = new RegExp(
  String.raw`^(?:(${KEYWORD})\s*:|(${KEYWORD})(?=\s))\s*(.*?)(?:\.(?=\s)|\.?$)\s*(.*)$`,
  "i"
);
const CAPS_KEYWORD_PATTERN = new RegExp(String.raw`^(?:${KEYWORD})$`);
const BRACKET_KEYWORD_PATTERN = new RegExp(String.raw`^(${KEYWORD})\b\s*:?\s*(.*)$`, "i");

// Free-text effect words, used only to classify directions ("[Gold pulse effect on tile]" is a PULSE)
const EFFECT_WORDS: [DirectionType, RegExp][] = [
  ["ZOOM", /\bzoom(?:s|ed|ing)?\b/i],
  ["HIGHLIGHT", /\bhighlight(?:s|ed|ing)?\b/i],
  ["PULSE", /\bpuls(?:e|es|ed|ing)\b/i],
  ["POINT", /\bpoint(?:s|ed|ing)?\s+(?:to|at)\b/i],
  ["TITLE", /\btitle\b/i],
  ["CAPTION", /\bcaption\b/i],
  ["CALLOUT", /\bcallouts?\b/i],
  ["LOWER THIRD", /\blower[\s-]?thirds?\b/i]
];

// Stage direction followed by speech: Victor walks in and says: "Welcome."
const SAYS_PATTERN = /^(.+?)(?:,?\s+and)?\s+(?:says|said|say)\s*:\s*(["“'‘].*)?$/i;

// Block heading for speech: "VOICEOVER:" alone (the lines below it are spoken), or "VOICEOVER: \"Hello.\"" inline
const VOICEOVER_PATTERN = /^(?:VOICE[\s-]?OVER|V\.?O\.?|NARRATION|NARRATOR|DIALOGUE)\s*:\s*(.*)$/i;

// Timestamp at line start: mm:ss, h:mm:ss, or seconds with an "s" suffix. Plain numbers never match.
export const TIMESTAMP_PATTERN = /^\[?(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?|\d+(?:\.\d+)?s)(?![\w:])\]?\s*[-–—]?\s*/i;

export const VISUAL_EFFECTS = new Set<DirectionType>(["ZOOM", "HIGHLIGHT", "PULSE", "POINT", "CALLOUT"]);
export const TEXT_OVERLAYS = new Set<DirectionType>(["TITLE", "CAPTION", "LOWER THIRD"]);

type RawDirection = Omit<Direction, "id" | "sceneIndex">;

function normalizeType(keyword: string): DirectionType {
  const upper = keyword.toUpperCase().replace(/\s+/g, " ");
  if (upper.startsWith("POINT")) return "POINT";
  if (/^LOWER[ _-]?THIRD$/.test(upper)) return "LOWER THIRD";
  return upper as DirectionType;
}

export function timestampToSeconds(ts: string): number {
  if (/s$/i.test(ts)) return parseFloat(ts);
  return ts.split(":").reduce((total, part) => total * 60 + parseFloat(part), 0);
}

export function formatSeconds(seconds: number): string {
  const rounded = Math.round(seconds * 10) / 10;
  const mins = Math.floor(rounded / 60);
  const secs = rounded - mins * 60;
  const secStr = Number.isInteger(secs) ? String(secs).padStart(2, "0") : secs.toFixed(1).padStart(4, "0");
  return `${mins}:${secStr}`;
}

function inferType(text: string, fallback: DirectionType): DirectionType {
  const found = EFFECT_WORDS.find(([, pattern]) => pattern.test(text));
  return found ? found[0] : fallback;
}

function keywordDirection(keyword: string, text: string): RawDirection {
  const type = normalizeType(keyword);
  return { type, text, display: text ? `${type}: ${text}` : type };
}

function bracketDirection(content: string): RawDirection {
  const text = content.trim();
  const match = text.match(BRACKET_KEYWORD_PATTERN);
  if (match) return keywordDirection(match[1], match[2].trim());
  return { type: inferType(text, "ACTION"), text, display: text };
}

function stripQuotes(text: string): string {
  const match = text.match(/^["“'‘](.*)["”'’]$/);
  return match ? match[1].trim() : text;
}

interface ParsedLine {
  timestamp: string | null;
  spoken: string;
  actions: RawDirection[];
  awaitsSpeech: boolean;
  /** A block label alone on its line: "VOICEOVER:" (SPEECH) or a direction keyword like "AVATAR:" */
  heading: DirectionType | "SPEECH" | null;
}

function parseLine(line: string): ParsedLine {
  let rest = line.trim();
  let timestamp: string | null = null;

  // 1. Strip the timestamp first, so "[0:05] Hello" is not mistaken for an action line
  const tsMatch = rest.match(TIMESTAMP_PATTERN);
  if (tsMatch) {
    timestamp = tsMatch[1];
    rest = rest.slice(tsMatch[0].length).trim();
  }

  const actions: RawDirection[] = [];

  // 2. Pull out every [bracket] anywhere in the line
  rest = rest.replace(/\[([^\]]+)\]/g, (_, content: string) => {
    actions.push(bracketDirection(content));
    return " ";
  }).replace(/\s+/g, " ").trim();

  // 2b. "VOICEOVER:" labels speech — drop the label; alone on its line it heads the lines below
  let heading: ParsedLine["heading"] = null;
  const voMatch = rest.match(VOICEOVER_PATTERN);
  if (voMatch) {
    rest = voMatch[1].trim();
    if (!rest && actions.length === 0) heading = "SPEECH";
  }

  // 3. Keywords only at the START of the remaining text; chaining allowed ("ZOOM: a. HIGHLIGHT: b.")
  let kwMatch: RegExpMatchArray | null;
  while ((kwMatch = rest.match(LINE_KEYWORD_PATTERN)) && (kwMatch[1] || CAPS_KEYWORD_PATTERN.test(kwMatch[2]))) {
    // "AVATAR:" alone on its line heads a block: the next line is the direction's text, never speech
    if (kwMatch[1] && !kwMatch[3].trim() && !kwMatch[4].trim() && actions.length === 0) {
      heading = normalizeType(kwMatch[1]);
      rest = "";
      break;
    }
    actions.push(keywordDirection(kwMatch[1] || kwMatch[2], kwMatch[3].trim()));
    rest = kwMatch[4].trim();
  }

  // 4. Stage direction + speech
  let awaitsSpeech = false;
  const saysMatch = rest.match(SAYS_PATTERN);
  if (saysMatch) {
    const stage = saysMatch[1].trim();
    actions.push({ type: inferType(stage, "AVATAR"), text: stage, display: `AVATAR: ${stage}` });
    rest = (saysMatch[2] || "").trim();
    awaitsSpeech = !rest;
  }

  return { timestamp, spoken: stripQuotes(rest), actions, awaitsSpeech, heading };
}

interface Timing { start: number; duration: number; estimated: boolean }

/** Explicit timestamps are anchors; untimed scenes are spread evenly between them (or 0 / the video end). */
function scheduleScenes(scenes: { timestamp: string | null }[], totalSeconds: number): Timing[] {
  const n = scenes.length;
  const starts: (number | null)[] = scenes.map(s => (s.timestamp ? timestampToSeconds(s.timestamp) : null));
  const estimated = starts.map(s => s === null);
  if (n > 0 && starts[0] === null) starts[0] = 0;

  let anchor = 0;
  for (let i = 1; i <= n; i++) {
    if (i < n && starts[i] === null) continue;
    const endTime = i < n ? (starts[i] as number) : totalSeconds;
    const step = Math.max(0, endTime - (starts[anchor] as number)) / (i - anchor);
    for (let k = anchor + 1; k < i; k++) starts[k] = (starts[anchor] as number) + step * (k - anchor);
    anchor = i;
  }

  return starts.map((start, i) => ({
    start: start as number,
    duration: Math.max(0, (i + 1 < n ? (starts[i + 1] as number) : totalSeconds) - (start as number)),
    estimated: estimated[i]
  }));
}

export function parseScript(script: string, avatarName = "Presenter", videoDurationSeconds: number | null = null): ParseResult {
  const lines: (ParsedLine & { timestamp: string | null; lines: number[]; spokenLine: number | null })[] = [];
  let pendingTimestamp: string | null = null;
  let pendingLines: number[] = [];
  let heading: ParsedLine["heading"] = null;
  const rawLines = script.split("\n");
  for (let lineIndex = 0; lineIndex < rawLines.length; lineIndex++) {
    const line = rawLines[lineIndex];
    if (!line.trim()) continue;
    let parsed = parseLine(line);
    if (parsed.timestamp) pendingTimestamp = parsed.timestamp;
    if (parsed.heading) {
      heading = parsed.heading;
      pendingLines.push(lineIndex);
      continue;
    }
    // The line under "AVATAR:" (or any direction heading) is that direction, e.g. "Victor gestures toward the screen."
    if (heading && heading !== "SPEECH" && !parsed.timestamp) {
      parsed = { ...parsed, spoken: "", awaitsSpeech: false, actions: [keywordDirection(heading, line.trim().replace(/\.$/, ""))] };
    }
    heading = null;
    if (!parsed.spoken && parsed.actions.length === 0) {
      pendingLines.push(lineIndex); // timestamp-only line belongs to the next scene
      continue;
    }

    // "Victor ... says:" with the quote on the next line — join them into one scene
    const previous = lines[lines.length - 1];
    if (previous?.awaitsSpeech && !parsed.timestamp && parsed.spoken) {
      previous.spoken = parsed.spoken;
      previous.actions.push(...parsed.actions);
      previous.awaitsSpeech = false;
      previous.lines.push(lineIndex);
      previous.spokenLine = lineIndex;
      continue;
    }

    lines.push({
      ...parsed, timestamp: pendingTimestamp,
      lines: [...pendingLines, lineIndex], spokenLine: parsed.spoken ? lineIndex : null
    });
    pendingTimestamp = null;
    pendingLines = [];
  }

  const timed = videoDurationSeconds ? scheduleScenes(lines, videoDurationSeconds) : null;

  const scenes: Scene[] = [];
  const voiceoverLines: string[] = [];
  const directionLines: string[] = [];
  let lastTimestamp: string | null = null;

  lines.forEach((line, i) => {
    let label: string;
    let durationNote = "";
    let start: number | null = null;
    let duration: number | null = null;
    let estimated = false;

    if (timed) {
      ({ start, duration, estimated } = timed[i]);
      label = `[${estimated ? "~" : ""}${formatSeconds(start)}]`;
      durationNote = ` (≈${Math.round(duration * 10) / 10}s)`;
    } else {
      if (line.timestamp) lastTimestamp = line.timestamp;
      label = lastTimestamp ? `[${lastTimestamp}]` : "";
      start = lastTimestamp ? timestampToSeconds(lastTimestamp) : null;
    }

    if (line.spoken) voiceoverLines.push(`${label}${durationNote} ${line.spoken}`.trim());

    const directions = line.actions.map((action, j): Direction => ({ ...action, id: `${i}-${j}`, sceneIndex: i }));
    directions.forEach(d => directionLines.push(`${label || `[Scene ${i + 1}]`} ${d.display}`));

    scenes.push({
      index: i, timestamp: line.timestamp, start, duration, estimated, spoken: line.spoken, directions,
      lines: line.lines, spokenLine: line.spokenLine
    });
  });

  const voiceoverHeader = [
    `VOICEOVER SCRIPT — ${avatarName}`,
    `Generated by DirectorAI™ | HCCGSA LLC`,
    `─────────────────────────────────`
  ];
  if (timed && videoDurationSeconds) {
    voiceoverHeader.push(
      `Video duration: ${formatSeconds(videoDurationSeconds)} across ${lines.length} scenes.`,
      `~ = estimated start time, (≈Ns) = estimated scene duration.`
    );
  }

  const allDirections = scenes.flatMap(s => s.directions);
  const visual = allDirections.filter(d => VISUAL_EFFECTS.has(d.type)).length;
  const text = allDirections.filter(d => TEXT_OVERLAYS.has(d.type)).length;

  return {
    scenes,
    voiceover_script: [...voiceoverHeader, "", ...voiceoverLines].join("\n"),
    scene_directions: [
      `SCENE DIRECTIONS`,
      `Generated by DirectorAI™ | HCCGSA LLC`,
      `─────────────────────────────────`,
      `Apply these effects in your video editor at the timestamps shown.`,
      "",
      ...directionLines
    ].join("\n"),
    summary: `SUMMARY
─────────────────────────────────
Avatar: ${avatarName}
Voiceover lines: ${voiceoverLines.length}
Scene directions: ${allDirections.length}
Effects detected: ${visual} visual effects, ${text} text overlays${
      timed && videoDurationSeconds ? `\nVideo duration: ${formatSeconds(videoDurationSeconds)}` : ""
    }`,
    veed_instructions: `VEED.IO INSTRUCTIONS
─────────────────────────────────
1. Upload your screen recording as the base video
2. Click Add → AI Avatar → choose your presenter
3. Paste the VOICEOVER SCRIPT into the avatar script box
4. For each SCENE DIRECTION:
   • Click Add → Spotlight or Zoom
   • Set the timestamp from the direction
   • Apply to the element named in the direction
5. For HIGHLIGHT effects: Add → Shape → set color to gold #c9a84c
6. For TITLE/CAPTION: Add → Text → navy background #1a2744, gold text #c9a84c
7. Export at 1080p`,
    capcut_instructions: `CAPCUT INSTRUCTIONS
─────────────────────────────────
1. Import your screen recording
2. Add AI Avatar from the right panel
3. Paste the VOICEOVER SCRIPT into the avatar script box
4. For each SCENE DIRECTION:
   • Use Keyframe zoom for ZOOM effects
   • Use Sticker/Overlay for HIGHLIGHT effects
   • Use Text for TITLE/CAPTION
5. Match timestamps from scene directions to your timeline
6. Export at 1080p`,
    counts: { voiceover: voiceoverLines.length, directions: allDirections.length, visual, text }
  };
}
