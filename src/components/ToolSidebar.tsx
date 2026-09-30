import { BookOpen, Crosshair, Download, Pause, Play, Search, Settings, Sparkles, UserRound, Wand2 } from "lucide-react";
import type { Player } from "../lib/player.ts";
import { usePlayerTime } from "./VideoPreview.tsx";
import { formatSeconds } from "../lib/parser.ts";

interface Props {
  player: Player;
  onAi: () => void;
  onParse: () => void;
  onFind: () => void;
  onPlaceEffect: () => void;
  onGenerate: () => void;
  canGenerate: boolean;
  onTeleprompter: () => void;
  onExport: () => void;
  onSettings: () => void;
}

function Tool({ icon, label, onClick, disabled, accent }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; accent?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} title={label} aria-label={label}
      className={`flex min-h-14 w-full flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-medium leading-tight transition disabled:opacity-35 ${
        accent ? "bg-gold text-navy hover:bg-gold-light" : "text-white/65 hover:bg-white/5 hover:text-gold"}`}>
      {icon}
      <span className="text-center">{label}</span>
    </button>
  );
}

/** Quick-access tool rail on the left (desktop) */
export default function ToolSidebar(p: Props) {
  const t = usePlayerTime(p.player);
  return (
    <aside className="sticky top-[69px] hidden h-[calc(100vh-69px)] w-24 shrink-0 flex-col gap-1 overflow-y-auto border-r border-white/10 bg-navy-900/60 p-2 lg:flex" aria-label="Quick tools">
      <Tool icon={<Sparkles size={20} />} label="Ask AI" onClick={p.onAi} accent />
      <div className="my-1 h-px bg-white/10" />
      <Tool icon={p.player.playing ? <Pause size={20} /> : <Play size={20} />} label={p.player.playing ? `Pause ${formatSeconds(t)}` : `Play ${formatSeconds(t)}`}
        onClick={() => (p.player.playing ? p.player.pause() : p.player.play())} />
      <Tool icon={<Wand2 size={20} />} label="Parse script" onClick={p.onParse} />
      <Tool icon={<Search size={20} />} label="Find & replace" onClick={p.onFind} />
      <Tool icon={<Crosshair size={20} />} label="Add effect" onClick={p.onPlaceEffect} />
      <Tool icon={<UserRound size={20} />} label="Generate avatar" onClick={p.onGenerate} disabled={!p.canGenerate} />
      <Tool icon={<BookOpen size={20} />} label="Teleprompter" onClick={p.onTeleprompter} />
      <Tool icon={<Download size={20} />} label="Export" onClick={p.onExport} />
      <div className="mt-auto" />
      <Tool icon={<Settings size={20} />} label="Settings" onClick={p.onSettings} />
    </aside>
  );
}
