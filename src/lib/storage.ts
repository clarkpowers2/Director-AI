/**
 * Persistence: project settings autosave to localStorage; media (videos, music,
 * photos, generated avatar clips) goes to IndexedDB, which handles large files.
 * Every call fails soft — private windows or blocked storage just mean nothing persists.
 */
import { hydrateProject, type Project } from "./project.ts";

const PROJECT_KEY = "directorai:project";
const DB_NAME = "directorai";
const STORE = "media";

export function loadProject(): Project {
  try {
    const raw = localStorage.getItem(PROJECT_KEY);
    return hydrateProject(raw ? JSON.parse(raw) : null);
  } catch {
    return hydrateProject(null);
  }
}

export function saveProject(p: Project): boolean {
  try {
    localStorage.setItem(PROJECT_KEY, JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
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
