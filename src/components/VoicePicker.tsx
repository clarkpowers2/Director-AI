import { useEffect, useRef, useState } from "react";
import { Loader2, Play, Search, Square, UserRound } from "lucide-react";
import { FieldGroup, Seg, useDebounced } from "./ui.tsx";
import { ApiError, searchVoices, type HeyGenVoice, type ServerStatus } from "../lib/avatar.ts";
import type { VoiceSettings } from "../lib/project.ts";

/** Searchable HeyGen voice picker: name/language search, gender, language and tone filters, 3-second samples */
const LANGUAGES = ["English", "Spanish", "French", "Portuguese", "Other", "all"];

export default function VoicePicker(p: { voice: VoiceSettings; setVoice: (v: Partial<VoiceSettings>) => void; server: ServerStatus | null }) {
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 250);
  const [gender, setGender] = useState<"all" | "male" | "female">("male");
  const [language, setLanguage] = useState("English");
  const [tone, setTone] = useState<"all" | "warm" | "authoritative">("all");
  const [items, setItems] = useState<HeyGenVoice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const available = p.server?.heygen !== false;
  const current = p.voice.heygenVoice;

  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        for (let tries = 0; tries < 20 && !cancelled; tries++) {
          const page = await searchVoices({ q, gender, language, tone: tone === "all" ? "" : tone }, 0);
          if (cancelled) return;
          if (page.ready) {
            setItems(page.items);
            setTotal(page.total);
            return;
          }
          await new Promise(r => setTimeout(r, 800));
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Couldn't load voices.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [available, q, gender, language, tone]);

  useEffect(() => () => {
    audioRef.current?.pause();
    if (stopTimer.current) clearTimeout(stopTimer.current);
  }, []);

  const preview = (v: HeyGenVoice) => {
    audioRef.current?.pause();
    if (stopTimer.current) clearTimeout(stopTimer.current);
    if (playing === v.id || !v.preview) return setPlaying(null);
    const a = new Audio(v.preview);
    audioRef.current = a;
    setPlaying(v.id);
    a.onended = () => setPlaying(null);
    void a.play().catch(() => setPlaying(null));
    // 3-second sample
    stopTimer.current = setTimeout(() => {
      a.pause();
      setPlaying(null);
    }, 3000);
  };

  const more = async () => {
    setLoading(true);
    try {
      const page = await searchVoices({ q, gender, language, tone: tone === "all" ? "" : tone }, items.length);
      if (page.ready) setItems(prev => [...prev, ...page.items]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <FieldGroup label="Voice" hint={current?.id ? `Selected: ${current.name}` : "Using the avatar's own default voice."}>
      <div className="space-y-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
          <input className="input !pl-8" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search voices by name or language" aria-label="Search voices" />
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Seg value={gender} onChange={setGender} label="Voice gender" options={[
            { id: "all", label: "All" }, { id: "male", label: "Male" }, { id: "female", label: "Female" }
          ]} />
          <select className="input !w-auto !py-1.5 text-xs" value={language} onChange={e => setLanguage(e.target.value)} aria-label="Voice language">
            {LANGUAGES.map(l => <option key={l} value={l}>{l === "all" ? "All languages" : l}</option>)}
          </select>
        </div>
        <div>
          <span className="field-label">Tone</span>
          <Seg value={tone} onChange={setTone} label="Voice tone" options={[
            { id: "warm", label: "Warm" }, { id: "all", label: "Neutral" }, { id: "authoritative", label: "Authoritative" }
          ]} />
          <p className="mt-1 text-[11px] text-white/40">Studio voices each have a fixed style. Tone narrows the list to voices described as warm (friendly, soothing…) or authoritative (firm, serious, measured…).</p>
        </div>
        <ul className="max-h-80 space-y-1 overflow-auto rounded-lg bg-navy p-1" aria-label="Voices" aria-busy={loading}>
          <li>
            <button onClick={() => p.setVoice({ heygenVoice: { id: "", name: "Avatar's default voice" } })} aria-pressed={!current?.id}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${!current?.id ? "bg-gold/15 text-gold" : "text-white/75 hover:bg-white/5"}`}>
              <UserRound size={13} /> Avatar's own default voice
            </button>
          </li>
          {items.map(v => (
            <li key={v.id} className={`flex items-center gap-2 rounded-md px-2 py-1 ${current?.id === v.id ? "bg-gold/15" : "hover:bg-white/5"}`}>
              <button className="btn btn-ghost !px-1.5 !py-1" onClick={() => preview(v)} disabled={!v.preview}
                aria-label={playing === v.id ? `Stop ${v.name}` : `Play a 3-second sample of ${v.name}`} title={v.preview ? "3-second sample" : "No sample available"}>
                {playing === v.id ? <Square size={12} /> : <Play size={12} />}
              </button>
              <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => p.setVoice({ heygenVoice: { id: v.id, name: v.name } })} aria-pressed={current?.id === v.id}>
                <span className={`truncate text-xs ${current?.id === v.id ? "font-semibold text-gold" : "text-white/85"}`}>{v.private ? "★ " : ""}{v.name}</span>
                <span className="ml-auto shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">{v.language}</span>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${v.gender === "male" ? "bg-sky-400/15 text-sky-200" : v.gender === "female" ? "bg-pink-400/15 text-pink-200" : "bg-white/10 text-white/50"}`}>{v.gender}</span>
              </button>
            </li>
          ))}
          {!loading && items.length === 0 && <li className="px-2 py-2 text-xs text-white/40">{error ?? "No voices match these filters."}</li>}
          {loading && items.length === 0 && <li className="flex items-center gap-2 px-2 py-2 text-xs text-white/50"><Loader2 size={12} className="animate-spin" /> Loading voices…</li>}
        </ul>
        <div className="flex items-center justify-between text-[11px] text-white/40">
          <span>{total.toLocaleString()} voices match</span>
          {items.length < total && <button className="text-gold hover:underline" onClick={() => void more()} disabled={loading}>Show more</button>}
        </div>
      </div>
    </FieldGroup>
  );
}

