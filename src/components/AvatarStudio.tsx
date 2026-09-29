import { useRef, useState } from "react";
import {
  AlertCircle, Briefcase, CheckCircle2, Cpu, Loader2, Mic, Newspaper, Sparkles, Upload, UserRound, Video
} from "lucide-react";
import { Card, Drawer, Field, FieldGroup, Section, Seg, Toggle, V2 } from "./ui.tsx";
import {
  OUTFITS, PRESENTERS, VOICE_PRESETS, currentPhoto, sceneClipKey,
  type AvatarClip, type AvatarPosition, type AvatarSettings, type AvatarSize, type OutfitId, type PresenterId,
  type VoicePreset, type VoiceSettings
} from "../lib/project.ts";
import type { ParseResult } from "../lib/parser.ts";
import type { ServerStatus } from "../lib/avatar.ts";

const PRESENTER_ICON: Record<PresenterId, React.ReactNode> = {
  professional: <Briefcase size={28} />, creator: <Video size={28} />, anchor: <Newspaper size={28} />,
  tech: <Cpu size={28} />, custom: <UserRound size={28} />
};

const POSITIONS: { id: AvatarPosition; label: string }[] = [
  { id: "corner-left", label: "Corner left" },
  { id: "corner-right", label: "Corner right" },
  { id: "side", label: "Side panel" },
  { id: "floating", label: "Floating" },
  { id: "full", label: "Full screen" }
];

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
  generating: { done: number; total: number } | null;
  onCancel: () => void;
}

