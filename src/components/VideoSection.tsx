import { useRef } from "react";
import { Crosshair, Film, Music, Scissors, Trash2, Upload, Volume2 } from "lucide-react";
import { Card, Section, Slider, Toggle } from "./ui.tsx";
import VideoPreview, { type Placement } from "./VideoPreview.tsx";
import Timeline from "./Timeline.tsx";
import type { Player } from "../lib/player.ts";
import type { Media } from "../lib/render.ts";
import type { TimedEffect } from "../lib/effects.ts";
import { formatSeconds, type Direction, type ParseResult } from "../lib/parser.ts";
import type { AvatarClip, Project, RenderState, VideoSettings } from "../lib/project.ts";
import type { Chapter } from "../lib/chapters.ts";

const VIDEO_ACCEPT = "video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov";

interface Props {
  player: Player;
  media: Media;
  getState: () => RenderState;
  effects: TimedEffect[];
  project: Project;
  setVideo: (patch: Partial<VideoSettings>) => void;
  setDuration: (d: number | null) => void;
  parse: ParseResult;
  clips: Record<string, AvatarClip>;
  chapters: Chapter[];
  selectedId: string | null;
  onSelect: (d: Direction) => void;
  placement: Placement | null;
  showTargets: boolean;
  setShowTargets: (v: boolean) => void;
  onBaseFile: (f: File) => void;
  onRemoveBase: () => void;
  onMusicFile: (f: File) => void;
  onRemoveMusic: () => void;
  busy: string | null;
}

