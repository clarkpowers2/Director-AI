import { useState } from "react";
import { Check, Copy, Pencil } from "lucide-react";
import { formatSeconds, type Direction, type ParseResult, type Scene } from "../../lib/parser.ts";
import { EFFECT_COLOR, EFFECT_ICON, V2_ONLY } from "../../lib/effects.ts";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn btn-ghost !px-2 !py-1 text-xs"
      aria-label={label}
      onClick={() => void navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
    </button>
  );
}

interface Props {
  parse: ParseResult;
  intro: number;
  selectedId: string | null;
  onSelectDirection: (d: Direction) => void;
  onEditSpoken: (scene: Scene, text: string) => void;
  onSeek: (t: number) => void;
}

export default function ParsedOutput({ parse, intro, selectedId, onSelectDirection, onEditSpoken, onSeek }: Props) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const spoken = parse.scenes.filter(s => s.spoken);
  const directions = parse.scenes.flatMap(s => s.directions.map(d => ({ d, scene: s })));

  const commit = (scene: Scene) => {
    const text = draft.trim();
    if (text && text !== scene.spoken) onEditSpoken(scene, text);
    setEditing(null);
  };

  return (
    <div className="grid gap-3">
      <div className="rounded-xl border border-white/10 bg-navy-900/60 p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gold">Voiceover <span className="normal-case text-white/40">· click a line to edit</span></h3>
          <CopyButton text={parse.voiceover_script} label="Copy voiceover script" />
        </div>
        {spoken.length === 0 && <p className="text-sm text-white/40">No spoken lines yet.</p>}
        <ol className="max-h-72 space-y-1 overflow-auto pr-1">
          {spoken.map(scene => (
            <li key={scene.index} className="group flex items-start gap-2 rounded-lg px-1.5 py-1 hover:bg-white/5">
              <button className="mt-0.5 shrink-0 font-mono text-[11px] text-white/45 hover:text-gold" onClick={() => scene.start !== null && onSeek(intro + scene.start)} title="Jump to this line">
                {scene.start === null ? "—" : `${scene.estimated ? "~" : ""}${formatSeconds(scene.start)}`}
              </button>
              {editing === scene.index ? (
                <input
                  className="input !py-1 text-sm"
                  value={draft}
                  autoFocus
                  aria-label="Edit voiceover line"
                  onChange={e => setDraft(e.target.value)}
                  onBlur={() => commit(scene)}
                  onKeyDown={e => {
                    if (e.key === "Enter") commit(scene);
                    if (e.key === "Escape") setEditing(null);
                  }}
                />
              ) : (
                <button className="flex flex-1 items-start gap-1.5 text-left text-sm text-white/90" onClick={() => {
                  setEditing(scene.index);
                  setDraft(scene.spoken);
                }}>
                  <span className="flex-1">{scene.spoken}</span>
                  <Pencil size={12} className="mt-1 shrink-0 text-white/25 group-hover:text-gold" />
                </button>
              )}
            </li>
          ))}
        </ol>
      </div>

      <div className="rounded-xl border border-white/10 bg-navy-900/60 p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gold">Scene directions</h3>
          <CopyButton text={parse.scene_directions} label="Copy scene directions" />
        </div>
        {directions.length === 0 && <p className="text-sm text-white/40">No directions yet.</p>}
        <div className="flex max-h-56 flex-wrap gap-1.5 overflow-auto">
          {directions.map(({ d, scene }) => (
            <button
              key={d.id}
              onClick={() => onSelectDirection(d)}
              className={`flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-left text-xs transition ${selectedId === d.id ? "border-gold bg-gold/15" : "border-white/15 hover:border-white/40"}`}
              title={V2_ONLY.has(d.type) ? "Avatar gesture — acted out by studio avatars with gesture support (✋)" : "Select to place or style this effect"}
            >
              <span className="font-mono text-white/50">{scene.start === null ? `S${scene.index + 1}` : `${scene.estimated ? "~" : ""}${formatSeconds(scene.start)}`}</span>
              <span>{EFFECT_ICON[d.type]}</span>
              <span className="truncate" style={{ color: EFFECT_COLOR[d.type] }}>{d.display}</span>
              {V2_ONLY.has(d.type) && <span className="v2-badge !py-0">gesture</span>}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-white/40">
          {parse.counts.voiceover} voiceover lines · {parse.counts.directions} directions · {parse.counts.visual} visual effects · {parse.counts.text} text overlays
        </p>
      </div>
    </div>
  );
}
