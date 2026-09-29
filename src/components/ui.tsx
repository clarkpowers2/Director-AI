import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, X } from "lucide-react";

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? "bg-gold" : "bg-white/15"}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${checked ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: {
  value: T; options: { id: T; label: string; disabled?: boolean }[]; onChange: (v: T) => void; label?: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(o => (
        <button key={o.id} aria-pressed={value === o.id} disabled={o.disabled} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-white/40">{hint}</span>}
    </label>
  );
}

/** Like Field, for groups of buttons — a <label> would rename the first button inside it */
export function FieldGroup({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div role="group" aria-label={label}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-white/40">{hint}</span>}
    </div>
  );
}

export function Slider({ label, value, min, max, step, onChange, format }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string;
}) {
  return (
    <label className="block">
      <span className="field-label flex justify-between"><span>{label}</span><span className="text-white/70">{format ? format(value) : value}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} className="w-full" />
    </label>
  );
}

function useCollapsed(id: string) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(`directorai:collapsed:${id}`) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(`directorai:collapsed:${id}`, collapsed ? "1" : "0");
    } catch {
      // ignore
    }
  }, [id, collapsed]);
  return [collapsed, setCollapsed] as const;
}

/** Full-width, collapsible section with a numbered header */
export function Section({ id, number, icon, title, subtitle, actions, children }: {
  id: string; number: number; icon: ReactNode; title: string; subtitle?: string; actions?: ReactNode; children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useCollapsed(id);
  return (
    <section id={id} className="scroll-mt-20 overflow-hidden rounded-2xl border border-white/10 bg-navy-800/70">
      <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
        <button
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          aria-controls={`${id}-body`}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gold/15 text-gold">{icon}</span>
          <span className="min-w-0">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-gold/80">Section {number}</span>
            <span className="block truncate text-lg font-semibold text-light">{title}</span>
          </span>
          {subtitle && <span className="hidden truncate text-sm text-white/45 md:block">{subtitle}</span>}
          <ChevronDown size={18} className={`ml-auto shrink-0 text-white/50 transition ${collapsed ? "-rotate-90" : ""}`} />
        </button>
        {actions && !collapsed && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {!collapsed && <div id={`${id}-body`} className="p-4 sm:p-5">{children}</div>}
    </section>
  );
}

export function Card({ title, icon, children, badge, className = "" }: { title: string; icon?: ReactNode; children: ReactNode; badge?: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-white/10 bg-navy-900/60 p-4 ${className}`}>
      <div className="mb-3 flex items-center gap-2">
        {icon && <span className="text-gold">{icon}</span>}
        <h3 className="text-sm font-semibold text-light">{title}</h3>
        {badge && <span className="ml-auto">{badge}</span>}
      </div>
      {children}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal
        aria-label={title}
        onClick={e => e.stopPropagation()}
        className={`max-h-[90vh] w-full overflow-auto rounded-t-2xl border border-white/10 bg-navy-800 p-5 shadow-2xl sm:rounded-2xl ${wide ? "sm:max-w-3xl" : "sm:max-w-md"}`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gold">{title}</h2>
          <button className="btn btn-ghost !p-1.5" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Bottom sheet for mobile */
export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/60 lg:hidden" onClick={onClose}>
      <div
        role="dialog"
        aria-modal
        aria-label={title}
        onClick={e => e.stopPropagation()}
        className="absolute inset-x-0 bottom-0 max-h-[88vh] overflow-auto rounded-t-2xl border-t border-gold/30 bg-navy-800 p-4 pb-8 shadow-2xl"
      >
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-white/20" />
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gold">{title}</h2>
          <button className="btn btn-ghost !p-1.5" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function V2({ children = "Coming in v2" }: { children?: ReactNode }) {
  return <span className="v2-badge">{children}</span>;
}
