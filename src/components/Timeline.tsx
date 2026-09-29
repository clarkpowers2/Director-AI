import { useRef } from "react";
import type { Player } from "../lib/player.ts";
import { usePlayerTime } from "./VideoPreview.tsx";
import { EFFECT_COLOR, EFFECT_ICON, EFFECT_LABEL, V2_ONLY, type TimedEffect } from "../lib/effects.ts";
import { formatSeconds, type Direction, type ParseResult } from "../lib/parser.ts";
import { sceneClipKey, speechDuration, SPEED_RATE, type AvatarClip, type Project, type ProgramTiming } from "../lib/project.ts";
import type { Chapter } from "../lib/chapters.ts";

interface Props {
  player: Player;
  timing: ProgramTiming;
  parse: ParseResult | null;
  effects: TimedEffect[];
  project: Project;
  clips: Record<string, AvatarClip>;
  chapters: Chapter[];
  selectedId: string | null;
  onSelect: (d: Direction) => void;
}

const CLIP_STYLE: Record<string, string> = {
  done: "bg-gold/70 border-gold",
  generating: "bg-sky-400/40 border-sky-300 animate-pulse",
  queued: "bg-white/15 border-white/30",
  error: "bg-red-500/40 border-red-400"
};

export default function Timeline(p: Props) {
  const barRef = useRef<HTMLDivElement>(null);
  const t = usePlayerTime(p.player);
  const total = Math.max(p.timing.total, 0.001);
  const pct = (s: number) => `${(Math.max(0, Math.min(total, s)) / total) * 100}%`;
  const main = (s: number) => p.timing.intro + s;
  const rate = SPEED_RATE[p.project.voice.speed];

  const seekFrom = (clientX: number) => {
    const r = barRef.current!.getBoundingClientRect();
    p.player.seek(((clientX - r.left) / r.width) * total);
  };

  const step = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find(s => total / s <= 12) ?? 900;
  const ticks = Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step);

  return (
    <div className="rounded-xl border border-white/10 bg-navy-900/60 p-3">
      <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-white/45">
        <span className="font-semibold uppercase tracking-wider text-gold">Timeline</span>
        <span>{formatSeconds(p.timing.total)} total</span>
        <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-gold/70" /> avatar speaking</span>
        <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-sky-400/50" /> B-roll</span>
        <span className="ml-auto hidden sm:inline">Click to seek · click a marker to jump to it</span>
      </div>

      <div
        ref={barRef}
        className="relative touch-none select-none"
        onPointerDown={e => {
          if ((e.target as HTMLElement).closest("[data-pin]")) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          seekFrom(e.clientX);
        }}
        onPointerMove={e => {
          if (e.buttons === 1 && !(e.target as HTMLElement).closest("[data-pin]")) seekFrom(e.clientX);
        }}
      >
        <div className="relative h-5 text-[10px] text-white/40">
          {ticks.map(s => <span key={s} className="absolute -translate-x-1/2 font-mono" style={{ left: pct(s) }}>{formatSeconds(s)}</span>)}
        </div>

        {/* chapters */}
        <div className="relative h-4">
          {p.chapters.map(c => (
            <span key={`${c.time}-${c.title}`} className="absolute top-0 max-w-[20%] truncate border-l-2 border-gold/60 pl-1 text-[10px] text-gold/80" style={{ left: pct(c.time) }} title={`${formatSeconds(c.time)} ${c.title}`}>
              {c.title}
            </span>
          ))}
        </div>

        {/* main track */}
        <div className="relative h-9 overflow-hidden rounded-md bg-navy">
          {p.timing.intro > 0 && <div className="absolute inset-y-0 flex items-center justify-center bg-gold/15 text-[10px] text-gold" style={{ left: 0, width: pct(p.timing.intro) }}>Intro</div>}
          {p.timing.outro > 0 && <div className="absolute inset-y-0 flex items-center justify-center bg-gold/15 text-[10px] text-gold" style={{ left: pct(main(p.timing.main)), width: pct(p.timing.outro) }}>Outro</div>}
          {p.parse?.scenes.filter(s => s.spoken && s.start !== null).map(s => {
            const key = sceneClipKey(p.project.avatar, p.project.voice, s.spoken);
            const clip = key ? p.clips[key] : undefined;
            return (
              <div key={s.index} title={`${s.spoken}${clip ? ` — avatar ${clip.status}` : ""}`}
                className={`absolute top-1 h-3.5 overflow-hidden rounded border px-1 text-[9px] leading-3 text-white/90 ${clip ? CLIP_STYLE[clip.status] : "border-white/20 bg-white/10"}`}
                style={{ left: pct(main(s.start as number)), width: pct(Math.max(0.3, speechDuration(s, clip, rate))) }}>
                {s.spoken}
              </div>
            );
          })}
          {p.project.broll.map(b => (
            <div key={b.id} title={`B-roll: ${b.name}`} className="absolute bottom-1 h-3 overflow-hidden rounded border border-sky-300 bg-sky-400/40 px-1 text-[9px] leading-[10px]"
              style={{ left: pct(main(b.start)), width: pct(b.length) }}>
              {b.name}
            </div>
          ))}
        </div>

        {/* effect markers */}
        <div className="relative mt-1 h-9">
          {p.effects.map(e => (
            <button key={e.direction.id} data-pin
              title={`${formatSeconds(main(e.start))} ${EFFECT_LABEL[e.direction.type]}: ${e.direction.text}${V2_ONLY.has(e.direction.type) ? " (v2)" : ""}`}
              onClick={() => {
                p.player.seek(main(e.start));
                p.onSelect(e.direction);
              }}
              className={`absolute top-0 flex -translate-x-1/2 flex-col items-center ${V2_ONLY.has(e.direction.type) ? "opacity-50" : ""}`}
              style={{ left: pct(main(e.start)) }}>
              <span className={`flex h-6 w-6 items-center justify-center rounded-full border-2 bg-navy-900 text-xs ${p.selectedId === e.direction.id ? "scale-125" : ""}`} style={{ borderColor: EFFECT_COLOR[e.direction.type] }}>
                {EFFECT_ICON[e.direction.type]}
              </span>
              <span className="h-2 w-0.5" style={{ background: EFFECT_COLOR[e.direction.type] }} />
            </button>
          ))}
        </div>

        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-gold shadow-[0_0_6px_#c9a84c]" style={{ left: pct(t) }} />
      </div>
    </div>
  );
}
