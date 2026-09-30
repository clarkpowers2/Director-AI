/**
 * Avatar rendering UI: the Render Avatar panel (choose scenes → confirm), the
 * render queue, the 10-second TEST RENDER, generation history, and the confirm
 * dialog that guards every paid render. Nothing here renders without a click.
 */
import { useMemo, useState } from "react";
import {
  AlertCircle, CheckCircle2, Clock, FlaskConical, History, Loader2, Pause, Play, RefreshCw, Sparkles, X
} from "lucide-react";
import { Card, Modal, Seg } from "./ui.tsx";
import { estimateSeconds, type AvatarScene } from "../lib/avatarScenes.ts";
import { usage, type GenerationRecord } from "../lib/history.ts";
import type { ProviderInfo } from "../lib/avatar.ts";
import type { AvatarRenderSettings, BackgroundMode, RenderQuality } from "../lib/project.ts";
import { formatSeconds } from "../lib/parser.ts";

/** "4 minutes 35 seconds" */
export function spokenDuration(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  const m = Math.floor(s / 60), r = s % 60;
  const part = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  return m ? `${part(m, "minute")}${r ? ` ${part(r, "second")}` : ""}` : part(r, "second");
}

export const providerLabel = (providers: ProviderInfo[], id: string | null | undefined) =>
  id === "free-voice" ? "Free voice" : providers.find(p => p.id === id)?.label ?? (id || "Automatic");

// ---------- Confirm dialog ----------

export interface ConfirmRequest {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
}

