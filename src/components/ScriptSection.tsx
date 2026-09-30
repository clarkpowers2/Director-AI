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
  onScriptAction: (action: string, instruction?: string) => Promise<void>;
  assistBusy: boolean;
  canUndo: boolean;
  onUndo: () => void;
  selectedId: string | null;
  onSelectDirection: (d: Direction) => void;
  onEditSpoken: (scene: Scene, text: string) => void;
  onSeek: (t: number) => void;
  avatarName: string;
  setAvatarName: (s: string) => void;
  finding: boolean;
  setFinding: (v: boolean) => void;
}

export default function ScriptSection(p: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [view, setView] = useState<"script" | "scenes">("script");
  const { finding, setFinding } = p;
  const [parsedFlash, setParsedFlash] = useState(false);
  const [scriptAction, setScriptAction] = useState("write");

  return (
    <Section
      id="script"
      icon={<Clapperboard size={18} />}
      title="Director's script"
      subtitle="Write what the presenter says and does — it parses as you type"
      actions={
        <>
          {p.canUndo && <button className="btn btn-ghost !py-1.5 text-xs" onClick={p.onUndo}><Undo2 size={14} /> Undo AI</button>}
          <button className="btn btn-ghost !py-1.5 text-xs" onClick={() => setFinding(!finding)} aria-pressed={finding}><Search size={14} /> Find & replace</button>
          <button className="btn btn-ghost !py-1.5 text-xs" onClick={() => void p.onAssist()} disabled={p.assistBusy || !p.script.trim()} title="Claude rewrites rough notes into director's script syntax and fixes formatting">
            {p.assistBusy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} AI Assist
          </button>
          <select className="input !w-auto !py-1.5 text-xs" aria-label="Script assistant action" value={scriptAction} onChange={e => setScriptAction(e.target.value)}>
            <option value="write">Write script</option><option value="improve">Improve</option><option value="shorten">Shorten</option><option value="expand">Expand</option><option value="tone">Change tone</option><option value="hook">Create hook</option><option value="cta">Create CTA</option><option value="avatar_directions">Add avatar directions</option><option value="visual_directions">Add visual directions</option><option value="broll_directions">Add B-roll directions</option><option value="split_scenes">Split into scenes</option>
          </select>
          <button className="btn btn-navy !py-1.5 text-xs" disabled={p.assistBusy || (scriptAction !== "write" && !p.script.trim())} onClick={() => {
            const instruction = scriptAction === "tone" || scriptAction === "write" ? window.prompt(scriptAction === "tone" ? "What tone should the script use?" : "What should the script cover?") ?? "" : "";
            if ((scriptAction === "tone" || scriptAction === "write") && !instruction.trim()) return;
            void p.onScriptAction(scriptAction, instruction);
          }}><Wand2 size={14}/> Apply</button>
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
