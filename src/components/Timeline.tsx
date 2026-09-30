import { useRef, useState } from "react";
import { EyeOff } from "lucide-react";
import { moveSegment, trimSegment, type AvatarSegment } from "../lib/avatarLayers.ts";
import type { AvatarEditing } from "./VideoPreview.tsx";
import type { Player } from "../lib/player.ts";
import { usePlayerTime } from "./VideoPreview.tsx";
import { EFFECT_COLOR, EFFECT_ICON, EFFECT_LABEL, V2_ONLY, type TimedEffect } from "../lib/effects.ts";
import { formatSeconds, type Direction, type ParseResult } from "../lib/parser.ts";
import { speechSchedule, type AvatarClip, type Project, type ProgramTiming } from "../lib/project.ts";
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
  /** Avatar track: one block per avatar layer (on-screen window) */
  avatarSegments?: AvatarSegment[];
  avatarEditing?: AvatarEditing;
}

const CLIP_STYLE: Record<string, string> = {
  done: "bg-gold/70 border-gold",
  generating: "bg-sky-400/40 border-sky-300 animate-pulse",
  queued: "bg-white/15 border-white/30",
  error: "bg-red-500/40 border-red-400",
  cancelled: "bg-white/10 border-white/20"
};

export default function Timeline(p: Props) {
  const barRef = useRef<HTMLDivElement>(null);
  const t = usePlayerTime(p.player);
  const total = Math.max(p.timing.total, 0.001);
  const pct = (s: number) => `${(Math.max(0, Math.min(total, s)) / total) * 100}%`;
  const main = (s: number) => p.timing.intro + s;

  const seekFrom = (clientX: number) => {
    const r = barRef.current!.getBoundingClientRect();
    p.player.seek(((clientX - r.left) / r.width) * total);
  };

  // Avatar track: drag the body to move a layer (window + speech), drag an edge to trim its window
  const [avatarDrag, setAvatarDrag] = useState<{ key: string; mode: "move" | "start" | "end"; x0: number; seg: AvatarSegment; moved: boolean } | null>(null);
  const secondsPerPx = () => total / Math.max(1, barRef.current?.getBoundingClientRect().width ?? 1);
  const avatarPointerDown = (e: React.PointerEvent<HTMLDivElement>, seg: AvatarSegment) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const edge = Math.min(10, r.width / 4);
    const mode = e.clientX - r.left < edge ? "start" : r.right - e.clientX < edge ? "end" : "move";
    e.currentTarget.setPointerCapture(e.pointerId);
    p.avatarEditing?.select(seg.key);
    setAvatarDrag({ key: seg.key, mode, x0: e.clientX, seg, moved: false });
  };
  const avatarPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = avatarDrag;
    if (!d || !p.avatarEditing) return;
    const delta = (e.clientX - d.x0) * secondsPerPx();
    if (!d.moved && Math.abs(e.clientX - d.x0) < 3) return;
    if (!d.moved) setAvatarDrag({ ...d, moved: true });
    const change = d.mode === "move" ? moveSegment(d.seg, delta, p.timing.main)
      : trimSegment(d.seg, d.mode, (d.mode === "start" ? d.seg.start : d.seg.end) + delta, p.timing.main);
    p.avatarEditing.change(d.key, change);
  };
  const avatarPointerUp = () => {
    if (avatarDrag && !avatarDrag.moved) p.player.seek(main(avatarDrag.seg.start));
    setAvatarDrag(null);
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
        {p.avatarSegments?.length ? <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-violet-400/60" /> avatar on screen</span> : null}
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
          {speechSchedule(p.parse, p.project, p.clips).map(slot => {
            const s = p.parse!.scenes[slot.sceneIndex];
            const clip = slot.clip;
            const shifted = slot.start - slot.scripted > 0.05;
            return (
              <div key={s.index} title={`${s.spoken}${clip ? ` — avatar ${clip.status}` : ""}${shifted ? ` — starts ${(slot.start - slot.scripted).toFixed(1)}s late so the line before isn't cut` : ""}`}
                className={`absolute top-1 h-3.5 overflow-hidden rounded border px-1 text-[9px] leading-3 text-white/90 ${clip ? CLIP_STYLE[clip.status] : "border-white/20 bg-white/10"} ${shifted ? "border-dashed" : ""}`}
                style={{ left: pct(main(slot.start)), width: pct(Math.max(0.3, slot.length)) }}>
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

        {/* avatar layers */}
        {p.avatarSegments && p.avatarSegments.length > 0 && (
          <div className="relative mt-1 h-7 rounded-md bg-navy/60" aria-label="Avatar track">
            {p.avatarSegments.map(seg => {
              const selected = p.avatarEditing?.selectedKey === seg.key;
              const label = seg.layout.visible ? (seg.layout.preset === "full" ? "Full" : seg.layout.preset === "custom" ? `Custom ${Math.round(seg.layout.scale * 100)}%` : `${seg.layout.preset.replace("-", " ")} ${Math.round(seg.layout.scale * 100)}%`) : "Hidden";
              return (
                <div key={`${seg.key}-${seg.index}`} data-pin role="button" tabIndex={0}
                  aria-label={`Avatar scene ${seg.index + 1}: ${label}, ${formatSeconds(seg.start)} to ${formatSeconds(seg.end)}`} aria-pressed={selected}
                  title={`Avatar scene ${seg.index + 1} · ${label} · ${formatSeconds(seg.start)}–${formatSeconds(seg.end)} — drag to move, drag an edge to trim`}
                  onPointerDown={e => avatarPointerDown(e, seg)} onPointerMove={avatarPointerMove} onPointerUp={avatarPointerUp} onPointerCancel={avatarPointerUp}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { p.avatarEditing?.select(seg.key); p.player.seek(main(seg.start)); } }}
                  className={`absolute top-0.5 flex h-6 cursor-grab items-center gap-1 overflow-hidden rounded border px-1.5 text-[10px] font-semibold capitalize leading-none ${
                    seg.layout.visible ? "border-violet-300/70 bg-violet-400/35 text-white" : "border-white/25 bg-[repeating-linear-gradient(45deg,transparent_0_4px,rgba(255,255,255,0.08)_4px_8px)] text-white/55"
                  } ${selected ? "ring-2 ring-gold" : ""}`}
                  style={{ left: pct(main(seg.start)), width: pct(Math.max(0.3, seg.end - seg.start)) }}>
                  <span className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-white/25" aria-hidden />
                  {!seg.layout.visible && <EyeOff size={11} aria-hidden />}
                  <span className="truncate pl-1">{seg.index + 1} · {label}</span>
                  <span className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-white/25" aria-hidden />
                </div>
              );
            })}
          </div>
        )}

        {/* effect markers */}
        <div className="relative mt-1 h-9">
          {p.effects.map(e => (
            <button key={e.direction.id} data-pin
              title={`${formatSeconds(main(e.start))} ${EFFECT_LABEL[e.direction.type]}: ${e.direction.text}${V2_ONLY.has(e.direction.type) ? " (avatar gesture)" : ""}`}
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
