import { AudioLines, Clapperboard, Download, PackageOpen, Plus, Save, Settings, Sparkles, UserRound, Wrench } from "lucide-react";
import type { PageId } from "../lib/command.ts";

export const PAGES: { id: PageId; label: string; icon: React.ReactNode; blurb: string }[] = [
  { id: "editor", label: "Editor", icon: <Clapperboard size={18} />, blurb: "Write the script and bring in your video" },
  { id: "effects", label: "Effects", icon: <Sparkles size={18} />, blurb: "Zooms, highlights, callouts, titles, transitions and branding" },
  { id: "advanced", label: "Advanced", icon: <Wrench size={18} />, blurb: "Production tools: clean-up, chapters, B-roll, translation, teleprompter" },
  { id: "audio", label: "Audio", icon: <AudioLines size={18} />, blurb: "Music, the mix, and the presenter's voice" },
  { id: "avatar", label: "Avatar", icon: <UserRound size={18} />, blurb: "Pick the presenter, place it, and generate it" },
  { id: "export", label: "Export", icon: <PackageOpen size={18} />, blurb: "Render the video and its companion files" }
];

interface Props {
  page: PageId;
  onPage: (p: PageId) => void;
  /** Start screen: new project or open another */
  onNew: () => void;
  name: string;
  setName: (s: string) => void;
  savedAt: number | null;
  onSave: () => void;
  onSettings: () => void;
  apiOnline: boolean | null;
}

function ago(ts: number | null): string {
  if (!ts) return "Autosaves every 30s";
  const s = Math.round((Date.now() - ts) / 1000);
  return s < 5 ? "Saved just now" : s < 60 ? `Saved ${s}s ago` : `Saved ${Math.round(s / 60)}m ago`;
}

export default function Header(p: Props) {
  return (
    <header className="sticky top-0 z-30 border-b border-gold/20 bg-navy/95 backdrop-blur">
      <div className="flex items-center gap-3 px-4 py-2.5 lg:px-6">
        <img src="/favicon.svg" alt="" className="h-9 w-9 shrink-0" />
        <div className="hidden shrink-0 font-display text-lg font-bold text-gold xl:block">DirectorAI™</div>

        <nav className="ml-2 hidden gap-1 lg:flex" aria-label="Pages">
          {PAGES.map(pg => (
            <button key={pg.id} onClick={() => p.onPage(pg.id)} aria-current={p.page === pg.id ? "page" : undefined}
              className={`flex min-h-12 items-center gap-2 rounded-xl px-3 text-sm font-medium transition ${p.page === pg.id ? "bg-gold text-navy" : "text-white/70 hover:bg-white/5 hover:text-gold"}`}>
              {pg.icon} {pg.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1 text-center">
          <input value={p.name} onChange={e => p.setName(e.target.value)} aria-label="Project name"
            className="mx-auto block w-full max-w-xs truncate rounded-md border border-transparent bg-transparent px-2 py-1 text-center text-sm font-semibold text-light hover:border-white/15 focus:border-gold focus:outline-none sm:text-base" />
          <div className="flex items-center justify-center gap-1.5 text-[11px] text-white/45">
            <span className={`h-1.5 w-1.5 rounded-full ${p.apiOnline ? "bg-emerald-400" : p.apiOnline === false ? "bg-red-400" : "bg-white/30"}`} />
            {ago(p.savedAt)}
          </div>
        </div>

        <button className="btn btn-ghost" onClick={p.onNew} aria-label="New or open project" title="New or open project"><Plus size={18} /><span className="hidden 2xl:inline">Projects</span></button>
        <button className="btn btn-ghost" onClick={p.onSave} aria-label="Save project"><Save size={18} /><span className="hidden sm:inline">Save</span></button>
        <button className="btn btn-gold hidden sm:inline-flex" onClick={() => p.onPage("export")} aria-label="Go to export"><Download size={18} /> Export</button>
        <button className="btn btn-ghost !px-3" onClick={p.onSettings} aria-label="Settings"><Settings size={18} /></button>
      </div>
    </header>
  );
}

/** Bottom tab bar on phones */
export function MobileTabs({ page, onPage }: { page: PageId; onPage: (p: PageId) => void }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-gold/20 bg-navy/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Pages">
      {PAGES.map(pg => (
        <button key={pg.id} onClick={() => onPage(pg.id)} aria-current={page === pg.id ? "page" : undefined}
          className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${page === pg.id ? "text-gold" : "text-white/55"}`}>
          {pg.icon}
          {pg.label}
        </button>
      ))}
    </nav>
  );
}
