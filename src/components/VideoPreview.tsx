import { useEffect, useRef, useState } from "react";
import { Crosshair, Maximize, Pause, Play, SkipBack, Upload } from "lucide-react";
import type { Player } from "../lib/player.ts";
import { baseAspect, contentRect, renderFrame, type Media } from "../lib/render.ts";
import type { TimedEffect } from "../lib/effects.ts";
import { formatSeconds } from "../lib/parser.ts";
import type { RenderState, TargetRect } from "../lib/project.ts";

const W = 1280, H = 720;

/** Re-renders ~20×/s while the clock moves, and whenever play/pause changes */
export function usePlayerTime(player: Player): number {
  const [snap, setSnap] = useState({ t: player.t, playing: player.playing });
  useEffect(() => {
    let raf = 0, lastT = -1, lastPlaying = !player.playing;
    const loop = () => {
      if (Math.abs(player.t - lastT) > 0.05 || player.playing !== lastPlaying) {
        lastT = player.t;
        lastPlaying = player.playing;
        setSnap({ t: player.t, playing: player.playing });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [player]);
  return snap.t;
}

export interface Placement {
  /** Shown over the preview, e.g. "Click or drag where the ZOOM should land" */
  prompt: string;
  onPlace: (rect: TargetRect) => void;
  onCancel: () => void;
}

interface Props {
  player: Player;
  media: Media;
  getState: () => RenderState;
  effects: TimedEffect[];
  hasBase: boolean;
  onPickBase: () => void;
  showTargets: boolean;
  selectedId: string | null;
  placement: Placement | null;
}

export default function VideoPreview(p: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const t = usePlayerTime(p.player);
  const total = p.getState().timing.total;

  const live = useRef(p);
  live.current = p;
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    const ctx = canvasRef.current!.getContext("2d")!;
    let raf = 0;
    const loop = () => {
      const { player, media, getState, effects, showTargets, placement, selectedId } = live.current;
      renderFrame(ctx, W, H, player.t, getState(), media, effects, { editTargets: showTargets || !!placement, selectedDirectionId: selectedId });
      const d = draftRef.current;
      if (d) {
        ctx.save();
        ctx.strokeStyle = "#c9a84c";
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 6]);
        ctx.strokeRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
        ctx.restore();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const toCanvas = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };

  // Read the drag from the ref: on a quick click, pointerup fires before React re-renders
  const updateDraft = (d: typeof draft) => {
    draftRef.current = d;
    setDraft(d);
  };

  const finish = () => {
    const draft = draftRef.current;
    if (!draft || !p.placement) return updateDraft(null);
    const content = contentRect(W, H, baseAspect(p.media));
    const nx = (v: number) => Math.min(1, Math.max(0, (v - content.x) / content.w));
    const ny = (v: number) => Math.min(1, Math.max(0, (v - content.y) / content.h));
    let x = nx(Math.min(draft.x0, draft.x1)), y = ny(Math.min(draft.y0, draft.y1));
    let w = nx(Math.max(draft.x0, draft.x1)) - x, h = ny(Math.max(draft.y0, draft.y1)) - y;
    if (w < 0.02 || h < 0.02) {
      // a click: center a box on that point
      w = 0.2;
      h = 0.2;
      x = Math.min(1 - w, Math.max(0, nx(draft.x0) - w / 2));
      y = Math.min(1 - h, Math.max(0, ny(draft.y0) - h / 2));
    }
    p.placement.onPlace({ x, y, w, h });
    updateDraft(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <div ref={wrapRef} className="relative overflow-hidden rounded-xl border border-white/10 bg-black">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          aria-label="Video preview"
          className={`block aspect-video w-full ${p.placement ? "cursor-crosshair" : ""}`}
          onPointerDown={e => {
            if (!p.placement) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            const pt = toCanvas(e);
            updateDraft({ x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y });
          }}
          onPointerMove={e => {
            const d = draftRef.current;
            if (!d) return;
            const pt = toCanvas(e);
            updateDraft({ ...d, x1: pt.x, y1: pt.y });
          }}
          onPointerUp={finish}
        />
        {!p.hasBase && !p.placement && (
          <button onClick={p.onPickBase}
            className="absolute inset-x-4 top-4 flex items-center justify-center gap-2 rounded-lg border border-dashed border-gold/60 bg-navy/85 px-4 py-3 text-sm text-gold backdrop-blur hover:bg-navy">
            <Upload size={16} /> Upload your screen recording · MP4, WebM or MOV · up to 30 minutes
          </button>
        )}
        {p.placement && (
          <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gold px-3 py-2 text-xs font-semibold text-navy">
            <span className="flex items-center gap-1.5"><Crosshair size={14} /> {p.placement.prompt}</span>
            <button className="rounded bg-navy/15 px-2 py-0.5 hover:bg-navy/25" onClick={p.placement.onCancel}>Cancel</button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-ghost !px-2" onClick={() => p.player.seek(0)} aria-label="Back to start"><SkipBack size={16} /></button>
        <button className="btn btn-gold !px-3" onClick={() => (p.player.playing ? p.player.pause() : p.player.play())} aria-label={p.player.playing ? "Pause" : "Play"}>
          {p.player.playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <span className="font-mono text-sm tabular-nums text-white/70">{formatSeconds(t)} / {formatSeconds(total)}</span>
        <button className="btn btn-ghost ml-auto !px-2" aria-label="Full screen preview" onClick={() => void wrapRef.current?.requestFullscreen?.().catch(() => {})}>
          <Maximize size={16} />
        </button>
      </div>
    </div>
  );
}
