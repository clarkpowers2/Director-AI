import { useRef, useState, type ReactNode } from "react";
import { Crosshair, ImagePlus, Palette, Plus, RotateCcw, Sparkles, X } from "lucide-react";
import { EmptyState, Field, Section, Seg, Slider, Toggle, V2 } from "./ui.tsx";
import {
  COLORED, EFFECT_COLOR, EFFECT_DURATION, EFFECT_ICON, EFFECT_LABEL, TARGETED, V2_ONLY, type TimedEffect
} from "../lib/effects.ts";
import { formatSeconds, type Direction, type DirectionType } from "../lib/parser.ts";
import { FONTS, targetKey, type BrandFont, type Branding, type LogoPosition, type Project } from "../lib/project.ts";
import { readAsDataURL } from "../lib/video.ts";

const PALETTE: { type: DirectionType; keyword: string; label: string; needs: string; description: string }[] = [
  { type: "ZOOM", keyword: "ZOOM", label: "Zoom", needs: "Element to zoom on", description: "Zooms to 150% on an element, holds 2 seconds, zooms back out." },
  { type: "HIGHLIGHT", keyword: "HIGHLIGHT", label: "Highlight", needs: "Element to highlight", description: "A glowing border fades in around an element." },
  { type: "PULSE", keyword: "PULSE", label: "Pulse glow", needs: "Element to pulse", description: "A glow radiates from an element three times." },
  { type: "POINT", keyword: "POINTS TO", label: "Pointer", needs: "Element to point at", description: "An animated arrow bounces toward an element; the avatar points too." },
  { type: "CALLOUT", keyword: "CALLOUT", label: "Callout", needs: "Callout text", description: "A speech bubble with a label, pointing at an element." },
  { type: "TITLE", keyword: "TITLE", label: "Title card", needs: "Title text", description: "A full-width title band in your brand colors." },
  { type: "LOWER THIRD", keyword: "LOWER THIRD", label: "Lower third", needs: "Name | Title", description: "A name and title strip that slides in at the bottom left." },
  { type: "TRANSITION", keyword: "TRANSITION", label: "Transition", needs: "", description: "A fade or slide wipe between scenes." }
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
  /** Video preview (click to place effects) */
  stage: ReactNode;
  timeline: ReactNode;
}

/** The Effects page: effect cards, preview for placing them, effect list, timeline, branding */
export default function EffectsBranding(p: Props) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <Section id="effects-add" icon={<Plus size={18} />} title="Add an effect"
        subtitle={`Adds a line to your script at the playhead (${formatSeconds(Math.max(0, p.playhead()))}). Effects that land on something — zoom, highlight, pulse, pointer, callout — then ask you to click the preview.`}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {PALETTE.map(item => <EffectCard key={item.type} item={item} onAdd={p.onAdd} />)}
        </div>
      </Section>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
        <Section id="effects-preview" icon={<Crosshair size={18} />} title="Preview" subtitle="Play it back, or click and drag to place an effect">
          {p.stage}
        </Section>
        <EffectsList {...p} />
      </div>

      <Section id="effects-timeline" icon={<Sparkles size={18} />} title="Timeline" subtitle="Where each effect lands — click a marker to jump to it">
        {p.timeline}
      </Section>

      <Section id="branding" icon={<Palette size={18} />} title="Branding" subtitle="Colors, font, logo, intro and outro cards, captions">
        <BrandingPanel branding={p.project.branding} setBranding={p.setBranding} languages={p.languages} />
      </Section>
    </div>
  );
}

