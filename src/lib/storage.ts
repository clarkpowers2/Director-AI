/**
 * Persistence: project settings autosave to localStorage; media (videos, music,
 * photos, generated avatar clips) goes to IndexedDB, which handles large files.
 * Every call fails soft — private windows or blocked storage just mean nothing persists.
 */
import { hydrateProject, type Project } from "./project.ts";

/** Before multiple projects: the one project lived here. Migrated into the index on first load. */
const LEGACY_KEY = "directorai:project";
const INDEX_KEY = "directorai:projects";
const CURRENT_KEY = "directorai:current";
const projectKey = (id: string) => `directorai:project:${id}`;
const DB_NAME = "directorai";
const STORE = "media";

export interface ProjectSummary { id: string; name: string; updatedAt: number; startedWith?: Project["startedWith"] }

function readIndex(): ProjectSummary[] {
  try {
    const list = JSON.parse(localStorage.getItem(INDEX_KEY) ?? "[]") as ProjectSummary[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeIndex(list: ProjectSummary[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(list));
  } catch {
    // ignore — the project itself is what matters
  }
}

/** Saved projects, most recently edited first */
export function listProjects(): ProjectSummary[] {
  migrateLegacy();
  return readIndex().sort((a, b) => b.updatedAt - a.updatedAt);
}

function migrateLegacy(): void {
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!legacy) return;
    const p = hydrateProject(JSON.parse(legacy));
    localStorage.setItem(projectKey(p.id), JSON.stringify(p));
    writeIndex([...readIndex().filter(x => x.id !== p.id), { id: p.id, name: p.name, updatedAt: Date.now(), startedWith: p.startedWith }]);
    if (!localStorage.getItem(CURRENT_KEY)) localStorage.setItem(CURRENT_KEY, p.id);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // leave the legacy copy in place and try again next load
  }
}

/** The project to open: the last one used, else null (first visit — show the start screen) */
export function loadCurrentProject(): Project | null {
  migrateLegacy();
  try {
    const id = localStorage.getItem(CURRENT_KEY);
    const raw = id ? localStorage.getItem(projectKey(id)) : null;
    return raw ? hydrateProject(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function loadProject(): Project {
  return loadCurrentProject() ?? hydrateProject(null);
}

export function openStoredProject(id: string): Project | null {
  try {
    const raw = localStorage.getItem(projectKey(id));
    return raw ? hydrateProject(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveProject(p: Project): boolean {
  try {
    localStorage.setItem(projectKey(p.id), JSON.stringify(p));
    localStorage.setItem(CURRENT_KEY, p.id);
    writeIndex([...readIndex().filter(x => x.id !== p.id), { id: p.id, name: p.name, updatedAt: Date.now(), startedWith: p.startedWith }]);
    return true;
  } catch {
    return false;
  }
}

/** Remove a saved project's settings (its media is removed by the caller, which knows the ids) */
export function deleteStoredProject(id: string): void {
  try {
    localStorage.removeItem(projectKey(id));
    localStorage.removeItem(`directorai:history:${id}`);
    if (localStorage.getItem(CURRENT_KEY) === id) localStorage.removeItem(CURRENT_KEY);
  } catch {
    // ignore
  }
  writeIndex(readIndex().filter(x => x.id !== id));
}

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(d => new Promise<T>((resolve, reject) => {
    const req = fn(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

export const newMediaId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export async function putMedia(id: string, blob: Blob): Promise<void> {
  await tx("readwrite", s => s.put(blob, id)).catch(() => {});
}

export async function getMedia(id: string): Promise<Blob | null> {
  return (await tx<Blob | undefined>("readonly", s => s.get(id)).catch(() => undefined)) ?? null;
}

export async function deleteMedia(id: string): Promise<void> {
  await tx("readwrite", s => s.delete(id)).catch(() => {});
}

/** Clip metadata (not the blob) so generated avatar lines survive reloads */
export async function putClipRecord(key: string, blob: Blob, meta: { kind: string; duration: number; envelope?: number[]; alpha?: boolean; motion?: string }) {
  await putMedia(`clip:${key}`, blob);
  await putMedia(`clipmeta:${key}`, new Blob([JSON.stringify(meta)], { type: "application/json" }));
}

export async function getClipRecord(key: string): Promise<{ blob: Blob; kind: "video" | "audio"; duration: number; envelope?: number[]; alpha?: boolean; motion?: string } | null> {
  const [blob, meta] = await Promise.all([getMedia(`clip:${key}`), getMedia(`clipmeta:${key}`)]);
  if (!blob || !meta) return null;
  try {
    return { blob, ...JSON.parse(await meta.text()) };
  } catch {
    return null;
  }
}
