import { forwardRef, useRef, type ReactNode } from "react";
import { TIMESTAMP_PATTERN } from "../../lib/parser.ts";

const KW = String.raw`ZOOM|HIGHLIGHT|POINTS?\s+(?:TO|AT)|POINT|GESTURE|FADE|TRANSITION|AVATAR|PULSE|TITLE|CAPTION|CALLOUT|LOWER[\s_-]?THIRD|ACTION`;
const TOKEN = new RegExp(String.raw`(\[[^\]]*\]?)|((?:^|(?<=\.\s))\s*(?:${KW})\s*:)|("[^"]*"?|“[^”]*”?)`, "gi");
const SAYS = /^(.+?\b(?:says|said|say)\s*:)(\s*)(["“'‘].*)?$/i;
const KW_START = new RegExp(`^\\s*(?:${KW})\\s*:`, "i");

/** Timestamps gold · keywords teal · "Name says:" purple · quotes bright · [brackets] orange */
export function highlightLine(line: string, key: number): ReactNode {
  const out: ReactNode[] = [];
  let rest = line;
  const ts = rest.match(TIMESTAMP_PATTERN);
  if (ts) {
    out.push(<span key="ts" className="text-gold">{ts[0]}</span>);
    rest = rest.slice(ts[0].length);
  }
  const says = rest.match(SAYS);
  if (says && !KW_START.test(rest)) {
    out.push(<span key="says" className="text-violet-300">{says[1]}</span>, says[2]);
    if (says[3]) out.push(<span key="q" className="font-semibold text-white">{says[3]}</span>);
    return <div key={key}>{out}{"\n"}</div>;
  }
  let last = 0;
  for (const m of rest.matchAll(TOKEN)) {
    if (m.index! > last) out.push(<span key={`t${last}`} className="text-white/70">{rest.slice(last, m.index)}</span>);
    const cls = m[1] ? "text-orange-300" : m[2] ? "font-semibold text-teal-300" : "font-semibold text-white";
    out.push(<span key={`m${m.index}`} className={cls}>{m[0]}</span>);
    last = m.index! + m[0].length;
  }
  if (last < rest.length) out.push(<span key="end" className="text-white/70">{rest.slice(last)}</span>);
  return <div key={key}>{out}{"\n"}</div>;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  minHeight?: string;
  label: string;
}

/** Transparent textarea over a highlighted <pre>; both share metrics (see .editor-layer) */
const Editor = forwardRef<HTMLTextAreaElement, Props>(function Editor({ value, onChange, onSubmit, placeholder, minHeight = "min-h-[340px]", label }, ref) {
  const preRef = useRef<HTMLPreElement>(null);
  return (
    <div className={`relative overflow-hidden rounded-xl bg-navy ${minHeight}`}>
      <pre ref={preRef} aria-hidden className="editor-layer pointer-events-none absolute inset-0 m-0 overflow-hidden">
        {value.split("\n").map(highlightLine)}
      </pre>
      <textarea
        ref={ref}
        value={value}
        onChange={e => onChange(e.target.value)}
        onScroll={e => {
          if (preRef.current) preRef.current.scrollTop = e.currentTarget.scrollTop;
        }}
        onKeyDown={e => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") onSubmit?.();
        }}
        placeholder={placeholder}
        spellCheck={false}
        aria-label={label}
        className="editor-layer absolute inset-0 h-full w-full resize-none bg-transparent text-transparent caret-gold outline-none selection:bg-gold/40 selection:text-transparent placeholder:text-white/30"
      />
    </div>
  );
});

export default Editor;
