import { useRef, useState } from "react";
import { Clapperboard, LayoutList, Loader2, Search, Sparkles, Undo2, Wand2, FileText } from "lucide-react";
import { Section, Seg } from "./ui.tsx";
import Editor from "./script/Editor.tsx";
import FindReplace from "./script/FindReplace.tsx";
import SceneBlocks from "./script/SceneBlocks.tsx";
import ParsedOutput from "./script/ParsedOutput.tsx";
import type { Direction, ParseResult, Scene } from "../lib/parser.ts";

const PLACEHOLDER = `[0:00] Victor says: 'Welcome to Haven Memory OS.'
ZOOM: Dashboard header
HIGHLIGHT: gold border`;

interface Props {
  script: string;
  setScript: (s: string) => void;
  parse: ParseResult;
  onParse: () => void;
  duration: number;
  intro: number;
  onAssist: () => Promise<void>;
  assistBusy: boolean;
  canUndo: boolean;
  onUndo: () => void;
  selectedId: string | null;
  onSelectDirection: (d: Direction) => void;
  onEditSpoken: (scene: Scene, text: string) => void;
  onSeek: (t: number) => void;
  avatarName: string;
  setAvatarName: (s: string) => void;
}

export default function ScriptSection(p: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [view, setView] = useState<"script" | "scenes">("script");
  const [finding, setFinding] = useState(false);
  const [parsedFlash, setParsedFlash] = useState(false);

  return (
    <Section
      id="script"
      number={1}
      icon={<Clapperboard size={18} />}
      title="Script Editor"
      subtitle="Write what the presenter says and does — it parses as you type"
      actions={
        <>
          {p.canUndo && <button className="btn btn-ghost !py-1.5 text-xs" onClick={p.onUndo}><Undo2 size={14} /> Undo AI</button>}
          <button className="btn btn-ghost !py-1.5 text-xs" onClick={() => setFinding(f => !f)} aria-pressed={finding}><Search size={14} /> Find & replace</button>
          <button className="btn btn-ghost !py-1.5 text-xs" onClick={() => void p.onAssist()} disabled={p.assistBusy || !p.script.trim()} title="Claude rewrites rough notes into director's script syntax and fixes formatting">
            {p.assistBusy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} AI Assist
          </button>
          <button className="btn btn-navy !py-1.5 text-xs" onClick={() => {
            p.onParse();
            setParsedFlash(true);
            setTimeout(() => setParsedFlash(false), 1200);
          }}>
            <Sparkles size={14} /> {parsedFlash ? "Parsed ✓" : "Parse"}
          </button>
        </>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <Seg value={view} onChange={setView} label="Editor view" options={[
              { id: "script", label: "Script" },
              { id: "scenes", label: "Scenes" }
            ]} />
            <span className="flex items-center gap-1 text-[11px] text-white/40">
              {view === "script" ? <><FileText size={12} /> Full script · Ctrl+Enter to parse</> : <><LayoutList size={12} /> Drag to reorder · duplicate · delete · add</>}
            </span>
            <span className="ml-auto text-[11px] text-white/40">{p.script.length.toLocaleString()} characters</span>
          </div>
          {finding && <FindReplace script={p.script} setScript={p.setScript} textarea={textareaRef} onClose={() => setFinding(false)} />}
          {view === "script" ? (
            <Editor ref={textareaRef} value={p.script} onChange={p.setScript} onSubmit={p.onParse} placeholder={PLACEHOLDER} label="Director's script" minHeight="min-h-[380px]" />
          ) : (
            <SceneBlocks script={p.script} setScript={p.setScript} duration={p.duration} />
          )}
          <label className="mt-3 flex items-center gap-2 text-xs text-white/55">
            Presenter name in the script
            <input className="input !w-40 !py-1" value={p.avatarName} onChange={e => p.setAvatarName(e.target.value)} placeholder="Victor" />
          </label>
        </div>
        <ParsedOutput parse={p.parse} intro={p.intro} selectedId={p.selectedId} onSelectDirection={p.onSelectDirection} onEditSpoken={p.onEditSpoken} onSeek={p.onSeek} />
      </div>
    </Section>
  );
}