export function ConfirmDialog({ request, onClose }: { request: ConfirmRequest | null; onClose: () => void }) {
  return (
    <Modal open={!!request} onClose={onClose} title={request?.title ?? ""}>
      {request && (
        <>
          <div className="space-y-2 text-sm text-white/80">{request.body}</div>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-gold" onClick={() => {
              onClose();
              request.onConfirm();
            }}>{request.confirmLabel}</button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ---------- Render Avatar panel ----------

interface PanelProps {
  open: boolean;
  onClose: () => void;
  scenes: AvatarScene[];
  /** Clip keys to tick when it opens (null = every line not rendered yet) */
  preselect: string[] | null;
  /** true = avatar renderer; false = free voice (no credits) */
  rendered: boolean;
  avatarName: string | null;
  avatarImage: string | null;
  voiceName: string;
  providers: ProviderInfo[];
  settings: AvatarRenderSettings;
  setSettings: (s: Partial<AvatarRenderSettings>) => void;
  rate: number;
  onChangeAvatar: () => void;
  onChangeVoice: () => void;
  onConfirm: (keys: string[]) => void;
}

const QUALITY_LABEL: Record<RenderQuality, string> = { preview: "Preview · 720p", standard: "Standard · 1080p", high: "High" };

export function RenderAvatarPanel(p: PanelProps) {
  // one row per distinct line — identical lines share one render
  const rows = useMemo(() => {
    const seen = new Set<string>();
    return p.scenes.filter(s => s.key && !seen.has(s.key) && (seen.add(s.key), true));
  }, [p.scenes]);
  const busyKeys = new Set(rows.filter(s => s.status === "queued" || s.status === "rendering").map(s => s.key!));
  const initial = () => new Set(p.preselect ?? rows.filter(s => s.status !== "completed" && !busyKeys.has(s.key!)).map(s => s.key!));
  const [selected, setSelected] = useState<Set<string>>(initial);
  const [step, setStep] = useState<"choose" | "confirm">("choose");
  const [openedWith, setOpenedWith] = useState<string | null>(null);
  // reset each time the panel opens
  const token = p.open ? `${p.preselect?.join(",") ?? "missing"}` : null;
  if (token !== openedWith) {
    setOpenedWith(token);
    if (p.open) {
      setSelected(initial());
      setStep("choose");
    }
  }

  const chosen = rows.filter(s => selected.has(s.key!) && !busyKeys.has(s.key!));
  const regenerations = chosen.filter(s => s.status === "completed").length;
  const seconds = chosen.reduce((n, s) => n + estimateSeconds(s.voiceoverText, p.rate), 0);
  const provider = p.settings.provider === "auto" ? p.providers[0] : p.providers.find(x => x.id === p.settings.provider);
  const caps = provider?.capabilities;
  const paid = p.rendered && (caps?.paid ?? true);
  const noProvider = p.rendered && p.providers.length === 0;
  const toggle = (key: string) => setSelected(s => {
    const n = new Set(s);
    if (n.has(key)) n.delete(key);
    else n.add(key);
    return n;
  });

  return (
    <Modal open={p.open} onClose={p.onClose} title={step === "choose" ? "Render avatar" : "Confirm generation"} wide>
      {step === "choose" ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-navy p-3">
              <span className="h-14 w-11 shrink-0 overflow-hidden rounded-lg bg-navy-900">
                {p.avatarImage && <img src={p.avatarImage} alt="" className="h-full w-full object-cover" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="field-label !mb-0">Avatar</span>
                <span className="block truncate text-sm font-semibold">{p.avatarName ?? "None selected"}</span>
              </span>
              <button className="btn btn-ghost !py-1 text-xs" onClick={p.onChangeAvatar}>Change</button>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-navy p-3">
              <span className="min-w-0 flex-1">
                <span className="field-label !mb-0">Voice</span>
                <span className="block truncate text-sm font-semibold">{p.voiceName}</span>
              </span>
              <button className="btn btn-ghost !py-1 text-xs" onClick={p.onChangeVoice}>Change</button>
            </div>
          </div>

          {p.rendered && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="field-label">Provider</span>
                <select className="input" value={p.settings.provider} onChange={e => p.setSettings({ provider: e.target.value })}>
                  <option value="auto">Automatic{p.providers[0] ? ` (${p.providers[0].label})` : ""}</option>
                  {p.providers.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
                </select>
              </label>
              <div>
                <span className="field-label">Render quality</span>
                <Seg<RenderQuality> value={p.settings.quality} onChange={q => p.setSettings({ quality: q })} label="Render quality"
                  options={(["preview", "standard", "high"] as RenderQuality[]).map(q => ({ id: q, label: QUALITY_LABEL[q], disabled: !!caps && !caps.qualities.includes(q) }))} />
              </div>
              <div className="sm:col-span-2">
                <span className="field-label">Background</span>
                <Seg<BackgroundMode> value={p.settings.background} onChange={b => p.setSettings({ background: b })} label="Background" options={[
                  { id: "transparent", label: "Transparent (cut-out)" },
                  { id: "provider", label: "Provider background" }
                ]} />
                <span className="mt-1 block text-[11px] text-white/40">Transparent needs an avatar trained for it; others fall back to their own background automatically, at no extra cost.</span>
              </div>
            </div>
          )}

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="field-label !mb-0">Scenes</span>
              <span className="flex gap-2 text-xs">
                <button className="text-gold hover:underline" onClick={() => setSelected(new Set(rows.filter(s => !busyKeys.has(s.key!)).map(s => s.key!)))}>All</button>
                <button className="text-gold hover:underline" onClick={() => setSelected(new Set(rows.filter(s => s.status !== "completed" && !busyKeys.has(s.key!)).map(s => s.key!)))}>Not rendered</button>
                <button className="text-gold hover:underline" onClick={() => setSelected(new Set())}>None</button>
              </span>
            </div>
            <ul className="max-h-64 space-y-1 overflow-auto rounded-xl border border-white/10 bg-navy-900/60 p-2">
              {rows.map(s => (
                <li key={s.key}>
                  <label className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm ${busyKeys.has(s.key!) ? "opacity-50" : "hover:bg-white/5"}`}>
                    <input type="checkbox" className="mt-1" checked={selected.has(s.key!) && !busyKeys.has(s.key!)} disabled={busyKeys.has(s.key!)} onChange={() => toggle(s.key!)} />
                    <span className="min-w-0 flex-1">
                      <span className="text-white/50">Scene {p.scenes.indexOf(s) + 1} · {formatSeconds(s.startTime)} · </span>
                      <span className="text-white/85">{s.voiceoverText}</span>
                      {s.gesture && <span className="block text-[11px] text-white/40">Gesture: {s.gesture}</span>}
                    </span>
                    <span className="shrink-0 text-[11px] text-white/45">
                      {s.status === "completed" ? "Rendered ✓" : busyKeys.has(s.key!) ? "In queue" : s.status === "failed" ? "Failed" : ""}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-gold/30 bg-gold/5 p-3 text-sm">
            <span className="field-label !mb-0">Estimated generation</span>
            {chosen.length} scene{chosen.length === 1 ? "" : "s"} · about {spokenDuration(seconds)} of speech
            {regenerations > 0 && <span className="block text-xs text-amber-200">{regenerations} already rendered — regenerating may use additional provider credits.</span>}
          </div>
          {noProvider && <p className="text-xs text-red-300">No avatar renderer is set up on the server.</p>}
          <div className="flex justify-end gap-2">
            <button className="btn btn-ghost" onClick={p.onClose}>Cancel</button>
            <button className="btn btn-gold" disabled={!chosen.length || noProvider || (p.rendered && !p.avatarName)} onClick={() => setStep("confirm")}>
              <Sparkles size={16} /> Generate avatar
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <p>You are about to generate:</p>
          <p className="text-2xl font-semibold text-gold">{chosen.length} avatar scene{chosen.length === 1 ? "" : "s"}</p>
          <p>Estimated duration:<br /><span className="text-lg font-semibold">{spokenDuration(seconds)}</span></p>
          <p className="text-white/60">
            {p.rendered ? `${providerLabel(p.providers, provider?.id)} · ${QUALITY_LABEL[p.settings.quality]} · ${p.avatarName}` : "Free voice"}
          </p>
          {paid && <p className="rounded-lg bg-amber-400/10 p-2 text-amber-100">This uses avatar provider credits. Each scene takes a few minutes to render.</p>}
          {regenerations > 0 && <p className="rounded-lg bg-amber-400/10 p-2 text-amber-100">{regenerations} of these scene{regenerations === 1 ? " has" : "s have"} already been generated. Regenerating may consume additional provider credits.</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn btn-ghost" onClick={() => setStep("choose")}>Back</button>
            <button className="btn btn-gold" onClick={() => {
              p.onConfirm(chosen.map(s => s.key!));
              p.onClose();
            }}>Confirm generation</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------- Render queue ----------

interface QueueProps {
  scenes: AvatarScene[];
  providers: ProviderInfo[];
  canRender: boolean;
  onOpenPanel: () => void;
  onCancel: (key: string) => void;
  onCancelAll: () => void;
  onRetry: (s: AvatarScene) => void;
  onRegenerate: (s: AvatarScene) => void;
  onTryProvider: (s: AvatarScene, provider: ProviderInfo) => void;
  onPreview: (s: AvatarScene) => void;
  onEditScript: (s: AvatarScene) => void;
  onChangeAvatar: () => void;
  onFasterVoice: (() => void) | null;
}

function StatusIcon({ s }: { s: AvatarScene }) {
  if (s.status === "completed") return <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-gold" />;
  if (s.status === "failed") return <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-300" />;
  if (s.status === "rendering") return <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin text-sky-300" />;
  if (s.status === "queued") return <Clock size={16} className="mt-0.5 shrink-0 text-white/50" />;
  if (s.status === "cancelled") return <Pause size={16} className="mt-0.5 shrink-0 text-white/40" />;
  return <span className="mt-1.5 h-3 w-3 shrink-0 rounded-full border border-white/30" />;
}

function statusText(s: AvatarScene): string {
  switch (s.status) {
    case "completed": return "Completed ✓";
    case "rendering": return s.progress != null && s.progress > 0 ? `Rendering ${Math.round(s.progress * 100)}%` : "Rendering…";
    case "queued": return "Queued";
    case "failed": return "Failed";
    case "cancelled": return "Cancelled";
    default: return "Not rendered";
  }
}

export function RenderQueue(p: QueueProps) {
  const done = p.scenes.filter(s => s.status === "completed").length;
  const active = p.scenes.some(s => s.status === "queued" || s.status === "rendering");
  const small = "btn btn-ghost !min-h-0 !px-2 !py-1 text-[11px]";
  return (
    <Card title={`Avatar generation (${done}/${p.scenes.length})`} icon={<Sparkles size={16} />} badge={
      <span className="flex gap-2">
        {active && <button className={small} onClick={p.onCancelAll}><X size={12} /> Cancel all</button>}
        <button className="btn btn-gold !min-h-0 !py-1 text-xs" onClick={p.onOpenPanel} disabled={!p.canRender}><Sparkles size={12} /> Render avatar…</button>
      </span>
    }>
      {p.scenes.length === 0 && <p className="text-sm text-white/40">Add voiceover lines to the script on the Editor page.</p>}
      <ul className="max-h-[420px] space-y-1.5 overflow-auto text-sm">
        {p.scenes.map((s, i) => {
          const others = p.providers.filter(x => x.id !== s.provider);
          const late = s.timingDifference !== null && s.timingDifference > 0.3;
          return (
            <li key={s.id} className="rounded-lg bg-navy px-3 py-2">
              <div className="flex items-start gap-2">
                <StatusIcon s={s} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap gap-x-2 text-xs">
                    <b className="text-white/85">Scene {i + 1}</b>
                    <span className="text-white/50">{s.avatarName}</span>
                    <span className="text-white/50">{formatSeconds(s.startTime)}</span>
                    <span className={s.status === "failed" ? "text-red-300" : s.status === "completed" ? "text-gold" : "text-white/60"}>{statusText(s)}</span>
                    {s.clip?.version && s.clip.version > 1 ? <span className="text-white/40">v{s.clip.version}</span> : null}
                  </span>
                  <span className="line-clamp-2 text-white/75">{s.voiceoverText}</span>
                  {s.status === "rendering" && s.progress != null && s.progress > 0 && (
                    <span className="mt-1 block h-1 overflow-hidden rounded-full bg-white/10"><span className="block h-full bg-sky-300" style={{ width: `${Math.round(s.progress * 100)}%` }} /></span>
                  )}
                </span>
                <span className="flex shrink-0 flex-wrap justify-end gap-1">
                  {s.status === "completed" && (
                    <>
                      <button className={small} onClick={() => p.onPreview(s)}><Play size={12} /> Preview</button>
                      <button className={small} onClick={() => p.onRegenerate(s)} disabled={!p.canRender}><RefreshCw size={12} /> Regenerate</button>
                    </>
                  )}
                  {(s.status === "queued" || s.status === "rendering") && <button className={small} onClick={() => s.key && p.onCancel(s.key)}><X size={12} /> Cancel</button>}
                  {s.status === "cancelled" && s.clip?.error && <span className="w-full text-right text-[11px] text-amber-200">{s.clip.error}</span>}
                  {s.status === "cancelled" && <button className={small} onClick={() => p.onRetry(s)} disabled={!p.canRender}><RefreshCw size={12} /> Render</button>}
                </span>
              </div>

              {s.status === "failed" && (
                <div className="mt-2 rounded-lg border border-red-400/30 bg-red-500/10 p-2 text-xs">
                  <div className="font-semibold uppercase tracking-wide text-red-200">Avatar generation failed</div>
                  <div className="text-red-100/90">{s.error}</div>
                  <ErrorDetails detail={s.clip?.errorDetail} />
                  <div className="mt-2 flex flex-wrap gap-1">
                    <button className={small} onClick={() => p.onRetry(s)} disabled={!p.canRender}><RefreshCw size={12} /> Retry</button>
                    {others.map(x => <button key={x.id} className={small} onClick={() => p.onTryProvider(s, x)}>Try {x.label}</button>)}
                    <button className={small} onClick={p.onChangeAvatar}>Change avatar</button>
                    <button className={small} onClick={() => p.onEditScript(s)}>Edit script</button>
                  </div>
                </div>
              )}

              {late && (
                <div className="mt-2 rounded-lg border border-amber-300/30 bg-amber-400/10 p-2 text-xs text-amber-100">
                  <b className="uppercase tracking-wide">Timing difference +{s.timingDifference!.toFixed(1)} seconds</b>
                  <span className="block text-amber-100/80">
                    Planned {s.expectedDuration.toFixed(1)}s, spoken {s.actualDuration!.toFixed(1)}s. Nothing is cut: the timeline follows the rendered audio and the next line starts when this one ends.
                  </span>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <button className={small} onClick={() => p.onEditScript(s)}>Edit script</button>
                    {p.onFasterVoice && <button className={small} onClick={p.onFasterVoice}>Change speech speed</button>}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[11px] text-white/40">Failed or cancelled scenes are never re-rendered automatically. Each render or retry needs your confirmation.</p>
    </Card>
  );
}

/** Sanitized provider response for a failed render — never credentials */
export function ErrorDetails({ detail }: { detail?: { http?: number; code?: string; message?: string; endpoint?: string; jobId?: string; requestId?: string; providerJobId?: string } | null }) {
  if (!detail) return <div className="mt-1 text-red-100/70">No credits will be retried automatically.</div>;
  const rows: [string, string | number | undefined][] = [
    ["Provider response", [detail.code, detail.message].filter(Boolean).join(" · ") || undefined],
    ["HTTP", detail.http || undefined],
    ["Provider call", detail.endpoint],
    ["DirectorAI job", detail.jobId ?? detail.requestId],
    ["Provider job", detail.providerJobId]
  ];
  return (
    <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-red-100/85">
      {rows.filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => (
        <div key={k} className="contents"><dt className="text-red-200/70">{k}:</dt><dd className="break-all font-mono text-[10.5px]">{v}</dd></div>
      ))}
      <dd className="col-span-2 mt-1 text-red-100/70">No credits will be retried automatically.</dd>
    </dl>
  );
}

// ---------- 10-second test ----------

export const TEST_MAX_CHARS = 220;

export interface TestState {
  status: "idle" | "rendering" | "done" | "error";
  progress?: number | null;
  error?: string;
  detail?: Parameters<typeof ErrorDetails>[0]["detail"];
  result?: { url: string; duration: number; provider: string; alpha: boolean; avatar: string; voice: string };
}

export function TestRenderCard(p: {
  text: string; setText: (t: string) => void; state: TestState; disabledReason: string | null;
  providerName: string; onGenerate: () => void; onCancel: () => void;
}) {
  const busy = p.state.status === "rendering";
  return (
    <Card title="10-second test" icon={<FlaskConical size={16} />} badge={<span className="rounded bg-sky-400/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-200">Test render</span>}>
      <p className="mb-2 text-xs text-white/55">
        Try the avatar, voice, placement and look on a short sample before rendering the whole project. Test clips never go on the timeline.
      </p>
      <textarea className="input min-h-20" maxLength={TEST_MAX_CHARS} value={p.text} onChange={e => p.setText(e.target.value)} aria-label="Sample script" />
      <div className="mt-1 flex justify-between text-[11px] text-white/40">
        <span>{p.providerName} · Preview quality</span>
        <span>{p.text.length}/{TEST_MAX_CHARS} · ~{Math.round(estimateSeconds(p.text))}s</span>
      </div>
      <div className="mt-2 flex gap-2">
        <button className="btn btn-navy flex-1" onClick={p.onGenerate} disabled={busy || !!p.disabledReason || !p.text.trim()}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <FlaskConical size={16} />}
          {busy ? (p.state.progress ? `Rendering test ${Math.round(p.state.progress * 100)}%` : "Rendering test…") : "Generate 10-second test"}
        </button>
        {busy && <button className="btn btn-ghost" onClick={p.onCancel}>Cancel</button>}
      </div>
      {p.disabledReason && <p className="mt-1 text-[11px] text-white/45">{p.disabledReason}</p>}
      {p.state.status === "error" && (
        <div className="mt-2 rounded-lg border border-red-400/30 bg-red-500/10 p-2 text-xs">
          <div className="flex gap-1.5 font-semibold text-red-200"><AlertCircle size={14} className="shrink-0" /> Test render failed</div>
          <div className="text-red-100/90">{p.state.error}</div>
          <ErrorDetails detail={p.state.detail} />
        </div>
      )}
      {p.state.result && (
        <div className="mt-3">
          <div className="relative overflow-hidden rounded-xl border border-sky-300/40 bg-[repeating-conic-gradient(#1a2744_0_25%,#22325a_0_50%)] bg-[length:20px_20px]">
            <video src={p.state.result.url} controls className="aspect-video w-full object-contain" />
            <span className="absolute left-2 top-2 rounded bg-sky-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-navy">Test render</span>
          </div>
          <p className="mt-1 text-[11px] text-white/45">
            {p.state.result.avatar} · {p.state.result.voice} · {p.state.result.duration.toFixed(1)}s · {p.state.result.alpha ? "transparent" : "with background"}
          </p>
        </div>
      )}
    </Card>
  );
}

// ---------- History & usage ----------

export function GenerationHistory({ records, providers }: { records: GenerationRecord[]; providers: ProviderInfo[] }) {
  const u = usage(records);
  const recent = [...records].reverse().slice(0, 60);
  return (
    <Card title="Generation history" icon={<History size={16} />}>
      <div className="mb-3 grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-5">
        {[
          ["Generated", spokenDuration(u.generatedSeconds).replace(/ seconds?/, "s").replace(/ minutes?/, "m")],
          ["Successful", u.completed], ["Failed", u.failed], ["Regenerations", u.regenerations], ["Tests", u.tests]
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-navy p-2">
            <div className="text-base font-semibold text-gold">{u.completed || k !== "Generated" ? v : "0s"}</div>
            <div className="text-white/45">{k}</div>
          </div>
        ))}
      </div>
      {Object.keys(u.byProvider).length > 1 && (
        <p className="mb-2 text-[11px] text-white/45">
          {Object.entries(u.byProvider).map(([id, v]) => `${providerLabel(providers, id)}: ${v.renders} renders, ${Math.round(v.seconds)}s`).join(" · ")}
        </p>
      )}
      {recent.length === 0 ? <p className="text-sm text-white/40">No renders yet for this project.</p> : (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-navy-800 text-white/45">
              <tr><th className="py-1 pr-2">When</th><th className="pr-2">Scene</th><th className="pr-2">Provider</th><th className="pr-2">Avatar · voice</th><th className="pr-2">Length</th><th className="pr-2">Status</th><th>Ver.</th></tr>
            </thead>
            <tbody>
              {recent.map(r => (
                <tr key={r.id} className="border-t border-white/5 align-top text-white/75">
                  <td className="py-1 pr-2 whitespace-nowrap">{new Date(r.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                  <td className="pr-2" title={r.text}>{r.test ? <span className="text-sky-200">Test</span> : r.sceneIndex === null ? "—" : `#${r.sceneIndex + 1}`}{r.regeneration ? " ↻" : ""}</td>
                  <td className="pr-2">{providerLabel(providers, r.provider)}</td>
                  <td className="pr-2">{r.avatar} · {r.voice}</td>
                  <td className="pr-2">{r.duration ? `${r.duration.toFixed(1)}s` : "—"}</td>
                  <td className={`pr-2 ${r.status === "failed" ? "text-red-300" : r.status === "completed" ? "text-gold" : ""}`} title={r.error}>{r.status}</td>
                  <td>{r.status === "completed" && !r.test ? `v${r.version}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[11px] text-white/40">Usage counts kept in this browser. Not billing: check your provider account for actual charges.</p>
    </Card>
  );
}

export function ClipPreview({ clip, onClose }: { clip: { url: string; title: string; audio: boolean } | null; onClose: () => void }) {
  return (
    <Modal open={!!clip} onClose={onClose} title={clip?.title ?? ""} wide>
      {clip && (clip.audio
        ? <audio src={clip.url} controls autoPlay className="w-full" />
        : <video src={clip.url} controls autoPlay className="aspect-video w-full rounded-xl bg-[repeating-conic-gradient(#1a2744_0_25%,#22325a_0_50%)] bg-[length:20px_20px] object-contain" />)}
    </Modal>
  );
}