function EffectCard({ item, onAdd }: { item: (typeof PALETTE)[number]; onAdd: Props["onAdd"] }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const targeted = TARGETED.has(item.type);
  const add = (body: string) => {
    if (!body.trim()) return;
    onAdd(item.keyword, item.type, body.trim());
    setText("");
    setOpen(false);
  };
  return (
    <div className="flex flex-col rounded-2xl border border-white/10 bg-navy-900/60 p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl text-2xl" style={{ background: `${EFFECT_COLOR[item.type]}22` }}>{EFFECT_ICON[item.type]}</span>
        <div>
          <div className="text-base font-semibold text-light">{item.label}</div>
          <div className="font-mono text-[11px] text-white/40">{item.keyword}:</div>
        </div>
      </div>
      <p className="mt-3 flex-1 text-sm text-white/55">{item.description}</p>
      {item.type === "TRANSITION" ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button className="btn btn-gold" onClick={() => add("fade to next scene")}><Plus size={16} /> Fade</button>
          <button className="btn btn-gold" onClick={() => add("slide to next scene")}><Plus size={16} /> Slide</button>
        </div>
      ) : open ? (
        <div className="mt-4 space-y-2">
          <input className="input" autoFocus value={text} onChange={e => setText(e.target.value)} placeholder={item.needs} aria-label={item.needs}
            onKeyDown={e => {
              if (e.key === "Enter") add(text);
              if (e.key === "Escape") setOpen(false);
            }} />
          <div className="grid grid-cols-2 gap-2">
            <button className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-gold" onClick={() => add(text)} disabled={!text.trim()}>
              {targeted ? <><Crosshair size={16} /> Place</> : <><Plus size={16} /> Add</>}
            </button>
          </div>
        </div>
      ) : (
        <button className="btn btn-gold mt-4 w-full" onClick={() => setOpen(true)} aria-label={`Add ${item.label}`}><Plus size={16} /> ADD</button>
      )}
    </div>
  );
}

function EffectsList(p: Props) {
  return (
    <Section id="effects-list" icon={<Sparkles size={18} />} title={`Effects in this video (${p.effects.length})`}>
      {p.effects.length === 0 ? (
        <EmptyState icon={<Sparkles size={20} />} title="No effects yet">Add one with the cards above, or write it into the script, e.g. <code className="text-gold">ZOOM: dashboard</code>.</EmptyState>
      ) : (
        <ul className="max-h-[520px] space-y-2 overflow-auto pr-1">
          {p.effects.map(e => {
            const d = e.direction;
            const placed = TARGETED.has(d.type) && !!p.project.targets[targetKey(d)];
            return (
              <li key={d.id} className={`rounded-xl border p-3 text-sm ${p.selectedId === d.id ? "border-gold bg-gold/10" : "border-white/10"}`}>
                <button className="flex w-full min-w-0 items-center gap-2 text-left" onClick={() => p.onSelect(d)}>
                  <span className="text-lg">{EFFECT_ICON[d.type]}</span>
                  <span className="font-mono text-xs text-white/45">{formatSeconds(p.intro + e.start)}</span>
                  <span className="shrink-0 font-semibold" style={{ color: EFFECT_COLOR[d.type] }}>{EFFECT_LABEL[d.type]}</span>
                  <span className="truncate text-white/80">{d.text}</span>
                  {V2_ONLY.has(d.type) && <V2>avatar gesture</V2>}
                </button>
                {(COLORED.has(d.type) || TARGETED.has(d.type)) && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {EFFECT_DURATION[d.type] > 0 && <span className="text-xs text-white/40">{EFFECT_DURATION[d.type]}s</span>}
                    {COLORED.has(d.type) && (
                      <label className="flex items-center gap-2 text-xs text-white/60">
                        Color
                        <input type="color" aria-label={`${EFFECT_LABEL[d.type]} color`} value={e.color ?? p.project.branding.accent}
                          onChange={ev => p.onColor(d, ev.target.value)} className="h-10 w-12" />
                      </label>
                    )}
                    {TARGETED.has(d.type) && (
                      <div className="ml-auto flex gap-2">
                        <button className={`btn text-xs ${placed ? "btn-ghost" : "btn-navy"}`} onClick={() => p.onPlace(d)}>
                          <Crosshair size={14} /> {placed ? "Move" : "Place"}
                        </button>
                        {placed && <button className="btn btn-ghost" onClick={() => p.onResetTarget(d)} aria-label="Reset placement"><RotateCcw size={14} /></button>}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-xs text-white/40">Effects that name the same element share one placement and color.</p>
    </Section>
  );
}

function Group({ title, on, onToggle, children }: { title: string; on?: boolean; onToggle?: (v: boolean) => void; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-navy-900/60 p-4">
      <div className="mb-3 flex items-center justify-between">
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
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
      <div className="space-y-4">
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

      </div>
      <div className="space-y-4">
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
    </div>
  );
}
