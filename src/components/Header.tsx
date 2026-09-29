import { Download, Save, Settings } from "lucide-react";

interface Props {
  name: string;
  setName: (s: string) => void;
  savedAt: number | null;
  onSave: () => void;
  onExport: () => void;
  onSettings: () => void;
  apiOnline: boolean | null;
}

function ago(ts: number | null): string {
  if (!ts) return "Not saved yet";
  const s = Math.round((Date.now() - ts) / 1000);
  return s < 5 ? "Saved just now" : s < 60 ? `Saved ${s}s ago` : `Saved ${Math.round(s / 60)}m ago`;
}

export default function Header(p: Props) {
  return (
    <header className="sticky top-0 z-30 border-b border-gold/20 bg-navy/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1500px] items-center gap-3 px-4 py-2.5">
        <img src="/favicon.svg" alt="" className="h-9 w-9 shrink-0" />
        <div className="hidden shrink-0 sm:block">
          <div className="font-display text-lg font-bold leading-tight text-gold">DirectorAI™</div>
          <div className="text-[10px] text-white/50">Write it like a director. Render it like a production.</div>
        </div>
        <div className="mx-1 hidden h-8 w-px bg-white/10 sm:block" />
        <div className="min-w-0 flex-1">
          <input
            value={p.name}
            onChange={e => p.setName(e.target.value)}
            aria-label="Project name"
            className="w-full max-w-md truncate rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-semibold text-light hover:border-white/15 focus:border-gold focus:outline-none sm:text-base"
          />
          <div className="flex items-center gap-2 px-2 text-[11px] text-white/45">
            <span>{ago(p.savedAt)} · autosaves every 30s</span>
            <span className="hidden items-center gap-1 md:flex">
              · <span className={`h-1.5 w-1.5 rounded-full ${p.apiOnline ? "bg-emerald-400" : p.apiOnline === false ? "bg-red-400" : "bg-white/30"}`} />
              {p.apiOnline ? "API online" : p.apiOnline === false ? "Offline — parsing still works" : "Checking…"}
            </span>
          </div>
        </div>
        <button className="btn btn-ghost" onClick={p.onSave} aria-label="Save project"><Save size={16} /><span className="hidden sm:inline">Save</span></button>
        <button className="btn btn-gold" onClick={p.onExport} aria-label="Go to export"><Download size={16} /><span className="hidden sm:inline">Export</span></button>
        <button className="btn btn-ghost !px-2.5" onClick={p.onSettings} aria-label="Settings"><Settings size={16} /></button>
      </div>
    </header>
  );
}
