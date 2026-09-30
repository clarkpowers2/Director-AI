import { useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Download, FileAudio, FileText, Film, Loader2, PackageOpen, Subtitles, X } from "lucide-react";
import { Section, Seg, Toggle } from "./ui.tsx";
import {
  buildPdf, buildSrt, download, exportAudio, exportVideo, ExportError, RESOLUTIONS,
  type ExportSources, type Format, type Resolution
} from "../lib/export.ts";
import { formatSeconds } from "../lib/parser.ts";
import type { RenderState } from "../lib/project.ts";

interface Props {
  getState: () => RenderState;
  sources: () => Promise<ExportSources>;
  clipsReady: number;
  clipsNeeded: number;
  canGenerate: boolean;
  /** Open the Render Avatar panel — export never renders avatar scenes by itself */
  onRenderAvatar: () => void;
  pausePreview: () => void;
  fileBase: string;
}

interface Job {
  kind: "video" | "audio" | "srt" | "pdf";
  status: string;
  progress: number;
  error?: string;
  result?: { blob: Blob; filename: string; note?: string };
}

function size(bytes: number): string {
  return bytes > 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

export default function ExportSection(p: Props) {
  const [format, setFormat] = useState<Format>("mp4");
  const [res, setRes] = useState<Resolution>("1080p");
  const [includeAvatar, setIncludeAvatar] = useState(true);
  const [job, setJob] = useState<Job | null>(null);
  const [raw, setRaw] = useState<{ blob: Blob; ext: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const busy = !!job && !job.result && !job.error;
  const state = p.getState();
  const hasScript = !!state.parse?.scenes.length;
  const lang = state.project.branding.captions.language;

  const run = async (kind: Job["kind"], fn: (signal: AbortSignal) => Promise<Job["result"]>) => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRaw(null);
    setJob({ kind, status: "Starting...", progress: 0 });
    try {
      const result = await fn(ctrl.signal);
      setJob(j => j && { ...j, status: "Download ready!", progress: 1, result });
    } catch (err) {
      // Only our own worded errors are shown; anything unexpected gets a plain message
      const message = err instanceof ExportError ? err.message : "Export failed. Try again, or try a different format or resolution.";
      setJob(j => j && { ...j, error: message });
    }
  };

  const cb = {
    onStatus: (status: string) => setJob(j => j && { ...j, status }),
    onProgress: (progress: number) => setJob(j => j && { ...j, progress }),
    onRecorded: (blob: Blob, ext: string) => setRaw({ blob, ext })
  };

  const exportFull = () => run("video", async signal => {
    p.pausePreview();
    if (includeAvatar && p.canGenerate && p.clipsReady < p.clipsNeeded) {
      // Rendering uses provider credits, so it only ever starts from a confirmed Render Avatar panel
      throw new ExportError(`${p.clipsNeeded - p.clipsReady} avatar scene${p.clipsNeeded - p.clipsReady > 1 ? "s aren't" : " isn't"} rendered yet. Use "Render missing scenes" first, or export without the avatar.`);
    }
    const s = p.getState();
    const renderState = includeAvatar ? s : { ...s, project: { ...s.project, avatar: { ...s.project.avatar, enabled: false } } };
    const out = await exportVideo(renderState, await p.sources(), res, format, cb, signal);
    return { blob: out.blob, filename: `${p.fileBase}-${res}.${out.ext}`, note: out.note };
  });

  return (
    <Section id="export" icon={<PackageOpen size={18} />} title="Render and download" subtitle="The finished video, plus voiceover, captions and scene directions">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="rounded-xl border border-gold/40 bg-gold/5 p-4">
          <div className="mb-3 flex items-center gap-2 font-semibold"><Film size={18} className="text-gold" /> Full video</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <span className="field-label">Format</span>
              <Seg value={format} onChange={setFormat} label="Format" options={[{ id: "mp4", label: "MP4 (H.264)" }, { id: "webm", label: "WebM" }]} />
            </div>
            <div>
              <span className="field-label">Resolution</span>
              <Seg value={res} onChange={setRes} label="Resolution" options={(Object.keys(RESOLUTIONS) as Resolution[]).map(r => ({ id: r, label: r === "4k" ? "4K" : r }))} />
            </div>
          </div>
          <label className="mt-3 flex items-center justify-between gap-3 text-sm text-white/75">
            <span>
              Include avatar
              <span className="block text-[11px] text-white/45">{p.clipsNeeded ? `${p.clipsReady}/${p.clipsNeeded} scenes rendered` : "No voiceover lines"}</span>
              {includeAvatar && p.canGenerate && p.clipsReady < p.clipsNeeded && (
                <button className="mt-1 text-[11px] text-gold hover:underline" onClick={p.onRenderAvatar}>Render missing scenes…</button>
              )}
            </span>
            <Toggle checked={includeAvatar} onChange={setIncludeAvatar} label="Include avatar" />
          </label>
          <button className="btn btn-gold mt-4 w-full !py-3" onClick={() => void exportFull()} disabled={busy || !hasScript}>
            <Film size={16} /> Export video · {formatSeconds(state.timing.total)}
          </button>
          <p className="mt-2 text-[11px] text-white/45">
            Renders in real time (a {formatSeconds(state.timing.total)} video takes about that long). Keep this tab open and visible.
            {res === "4k" ? " 4K needs a fast computer." : ""}
            {state.timing.total > 480 ? " Long videos use a lower bitrate to stay within browser memory." : ""}
          </p>
        </div>

        <div className="space-y-2">
          <span className="field-label">Also export separately</span>
          <ExportRow icon={<FileAudio size={16} />} title="Voiceover audio" detail="MP3 of the avatar's lines at their timestamps"
            disabled={busy || p.clipsReady === 0} hint={p.clipsReady === 0 ? "Generate the avatar voice first" : undefined}
            onClick={() => void run("audio", async () => ({ blob: await exportAudio(p.getState(), cb), filename: `${p.fileBase}-voiceover.mp3` }))} />
          <ExportRow icon={<Subtitles size={16} />} title="Captions" detail={`SRT · ${lang === "original" ? "original language" : lang}`}
            disabled={busy || !hasScript}
            onClick={() => void run("srt", async () => ({ blob: new Blob([buildSrt(p.getState())], { type: "application/x-subrip" }), filename: `${p.fileBase}-captions${lang === "original" ? "" : `-${lang.toLowerCase().replace(/[^a-z]+/g, "-")}`}.srt` }))} />
          <ExportRow icon={<FileText size={16} />} title="Scene directions" detail="PDF to hand to a video editor"
            disabled={busy || !hasScript}
            onClick={() => void run("pdf", async () => {
              cb.onStatus("Building PDF...");
              return { blob: await buildPdf(p.getState()), filename: `${p.fileBase}-scene-directions.pdf` };
            })} />
        </div>
      </div>

      {job && (
        <div className="mt-4 rounded-xl border border-white/10 bg-navy-900 p-4" aria-live="polite">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            {job.error ? <AlertCircle size={18} className="text-red-300" /> : job.result ? <CheckCircle2 size={18} className="text-gold" /> : <Loader2 size={18} className="animate-spin text-gold" />}
            <span className={job.error ? "text-red-300" : ""}>{job.error ?? job.status}</span>
            <div className="ml-auto flex gap-2">
              {busy && raw && (
                <button className="btn btn-navy !py-1 text-xs" onClick={() => download(raw.blob, `${p.fileBase}-${res}.${raw.ext}`)} title="Skip the conversion and save the recording now">
                  <Download size={12} /> Save {raw.ext.toUpperCase()} now
                </button>
              )}
              {busy && job.kind === "video" && <button className="btn btn-ghost !py-1 text-xs" onClick={() => abortRef.current?.abort()}><X size={12} /> Cancel</button>}
            </div>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div className={`h-full transition-[width] ${job.error ? "bg-red-400" : "bg-gold"}`} style={{ width: `${Math.round(job.progress * 100)}%` }} />
          </div>
          {job.result && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button className="btn btn-gold" onClick={() => download(job.result!.blob, job.result!.filename)}><Download size={16} /> Download</button>
              <span className="text-sm text-white/70">{job.result.filename} · {size(job.result.blob.size)}</span>
              {job.result.note && <p className="w-full text-xs text-gold/80">{job.result.note}</p>}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function ExportRow({ icon, title, detail, onClick, disabled, hint }: { icon: React.ReactNode; title: string; detail: string; onClick: () => void; disabled?: boolean; hint?: string }) {
  return (
    <button onClick={onClick} disabled={disabled} className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-navy-900/60 p-3 text-left transition hover:border-gold/50 disabled:cursor-not-allowed disabled:opacity-45">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gold/15 text-gold">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-white/50">{hint ?? detail}</span>
      </span>
      <Download size={16} className="text-white/40" />
    </button>
  );
}
