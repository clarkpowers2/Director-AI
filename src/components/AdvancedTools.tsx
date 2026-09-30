import { useRef, useState } from "react";
import {
  AudioWaveform, BookOpen, Check, Copy, Download, Eraser, Film, Languages, Link2, ListOrdered, Loader2, MonitorPlay, Trash2, Upload, Wrench
} from "lucide-react";
import { Card, Section, Seg, Slider, Toggle, V2 } from "./ui.tsx";
import { chaptersText, type Chapter } from "../lib/chapters.ts";
import { formatSeconds } from "../lib/parser.ts";
import { mainDuration, type BrollClip, type Project, type VideoSettings } from "../lib/project.ts";
import { download } from "../lib/export.ts";

export const LANGUAGES = [
  "Spanish", "French", "German", "Italian", "Portuguese", "Chinese (Simplified)", "Japanese", "Korean",
  "Arabic", "Hindi", "Russian", "Haitian Creole", "Tagalog", "Vietnamese"
];

interface Props {
  project: Project;
  chapters: Chapter[];
  spokenLines: string[];
  setVideo: (patch: Partial<VideoSettings>) => void;
  onCleanBase: () => Promise<void>;
  onCleanMusic: () => Promise<void>;
  cleaning: string | null;
  onAddBroll: (file: File) => void;
  onUpdateBroll: (id: string, patch: Partial<BrollClip>) => void;
  onRemoveBroll: (id: string) => void;
  playhead: () => number;
  onTranslate: (language: string) => Promise<void>;
  translating: string | null;
  onTeleprompter: () => void;
  fileBase: string;
}

