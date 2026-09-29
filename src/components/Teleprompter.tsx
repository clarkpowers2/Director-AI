import { useEffect, useRef, useState } from "react";
import { FlipHorizontal, Pause, Play, RotateCcw, X } from "lucide-react";

/** Full-screen scrolling prompter for reading the voiceover on camera */
export default function Teleprompter({ lines, onClose }: { lines: string[]; onClose: () => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(40); // px per second
  const [size, setSize] = useState(48);
  const [mirror, setMirror] = useState(false);

  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now();
    const loop = (now: number) => {
      const el = scrollRef.current;
      if (el) {
        el.scrollTop += ((now - last) / 1000) * speed;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) setPlaying(false);
      }
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === " ") {
        e.preventDefault();
        setPlaying(p => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black" role="dialog" aria-modal aria-label="Teleprompter">
      <div className="flex flex-wrap items-center gap-3 border-b border-white/10 bg-navy px-4 py-2 text-sm">
        <button className="btn btn-gold !px-3" onClick={() => setPlaying(p => !p)} aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
        <button className="btn btn-ghost !px-2" onClick={() => scrollRef.current?.scrollTo({ top: 0 })} aria-label="Back to top"><RotateCcw size={16} /></button>
        <label className="flex items-center gap-2 text-xs text-white/60">Speed <input type="range" min={10} max={160} value={speed} onChange={e => setSpeed(Number(e.target.value))} /></label>
        <label className="flex items-center gap-2 text-xs text-white/60">Size <input type="range" min={28} max={96} value={size} onChange={e => setSize(Number(e.target.value))} /></label>
        <button className={`btn !py-1 text-xs ${mirror ? "btn-gold" : "btn-ghost"}`} onClick={() => setMirror(m => !m)} aria-pressed={mirror}><FlipHorizontal size={14} /> Mirror</button>
        <span className="hidden text-xs text-white/40 md:inline">Space to play/pause · Esc to close</span>
        <button className="btn btn-ghost ml-auto !px-2" onClick={onClose} aria-label="Close teleprompter"><X size={16} /></button>
      </div>
      <div ref={scrollRef} className="relative flex-1 overflow-y-auto" style={{ transform: mirror ? "scaleX(-1)" : undefined }}>
        <div className="pointer-events-none sticky top-1/3 z-10 h-0.5 bg-gold/50" />
        <div className="mx-auto max-w-4xl px-6 pb-[70vh] pt-[30vh] text-center font-semibold leading-snug text-white" style={{ fontSize: size }}>
          {lines.length === 0 ? <p className="text-white/40">Add spoken lines to the script.</p> : lines.map((l, i) => <p key={i} className="mb-[0.8em]">{l}</p>)}
        </div>
      </div>
    </div>
  );
}