export default function AvatarStudio(p: Props) {
  const [drawer, setDrawer] = useState(false);
  const spoken = p.parse.scenes.filter(s => s.spoken);
  const ready = spoken.filter(s => {
    const k = sceneClipKey(p.avatar, p.voice, s.spoken);
    return k && p.clips[k]?.status === "done";
  }).length;
  const photo = currentPhoto(p.avatar);
  const canGenerate = !!photo && spoken.length > 0 && ready < spoken.length && !p.generating;
  const label = p.generating ? `Generating ${p.generating.done}/${p.generating.total}…`
    : !photo ? "Add a presenter photo first"
    : spoken.length === 0 ? "No voiceover lines yet"
    : ready === spoken.length ? "Avatar ready ✓"
    : `Generate avatar (${spoken.length - ready} line${spoken.length - ready > 1 ? "s" : ""})`;

  const generate = (
    <div className="flex gap-2">
      <button className="btn btn-gold !py-1.5 text-xs" onClick={p.onGenerate} disabled={!canGenerate}>
        {p.generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {label}
      </button>
      {p.generating && <button className="btn btn-ghost !py-1.5 text-xs" onClick={p.onCancel}>Cancel</button>}
    </div>
  );

  return (
    <Section id="avatar" number={2} icon={<UserRound size={18} />} title="Avatar Studio" subtitle="Presenter, outfit, voice and placement" actions={generate}>
      <div className="hidden lg:block"><StudioBody {...p} ready={ready} /></div>
      <div className="flex items-center gap-3 lg:hidden">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-navy-600 text-gold">
          {photo ? <img src={photo.thumbnail} alt="" className="h-full w-full object-cover" /> : PRESENTER_ICON[p.avatar.presenter]}
        </span>
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-semibold">{PRESENTERS[p.avatar.presenter].name}</div>
          <div className="truncate text-xs text-white/50">{OUTFITS[p.avatar.outfit]} · {VOICE_PRESETS[p.voice.preset].label} · {ready}/{spoken.length} lines ready</div>
        </div>
        <button className="btn btn-navy" onClick={() => setDrawer(true)}>Open studio</button>
      </div>
      <Drawer open={drawer} onClose={() => setDrawer(false)} title="Avatar Studio">
        <StudioBody {...p} ready={ready} />
      </Drawer>
    </Section>
  );
}

function StudioBody(p: Props & { ready: number }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { avatar, voice } = p;
  const photo = currentPhoto(avatar);
  const didAvailable = p.server?.did ?? true;
  const ttsAvailable = p.server?.tts ?? true;

  const choosePresenter = (id: PresenterId) => {
    if (id === avatar.presenter) return;
    // Each presenter style comes with a suggested outfit, voice, tone and position
    const preset = PRESENTERS[id];
    p.setAvatar({ presenter: id, outfit: preset.outfit, position: preset.position });
    p.setVoice({ preset: preset.voice, tone: preset.tone });
  };

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

  const lines = p.parse.scenes.filter(s => s.spoken).map(s => {
    const key = sceneClipKey(avatar, voice, s.spoken);
    return { scene: s, clip: key ? p.clips[key] : undefined };
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <Card title="Presenter" icon={<UserRound size={16} />}>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {(Object.keys(PRESENTERS) as PresenterId[]).map(id => {
              const img = avatar.photos[`${id}:${avatar.presenter === id ? avatar.outfit : PRESENTERS[id].outfit}`]
                ?? Object.entries(avatar.photos).find(([k]) => k.startsWith(`${id}:`))?.[1];
              return (
                <button key={id} onClick={() => choosePresenter(id)} aria-pressed={avatar.presenter === id}
                  className={`flex flex-col items-center gap-1 rounded-xl border p-2 text-center transition ${avatar.presenter === id ? "border-gold bg-gold/10" : "border-white/10 hover:border-white/30"}`}>
                  <span className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-navy-500 to-navy-900 text-gold/80 sm:aspect-square">
                    {img ? <img src={img.thumbnail} alt="" className="h-full w-full object-cover" /> : PRESENTER_ICON[id]}
                  </span>
                  <span className="text-xs font-semibold leading-tight">{PRESENTERS[id].name}</span>
                  <span className="hidden text-[10px] leading-tight text-white/45 sm:block">{PRESENTERS[id].description}</span>
                </button>
              );
            })}
          </div>
        </Card>

        <Card title="Outfit & photo" icon={<Upload size={16} />}>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {(Object.keys(OUTFITS) as OutfitId[]).map(o => {
              const has = !!avatar.photos[`${avatar.presenter}:${o}`];
              return (
                <button key={o} onClick={() => p.setAvatar({ outfit: o })} aria-pressed={avatar.outfit === o}
                  className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-[11px] ${avatar.outfit === o ? "border-gold bg-gold font-semibold text-navy" : "border-white/15 text-white/75 hover:border-white/40"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${has ? (avatar.outfit === o ? "bg-navy" : "bg-emerald-400") : "bg-white/20"}`} />
                  {OUTFITS[o]}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <span className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-navy text-white/30">
              {photo ? <img src={photo.thumbnail} alt="Presenter photo" className="h-full w-full object-cover" /> : <UserRound size={28} />}
            </span>
            <div className="min-w-0 flex-1 text-xs text-white/55">
              {photo ? "This photo is used for this presenter and outfit." : "Upload a front-facing photo of the presenter wearing this outfit."}
              <span className="mt-1 block text-white/35">The avatar is animated from the photo, so each outfit is its own photo.</span>
            </div>
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

        <Card title="Placement" icon={<Video size={16} />} badge={<label className="flex items-center gap-2 text-xs text-white/60">Show avatar <Toggle checked={avatar.enabled} onChange={v => p.setAvatar({ enabled: v })} label="Show avatar" /></label>}>
          <div className="space-y-3">
            <FieldGroup label="Position">
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
                {POSITIONS.map(pos => (
                  <button key={pos.id} aria-pressed={avatar.position === pos.id} onClick={() => p.setAvatar({ position: pos.id })}
                    className={`rounded-lg border px-2 py-1.5 text-[11px] ${avatar.position === pos.id ? "border-gold bg-gold font-semibold text-navy" : "border-white/15 text-white/70 hover:border-white/40"}`}>
                    {pos.label}
                  </button>
                ))}
              </div>
            </FieldGroup>
            <FieldGroup label="Size">
              <Seg<AvatarSize> value={avatar.size} onChange={s => p.setAvatar({ size: s })} label="Avatar size" options={[
                { id: "small", label: "Small", disabled: avatar.position === "full" },
                { id: "medium", label: "Medium", disabled: avatar.position === "full" },
                { id: "large", label: "Large", disabled: avatar.position === "full" }
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
      </div>

      <div className="space-y-4">
        <Card title="Voice" icon={<Mic size={16} />}>
          <div className="space-y-3">
            <FieldGroup label="Animation">
              <Seg value={voice.engine} onChange={e => p.setVoice({ engine: e })} label="Avatar engine" options={[
                { id: "did", label: "Photoreal lip-sync (D-ID)", disabled: !didAvailable },
                { id: "animated", label: "Animated (free)", disabled: !ttsAvailable }
              ]} />
            </FieldGroup>
            <p className="-mt-1 text-[11px] text-white/40">
              {voice.engine === "did"
                ? "D-ID lip-syncs the photo to every word with natural head movement. Uses D-ID credits."
                : "Free voice with an animated photo that moves with the speech. No lip-sync."}
            </p>
            <Field label="Voice">
              <select className="input" value={voice.preset} onChange={e => p.setVoice({ preset: e.target.value as VoicePreset })}>
                {(Object.keys(VOICE_PRESETS) as VoicePreset[]).map(v => <option key={v} value={v}>{VOICE_PRESETS[v].label}</option>)}
                <option disabled>Custom voice clone (upload audio) — coming in v2</option>
              </select>
            </Field>
            <FieldGroup label="Speed">
              <Seg value={voice.speed} onChange={s => p.setVoice({ speed: s })} label="Voice speed" options={[
                { id: "slow", label: "Slow" }, { id: "normal", label: "Normal" }, { id: "fast", label: "Fast" }
              ]} />
            </FieldGroup>
            <FieldGroup label="Tone" hint={voice.engine === "animated" ? "Tone applies to D-ID voices only." : voice.preset === "casual-male" && voice.tone === "authoritative" ? "This voice has no authoritative style; it uses its normal tone." : undefined}>
              <Seg value={voice.tone} onChange={t => p.setVoice({ tone: t })} label="Voice tone" options={[
                { id: "warm", label: "Warm", disabled: voice.engine === "animated" },
                { id: "neutral", label: "Neutral", disabled: voice.engine === "animated" },
                { id: "authoritative", label: "Authoritative", disabled: voice.engine === "animated" }
              ]} />
            </FieldGroup>
            <p className="text-[11px] text-white/40">Speed changes apply instantly. Changing the voice, tone, photo or engine needs the lines generated again.</p>
            <div className="flex items-center gap-2 text-[11px] text-white/40"><V2 /> Custom voice cloning</div>
          </div>
        </Card>

        <Card title={`Avatar lines (${p.ready}/${lines.length} ready)`} icon={<Sparkles size={16} />}>
          {lines.length === 0 && <p className="text-sm text-white/40">Add spoken lines to the script.</p>}
          <ul className="max-h-64 space-y-1 overflow-auto text-xs">
            {lines.map(({ scene, clip }) => (
              <li key={scene.index} className="flex items-start gap-2 rounded-md bg-navy px-2 py-1.5">
                {clip?.status === "done" ? <CheckCircle2 size={14} className="mt-px shrink-0 text-gold" />
                  : clip?.status === "error" ? <AlertCircle size={14} className="mt-px shrink-0 text-red-300" />
                  : clip ? <Loader2 size={14} className="mt-px shrink-0 animate-spin text-sky-300" />
                  : <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full border border-white/30" />}
                <span className="min-w-0">
                  <span className="line-clamp-2 text-white/80">{scene.spoken}</span>
                  {clip?.error && <span className="block text-red-300">{clip.error}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
