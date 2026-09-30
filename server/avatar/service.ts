/**
 * AvatarService — the one place that knows which renderers exist. Picks the
 * provider (explicit choice, else the first configured one in AVATAR_PROVIDERS
 * priority order) and namespaces job ids as "<provider>.<provider job id>".
 *
 * It never falls back to another provider on its own: a failed paid render is
 * reported, and the studio asks the user before trying a different provider.
 */
import type { Env } from "../shared";
import { HeyGenProvider } from "./heygen";
import { MockAvatarProvider } from "./mock";
import { ProviderError, type AvatarProvider } from "./provider";

const ALL: AvatarProvider[] = [HeyGenProvider, MockAvatarProvider];
const DEFAULT_PRIORITY = ["heygen", "mock"];

/** Configured providers, highest priority first */
export function providers(env: Env): AvatarProvider[] {
  const order = (env.AVATAR_PROVIDERS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  const priority = order.length ? order : DEFAULT_PRIORITY;
  return priority
    .map(id => ALL.find(p => p.id === id))
    .filter((p): p is AvatarProvider => !!p && p.configured(env));
}

/** "auto" (or nothing) = highest-priority configured provider */
export function pickProvider(env: Env, id?: string | null): AvatarProvider {
  const list = providers(env);
  if (!list.length) throw new ProviderError("No avatar renderer is set up on the server yet.", 503);
  if (!id || id === "auto") return list[0];
  const p = list.find(x => x.id === id);
  if (!p) throw new ProviderError("That avatar renderer isn't available on this server.", 400);
  return p;
}

export const jobId = (provider: AvatarProvider, providerJobId: string) => `${provider.id}.${providerJobId}`;

/** Split a studio job id back into its provider and the provider's own id */
export function resolveJob(env: Env, id: string): { provider: AvatarProvider; providerJobId: string } {
  const m = id.match(/^([a-z]{2,20})\.([\w-]{1,120})$/);
  if (!m) throw new ProviderError("Invalid render id.", 400);
  return { provider: pickProvider(env, m[1]), providerJobId: m[2] };
}
