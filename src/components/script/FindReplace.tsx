import { useEffect, useMemo, useState, type RefObject } from "react";
import { ChevronDown, ChevronUp, Replace, X } from "lucide-react";
import { findAll, replaceAll, replaceAt } from "../../lib/scriptEdit.ts";

interface Props {
  script: string;
  setScript: (s: string) => void;
  textarea: RefObject<HTMLTextAreaElement | null>;
  onClose: () => void;
}

export default function FindReplace({ script, setScript, textarea, onClose }: Props) {
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [index, setIndex] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const matches = useMemo(() => findAll(script, find, matchCase), [script, find, matchCase]);
  const current = matches.length ? Math.min(index, matches.length - 1) : -1;

  // Select the current match in the editor and scroll it into view
  useEffect(() => {
    const ta = textarea.current;
    if (!ta || current < 0) return;
    const m = matches[current];
    ta.setSelectionRange(m.start, m.end);
    const line = script.slice(0, m.start).split("\n").length - 1;
    ta.scrollTop = Math.max(0, line * 22.4 - ta.clientHeight / 3);
  }, [current, matches, script, textarea]);

  const go = (step: number) => {
    if (!matches.length) return;
    setIndex((current + step + matches.length) % matches.length);
  };

  return (
    <div className="mb-3 rounded-xl border border-gold/30 bg-navy-900 p-3" role="search" aria-label="Find and replace">
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input className="input" placeholder="Find" value={find} autoFocus aria-label="Find"
          onChange={e => {
            setFind(e.target.value);
            setIndex(0);
            setNotice(null);
          }}
          onKeyDown={e => e.key === "Enter" && go(e.shiftKey ? -1 : 1)} />
        <input className="input" placeholder="Replace with" value={replace} onChange={e => setReplace(e.target.value)} aria-label="Replace with" />
        <button className="btn btn-ghost !px-2" onClick={onClose} aria-label="Close find and replace"><X size={16} /></button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-white/60" aria-live="polite">
          {find ? (matches.length ? `${current + 1} of ${matches.length} match${matches.length > 1 ? "es" : ""} found` : "No matches found") : "Type to search the script"}
        </span>
        <button className="btn btn-ghost !px-1.5 !py-1" onClick={() => go(-1)} disabled={!matches.length} aria-label="Previous match"><ChevronUp size={14} /></button>
        <button className="btn btn-ghost !px-1.5 !py-1" onClick={() => go(1)} disabled={!matches.length} aria-label="Next match"><ChevronDown size={14} /></button>
        <label className="flex items-center gap-1.5 text-xs text-white/60">
          <input type="checkbox" checked={matchCase} onChange={e => setMatchCase(e.target.checked)} className="accent-[#c9a84c]" /> Match case
        </label>
        <div className="ml-auto flex gap-2">
          <button className="btn btn-navy !py-1.5 text-xs" disabled={current < 0}
            onClick={() => {
              setScript(replaceAt(script, matches[current], replace));
              setNotice("Replaced 1");
            }}>
            <Replace size={14} /> Replace This
          </button>
          <button className="btn btn-gold !py-1.5 text-xs" disabled={!matches.length}
            onClick={() => {
              const r = replaceAll(script, find, replace, matchCase);
              setScript(r.text);
              setNotice(`Replaced ${r.count}`);
            }}>
            Replace All
          </button>
        </div>
      </div>
      {notice && <p className="mt-1.5 text-xs text-gold">{notice}</p>}
    </div>
  );
}