export default function AdvancedTools(p: Props) {
  const brollRef = useRef<HTMLInputElement>(null);
  const [lang, setLang] = useState(LANGUAGES[0]);
  const [copied, setCopied] = useState(false);
  const { project } = p;
  const translatedCount = (l: string) => p.spokenLines.filter(s => project.translations[l]?.[s]).length;
  const main = mainDuration(project);

  return (
    <Section id="advanced" icon={<Wrench size={18} />} title="Production tools" subtitle="Each tool works on its own — use what you need">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card title="Noise reduction" icon={<AudioWaveform size={16} />}>
          <p className="mb-3 text-xs text-white/55">Removes hiss and background hum from your recording's audio or the music track.</p>
          <div className="space-y-2">
            <button className="btn btn-navy w-full text-xs" onClick={() => void p.onCleanBase()} disabled={!project.base || !!p.cleaning}>
              {p.cleaning === "base" ? <Loader2 size={14} className="animate-spin" /> : <Eraser size={14} />} {project.cleanedAudio ? "Clean video audio again" : "Clean video audio"}
            </button>
            {project.cleanedAudio && (
              <label className="flex items-center justify-between text-xs text-white/65">
                Use cleaned audio
                <Toggle checked={project.video.cleanBaseAudio} onChange={v => p.setVideo({ cleanBaseAudio: v })} label="Use cleaned audio" />
              </label>
            )}
            <button className="btn btn-ghost w-full text-xs" onClick={() => void p.onCleanMusic()} disabled={!project.music || !!p.cleaning}>
              {p.cleaning === "music" ? <Loader2 size={14} className="animate-spin" /> : <Eraser size={14} />} Clean music track
            </button>
            {!project.base && !project.music && <p className="text-[11px] text-white/35">Upload a video or music in Section 3 first.</p>}
          </div>
        </Card>

        <Card title="Auto chapters" icon={<ListOrdered size={16} />}>
          <p className="mb-2 text-xs text-white/55">From TITLE cards and timestamped scenes. Paste into a YouTube description.</p>
          {p.chapters.length < 3 && <p className="mb-2 text-[11px] text-gold/80">YouTube needs at least 3 chapters, 10 seconds apart.</p>}
          <pre className="max-h-36 overflow-auto rounded-lg bg-navy p-2 font-mono text-xs text-white/80">{chaptersText(p.chapters) || "No chapters yet."}</pre>
          <div className="mt-2 flex gap-2">
            <button className="btn btn-ghost flex-1 !py-1 text-xs" disabled={!p.chapters.length} onClick={() => void navigator.clipboard.writeText(chaptersText(p.chapters)).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}</button>
            <button className="btn btn-ghost flex-1 !py-1 text-xs" disabled={!p.chapters.length}
              onClick={() => download(new Blob([chaptersText(p.chapters)], { type: "text/plain" }), `${p.fileBase}-chapters.txt`)}>
              <Download size={14} /> .txt
            </button>
          </div>
        </Card>

        <Card title="Subtitle translation" icon={<Languages size={16} />}>
          <p className="mb-2 text-xs text-white/55">Claude translates the captions. Pick the caption language in Branding; SRT exports use it too.</p>
          <div className="flex gap-2">
            <select className="input" value={lang} onChange={e => setLang(e.target.value)} aria-label="Translate to">
              {LANGUAGES.map(l => <option key={l} value={l}>{l}{translatedCount(l) ? ` (${translatedCount(l)}/${p.spokenLines.length})` : ""}</option>)}
            </select>
            <button className="btn btn-gold shrink-0 text-xs" onClick={() => void p.onTranslate(lang)} disabled={!!p.translating || !p.spokenLines.length}>
              {p.translating === lang ? <Loader2 size={14} className="animate-spin" /> : <Languages size={14} />} Translate
            </button>
          </div>
          <p className="mt-2 text-[11px] text-white/40">Only new or changed lines are sent, so re-translating after edits is quick.</p>
        </Card>

        <Card title="B-roll" icon={<Film size={16} />} className="md:col-span-2 xl:col-span-2">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <p className="flex-1 text-xs text-white/55">Secondary clips that play over the base video at set times — full screen or picture-in-picture (muted).</p>
            <button className="btn btn-navy text-xs" onClick={() => brollRef.current?.click()}><Upload size={14} /> Add clip at playhead</button>
            <input ref={brollRef} type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" className="hidden" onChange={e => {
              const f = e.target.files?.[0];
              if (f) p.onAddBroll(f);
              e.target.value = "";
            }} />
          </div>
          {project.broll.length === 0 && <p className="text-sm text-white/40">No B-roll yet.</p>}
          <ul className="space-y-2">
            {project.broll.map(b => (
              <li key={b.id} className="grid gap-2 rounded-lg border border-white/10 p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto_auto] sm:items-center">
                <div className="min-w-0 text-sm">
                  <div className="truncate" title={b.name}>{b.name}</div>
                  <div className="text-[11px] text-white/45">at {formatSeconds(b.start)} · clip {formatSeconds(b.duration)}</div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Slider label="Start" value={b.start} min={0} max={Math.max(0, main - 0.5)} step={0.1} format={formatSeconds} onChange={v => p.onUpdateBroll(b.id, { start: v })} />
                  <Slider label="Length" value={b.length} min={0.5} max={Math.max(0.5, b.duration)} step={0.1} format={v => `${v.toFixed(1)}s`} onChange={v => p.onUpdateBroll(b.id, { length: v })} />
                </div>
                <Seg value={b.mode} onChange={v => p.onUpdateBroll(b.id, { mode: v })} label="B-roll layout" options={[{ id: "full", label: "Full" }, { id: "pip", label: "PiP" }]} />
                <button className="btn btn-ghost !px-2" onClick={() => p.onRemoveBroll(b.id)} aria-label={`Remove ${b.name}`}><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Teleprompter" icon={<BookOpen size={16} />}>
          <p className="mb-3 text-xs text-white/55">Read the voiceover yourself on camera: full-screen scrolling text with speed, size and mirror controls.</p>
          <button className="btn btn-navy w-full text-xs" onClick={p.onTeleprompter} disabled={!p.spokenLines.length}><MonitorPlay size={14} /> Open teleprompter</button>
        </Card>

        <Card title="Background remover" icon={<Eraser size={16} />} badge={<V2 />}>
          <p className="text-xs text-white/50">Cut the presenter out of their photo so the avatar floats over your video. Needs an image-segmentation model; planned for v2.</p>
        </Card>
        <Card title="Green screen replacement" icon={<MonitorPlay size={16} />} badge={<V2 />}>
          <p className="text-xs text-white/50">Key out a green background in the base video or B-roll. Needs GPU (WebGL) processing to run at full resolution; planned for v2.</p>
        </Card>
        <Card title="Share preview link" icon={<Link2 size={16} />} badge={<V2 />}>
          <p className="text-xs text-white/50">A private URL to review the video. Needs cloud storage for your videos (up to 30 min each); planned for v2. For now, export and share the MP4.</p>
        </Card>
      </div>
    </Section>
  );
}

