import { useRef, useState, type ReactNode } from "react";
import { Crosshair, ImagePlus, Palette, Plus, RotateCcw, Sparkles, X } from "lucide-react";
import { Card, Field, Section, Seg, Slider, Toggle, V2 } from "./ui.tsx";
import {
  COLORED, EFFECT_COLOR, EFFECT_DURATION, EFFECT_ICON, EFFECT_LABEL, TARGETED, V2_ONLY, type TimedEffect
} from "../lib/effects.ts";
import { formatSeconds, type Direction, type DirectionType } from "../lib/parser.ts";
import { FONTS, targetKey, type BrandFont, type Branding, type LogoPosition, type Project } from "../lib/project.ts";
import { readAsDataURL } from "../lib/video.ts";

const PALETTE: { type: DirectionType; keyword: string; label: string; needs: string }[] = [
  { type: "ZOOM", keyword: "ZOOM", label: "Zoom", needs: "Element to zoom on" },
  { type: "HIGHLIGHT", keyword: "HIGHLIGHT", label: "Highlight", needs: "Element to highlight" },
  { type: "PULSE", keyword: "PULSE", label: "Pulse", needs: "Element to pulse" },
  { type: "POINT", keyword: "POINTS TO", label: "Pointer", needs: "Element to point at" },
  { type: "CALLOUT", keyword: "CALLOUT", label: "Callout", needs: "Callout text" },
  { type: "TITLE", keyword: "TITLE", label: "Title card", needs: "Title text" },
  { type: "LOWER THIRD", keyword: "LOWER THIRD", label: "Lower third", needs: "Name | Title" },
  { type: "TRANSITION", keyword: "TRANSITION", label: "Transition", needs: "" }
];

interface Props {
  project: Project;
  effects: TimedEffect[];
  intro: number;
  playhead: () => number;
  selectedId: string | null;
  onSelect: (d: Direction) => void;
  onAdd: (keyword: string, type: DirectionType, text: string) => void;
  onPlace: (d: Direction) => void;
  onResetTarget: (d: Direction) => void;
  onColor: (d: Direction, color: string | null) => void;
  setBranding: (patch: Partial<Branding>) => void;
  languages: string[];
}

export default function EffectsBranding(p: Props) {
  return (
    <Section id="effects" number={4} icon={<Sparkles size={18} />} title="Effects & Branding" subtitle="Add effects at the playhead, place them on the video, brand everything">
      <div className="grid gap-4 xl:grid-cols-2">
        <EffectsPanel {...p} />
        <BrandingPanel branding={p.project.branding} setBranding={p.setBranding} languages={p.languages} />
      </div>
    </Section>
  );
}

