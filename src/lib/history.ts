/**
 * Generation history and usage, per project, kept in this browser. Avatar renders
 * can cost provider credits, so every render attempt is recorded here — scene,
 * renderer, avatar, voice, when, how long, outcome, version. No credentials, ever.
 * These are usage counts, not billing.
 */
export interface GenerationRecord {
  id: string;
  projectId: string;
  /** Voiceover line number, 0-based (the queue's "Scene N" is this + 1); null for a test render */
  sceneIndex: number | null;
  clipKey: string | null;
  text: string;
  provider: string;
  avatar: string;
  voice: string;
  quality: string;
  at: number;
  /** Seconds of generated video/audio (completed renders) */
  duration: number | null;
  status: "completed" | "failed" | "cancelled";
  /** 1 = first render of this line */
  version: number;
  regeneration: boolean;
  test: boolean;
  error?: string;
}

const MAX = 500;
const key = (projectId: string) => `directorai:history:${projectId}`;

export function loadHistory(projectId: string): GenerationRecord[] {
  try {
    const raw = localStorage.getItem(key(projectId));
    const list = raw ? (JSON.parse(raw) as GenerationRecord[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveHistory(projectId: string, list: GenerationRecord[]): void {
  try {
    localStorage.setItem(key(projectId), JSON.stringify(list.slice(-MAX)));
  } catch {
    // storage full or blocked — history is a convenience, rendering still works
  }
}

/** Next version number for a line: completed production renders so far + 1 */
export function nextVersion(list: GenerationRecord[], clipKey: string): number {
  return list.filter(r => r.clipKey === clipKey && r.status === "completed" && !r.test).length + 1;
}

export interface Usage {
  generatedSeconds: number;
  completed: number;
  failed: number;
  cancelled: number;
  regenerations: number;
  tests: number;
  byProvider: Record<string, { seconds: number; renders: number }>;
}

export function usage(list: GenerationRecord[]): Usage {
  const u: Usage = { generatedSeconds: 0, completed: 0, failed: 0, cancelled: 0, regenerations: 0, tests: 0, byProvider: {} };
  for (const r of list) {
    const p = (u.byProvider[r.provider] ??= { seconds: 0, renders: 0 });
    p.renders++;
    if (r.status === "completed") {
      u.completed++;
      u.generatedSeconds += r.duration ?? 0;
      p.seconds += r.duration ?? 0;
    } else if (r.status === "failed") u.failed++;
    else u.cancelled++;
    if (r.regeneration) u.regenerations++;
    if (r.test) u.tests++;
  }
  return u;
}
