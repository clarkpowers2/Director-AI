import { CheckCircle2, RotateCcw, XCircle } from "lucide-react";
import { Modal } from "./ui.tsx";
import { type ServerStatus } from "../lib/avatar.ts";

interface Props {
  open: boolean;
  onClose: () => void;
  server: ServerStatus | null;
  onReset: () => void;
}

function Row({ ok, label }: { ok: boolean | undefined; label: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      {ok ? <CheckCircle2 size={16} className="text-emerald-400" /> : <XCircle size={16} className="text-white/30" />}
      <span className={ok ? "text-white/85" : "text-white/45"}>{label}</span>
    </li>
  );
}

export default function SettingsModal({ open, onClose, server, onReset }: Props) {
  return (
    <Modal open={open} onClose={onClose} title="Settings">
      <div className="space-y-5">
        <div>
          <span className="field-label">Server features</span>
          {server === null ? (
            <p className="text-sm text-white/50">Can't reach the server — you're offline or running without the API.</p>
          ) : (
            <ul className="space-y-1.5">
              <Row ok={server.heygen} label="HeyGen avatars (full body, gestures)" />
              <Row ok={server.tts} label="Free animated voice (Cloudflare Workers AI)" />
              <Row ok={server.anthropic} label="AI Assist and subtitle translation (Claude)" />
            </ul>
          )}
        </div>

        <div className="border-t border-white/10 pt-4">
          <button className="btn btn-ghost text-red-300" onClick={() => {
            if (window.confirm("Start a new project? This clears the script, settings and uploaded media in this browser.")) onReset();
          }}>
            <RotateCcw size={14} /> New project
          </button>
        </div>
      </div>
    </Modal>
  );
}
