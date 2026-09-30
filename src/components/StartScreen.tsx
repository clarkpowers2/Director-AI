import { useRef, useState } from "react";
import { Clapperboard, FileText, FolderOpen, Loader2, Sparkles, Trash2, Upload } from "lucide-react";
import type { ProjectSummary } from "../lib/storage.ts";

interface Props {
  projects: ProjectSummary[];
  currentId: string | null;
  busy: string | null;
  onCreateWithAi: () => void;
  onUpload: (file: File) => void;
  onBlank: () => void;
  onOpen: (id: string) => void;
  onDelete: (p: ProjectSummary) => void;
}

const STARTED: Record<string, string> = { ai: "Created with AI", upload: "From uploaded video", script: "From a script" };

/** "What do you want to create?" — the two ways into a DirectorAI project, plus saved projects */
export default function StartScreen(p: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [showAll, setShowAll] = useState(false);
  const list = showAll ? p.projects : p.projects.slice(0, 6);
  return (
    <div className="mx-auto w-full max-w-5xl py-6">
      <h1 className="text-center font-display text-3xl font-bold text-gold sm:text-4xl">What do you want to create?</h1>
      <p className="mt-2 text-center text-sm text-white/55">Both paths open the same DirectorAI™ Studio: one project, one timeline.</p>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <div className="flex flex-col rounded-2xl border border-gold/40 bg-gradient-to-br from-gold/10 to-transparent p-6">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gold text-navy"><Sparkles size={24} /></span>
          <h2 className="mt-4 text-xl font-semibold text-light">Create with AI</h2>
          <p className="mt-1 flex-1 text-sm text-white/60">Describe your video and let DirectorAI build the production: script, scenes, voiceover, presenter appearances, titles and timing.</p>
          <button className="btn btn-gold mt-5 !min-h-12 text-base" onClick={p.onCreateWithAi}><Sparkles size={18} /> Create video</button>
        </div>
        <div className="flex flex-col rounded-2xl border border-white/15 bg-navy-800/70 p-6">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gold/15 text-gold"><Upload size={24} /></span>
          <h2 className="mt-4 text-xl font-semibold text-light">Upload video</h2>
          <p className="mt-1 flex-1 text-sm text-white/60">Bring in an existing video and add an AI presenter, narration, titles and production effects.</p>
          <button className="btn btn-navy mt-5 !min-h-12 text-base" onClick={() => fileRef.current?.click()} disabled={!!p.busy}>
            {p.busy ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />} {p.busy ?? "Upload video"}
          </button>
          <input ref={fileRef} type="file" accept="video/mp4,video/webm,video/quicktime,video/*" className="hidden" onChange={e => {
            const f = e.target.files?.[0];
            if (f) p.onUpload(f);
            e.target.value = "";
          }} />
          <span className="mt-2 text-center text-[11px] text-white/40">MP4, WebM or MOV · up to 30 minutes · stays in this browser</span>
        </div>
      </div>

      <div className="mt-4 text-center">
        <button className="text-sm text-gold hover:underline" onClick={p.onBlank}><FileText size={14} className="-mt-0.5 mr-1 inline" />Or start from a blank Director's Script</button>
      </div>

      <section className="mt-10" aria-labelledby="open-project">
        <h2 id="open-project" className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-white/60"><FolderOpen size={16} /> Open project</h2>
        {p.projects.length === 0 ? <p className="text-sm text-white/40">No saved projects yet.</p> : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {list.map(pr => (
              <li key={pr.id} className="flex items-center gap-2 rounded-xl border border-white/10 bg-navy-900/60 p-3">
                <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => p.onOpen(pr.id)}>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gold/10 text-gold"><Clapperboard size={18} /></span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-light">{pr.name || "Untitled production"}</span>
                    <span className="block text-[11px] text-white/45">
                      {pr.id === p.currentId ? "Open now · " : ""}{STARTED[pr.startedWith ?? ""] ?? "Project"} · {new Date(pr.updatedAt).toLocaleDateString([], { month: "short", day: "numeric" })}
                    </span>
                  </span>
                </button>
                <button className="btn btn-ghost !min-h-9 !px-2" aria-label={`Delete ${pr.name}`} title={pr.id === p.currentId ? "This project is open" : "Delete project"}
                  disabled={pr.id === p.currentId} onClick={() => p.onDelete(pr)}><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
        )}
        {p.projects.length > 6 && !showAll && <button className="mt-2 text-xs text-gold hover:underline" onClick={() => setShowAll(true)}>Show all {p.projects.length} projects</button>}
      </section>
    </div>
  );
}
