import { useEffect, useRef, useState } from "react";
import {
  AlertCircle, Briefcase, Cpu, Hand, KeyRound, Loader2, Newspaper, RefreshCw, Search, Sparkles, Upload, UserRound, Video
} from "lucide-react";
import { Card, Field, FieldGroup, Section, Seg, Toggle, useDebounced } from "./ui.tsx";
import {
  GESTURE_STYLES, OUTFITS, PRESENTERS, currentPhoto, gestureSupport, sceneClipKey,
  type AvatarClip, type AvatarPosition, type AvatarSettings, type AvatarSize, type GestureStyle, type HeyGenLook,
  type OutfitId, type PresenterId, type VoiceSettings
} from "../lib/project.ts";
import type { ParseResult } from "../lib/parser.ts";
import { ApiError, createPhotoAvatar, fetchLooks, getAccessCode, searchLooks, setAccessCode, type ServerStatus } from "../lib/avatar.ts";

const PRESENTER_ICON: Record<PresenterId, React.ReactNode> = {
  professional: <Briefcase size={28} />, creator: <Video size={28} />, anchor: <Newspaper size={28} />,
  tech: <Cpu size={28} />, custom: <UserRound size={28} />
};

const POSITIONS: { id: AvatarPosition; label: string }[] = [
  { id: "left", label: "Left side" },
  { id: "right", label: "Right side" },
  { id: "bottom-center", label: "Bottom center" },
  { id: "corner", label: "Corner" },
  { id: "full", label: "Full screen" }
];

const CATEGORY_LABEL: Record<HeyGenLook["category"], string> = {
  full_body: "Full Body", studio: "Studio", digital_twin: "Digital Twin", talking_head: "Talking Head"
};

type GalleryTab = HeyGenLook["category"] | "mine";
const TABS: GalleryTab[] = ["full_body", "studio", "digital_twin", "talking_head", "mine"];

interface Props {
  avatar: AvatarSettings;
  voice: VoiceSettings;
  setAvatar: (patch: Partial<AvatarSettings>) => void;
  setVoice: (patch: Partial<VoiceSettings>) => void;
  onPhoto: (file: File) => Promise<void>;
  server: ServerStatus | null;
  parse: ParseResult;
  clips: Record<string, AvatarClip>;
  onGenerate: () => void;
  onRegenerateStale: () => void;
  staleCount: number;
  generating: { done: number; total: number } | null;
  onCancel: () => void;
  onAccessCodeSaved: () => void;
  /** Avatar generation queue (replaces the old line list) */
  queue: React.ReactNode;
  /** Test render and generation history */
  extras: React.ReactNode;
}

