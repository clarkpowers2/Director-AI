/** Shared helpers for the Pages Functions in /functions */

export interface Env {
  AI?: Ai;
  DID_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  APP_ACCESS_CODE?: string;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

/** Constant-time string comparison, so the access code can't be guessed by timing */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const DID_BASE = "https://api.d-id.com";

export async function didFetch(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  if (!env.DID_API_KEY) return json({ error: "D-ID is not configured on the server (DID_API_KEY missing)." }, 503);
  const res = await fetch(`${DID_BASE}${path}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Basic ${env.DID_API_KEY}`, Accept: "application/json" }
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: text.slice(0, 300) };
  }
  if (!res.ok) {
    const b = body as { description?: string; message?: string; kind?: string };
    const detail = `${b.kind ?? ""} ${b.description ?? b.message ?? ""}`.toLowerCase();
    let message = friendly("D-ID", res.status);
    if (/face/.test(detail)) message = "D-ID couldn't find a clear face in that photo. Use a front-facing photo of one person.";
    else if (/file name|filename|format|image/.test(detail) && res.status === 400) message = "D-ID couldn't read that photo. Try a JPG or PNG.";
    else if (/credit|insufficient/.test(detail)) message = "Your D-ID account is out of credits.";
    else if (/moderat|celebrity|inappropriate/.test(detail)) message = "D-ID's content rules rejected this photo or text.";
    return json({ error: message }, res.status >= 500 ? 502 : res.status);
  }
  return json(body);
}

/** Plain-English message for any upstream failure — never forward raw API errors */
export function friendly(service: string, status: number): string {
  if (status === 401 || status === 403) return `${service} rejected the server's credentials. Check the API key.`;
  if (status === 402) return `${service} is out of credits.`;
  if (status === 429) return `${service} is busy. Try again in a minute.`;
  if (status >= 500) return `${service} is having trouble right now. Try again shortly.`;
  return `${service} couldn't process that request.`;
}
