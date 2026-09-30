import { useState } from "react";
import { ArrowLeft, Loader2, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import type { CreatorSettings, PlanScene, ProductionPlan } from "../lib/plan.ts";
import type { Project } from "../lib/project.ts";

const input = "input w-full";
const styles = ["Professional", "Educational", "Product Demo", "Social", "Explainer", "Sales", "Custom"];
const placements = ["full", "bottom-right", "bottom-left", "top-right", "top-left", "center"] as const;

export function Creator({ initial, project, busy, onBack, onGenerate }: {
  initial: CreatorSettings; project: Project; busy: boolean; onBack: () => void; onGenerate: (s: CreatorSettings) => void;
}) {
  const [s, set] = useState(initial);
  const patch = (p: Partial<CreatorSettings>) => set(v => ({ ...v, ...p }));
  const avatarOptions = ["Victor", "ARIA", "Professional presenter", "YouTube creator", "News anchor", "Tech demo presenter", ...(project.avatar.heygen?.name ? [project.avatar.heygen.name] : [])];
  return <div className="mx-auto max-w-4xl py-4">
    <button className="btn btn-ghost mb-4" onClick={onBack}><ArrowLeft size={16}/> Back to projects</button>
    <h1 className="font-display text-3xl font-bold text-gold">Create with AI</h1>
    <p className="mt-2 text-sm text-white/55">Describe the video. DirectorAI will prepare a plan for you to review before anything is generated.</p>
    <div className="mt-6 space-y-5 rounded-2xl border border-white/10 bg-navy-800/70 p-5 sm:p-7">
      <label className="block"><span className="field-label">What video do you want to make?</span><textarea className={`${input} min-h-36`} value={s.prompt} onChange={e => patch({ prompt: e.target.value })} placeholder="Create a product video explaining…" /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label><span className="field-label">Duration</span><select className={input} value={[30,60,90,120].includes(s.duration) ? String(s.duration) : "custom"} onChange={e => patch({ duration: e.target.value === "custom" ? 45 : Number(e.target.value) })}><option value="30">30 sec</option><option value="60">60 sec</option><option value="90">90 sec</option><option value="120">2 min</option><option value="custom">Custom</option></select>{![30,60,90,120].includes(s.duration) || s.duration === 45 ? <input className={`${input} mt-2`} type="number" min="10" max="600" value={s.duration} onChange={e => patch({ duration: Math.max(10, Math.min(600, Number(e.target.value) || 10)) })} aria-label="Custom duration in seconds" /> : null}</label>
        <label><span className="field-label">Format</span><select className={input} value={s.format} onChange={e => patch({ format: e.target.value as CreatorSettings["format"] })}><option>16:9</option><option>9:16</option><option>1:1</option></select></label>
        <label><span className="field-label">Style</span><select className={input} value={s.style.startsWith("Custom") ? "Custom" : s.style} onChange={e => patch({ style: e.target.value })}>{styles.map(x => <option key={x}>{x}</option>)}</select>{s.style.startsWith("Custom") && <input className={`${input} mt-2`} placeholder="Describe the style" value={s.style.slice("Custom".length).replace(/^:\s*/, "")} onChange={e => patch({ style: `Custom: ${e.target.value}` })}/>}</label>
        <label><span className="field-label">Avatar</span><select className={input} value={s.presenter ?? "none"} onChange={e => patch({ presenter: e.target.value === "none" ? null : e.target.value })}><option value="none">None</option>{[...new Set(avatarOptions)].map(x => <option key={x}>{x}</option>)}</select></label>
        <label><span className="field-label">Avatar usage</span><select className={input} value={s.usage} onChange={e => patch({ usage: e.target.value as CreatorSettings["usage"] })}>{["Full video", "Intro + Outro", "Selected scenes", "DirectorAI decides"].map(x => <option key={x}>{x}</option>)}</select></label>
        <label><span className="field-label">Voice preset</span><select className={input} value={s.voice} onChange={e => patch({ voice:e.target.value })}><option value="default">Use current voice · {project.voice.heygenVoice?.name ?? "Default"}</option><option value="pro-male">Professional male · Victor</option><option value="pro-female">Professional female · ARIA</option><option value="casual-male">Casual male</option><option value="casual-female">Casual female</option></select></label>
      </div>
      <button className="btn btn-gold min-h-12 w-full text-base" disabled={busy || !s.prompt.trim()} onClick={() => onGenerate(s)}>{busy ? <Loader2 className="animate-spin" size={18}/> : <Sparkles size={18}/>} Generate production plan</button>
      <p className="text-center text-xs text-white/40">This creates an editable text plan. Avatar footage is never rendered here.</p>
    </div>
  </div>;
}

export function PlanReview({ plan, setPlan, presenter, busy, onBack, onRegenerate, onContinue }: {
  plan: ProductionPlan; setPlan: (p: ProductionPlan) => void; presenter: string | null; busy: boolean;
  onBack: () => void; onRegenerate: () => void; onContinue: () => void;
}) {
  const scene = (i: number, change: Partial<PlanScene>) => setPlan({ ...plan, scenes: plan.scenes.map((s,n) => n === i ? { ...s, ...change } : s) });
  return <div className="mx-auto max-w-5xl py-4">
    <button className="btn btn-ghost mb-4" onClick={onBack}><ArrowLeft size={16}/> Back to creator</button>
    <h1 className="font-display text-3xl font-bold text-gold">Review production plan</h1>
    <p className="mt-2 text-sm text-white/55">Edit the plan below. Continuing opens the existing DirectorAI Studio; it does not render avatar footage.</p>
    <div className="mt-6 space-y-4">
      <section className="rounded-2xl border border-white/10 bg-navy-800/70 p-5 space-y-3">
        <label className="block"><span className="field-label">Project title</span><input className={input} value={plan.title} onChange={e => setPlan({...plan,title:e.target.value})}/></label>
        <label className="block"><span className="field-label">Objective</span><textarea className={`${input} min-h-20`} value={plan.objective} onChange={e => setPlan({...plan,objective:e.target.value})}/></label>
        <label className="block"><span className="field-label">Target audience</span><input className={input} value={plan.audience} onChange={e => setPlan({...plan,audience:e.target.value})}/></label>
      </section>
      {plan.scenes.map((s,i) => <section key={i} className="rounded-2xl border border-white/10 bg-navy-800/70 p-5 space-y-3">
        <div className="flex items-center justify-between"><h2 className="font-semibold text-gold">Scene {i+1}</h2><button aria-label={`Delete scene ${i+1}`} className="btn btn-ghost" onClick={() => setPlan({...plan,scenes:plan.scenes.filter((_,n)=>n!==i)})}><Trash2 size={15}/></button></div>
        <div className="grid gap-3 sm:grid-cols-2"><label><span className="field-label">Start (seconds)</span><input className={input} type="number" min="0" max={plan.estimated_duration_seconds} value={s.start_seconds} onChange={e=>scene(i,{start_seconds:Number(e.target.value)})}/><span className="text-xs text-white/40">{time(s.start_seconds)}</span></label><label><span className="field-label">End (seconds)</span><input className={input} type="number" min="0" max={plan.estimated_duration_seconds} value={s.end_seconds} onChange={e=>scene(i,{end_seconds:Number(e.target.value)})}/><span className="text-xs text-white/40">{time(s.end_seconds)}</span></label></div>
        <label className="block"><span className="field-label">Scene purpose</span><input className={input} value={s.purpose} onChange={e=>scene(i,{purpose:e.target.value})}/></label>
        <label className="block"><span className="field-label">Voiceover · spoken words only</span><textarea className={`${input} min-h-24`} value={s.voiceover} onChange={e=>scene(i,{voiceover:e.target.value})}/></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label><span className="field-label">Avatar appears</span><select className={input} value={String(s.avatar.appears)} onChange={e=>scene(i,{avatar:{...s.avatar,appears:e.target.value === "true"}})}><option value="true">Yes · {presenter || "Presenter"}</option><option value="false">No</option></select></label>
          <label><span className="field-label">Avatar placement</span><select className={input} value={s.avatar.placement} onChange={e=>scene(i,{avatar:{...s.avatar,placement:e.target.value as typeof s.avatar.placement}})}>{placements.map(x=><option key={x}>{x}</option>)}</select></label>
          <label className="sm:col-span-2"><span className="field-label">Avatar instructions · stage direction</span><textarea className={`${input} min-h-16`} value={s.avatar.direction} onChange={e=>scene(i,{avatar:{...s.avatar,direction:e.target.value}})}/></label>
          <label><span className="field-label">Visual direction</span><textarea className={`${input} min-h-20`} value={s.visual} onChange={e=>scene(i,{visual:e.target.value})}/></label>
          <label><span className="field-label">Titles and captions (one per line)</span><textarea className={`${input} min-h-20`} value={s.overlays.map(o=>`${o.type}: ${o.text}`).join("\n")} onChange={e=>scene(i,{overlays:e.target.value.split("\n").filter(Boolean).map(t=>{const k=t.indexOf(":");return {type:(k>0?t.slice(0,k):"TITLE") as PlanScene["overlays"][number]["type"],text:k>0?t.slice(k+1).trim():t}})})}/></label>
          <label><span className="field-label">B-roll suggestions</span><textarea className={`${input} min-h-16`} value={s.broll ?? ""} onChange={e=>scene(i,{broll:e.target.value || null})}/></label>
          <label><span className="field-label">Transition</span><input className={input} value={s.transition ?? ""} onChange={e=>scene(i,{transition:e.target.value || null})}/></label>
        </div>
      </section>)}
      <button className="btn btn-navy" onClick={()=>setPlan({...plan,scenes:[...plan.scenes,{start_seconds:plan.scenes.at(-1)?.end_seconds ?? 0,end_seconds:plan.estimated_duration_seconds,purpose:"New scene",voiceover:"",avatar:{appears:false,placement:"bottom-right",scale_percent:27,direction:""},visual:"",overlays:[],effects:[],transition:null,broll:null}]})}><Plus size={15}/> Add scene</button>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={plan.captions} onChange={e=>setPlan({...plan,captions:e.target.checked})}/> Include captions</label>
      <div className="flex flex-wrap gap-3 border-t border-white/10 pt-5"><button className="btn btn-navy" onClick={onRegenerate} disabled={busy}>{busy?<Loader2 className="animate-spin" size={16}/>:<RefreshCw size={16}/>} Regenerate plan</button><button className="btn btn-gold ml-auto" onClick={onContinue}>Continue to Studio</button></div>
    </div>
  </div>;
}
function time(n:number){return `${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2,"0")}`;}