export default function VideoSection(p: Props) {
  const baseRef = useRef<HTMLInputElement>(null);
  const musicRef = useRef<HTMLInputElement>(null);
  const { video, base, music } = p.project;
  const trimOut = base ? Math.min(video.trimOut ?? base.duration, base.duration) : 0;
  const playheadBase = () => {
    const m = p.player.t - p.getState().timing.intro;
    return Math.max(0, Math.min(base?.duration ?? 0, video.trimIn + Math.max(0, m) * video.speed));
  };

  return (
    <Section id="video" number={3} icon={<Film size={18} />} title="Video Editor" subtitle="Base video, preview, timeline, trim, speed and mix"
      actions={
        <button className={`btn !py-1.5 text-xs ${p.showTargets ? "btn-gold" : "btn-ghost"}`} onClick={() => p.setShowTargets(!p.showTargets)} aria-pressed={p.showTargets}>
          <Crosshair size={14} /> {p.showTargets ? "Hide effect boxes" : "Show effect boxes"}
        </button>
      }>
      <input ref={baseRef} type="file" accept={VIDEO_ACCEPT} className="hidden" onChange={e => {
        const f = e.target.files?.[0];
        if (f) p.onBaseFile(f);
        e.target.value = "";
      }} />
      <input ref={musicRef} type="file" accept="audio/*" className="hidden" onChange={e => {
        const f = e.target.files?.[0];
        if (f) p.onMusicFile(f);
        e.target.value = "";
      }} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        <div
          className="min-w-0"
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f?.type.startsWith("video/")) p.onBaseFile(f);
            else if (f?.type.startsWith("audio/")) p.onMusicFile(f);
          }}
        >
          <VideoPreview player={p.player} media={p.media} getState={p.getState} effects={p.effects}
            hasBase={!!base} onPickBase={() => baseRef.current?.click()}
            showTargets={p.showTargets} selectedId={p.selectedId} placement={p.placement} />
          {p.busy && <p className="mt-2 text-xs text-gold" aria-live="polite">{p.busy}</p>}
        </div>

        <div className="space-y-3">
          <Card title="Base video" icon={<Film size={16} />}>
            {base ? (
              <div className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate" title={base.name}>{base.name}</span>
                <span className="font-mono text-xs text-white/50">{formatSeconds(base.duration)}</span>
                <button className="btn btn-ghost !px-2 !py-1 text-xs" onClick={() => baseRef.current?.click()}>Replace</button>
                <button className="btn btn-ghost !px-1.5 !py-1" onClick={p.onRemoveBase} aria-label="Remove base video"><Trash2 size={14} /></button>
              </div>
            ) : (
              <div className="space-y-2">
                <button className="btn btn-navy w-full" onClick={() => baseRef.current?.click()}><Upload size={16} /> Upload video (MP4, WebM, MOV)</button>
                <label className="flex items-center gap-2 text-xs text-white/55">
                  Or preview without a video for
                  <input className="input !w-20 !py-1" type="number" min={1} max={1800} value={p.project.durationInput ?? 60}
                    onChange={e => p.setDuration(e.target.value ? Math.min(1800, Math.max(1, Number(e.target.value))) : null)} aria-label="Duration without video" />
                  seconds
                </label>
              </div>
            )}
            <p className="mt-2 text-[11px] text-white/40">Up to 30 minutes. Drop a video or music file anywhere on the preview.</p>
          </Card>

          <Card title="Trim & speed" icon={<Scissors size={16} />}>
            {base ? (
              <div className="space-y-3">
                <Slider label="In point" value={video.trimIn} min={0} max={Math.max(0, trimOut - 0.5)} step={0.1} format={formatSeconds}
                  onChange={v => p.setVideo({ trimIn: v })} />
                <Slider label="Out point" value={trimOut} min={Math.min(base.duration, video.trimIn + 0.5)} max={base.duration} step={0.1} format={formatSeconds}
                  onChange={v => p.setVideo({ trimOut: v >= base.duration - 0.05 ? null : v })} />
                <div className="flex gap-2">
                  <button className="btn btn-ghost flex-1 !py-1 text-xs" onClick={() => p.setVideo({ trimIn: Math.min(playheadBase(), trimOut - 0.5) })}>Set in at playhead</button>
                  <button className="btn btn-ghost flex-1 !py-1 text-xs" onClick={() => p.setVideo({ trimOut: Math.max(playheadBase(), video.trimIn + 0.5) })}>Set out at playhead</button>
                </div>
                <Slider label="Speed" value={video.speed} min={0.5} max={2} step={0.05} format={v => `${v.toFixed(2)}×`} onChange={v => p.setVideo({ speed: v })} />
                <p className="text-[11px] text-white/40">Edited length: {formatSeconds(p.getState().timing.main)} (script timing follows it)</p>
              </div>
            ) : <p className="text-sm text-white/40">Upload a video to trim it and change its speed.</p>}
          </Card>

          <Card title="Audio mix" icon={<Volume2 size={16} />}>
            <div className="space-y-2.5">
              <Slider label="Video" value={video.volumes.video} min={0} max={1} step={0.05} format={v => `${Math.round(v * 100)}%`} onChange={v => p.setVideo({ volumes: { ...video.volumes, video: v } })} />
              <Slider label="Voiceover" value={video.volumes.voice} min={0} max={1} step={0.05} format={v => `${Math.round(v * 100)}%`} onChange={v => p.setVideo({ volumes: { ...video.volumes, voice: v } })} />
              <Slider label="Music" value={video.volumes.music} min={0} max={1} step={0.05} format={v => `${Math.round(v * 100)}%`} onChange={v => p.setVideo({ volumes: { ...video.volumes, music: v } })} />
            </div>
            <div className="mt-3 border-t border-white/10 pt-3">
              <div className="flex items-center gap-2 text-sm">
                <Music size={14} className="text-gold" />
                {music ? (
                  <>
                    <span className="min-w-0 flex-1 truncate" title={music.name}>{music.name}</span>
                    <button className="btn btn-ghost !px-1.5 !py-1" onClick={p.onRemoveMusic} aria-label="Remove music"><Trash2 size={14} /></button>
                  </>
                ) : (
                  <button className="btn btn-ghost flex-1 !py-1 text-xs" onClick={() => musicRef.current?.click()}><Upload size={14} /> Add background music</button>
                )}
              </div>
              {music && (
                <label className="mt-2 flex items-center justify-between text-xs text-white/60">
                  Loop music to the end
                  <Toggle checked={video.musicLoop} onChange={v => p.setVideo({ musicLoop: v })} label="Loop music" />
                </label>
              )}
            </div>
          </Card>
        </div>
      </div>

      <div className="mt-4">
        <Timeline player={p.player} timing={p.getState().timing} parse={p.parse} effects={p.effects} project={p.project}
          clips={p.clips} chapters={p.chapters} selectedId={p.selectedId} onSelect={p.onSelect} />
      </div>
    </Section>
  );
}
