import { useRef } from "react";
import { AudioWaveform, Eraser, Loader2, Mic, Music, Pause, Play, Trash2, Upload, Volume2 } from "lucide-react";
import { Card, EmptyState, FieldGroup, Section, Seg, Slider, Toggle, V2 } from "./ui.tsx";
import VoicePicker from "./VoicePicker.tsx";
import { usePlayerTime } from "./VideoPreview.tsx";
import type { Player } from "../lib/player.ts";
import type { ServerStatus } from "../lib/avatar.ts";
import { formatSeconds } from "../lib/parser.ts";
import { VOICE_PRESETS, type Project, type VideoSettings, type VoicePreset, type VoiceSettings } from "../lib/project.ts";

interface Props {
  project: Project;
  setVideo: (patch: Partial<VideoSettings>) => void;
  setVoice: (patch: Partial<VoiceSettings>) => void;
  server: ServerStatus | null;
  player: Player;
  onMusicFile: (f: File) => void;
  onRemoveMusic: () => void;
  onCleanBase: () => Promise<void>;
  onCleanMusic: () => Promise<void>;
  cleaning: string | null;
}

/** The Audio page: music, the mix, the voice, speed/tone, preview and noise reduction */
export default function AudioPage(p: Props) {
  const musicRef = useRef<HTMLInputElement>(null);
  const { video, music, voice, base, cleanedAudio } = p.project;
  const t = usePlayerTime(p.player);
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
        <Section id="audio-music" icon={<Music size={18} />} title="Background music" subtitle="Plays under the whole video, including intro and outro">
          <input ref={musicRef} type="file" accept="audio/*" className="hidden" onChange={e => {
            const f = e.target.files?.[0];
            if (f) p.onMusicFile(f);
            e.target.value = "";
          }} />
          {music ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-xl bg-navy p-3">
                <Music size={18} className="shrink-0 text-gold" />
                <span className="min-w-0 flex-1 truncate text-sm" title={music.name}>{music.name}</span>
                <span className="font-mono text-xs text-white/50">{formatSeconds(music.duration)}</span>
                <button className="btn btn-ghost" onClick={() => musicRef.current?.click()}>Replace</button>
                <button className="btn btn-ghost" onClick={p.onRemoveMusic} aria-label="Remove music"><Trash2 size={16} /></button>
              </div>
              <label className="flex items-center justify-between text-sm text-white/70">
                Loop music to the end of the video
                <Toggle checked={video.musicLoop} onChange={v => p.setVideo({ musicLoop: v })} label="Loop music" />
              </label>
            </div>
          ) : (
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault();
                const f = e.dataTransfer.files[0];
                if (f?.type.startsWith("audio/")) p.onMusicFile(f);
              }}
            >
              <EmptyState icon={<Music size={20} />} title="No music yet" action={
                <button className="btn btn-gold" onClick={() => musicRef.current?.click()}><Upload size={16} /> Upload music</button>
              }>Drop an MP3 or WAV here, or upload one.</EmptyState>
            </div>
          )}
        </Section>

        <Section id="audio-mix" icon={<Volume2 size={18} />} title="Mix" subtitle="Balance the three sources — applies to the preview and the export">
          <div className="space-y-5">
            <Slider label="Voiceover" value={video.volumes.voice} min={0} max={1} step={0.05} format={pct} onChange={v => p.setVideo({ volumes: { ...video.volumes, voice: v } })} />
            <Slider label="Video audio" value={video.volumes.video} min={0} max={1} step={0.05} format={pct} onChange={v => p.setVideo({ volumes: { ...video.volumes, video: v } })} />
            <Slider label="Music" value={video.volumes.music} min={0} max={1} step={0.05} format={pct} onChange={v => p.setVideo({ volumes: { ...video.volumes, music: v } })} />
            <button className="btn btn-navy w-full" onClick={() => (p.player.playing ? p.player.pause() : p.player.play())}>
              {p.player.playing ? <Pause size={16} /> : <Play size={16} />} {p.player.playing ? "Stop preview" : "Preview audio"} · {formatSeconds(t)}
            </button>
          </div>
        </Section>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Section id="audio-voice" icon={<Mic size={18} />} title="Voice" subtitle={voice.engine === "heygen" ? "HeyGen voice for the avatar" : "Free voice for the animated photo"}>
          {voice.engine === "heygen" ? (
            <VoicePicker voice={voice} setVoice={p.setVoice} server={p.server} />
          ) : (
            <div className="space-y-2">
              {(Object.keys(VOICE_PRESETS) as VoicePreset[]).map(v => (
                <button key={v} onClick={() => p.setVoice({ preset: v })} aria-pressed={voice.preset === v}
                  className={`flex min-h-12 w-full items-center gap-3 rounded-xl border px-4 text-left text-sm ${voice.preset === v ? "border-gold bg-gold/15 text-gold" : "border-white/10 text-white/80 hover:border-white/30"}`}>
                  <Mic size={16} /> {VOICE_PRESETS[v].label}
                </button>
              ))}
              <p className="text-xs text-white/40">Switch to Studio avatars on the Avatar page for 2,900+ voices.</p>
            </div>
          )}
          <div className="mt-4 flex items-center gap-2 text-xs text-white/40"><V2 /> Custom voice cloning</div>
        </Section>

        <div className="space-y-6">
          <Card title="Speed" icon={<Mic size={16} />}>
            <FieldGroup label="Voice speed" hint="Applies instantly — no re-render needed.">
              <Seg value={voice.speed} onChange={s => p.setVoice({ speed: s })} label="Voice speed" options={[
                { id: "slow", label: "Slow" }, { id: "normal", label: "Normal" }, { id: "fast", label: "Fast" }
              ]} />
            </FieldGroup>
          </Card>

          <Card title="Noise reduction" icon={<AudioWaveform size={16} />}>
            <div className="space-y-3">
              <button className="btn btn-navy w-full" onClick={() => void p.onCleanBase()} disabled={!base || !!p.cleaning}>
                {p.cleaning === "base" ? <Loader2 size={16} className="animate-spin" /> : <Eraser size={16} />} {cleanedAudio ? "Clean video audio again" : "Clean video audio"}
              </button>
              {cleanedAudio && (
                <label className="flex items-center justify-between text-sm text-white/70">
                  Use cleaned video audio
                  <Toggle checked={video.cleanBaseAudio} onChange={v => p.setVideo({ cleanBaseAudio: v })} label="Use cleaned audio" />
                </label>
              )}
              <button className="btn btn-ghost w-full" onClick={() => void p.onCleanMusic()} disabled={!music || !!p.cleaning}>
                {p.cleaning === "music" ? <Loader2 size={16} className="animate-spin" /> : <Eraser size={16} />} Clean music track
              </button>
              {!base && !music && <p className="text-xs text-white/40">Upload a video (Editor page) or music (above) first.</p>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