/** The Avatar page: engine, gallery, big preview + generate, placement, gestures, lines, access code */
export default function AvatarStudio(p: Props) {
  const { avatar, voice } = p;
  const spoken = p.parse.scenes.filter(s => s.spoken);
  const lines = spoken.map(s => {
    const key = sceneClipKey(avatar, voice, s.spoken);
    return { scene: s, clip: key ? p.clips[key] : undefined };
  });
  const ready = lines.filter(l => l.clip?.status === "done").length;
  const heygen = voice.engine === "heygen";
  const heygenAvailable = p.server?.avatar ?? true;
  const ttsAvailable = p.server?.tts ?? true;
  const hasAvatar = heygen ? !!avatar.heygen : !!currentPhoto(avatar);
  const canGenerate = hasAvatar && spoken.length > 0 && ready < spoken.length;
  const label = p.generating && ready >= spoken.length ? `Rendering ${p.generating.done}/${p.generating.total}…`
    : !hasAvatar ? (heygen ? "Pick an avatar first" : "Add a presenter photo first")
    : spoken.length === 0 ? "No voiceover lines yet"
    : ready === spoken.length ? "Avatar video ready ✓"
    : `Render avatar (${spoken.length - ready} scene${spoken.length - ready > 1 ? "s" : ""} to render)`;
  const image = heygen ? avatar.heygen?.image : currentPhoto(avatar)?.thumbnail;
  const name = heygen ? avatar.heygen?.name : PRESENTERS[avatar.presenter].name;
  const support = gestureSupport(avatar.heygen);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <Section id="avatar-engine" icon={<Sparkles size={18} />} title="Avatar engine">
        <Seg value={voice.engine} onChange={e => p.setVoice({ engine: e })} label="Avatar engine" options={[
          { id: "heygen", label: "Studio avatars: full body & gestures", disabled: !heygenAvailable },
          { id: "animated", label: "Animated photo (free)", disabled: !ttsAvailable }
        ]} />
        <p className="mt-3 text-sm text-white/50">
          {heygen
            ? "The avatar renderer creates a lifelike presenter for each voiceover line, with lip-sync, natural movement and, on supported avatars, gestures that follow your scene directions. Uses avatar provider credits."
            : "A free voice with your own photo, animated with the speech. No lip-sync or body movement."}
          {!heygenAvailable && " No avatar renderer is set up on this server yet."}
        </p>
      </Section>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
        <div className="min-w-0">
          <div id="avatar-gallery" className="scroll-mt-24">{heygen ? <HeyGenGallery {...p} /> : <PhotoPresenter {...p} />}</div>
        </div>

        <div className="space-y-6">
          <Card title="Selected presenter" icon={<UserRound size={16} />}>
            {image ? (
              <div className="overflow-hidden rounded-xl border border-gold/40 bg-navy">
                <img src={image} alt={name ?? "Selected avatar"} className="aspect-[4/5] w-full object-cover" />
              </div>
            ) : (
              <div className="flex aspect-[4/5] items-center justify-center rounded-xl border border-dashed border-white/15 bg-navy text-center text-sm text-white/45">
                {heygen ? "Pick an avatar from the gallery" : "Upload a presenter photo"}
              </div>
            )}
            {name && (
              <div className="mt-3">
                <div className="text-base font-semibold">{name}</div>
                {heygen && avatar.heygen && (
                  <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                    <span className="rounded bg-gold/15 px-2 py-0.5 text-gold">{CATEGORY_LABEL[avatar.heygen.category]}</span>
                    <span className={`rounded px-2 py-0.5 ${support.supported ? "bg-emerald-400/15 text-emerald-200" : "bg-white/10 text-white/50"}`}>
                      {support.supported ? "Follows gesture directions" : "Natural movement only"}
                    </span>
                  </div>
                )}
              </div>
            )}
            <button className="btn btn-gold mt-4 w-full !min-h-14 text-base" onClick={p.onGenerate} disabled={!canGenerate}>
              {p.generating ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />} {label}
            </button>
            <div className="mt-2 flex gap-2">
              {p.staleCount > 0 && !p.generating && (
                <button className="btn btn-navy flex-1 text-xs" onClick={p.onRegenerateStale} title="These lines were rendered before their gestures changed">
                  <RefreshCw size={14} /> Update gestures ({p.staleCount})
                </button>
              )}
              {p.generating && <button className="btn btn-ghost flex-1 text-xs" onClick={p.onCancel}>Cancel</button>}
            </div>
            {heygen && <p className="mt-2 text-[11px] text-white/40">Each scene takes a few minutes to render. You can keep working on other pages meanwhile.</p>}
          </Card>

          {heygen && (
            <Card title="Gestures" icon={<Hand size={16} />}>
              <GestureStylePicker {...p} />
            </Card>
          )}
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
        <PlacementCard {...p} />
        {p.queue}
      </div>

      {p.extras}

      <AccessCodeCard server={p.server} onSaved={p.onAccessCodeSaved} />
    </div>
  );
}

function AccessCodeCard({ server, onSaved }: { server: ServerStatus | null; onSaved: () => void }) {
  const [code, setCode] = useState(getAccessCode());
  const [saved, setSaved] = useState(false);
  return (
    <Section id="avatar-settings" icon={<KeyRound size={18} />} title="Settings" subtitle="Studio access code — needed for avatars, AI Assist and translation">
      <div className="flex flex-col gap-3 sm:flex-row">
        <input className="input" type="password" value={code} onChange={e => {
          setCode(e.target.value);
          setSaved(false);
        }} placeholder="Studio access code" aria-label="Studio access code" />
        <button className="btn btn-gold shrink-0" onClick={() => {
          setAccessCode(code.trim());
          setSaved(true);
          onSaved();
        }}>{saved ? "Saved ✓" : "Save code"}</button>
      </div>
      <p className="mt-2 text-xs text-white/45">
        Stored only in this browser.
        {server ? ` Server: avatar renderer ${server.avatar ? "connected" : "not set up"} · free voice ${server.tts ? "on" : "off"} · AI ${server.anthropic ? "connected" : "not set up"}.` : " Can't reach the server right now."}
      </p>
    </Section>
  );
}

