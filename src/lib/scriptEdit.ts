/** Script editing helpers: scene blocks, find & replace, inline voiceover edits, inserting effects. */
import { formatSeconds, TIMESTAMP_PATTERN, type Scene } from "./parser.ts";

// ---------- Scene blocks (paragraphs separated by blank lines) ----------

export interface Block { id: string; text: string; firstLine: number; lastLine: number }

/** Consecutive non-blank lines form a block; line numbers match the parser's scene.lines */
export function splitBlocks(script: string): Block[] {
  const lines = script.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  const seen = new Map<string, number>();
  let start = -1;
  const close = (end: number) => {
    const text = lines.slice(start, end + 1).join("\n");
    const n = (seen.get(text) ?? 0) + 1;
    seen.set(text, n);
    blocks.push({ id: `${text.slice(0, 40)}#${n}`, text, firstLine: start, lastLine: end });
    start = -1;
  };
  lines.forEach((line, i) => {
    if (line.trim()) {
      if (start === -1) start = i;
    } else if (start !== -1) close(i - 1);
  });
  if (start !== -1) close(lines.length - 1);
  return blocks;
}

export const joinBlocks = (blocks: { text: string }[]) => blocks.map(b => b.text.trim()).filter(Boolean).join("\n\n");

export function moveBlock<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item);
  return next;
}

// ---------- Find & replace ----------

export interface Match { start: number; end: number }

export function findAll(text: string, query: string, matchCase: boolean): Match[] {
  if (!query) return [];
  const hay = matchCase ? text : text.toLowerCase();
  const needle = matchCase ? query : query.toLowerCase();
  const out: Match[] = [];
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) {
    out.push({ start: i, end: i + needle.length });
  }
  return out;
}

export function replaceAt(text: string, m: Match, replacement: string): string {
  return text.slice(0, m.start) + replacement + text.slice(m.end);
}

export function replaceAll(text: string, query: string, replacement: string, matchCase: boolean): { text: string; count: number } {
  const matches = findAll(text, query, matchCase);
  let out = text;
  for (let i = matches.length - 1; i >= 0; i--) out = replaceAt(out, matches[i], replacement);
  return { text: out, count: matches.length };
}

// ---------- Inline voiceover edit ----------

/** Replace a scene's spoken words in the script, keeping its timestamp, brackets and stage direction */
export function replaceSpoken(script: string, scene: Scene, newSpoken: string): string {
  if (scene.spokenLine === null) return script;
  const lines = script.split("\n");
  const line = lines[scene.spokenLine];
  if (line === undefined) return script;
  const clean = newSpoken.replace(/\s+/g, " ").trim();
  if (line.includes(scene.spoken)) {
    lines[scene.spokenLine] = line.replace(scene.spoken, clean);
  } else {
    // The spoken text was interleaved with [actions] — rebuild the line
    const ts = line.match(TIMESTAMP_PATTERN)?.[0] ?? "";
    const actions = line.slice(ts.length).match(/\[[^\]]+\]/g)?.join(" ") ?? "";
    lines[scene.spokenLine] = `${ts}${clean}${actions ? ` ${actions}` : ""}`;
  }
  return lines.join("\n");
}

// ---------- Insert an effect at the playhead ----------

/** Adds "[m:ss] KEYWORD: text" as its own line after the scene playing at main time m */
export function insertDirection(script: string, scenes: Scene[], m: number, line: string): string {
  const stamped = `[${formatSeconds(Math.max(0, m))}] ${line}`;
  const lines = script.split("\n");
  let insertAfter = -1;
  for (const s of scenes) {
    if (s.start !== null && s.start <= m + 0.001) insertAfter = Math.max(insertAfter, ...s.lines);
  }
  if (insertAfter === -1) return `${stamped}\n${script}`;
  lines.splice(insertAfter + 1, 0, stamped);
  return lines.join("\n");
}
