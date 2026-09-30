/** Shared helpers for the Pages Functions in /functions */

export interface Env {
  AI?: Ai;
  CATALOG?: KVNamespace;
  HEYGEN_API_KEY?: string;
  /** Local testing only: point HeyGen calls at a mock server */
  HEYGEN_API_BASE?: string;
  ANTHROPIC_API_KEY?: string;
  /** Local testing only: point Claude calls at a mock server */
  ANTHROPIC_API_BASE?: string;
  APP_ACCESS_CODE?: string;
  /** Avatar renderer priority, e.g. "heygen,mock" (default: heygen, then mock) */
  AVATAR_PROVIDERS?: string;
  /** "1" enables the mock renderer (local testing) */
  AVATAR_MOCK?: string;
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

export interface HeyGenResult<T> { ok: true; status: number; data: T; raw: Record<string, unknown> }
export interface HeyGenFailure {
  ok: false;
  /** Ready-to-return JSON: { error, kind, detail } */
  response: Response;
  code: string;
  message: string;
  detail: ProviderErrorDetail;
}

/** Failure category the studio acts on: quota and rate_limit stop the batch; nothing is retried automatically */
export type ProviderErrorKind = "quota" | "rate_limit" | "auth" | "invalid" | "not_found" | "provider" | "network" | "not_configured";

/** Safe to return and log: never contains credentials, headers or tokens */
export interface ProviderErrorDetail {
  provider: string;
  /** Provider endpoint, e.g. "POST /v3/videos" (ids and query strings removed) */
  endpoint: string;
  http: number;
  code: string;
  message: string;
  kind: ProviderErrorKind;
  retryAfter?: number;
}

/** Strip anything credential-like from provider text before it's logged or shown */
export function sanitize(text: string, env: Env): string {
  let t = String(text ?? "");
  if (env.HEYGEN_API_KEY) t = t.split(env.HEYGEN_API_KEY).join("[redacted]");
  return t
    .replace(/(bearer|basic)\s+[\w.~+/=-]+/gi, "$1 [redacted]")
    .replace(/((?:x-)?api[_-]?key|token|secret|authorization|signature)(["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi, "$1$2[redacted]")
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

const endpointOf = (method: string, path: string) =>
  `${method} ${path.split("?")[0].replace(/\/(?=[\w-]*\d)[\w-]{8,}(?=\/|$)/g, "/{id}")}`;

export function errorKind(http: number, detail: string): ProviderErrorKind {
  if (http === 402 || /credit|quota|insufficient|balance|payment|billing|exceed.*limit/.test(detail)) return "quota";
  if (http === 429 || /rate.?limit|too many requests/.test(detail)) return "rate_limit";
  if (http === 401 || http === 403) return "auth";
  if (http === 404) return "not_found";
  if (http === 400 || http === 422) return "invalid";
  if (http === 0) return "network";
  return "provider";
}

/**
 * Call HeyGen's v3 API. Failures come back as a ready-to-return Response with a
 * plain-English message and a sanitized detail (HTTP status, HeyGen's code and
 * message), plus the raw code/message for callers that branch on them.
 */
export async function heygen<T>(env: Env, path: string, init: RequestInit = {}): Promise<HeyGenResult<T> | HeyGenFailure> {
  const endpoint = endpointOf(init.method ?? "GET", path);
  const failure = (http: number, code: string, message: string, text: string, status: number, retryAfter?: number): HeyGenFailure => {
    const kind = code === "not_configured" ? "not_configured" : errorKind(http, `${code} ${message}`.toLowerCase());
    const detail: ProviderErrorDetail = { provider: "heygen", endpoint, http, code: sanitize(code, env).slice(0, 80), message: sanitize(message, env), kind, retryAfter };
    // Server-side only (wrangler tail) — safe fields, never the key or headers
    console.warn(JSON.stringify({ event: "provider_error", ...detail }));
    return { ok: false, code, message, detail, response: json({ error: text, kind, detail }, status) };
  };
  if (!env.HEYGEN_API_KEY) return failure(0, "not_configured", "", "The avatar renderer isn't set up on the server yet.", 503);
  let res: Response;
  try {
    res = await fetch(`${env.HEYGEN_API_BASE || "https://api.heygen.com"}${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), "X-Api-Key": env.HEYGEN_API_KEY, Accept: "application/json" }
    });
  } catch {
    return failure(0, "network", "", "Couldn't reach the avatar provider. Try again shortly.", 502);
  }
  const body = (await res.json().catch(() => ({}))) as {
    data?: T; error?: { code?: string; message?: string } | string; code?: string | number; message?: string;
  };
  if (res.ok) return { ok: true, status: res.status, data: (body.data ?? body) as T, raw: body as Record<string, unknown> };

  // v3 errors: { error: { code, message, param } } — older shapes: { code, message } or { error: "text" }
  const err = typeof body.error === "object" && body.error ? body.error
    : { code: body.code !== undefined ? String(body.code) : undefined, message: typeof body.error === "string" ? body.error : body.message };
  const code = err.code ?? "";
  const message = err.message ?? "";
  const retryAfter = Number(res.headers.get("Retry-After")) || undefined;
  const detail = `${code} ${message}`.toLowerCase();
  const kind = errorKind(res.status, detail);
  let text = friendly("The avatar provider", res.status);
  if (kind === "quota") text = "The avatar provider account is out of credits or API balance. Nothing will be retried automatically.";
  else if (kind === "rate_limit") text = `The avatar provider is rate-limiting requests.${retryAfter ? ` Wait ${retryAfter} seconds,` : " Wait a minute,"} then retry.`;
  else if (res.status === 403) text = "The avatar provider refused access. The API key may not have permission or plan access for this feature.";
  else if (/moderation/.test(detail)) text = "The avatar provider's content rules rejected this photo or text.";
  else if (/matting|webm/.test(detail)) text = "This avatar can't have a transparent background.";
  else if (/not_ready|still processing/.test(detail)) text = "This avatar is still being created. Try again in a minute.";
  else if (/motion_prompt/.test(detail)) text = "This avatar doesn't support gesture direction.";
  else if (/face|image|photo/.test(detail) && res.status === 400) text = "The avatar provider couldn't use that photo. Use a clear, front-facing portrait of one person.";
  else if (kind === "invalid" && message) text = `The avatar provider rejected the request: ${sanitize(message, env)}`;
  return failure(res.status, code, message, text, res.status >= 500 ? 502 : res.status, retryAfter);
}

/** Plain-English message for any upstream failure — never forward raw API errors */
export function friendly(service: string, status: number): string {
  if (status === 401 || status === 403) return `${service} rejected the server's credentials. Check the API key.`;
  if (status === 402) return `${service} is out of credits.`;
  if (status === 429) return `${service} is busy. Try again in a minute.`;
  if (status >= 500) return `${service} is having trouble right now. Try again shortly.`;
  return `${service} couldn't process that request.`;
}
