/** Auto chapters from scene directions — YouTube-ready ("0:00 Intro" lines). */
import { formatSeconds, type ParseResult } from "./parser.ts";
import type { ProgramTiming } from "./project.ts";

export interface Chapter { time: number; title: string }

const MIN_GAP = 10; // YouTube needs chapters ≥ 10 s apart

function shortTitle(text: string): string {
  const words = text.replace(/[“”"]/g, "").split(/\s+/).filter(Boolean);
  return words.slice(0, 6).join(" ").replace(/[.,;:!?—-]+$/, "") + (words.length > 6 ? "…" : "");
}

/** A chapter at every TITLE card and every explicitly timestamped scene */
export function buildChapters(parse: ParseResult | null, timing: ProgramTiming, introTitle: string): Chapter[] {
  if (!parse) return [];
  const raw: Chapter[] = [];
  if (timing.intro > 0) raw.push({ time: 0, title: introTitle || "Intro" });
  for (const scene of parse.scenes) {
    if (scene.start === null) continue;
    const title = scene.directions.find(d => d.type === "TITLE")?.text;
    if (title) raw.push({ time: timing.intro + scene.start, title: shortTitle(title) });
    else if (scene.timestamp && scene.spoken) raw.push({ time: timing.intro + scene.start, title: shortTitle(scene.spoken) });
  }
  if (timing.outro > 0) raw.push({ time: timing.intro + timing.main, title: "Wrap-up" });

  raw.sort((a, b) => a.time - b.time);
  const out: Chapter[] = [];
  for (const c of raw) {
    const last = out[out.length - 1];
    if (!last) out.push({ time: 0, title: c.time === 0 ? c.title : "Intro" });
    if (out[out.length - 1].time === 0 && c.time === 0) {
      out[out.length - 1].title = c.title;
      continue;
    }
    if (c.time - out[out.length - 1].time >= MIN_GAP) out.push(c);
  }
  return out;
}

export const chaptersText = (chapters: Chapter[]) => chapters.map(c => `${formatSeconds(Math.floor(c.time))} ${c.title}`).join("\n");