function EffectsPanel(p: Props) {
  const [choice, setChoice] = useState(PALETTE[0]);
  const [text, setText] = useState("");
  const [transition, setTransition] = useState<"fade" | "slide">("fade");
  const needsText = choice.type !== "TRANSITION";

  const add = () => {
    const body = choice.type === "TRANSITION" ? `${transition} to next scene` : text.trim();
    if (needsText && !body) return;
    p.onAdd(choice.keyword, choice.type, body);
    setText("");
  };

  return (
    <div className="space-y-4">
      <Card title="Add an effect" icon={<Plus size={16} />}>
        <div className="grid grid-cols-4 gap-1.5">
          {PALETTE.map(item => (
            <button key={item.type} onClick={() => setChoice(item)} aria-pressed={choice.type === item.type}
              className={`flex flex-col items-center gap-0.5 rounded-lg border px-1 py-2 text-[11px] ${choice.type === item.type ? "border-gold bg-gold/15 text-gold" : "border-white/10 text-white/70 hover:border-white/30"}`}>
              <span className="text-base">{EFFECT_ICON[item.type]}</span>{item.label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          {needsText ? (
            <input className="input" value={text} onChange={e => setText(e.target.value)} placeholder={choice.needs} aria-label={choice.needs}
              onKeyDown={e => e.key === "Enter" && add()} />
          ) : (
            <Seg value={transition} onChange={setTransition} label="Transition style" options={[{ id: "fade", label: "Fade" }, { id: "slide", label: "Slide" }]} />
          )}
          <button className="btn btn-gold shrink-0" onClick={add} disabled={needsText && !text.trim()}>
            {TARGETED.has(choice.type) ? <><Crosshair size={14} /> Place</> : <><Plus size={14} /> Add</>}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-white/40">
          Adds a line to the script at the playhead ({formatSeconds(Math.max(0, p.playhead()))}).
          {TARGETED.has(choice.type) ? " Then click or drag on the preview where it should land." : ""}
        </p>
      </Card>

      <Card title={`Effects in this video (${p.effects.length})`} icon={<Sparkles size={16} />}>
        {p.effects.length === 0 && <p className="text-sm text-white/40">Effects from your script appear here.</p>}
        <ul className="max-h-80 space-y-1.5 overflow-auto pr-1">
          {p.effects.map(e => {
            const d = e.direction;
            const placed = TARGETED.has(d.type) && !!p.project.targets[targetKey(d)];
            return (
              <li key={d.id} className={`flex items-center gap-2 rounded-lg border p-2 text-sm ${p.selectedId === d.id ? "border-gold bg-gold/10" : "border-white/10"}`}>
                <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => p.onSelect(d)}>
                  <span>{EFFECT_ICON[d.type]}</span>
                  <span className="font-mono text-[11px] text-white/45">{formatSeconds(p.intro + e.start)}</span>
                  <span className="shrink-0 text-xs font-semibold" style={{ color: EFFECT_COLOR[d.type] }}>{EFFECT_LABEL[d.type]}</span>
                  <span className="truncate text-white/80">{d.text}</span>
                  {V2_ONLY.has(d.type) && <V2>v2</V2>}
                </button>
                {EFFECT_DURATION[d.type] > 0 && <span className="hidden text-[10px] text-white/35 sm:inline">{EFFECT_DURATION[d.type]}s</span>}
                {COLORED.has(d.type) && (
                  <input type="color" aria-label={`${EFFECT_LABEL[d.type]} color`} title="Effect color"
                    value={e.color ?? p.project.branding.accent} onChange={ev => p.onColor(d, ev.target.value)} className="h-6 w-7 shrink-0" />
                )}
                {TARGETED.has(d.type) && (
                  <>
                    <button className={`btn !px-2 !py-1 text-xs ${placed ? "btn-ghost" : "btn-navy"}`} onClick={() => p.onPlace(d)}>
                      <Crosshair size={12} /> {placed ? "Move" : "Place"}
                    </button>
                    {placed && <button className="btn btn-ghost !px-1.5 !py-1" onClick={() => p.onResetTarget(d)} aria-label="Reset placement"><RotateCcw size={12} /></button>}
                  </>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-[11px] text-white/40">Effects that name the same element share one placement and color.</p>
      </Card>
    </div>
  );
}

function Group({ title, on, onToggle, children }: { title: string; on?: boolean; onToggle?: (v: boolean) => void; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-white/85">{title}</span>
        {onToggle && <Toggle checked={!!on} onChange={onToggle} label={title} />}
      </div>
      {(on ?? true) && <div className="space-y-2">{children}</div>}
    </div>
  );
}

function BrandingPanel({ branding: b, setBranding, languages }: { branding: Branding; setBranding: (p: Partial<Branding>) => void; languages: string[] }) {
  const logoRef = useRef<HTMLInputElement>(null);
  const setLogo = async (f: File | undefined) => {
    if (f && /^image\/(png|svg\+xml|jpeg|webp)$/.test(f.type)) setBranding({ logo: await readAsDataURL(f) });
  };
  return (
    <Card title="Branding" icon={<Palette size={16} />}>
      <div className="space-y-3">
        <div className="grid grid-cols-[auto_auto_1fr] items-end gap-3">
          <label><span className="field-label">Primary</span><input type="color" value={b.primary} onChange={e => setBranding({ primary: e.target.value })} className="h-[38px] w-12" /></label>
          <label><span className="field-label">Accent</span><input type="color" value={b.accent} onChange={e => setBranding({ accent: e.target.value })} className="h-[38px] w-12" /></label>
          <Field label="Font">
            <select className="input" value={b.font} onChange={e => setBranding({ font: e.target.value as BrandFont })} style={{ fontFamily: b.font }}>
              {FONTS.map(f => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
            </select>
          </Field>
        </div>

        <Group title="Logo">
          <div className="flex items-center gap-3" onDragOver={e => e.preventDefault()} onDrop={e => {
            e.preventDefault();
            void setLogo(e.dataTransfer.files[0]);
          }}>
            <button onClick={() => logoRef.current?.click()} className="flex h-14 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-white/25 bg-navy hover:border-gold" aria-label="Upload logo">
              {b.logo ? <img src={b.logo} alt="Logo" className="max-h-full max-w-full object-contain p-1" /> : <ImagePlus size={20} className="text-white/40" />}
            </button>
            <span className="text-xs text-white/50">Drop a PNG or SVG, or click.</span>
            {b.logo && <button className="ml-auto text-xs text-red-300 hover:underline" onClick={() => setBranding({ logo: null })}><X size={12} className="inline" /> Remove</button>}
            <input ref={logoRef} type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp" className="hidden" onChange={e => void setLogo(e.target.files?.[0])} />
          </div>
          <Seg<LogoPosition> value={b.logoPosition} onChange={v => setBranding({ logoPosition: v })} label="Logo position" options={[
            { id: "top-left", label: "Top left" }, { id: "top-right", label: "Top right" }, { id: "bottom-left", label: "Bottom left" }, { id: "bottom-right", label: "Bottom right" }
          ]} />
          <Slider label="Logo size" value={b.logoSize} min={50} max={200} step={5} format={v => `${v}px`} onChange={v => setBranding({ logoSize: v })} />
        </Group>

        <Group title="Intro card" on={b.intro.enabled} onToggle={v => setBranding({ intro: { ...b.intro, enabled: v } })}>
          <input className="input" value={b.intro.title} onChange={e => setBranding({ intro: { ...b.intro, title: e.target.value } })} placeholder="Title" aria-label="Intro title" />
          <input className="input" value={b.intro.subtitle} onChange={e => setBranding({ intro: { ...b.intro, subtitle: e.target.value } })} placeholder="Subtitle" aria-label="Intro subtitle" />
          <Slider label="Duration" value={b.intro.duration} min={1} max={10} step={0.5} format={v => `${v}s`} onChange={v => setBranding({ intro: { ...b.intro, duration: v } })} />
        </Group>

        <Group title="Outro card" on={b.outro.enabled} onToggle={v => setBranding({ outro: { ...b.outro, enabled: v } })}>
          <input className="input" value={b.outro.cta} onChange={e => setBranding({ outro: { ...b.outro, cta: e.target.value } })} placeholder="Call to action" aria-label="Outro call to action" />
          <input className="input" value={b.outro.url} onChange={e => setBranding({ outro: { ...b.outro, url: e.target.value } })} placeholder="haven-mos.org" aria-label="Outro URL" />
          <Slider label="Duration" value={b.outro.duration} min={1} max={10} step={0.5} format={v => `${v}s`} onChange={v => setBranding({ outro: { ...b.outro, duration: v } })} />
        </Group>

        <Group title="Captions (from the voiceover)" on={b.captions.enabled} onToggle={v => setBranding({ captions: { ...b.captions, enabled: v } })}>
          <div className="grid grid-cols-[1fr_auto] items-end gap-3">
            <Slider label="Size" value={b.captions.size} min={24} max={72} step={1} format={v => `${v}px`} onChange={v => setBranding({ captions: { ...b.captions, size: v } })} />
            <label><span className="field-label">Color</span><input type="color" value={b.captions.color} onChange={e => setBranding({ captions: { ...b.captions, color: e.target.value } })} className="h-[38px] w-12" /></label>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Seg value={b.captions.position} onChange={v => setBranding({ captions: { ...b.captions, position: v } })} label="Caption position" options={[{ id: "bottom", label: "Bottom" }, { id: "top", label: "Top" }]} />
            <select className="input !py-1.5" value={b.captions.language} onChange={e => setBranding({ captions: { ...b.captions, language: e.target.value } })} aria-label="Caption language">
              <option value="original">Original language</option>
              {languages.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <p className="text-[11px] text-white/40">Translate captions under Advanced Tools.</p>
        </Group>
      </div>
    </Card>
  );
}
