import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Sparkles, Undo2, X } from "lucide-react";

export interface PrompterMessage { role: "user" | "assistant" | "error"; text: string }

const EXAMPLES = [
  "Make the avatar bigger and put it on the right",
  "Add a zoom on the dashboard at 0:12",
  "Rewrite the second line to sound warmer",
  "Turn on an outro that says Book a demo · haven-mos.org",
  "Translate the captions to Spanish",
  "Lower the music to 20%"
];

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (prompt: string) => Promise<void>;
  messages: PrompterMessage[];
  busy: boolean;
  canUndo: boolean;
  onUndo: () => void;
}

/** The AI prompter: ask for any edit in plain English */
export default function AiPrompter({ open, onClose, onSubmit, messages, busy, canUndo, onUndo }: Props) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const send = () => {
    const t = text.trim();
    if (!t || busy) return;
    setText("");
    void onSubmit(t);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <aside role="dialog" aria-modal aria-label="AI prompter" onClick={e => e.stopPropagation()}
        className="flex h-full w-full max-w-md flex-col border-l border-gold/30 bg-navy-800 shadow-2xl">
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold text-navy"><Sparkles size={18} /></span>
          <div className="flex-1">
            <div className="font-semibold text-light">AI prompter</div>
            <div className="text-xs text-white/50">Tell it what to change — script, effects, avatar, audio, branding</div>
          </div>
          <button className="btn btn-ghost !px-3" onClick={onClose} aria-label="Close AI prompter"><X size={18} /></button>
        </div>

        <div ref={listRef} className="flex-1 space-y-3 overflow-auto px-5 py-4">
          {messages.length === 0 && (
            <div className="space-y-2">
              <p className="text-sm text-white/55">Try one of these:</p>
              {EXAMPLES.map(ex => (
                <button key={ex} onClick={() => void onSubmit(ex)} disabled={busy}
                  className="flex min-h-12 w-full items-center rounded-xl border border-white/10 px-4 text-left text-sm text-white/80 hover:border-gold/50">
                  {ex}
                </button>
              ))}
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm ${
              m.role === "user" ? "ml-auto bg-gold text-navy" : m.role === "error" ? "border border-red-400/40 bg-red-500/10 text-red-200" : "bg-navy-900 text-white/90"
            }`}>
              {m.text}
            </div>
          ))}
          {busy && <div className="flex items-center gap-2 text-sm text-white/55"><Loader2 size={16} className="animate-spin text-gold" /> Working on it…</div>}
        </div>

        <div className="border-t border-white/10 p-4">
          {canUndo && !busy && (
            <button className="btn btn-ghost mb-3 w-full text-sm" onClick={onUndo}><Undo2 size={16} /> Undo last AI change</button>
          )}
          <div className="flex items-end gap-2">
            <textarea ref={inputRef} rows={2} value={text} onChange={e => setText(e.target.value)} disabled={busy}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="e.g. Add a title card that says 60-Day Free Pilot at the end"
              aria-label="Ask the AI" className="input min-h-14 flex-1 resize-none" />
            <button className="btn btn-gold !min-h-14 !px-4" onClick={send} disabled={busy || !text.trim()} aria-label="Send"><Send size={18} /></button>
          </div>
          <p className="mt-2 text-[11px] text-white/35">Enter to send · Shift+Enter for a new line · Ctrl+K to open</p>
        </div>
      </aside>
    </div>
  );
}
