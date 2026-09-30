import { Eye, EyeOff, Layers, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { Card, FieldGroup, Seg, Slider, Toggle } from "./ui.tsx";
import { applyPreset, PRESET_ORDER, type AvatarSegment } from "../lib/avatarLayers.ts";
import { AVATAR_PRESETS, type AvatarLayout, type AvatarMotion, type Project } from "../lib/project.ts";
import { formatSeconds } from "../lib/parser.ts";

interface Props {
  segments: AvatarSegment[];
  selectedKey: string | null;
  format: Project["format"];
  mainSeconds: number;
  onSelect: (key: string | null) => void;
  onChange: (key: string, change: Partial<AvatarLayout>) => void;
  onReset: (key: string) => void;
  onSeek: (mainSeconds: number) => void;
}

const MOTIONS: { id: AvatarMotion; label: string }[] = [
  { id: "none", label: "None" }, { id: "fade", label: "Fade" }, { id: "slide", label: "Slide" }, { id: "pop", label: "Pop" }
];

/**
 * Controls for one avatar layer. Everything here edits project layout data only —
 * rendered footage is reused as is, so no change costs provider credits.
 */
export default function AvatarLayerPanel(p: Props) {
  const seg = p.segments.find(s => s.key === p.selectedKey) ?? null;
  const change = (c: Partial<AvatarLayout>) => seg && p.onChange(seg.key, c);
  const timeInput = (edge: "start" | "end") => {
    if (!seg) return null;
    const custom = seg.layout[edge] !== null;
    return (
      <label className="block">
        <span className="field-label">{edge === "start" ? "On screen from" : "Until"} (seconds)</span>
        <div className="flex gap-1.5">
          <input className="input" type="number" step="0.1" min={0} max={p.mainSeconds}
            value={Math.round(seg[edge] * 10) / 10}
            onChange={e => {
              const v = Number(e.target.value);
              if (!Number.isFinite(v)) return;
              change(edge === "start"
                ? { start: Math.max(0, Math.min(v, seg.end - 0.25)) }
                : { end: Math.max(seg.start + 0.25, Math.min(v, p.mainSeconds)) });
            }} />
          <button className={`btn !px-2 text-xs ${custom ? "btn-navy" : "btn-ghost"}`} disabled={!custom} onClick={() => change({ [edge]: null })}
            title="Back to automatic timing (this line's speech → the next line)">Auto</button>
        </div>
      </label>
    );
  };

  return (
    <Card title="Avatar layer" icon={<Layers size={16} />} badge={seg && (
      <button className="btn btn-ghost !min-h-0 !px-2 !py-1 text-xs" onClick={() => p.onReset(seg.key)} title="Back to the project's default placement">
        <RotateCcw size={12} /> Reset layer
      </button>
    )}>
      {p.segments.length === 0 ? (
        <p className="text-sm text-white/50">Add voiceover lines to the script to get avatar layers.</p>
      ) : (
        <div className="space-y-4">
          <label className="block">
            <span className="field-label">Layer</span>
            <select className="input" value={seg?.key ?? ""} onChange={e => {
              const next = p.segments.find(s => s.key === e.target.value);
              p.onSelect(next?.key ?? null);
              if (next) p.onSeek(next.start);
            }}>
              <option value="">Select an avatar layer…</option>
              {p.segments.map(s => (
                <option key={`${s.key}-${s.index}`} value={s.key}>
                  Scene {s.index + 1} · {formatSeconds(s.start)}–{formatSeconds(s.end)} · {s.layout.visible ? AVATAR_PRESETS[s.layout.preset as keyof typeof AVATAR_PRESETS]?.label ?? "Custom" : "Hidden"}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[11px] text-white/40">Or click the avatar in the preview, or its block on the timeline.</span>
          </label>

          {seg && (
            <>
              <p className="line-clamp-2 rounded-lg bg-navy px-3 py-2 text-xs text-white/70">“{seg.spoken}”</p>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  {seg.layout.visible ? <Eye size={16} className="text-gold" /> : <EyeOff size={16} className="text-white/40" />}
                  Visible <Toggle checked={seg.layout.visible} onChange={v => change({ visible: v })} label="Avatar visible in this scene" />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  {seg.layout.muted ? <VolumeX size={16} className="text-white/40" /> : <Volume2 size={16} className="text-gold" />}
                  Speech <Toggle checked={!seg.layout.muted} onChange={v => change({ muted: !v })} label="Play this line's speech" />
                </label>
              </div>

              <FieldGroup label="Position">
                <div className="grid grid-cols-3 gap-1.5">
                  {PRESET_ORDER.map(preset => (
                    <button key={preset} aria-pressed={seg.layout.preset === preset}
                      onClick={() => change(applyPreset(preset, p.format))}
                      className={`min-h-10 rounded-lg border px-2 text-xs ${seg.layout.preset === preset ? "border-gold bg-gold font-semibold text-navy" : "border-white/15 text-white/75 hover:border-white/40"}`}>
                      {AVATAR_PRESETS[preset].label}
                    </button>
                  ))}
                </div>
                {seg.layout.preset === "custom" && <span className="mt-1 block text-[11px] text-gold/80">Custom position (dragged in the preview)</span>}
              </FieldGroup>

              <Slider label="Scale" value={Math.round(seg.layout.scale * 100)} min={8} max={100} step={1} format={v => `${v}% of width`}
                onChange={v => change(seg.layout.preset === "full" ? { ...applyPreset("center", p.format), scale: v / 100, preset: "custom" } : { scale: v / 100, preset: "custom" })} />
              <Slider label="Opacity" value={Math.round(seg.layout.opacity * 100)} min={10} max={100} step={5} format={v => `${v}%`}
                onChange={v => change({ opacity: v / 100 })} />

              <div className="grid gap-3 sm:grid-cols-2">{timeInput("start")}{timeInput("end")}</div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div><span className="field-label">Entrance</span><Seg value={seg.layout.entrance} onChange={v => change({ entrance: v })} label="Entrance" options={MOTIONS} /></div>
                <div><span className="field-label">Exit</span><Seg value={seg.layout.exit} onChange={v => change({ exit: v })} label="Exit" options={MOTIONS} /></div>
              </div>

              <p className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-[11px] text-emerald-100">
                Layout, visibility, timing and motion reuse the rendered footage — no re-render, no provider credits.
                {seg.clip?.status !== "done" && " No footage for this line yet; the layout applies once it's rendered."}
              </p>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
