/**
 * Daily cache of HeyGen's full avatar and voice catalogs in KV.
 *
 * HeyGen lists ~10,000 avatar looks across ~200 pages, more than one Function call
 * may fetch (free plan: 50 subrequests). So the catalog is built in steps of
 * PAGES_PER_STEP pages, with progress saved in KV. Callers get the finished catalog;
 * while it's missing they get build progress, and once it's older than a day a
 * rebuild runs in the background while the old copy keeps being served.
 */
import { heygen, type Env } from "./shared";

const PAGES_PER_STEP = 40;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface CatalogSpec<Raw, Item> {
  kind: "looks" | "voices";
  /** HeyGen list path without paging params, e.g. "/v3/avatars/looks?ownership=public" */
  path: string;
  pageSize: number;
  map: (raw: Raw) => Item;
  id: (item: Item) => string;
}

interface Catalog<Item> { built: number; items: Item[] }
interface Build<Item> { started: number; cursor: string | null; pages: number; items: Item[] }

export type CatalogState<Item> =
  | { ready: true; items: Item[]; built: number; refreshing: boolean }
  | { ready: false; pages: number; items: number; error?: string };

const keys = (kind: string) => ({ done: `catalog:${kind}`, build: `catalog:${kind}:build` });

/** Fetch up to PAGES_PER_STEP more pages; finalize the catalog when HeyGen runs out */
async function step<Raw, Item>(env: Env, spec: CatalogSpec<Raw, Item>): Promise<{ finished: boolean; pages: number; items: number; error?: string }> {
  const kv = env.CATALOG!;
  const k = keys(spec.kind);
  let build = (await kv.get<Build<Item>>(k.build, "json")) ?? { started: Date.now(), cursor: null, pages: 0, items: [] };
  // an abandoned build (e.g. HeyGen errors) restarts after an hour
  if (Date.now() - build.started > 60 * 60 * 1000) build = { started: Date.now(), cursor: null, pages: 0, items: [] };

  for (let i = 0; i < PAGES_PER_STEP; i++) {
    const sep = spec.path.includes("?") ? "&" : "?";
    const res = await heygen<Raw[]>(env, `${spec.path}${sep}limit=${spec.pageSize}${build.cursor ? `&token=${encodeURIComponent(build.cursor)}` : ""}`);
    if (!res.ok) {
      await kv.put(k.build, JSON.stringify(build));
      return { finished: false, pages: build.pages, items: build.items.length, error: "The avatar library didn't answer while indexing. It will retry." };
    }
    build.items.push(...(Array.isArray(res.data) ? res.data : []).map(spec.map));
    build.pages++;
    build.cursor = res.raw.has_more ? (res.raw.next_token as string | null) ?? null : null;
    if (!build.cursor) {
      const seen = new Set<string>();
      const items = build.items.filter(it => (seen.has(spec.id(it)) ? false : (seen.add(spec.id(it)), true)));
      await kv.put(k.done, JSON.stringify({ built: Date.now(), items } satisfies Catalog<Item>));
      await kv.delete(k.build);
      return { finished: true, pages: build.pages, items: items.length };
    }
  }
  await kv.put(k.build, JSON.stringify(build));
  return { finished: false, pages: build.pages, items: build.items.length };
}

export async function getCatalog<Raw, Item>(
  env: Env, spec: CatalogSpec<Raw, Item>, waitUntil: (p: Promise<unknown>) => void
): Promise<CatalogState<Item>> {
  if (!env.CATALOG) return { ready: false, pages: 0, items: 0, error: "The catalog cache isn't configured on the server." };
  const cached = await env.CATALOG.get<Catalog<Item>>(keys(spec.kind).done, { type: "json", cacheTtl: 300 });
  if (cached) {
    const stale = Date.now() - cached.built > MAX_AGE_MS;
    if (stale) waitUntil(step(env, spec).catch(() => {}));
    return { ready: true, items: cached.items, built: cached.built, refreshing: stale };
  }
  // First build: do one step now so the caller sees progress
  const s = await step(env, spec);
  if (s.finished) {
    const fresh = await env.CATALOG.get<Catalog<Item>>(keys(spec.kind).done, "json");
    if (fresh) return { ready: true, items: fresh.items, built: fresh.built, refreshing: false };
  }
  return { ready: false, pages: s.pages, items: s.items, error: s.error };
}
