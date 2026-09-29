import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Copy, GripVertical, Plus, Trash2 } from "lucide-react";
import { joinBlocks, moveBlock, splitBlocks } from "../../lib/scriptEdit.ts";
import { highlightLine } from "./Editor.tsx";
import { formatSeconds, parseScript } from "../../lib/parser.ts";

interface Props {
  script: string;
  setScript: (s: string) => void;
  duration: number;
}

const NEW_SCENE = "New scene — replace this line with what the presenter says.";

/** Each paragraph of the script is a scene block you can collapse, drag, duplicate or delete */
export default function SceneBlocks({ script, setScript, duration }: Props) {
  const blocks = splitBlocks(script);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  const update = (next: { text: string }[]) => setScript(joinBlocks(next));
  const scenes = parseScript(script, "Presenter", duration).scenes;
  const starts = blocks.map(b => scenes.find(s => s.lines.some(l => l >= b.firstLine && l <= b.lastLine))?.start ?? null);

  const insertAt = (i: number) => {
    const next = [...blocks];
    next.splice(i, 0, { id: `new-${Date.now()}`, text: NEW_SCENE, firstLine: -1, lastLine: -1 });
    update(next);
  };

  return (
    <div className="space-y-1.5">
      <InsertButton onClick={() => insertAt(0)} />
      {blocks.map((b, i) => {
        const expanded = open[b.id] ?? false;
        const first = b.text.split("\n")[0];
        return (
          <div key={b.id}>
            <div
              draggable
              onDragStart={e => {
                setDragging(i);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={e => {
                e.preventDefault();
                setOver(i);
              }}
              onDragLeave={() => setOver(null)}
              onDrop={e => {
                e.preventDefault();
                if (dragging !== null && dragging !== i) update(moveBlock(blocks, dragging, i));
                setDragging(null);
                setOver(null);
              }}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
              className={`rounded-xl border bg-navy-900/70 transition ${over === i && dragging !== i ? "border-gold" : "border-white/10"} ${dragging === i ? "opacity-40" : ""}`}
            >
              <div className="flex items-center gap-2 px-2 py-2">
                <span className="cursor-grab text-white/30 active:cursor-grabbing" aria-hidden><GripVertical size={16} /></span>
                <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen({ ...open, [b.id]: !expanded })} aria-expanded={expanded}>
                  <ChevronDown size={14} className={`shrink-0 text-white/40 transition ${expanded ? "" : "-rotate-90"}`} />
                  <span className="shrink-0 rounded bg-gold/15 px-1.5 py-0.5 font-mono text-[11px] text-gold">
                    {i + 1}{starts[i] !== null ? ` · ${formatSeconds(starts[i]!)}` : ""}
                  </span>
                  <span className="truncate font-mono text-xs text-white/75">{first}</span>
                </button>
                <div className="flex shrink-0 items-center">
                  <IconBtn label="Move up" disabled={i === 0} onClick={() => update(moveBlock(blocks, i, i - 1))}><ArrowUp size={14} /></IconBtn>
                  <IconBtn label="Move down" disabled={i === blocks.length - 1} onClick={() => update(moveBlock(blocks, i, i + 1))}><ArrowDown size={14} /></IconBtn>
                  <IconBtn label="Duplicate scene" onClick={() => {
                    const next = [...blocks];
                    next.splice(i + 1, 0, { ...b, id: `${b.id}-copy` });
                    update(next);
                  }}><Copy size={14} /></IconBtn>
                  <IconBtn label="Delete scene" onClick={() => {
                    if (window.confirm(`Delete scene ${i + 1}?`)) update(blocks.filter((_, j) => j !== i));
                  }}><Trash2 size={14} /></IconBtn>
                </div>
              </div>
              {expanded ? (
                <div className="px-3 pb-3">
                  <textarea
                    className="editor-layer w-full resize-y rounded-lg border border-white/10 bg-navy text-white/90 outline-none focus:border-gold"
                    rows={Math.max(2, b.text.split("\n").length + 1)}
                    value={b.text}
                    aria-label={`Scene ${i + 1} text`}
                    onFocus={e => b.text === NEW_SCENE && e.currentTarget.select()}
                    onChange={e => update(blocks.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                  />
                </div>
              ) : (
                <pre className="editor-layer m-0 max-h-24 overflow-hidden !py-0 !pb-2 text-xs opacity-80">{b.text.split("\n").slice(1, 4).map(highlightLine)}</pre>
              )}
            </div>
            <InsertButton onClick={() => insertAt(i + 1)} />
          </div>
        );
      })}
    </div>
  );
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button className="rounded-md p-1.5 text-white/55 hover:bg-white/10 hover:text-gold disabled:opacity-25" onClick={onClick} disabled={disabled} aria-label={label} title={label}>
      {children}
    </button>
  );
}

function InsertButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="group flex h-4 items-center justify-center">
      <button onClick={onClick} className="flex items-center gap-1 rounded-full border border-dashed border-white/15 px-2 text-[10px] text-white/35 opacity-60 transition hover:border-gold hover:text-gold group-hover:opacity-100" aria-label="Add a blank scene here">
        <Plus size={10} /> Add scene
      </button>
    </div>
  );
}