function HeyGenGallery(p: Props) {
  const [tab, setTab] = useState<GalleryTab>("full_body");
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 250);
  const [items, setItems] = useState<HeyGenLook[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<HeyGenLook["category"], number> | null>(null);
  const [indexing, setIndexing] = useState<{ items: number } | null>(null);
  const [mine, setMine] = useState<HeyGenLook[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const available = p.server?.heygen !== false;

  // Your own avatars (live)
  useEffect(() => {
    if (available) fetchLooks("private").then(r => setMine(r.looks)).catch(() => {});
  }, [available]);

  // The library (cached catalog). The first visit after a refresh may need to finish indexing.
  useEffect(() => {
    if (!available || tab === "mine") return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        for (let tries = 0; tries < 30 && !cancelled; tries++) {
          const page = await searchLooks(tab, q, 0);
          if (cancelled) return;
          if (page.ready) {
            setItems(page.items);
            setTotal(page.total);
            setCounts(page.counts ?? null);
            setIndexing(null);
            return;
          }
          setIndexing({ items: page.progress.items });
          if (page.error) setError(page.error);
          await new Promise(r => setTimeout(r, 800));
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Couldn't load avatars.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [available, tab, q]);

  const more = async () => {
    setLoading(true);
    try {
      const page = await searchLooks(tab === "mine" ? "all" : tab, q, items.length);
      if (page.ready) setItems(prev => [...prev, ...page.items]);
    } catch {
      setError("Couldn't load more avatars.");
    } finally {
      setLoading(false);
    }
  };

  const fromPhoto = async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(jpeg|png)$/.test(file.type)) return setError("Use a JPG or PNG photo with one clear, front-facing face.");
    setError(null);
    try {
      const look = await createPhotoAvatar(file, p.avatar.label.split(" · ")[0] || "Presenter", setCreating);
      setMine(m => [look, ...m.filter(x => x.id !== look.id)]);
      p.setAvatar({ heygen: look });
      setTab("mine");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the avatar. Try again.");
    } finally {
      setCreating(null);
    }
  };

  const selected = p.avatar.heygen;
  const shown = tab === "mine" ? mine.filter(l => !q || l.name.toLowerCase().includes(q.toLowerCase())) : items;
  const tabLabel = (t: GalleryTab) => t === "mine"
    ? `My avatars${mine.length ? ` (${mine.length})` : ""}`
    : `${CATEGORY_LABEL[t]}${counts ? ` (${counts[t].toLocaleString()})` : ""}`;

  return (
    <Card title="Avatar library" icon={<UserRound size={16} />} badge={selected && <span className="text-[11px] text-gold">Selected: {selected.name}</span>}>
      {!available && <p className="text-sm text-white/50">The avatar library needs the renderer's API key on the server.</p>}
      {available && (
        <>
          <div className="relative mb-2">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
            <input className="input !pl-8" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search avatars by name — e.g. Brandon, doctor, office" aria-label="Search avatars" />
          </div>
          <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Avatar type">
            {TABS.map(t => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                className={`rounded-full border px-3 py-1 text-xs ${tab === t ? "border-gold bg-gold font-semibold text-navy" : "border-white/15 text-white/70 hover:border-white/40"}`}>
                {tabLabel(t)}
              </button>
            ))}
          </div>
          {error && <p className="mb-2 flex items-start gap-1.5 text-xs text-red-300"><AlertCircle size={14} className="mt-px shrink-0" /> {error}</p>}
          {indexing && tab !== "mine" ? (
            <div className="rounded-lg bg-navy p-3 text-sm text-white/70" aria-live="polite">
              <div className="mb-2 flex items-center gap-2"><Loader2 size={14} className="animate-spin text-gold" /> Indexing the avatar library (done once a day)…</div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-gold transition-[width]" style={{ width: `${Math.min(98, (indexing.items / 10000) * 100)}%` }} /></div>
              <div className="mt-1 text-[11px] text-white/40">{indexing.items.toLocaleString()} avatars indexed</div>
            </div>
          ) : loading && !shown.length ? (
            <p className="flex items-center gap-2 text-sm text-white/50"><Loader2 size={14} className="animate-spin" /> Loading avatars…</p>
          ) : (
            <div className="grid max-h-[440px] grid-cols-3 gap-2 overflow-auto pr-1 sm:grid-cols-4 xl:grid-cols-5">
              {tab === "mine" && (
                <button onClick={() => fileRef.current?.click()} disabled={!!creating}
                  className="flex aspect-[3/4] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-gold/50 p-2 text-center text-xs text-gold hover:bg-gold/10">
                  {creating ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} />}
                  {creating ?? "Create from my photo"}
                </button>
              )}
              {shown.map(look => {
                const gestures = gestureSupport(look).supported;
                return (
                  <button key={look.id} onClick={() => p.setAvatar({ heygen: look })} aria-pressed={selected?.id === look.id}
                    title={`${look.name} — ${CATEGORY_LABEL[look.category]}${gestures ? ", takes gesture direction" : ""}`}
                    className={`group relative overflow-hidden rounded-xl border text-left transition ${selected?.id === look.id ? "border-gold ring-2 ring-gold/40" : "border-white/10 hover:border-white/40"}`}>
                    <span className="block aspect-[3/4] bg-navy">
                      {look.image ? <img src={look.image} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}
                    </span>
                    <span className="absolute left-1 top-1 rounded bg-navy/85 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-gold">
                      {CATEGORY_LABEL[look.category]}
                    </span>
                    {gestures && <span className="absolute right-1 top-1 rounded bg-gold px-1 py-0.5 text-navy" title="Takes gesture direction"><Hand size={10} /></span>}
                    {look.status === "processing" && <span className="absolute inset-x-0 top-1/2 text-center text-[10px] text-white">Processing…</span>}
                    <span className="block truncate bg-navy-900/90 px-1.5 py-1 text-[11px] text-white/85">{look.name}</span>
                  </button>
                );
              })}
              {!loading && shown.length === 0 && tab !== "mine" && <p className="col-span-full text-sm text-white/40">{q ? `No ${CATEGORY_LABEL[tab].toLowerCase()} avatars match "${q}".` : "No avatars here yet."}</p>}
            </div>
          )}
          {tab !== "mine" && !indexing && items.length < total && (
            <button className="btn btn-ghost mt-2 w-full !py-1.5 text-xs" onClick={() => void more()} disabled={loading}>
              {loading ? <Loader2 size={14} className="animate-spin" /> : null} Show more ({(total - items.length).toLocaleString()} left)
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={e => {
            void fromPhoto(e.target.files?.[0]);
            e.target.value = "";
          }} />
          <p className="mt-2 text-[11px] text-white/40">
            Tabs follow the avatar type. <b className="text-white/55">Full Body</b> = studio presenters filmed standing (wide shot);
            <b className="text-white/55"> Talking Head</b> = photo avatars. Cut-out (transparent) presenters need an avatar trained with
            background removal — others appear in a frame. Cut-outs show in Chrome, Edge and Firefox.
          </p>
        </>
      )}
    </Card>
  );
}

function GestureStylePicker(p: Props) {
  const support = gestureSupport(p.avatar.heygen);
  return (
    <FieldGroup label="Gesture style" hint={
      !p.avatar.heygen ? "Pick an avatar to see its gesture support."
        : support.supported ? "Each line gets gestures from its scene: POINTS TO points toward the element, ZOOM looks and gestures toward it, TITLE steps back with a sweeping gesture, new scenes turn to camera."
        : "This avatar moves naturally but doesn't take gesture direction. Avatars with the ✋ badge (photo avatars and Avatar V looks) follow your scene directions."
    }>
      <div className="grid grid-cols-2 gap-1.5">
        {(Object.keys(GESTURE_STYLES) as GestureStyle[]).map(g => (
          <button key={g} aria-pressed={p.voice.gesture === g} onClick={() => p.setVoice({ gesture: g })}
            className={`rounded-lg border px-2 py-1.5 text-left ${p.voice.gesture === g ? "border-gold bg-gold/15" : "border-white/15 hover:border-white/40"}`}>
            <span className={`block text-xs font-semibold ${p.voice.gesture === g ? "text-gold" : "text-white/85"}`}>{GESTURE_STYLES[g].label}</span>
            <span className="block text-[10px] text-white/45">{GESTURE_STYLES[g].detail}</span>
          </button>
        ))}
      </div>
    </FieldGroup>
  );
}

function PhotoPresenter(p: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { avatar } = p;
  const photo = currentPhoto(avatar);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return setError("Use a JPG, PNG or WebP photo with one clear, front-facing face.");
    if (file.size > 10 * 1024 * 1024) return setError("That photo is over 10 MB. Use a smaller one.");
    setUploading(true);
    try {
      await p.onPhoto(file);
    } catch {
      setError("That photo couldn't be loaded. Try a different file.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card title="Presenter photo" icon={<Upload size={16} />}>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {(Object.keys(PRESENTERS) as PresenterId[]).map(id => {
          const img = Object.entries(avatar.photos).find(([k]) => k.startsWith(`${id}:`))?.[1];
          return (
            <button key={id} onClick={() => p.setAvatar({ presenter: id, outfit: PRESENTERS[id].outfit })} aria-pressed={avatar.presenter === id}
              className={`flex flex-col items-center gap-1 rounded-xl border p-2 text-center ${avatar.presenter === id ? "border-gold bg-gold/10" : "border-white/10 hover:border-white/30"}`}>
              <span className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-navy-500 to-navy-900 text-gold/80">
                {img ? <img src={img.thumbnail} alt="" className="h-full w-full object-cover" /> : PRESENTER_ICON[id]}
              </span>
              <span className="text-[11px] font-semibold leading-tight">{PRESENTERS[id].name}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {(Object.keys(OUTFITS) as OutfitId[]).map(o => (
          <button key={o} onClick={() => p.setAvatar({ outfit: o })} aria-pressed={avatar.outfit === o}
            className={`rounded-lg border px-2 py-1.5 text-[11px] ${avatar.outfit === o ? "border-gold bg-gold font-semibold text-navy" : "border-white/15 text-white/75"}`}>
            {OUTFITS[o]}
          </button>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-navy text-white/30">
          {photo ? <img src={photo.thumbnail} alt="Presenter photo" className="h-full w-full object-cover" /> : <UserRound size={24} />}
        </span>
        <p className="min-w-0 flex-1 text-xs text-white/55">{photo ? "Photo set for this presenter and outfit." : "Upload a front-facing photo — each outfit is its own photo."}</p>
        <button className="btn btn-navy shrink-0 text-xs" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {photo ? "Replace" : "Upload"}
        </button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => {
          void onFile(e.target.files?.[0]);
          e.target.value = "";
        }} />
      </div>
      {error && <p className="mt-2 flex items-start gap-1.5 text-xs text-red-300"><AlertCircle size={14} className="mt-px shrink-0" /> {error}</p>}
    </Card>
  );
}

function PlacementCard(p: Props) {
  const { avatar } = p;
  return (
    <Card title="Default placement" icon={<Video size={16} />} badge={<label className="flex items-center gap-2 text-xs text-white/60">Show avatar <Toggle checked={avatar.enabled} onChange={v => p.setAvatar({ enabled: v })} label="Show avatar" /></label>}>
      <div className="space-y-3">
        <p className="text-[11px] text-white/45">Used by avatar lines without their own layout. Place, size, time and hide each scene's avatar in the Editor → Avatar layer.</p>
        <FieldGroup label="Position">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {POSITIONS.map(pos => (
              <button key={pos.id} aria-pressed={avatar.position === pos.id} onClick={() => p.setAvatar({ position: pos.id })}
                className={`min-h-12 rounded-lg border px-2 py-2 text-sm ${avatar.position === pos.id ? "border-gold bg-gold font-semibold text-navy" : "border-white/15 text-white/70 hover:border-white/40"}`}>
                {pos.label}
              </button>
            ))}
          </div>
        </FieldGroup>
        <FieldGroup label="Size (share of screen width)">
          <Seg<AvatarSize> value={avatar.size} onChange={s => p.setAvatar({ size: s })} label="Avatar size" options={[
            { id: "small", label: "Small · 25%", disabled: avatar.position === "full" },
            { id: "medium", label: "Medium · 33%", disabled: avatar.position === "full" },
            { id: "large", label: "Large · 50%", disabled: avatar.position === "full" }
          ]} />
        </FieldGroup>
        <div className="flex gap-2">
          <Field label="Label"><input className="input" value={avatar.label} onChange={e => p.setAvatar({ label: e.target.value })} placeholder="Victor · DirectorAI™" /></Field>
          <label className="shrink-0">
            <span className="field-label">Color</span>
            <input type="color" value={avatar.labelColor} onChange={e => p.setAvatar({ labelColor: e.target.value })} className="h-[38px] w-12" aria-label="Label color" />
          </label>
        </div>
      </div>
    </Card>
  );
}
