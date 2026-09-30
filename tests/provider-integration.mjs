/**
 * Real-provider integration tests against a FAKE HeyGen API — never calls the real one.
 *   npm run build && npm run test:provider
 * Starts a mock HeyGen server, runs the Pages Functions (wrangler pages dev) pointed
 * at it via HEYGEN_API_BASE, and checks create/poll/download for every response class,
 * the outgoing payload, error mapping, credential redaction and "no automatic retries".
 */
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";

const MOCK_PORT = 8791, APP_PORT = 8792;
const KEY = "test-key-SECRET-9f8e7d6c5b4a";
const CODE = "provider-test-code";
const APP = `http://127.0.0.1:${APP_PORT}`;

// ---------- fake HeyGen ----------
const calls = [];
const err = (res, status, code, message, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify({ error: { code, message, param: null } }));
};
const ok = (res, data) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ data }));
};
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", c => (body += c));
  req.on("end", () => {
    const url = new URL(req.url, "http://x");
    const json = body ? JSON.parse(body) : null;
    calls.push({ method: req.method, path: url.pathname, key: req.headers["x-api-key"], body: json });
    if (url.pathname.startsWith("/files/")) assert.equal(req.headers["x-api-key"], undefined, "key must not go to the file host");
    else if (req.headers["x-api-key"] !== KEY) return err(res, 401, "unauthorized", "Invalid API key");
    if (req.method === "POST" && url.pathname === "/v3/videos") {
      const a = json.avatar_id;
      if (a === "s400") return err(res, 400, "invalid_parameter", `Invalid avatar_id. x-api-key: ${KEY} Authorization: Bearer abc.def`);
      if (a === "s401") return err(res, 401, "unauthorized", "API key is invalid or expired");
      if (a === "s402") return err(res, 402, "insufficient_credit", "Insufficient API balance");
      if (a === "s403") return err(res, 403, "forbidden", "Your plan does not include API access");
      if (a === "s422") return err(res, 422, "voice_not_found", "voice_id is not compatible with this avatar");
      if (a === "s429") return err(res, 429, "rate_limited", "Too many requests", { "Retry-After": "30" });
      if (a === "s500") return err(res, 500, "internal_error", "Something went wrong");
      if (a === "s_iii" && json.engine?.type !== "avatar_iii") return err(res, 400, "invalid_parameter", "This video avatar does not support Avatar IV video generation.");
      if (a === "s_matting" && json.output_format === "webm") return err(res, 400, "avatar_not_matting", "Avatar does not support webm output");
      const id = a === "s_fail" ? "v_fail01" : a === "s_proc" ? "v_proc01" : "v_done01";
      return ok(res, { video_id: id, status: "waiting", output_format: json.output_format });
    }
    const look = url.pathname.match(/^\/v3\/avatars\/looks\/([\w-]+)$/);
    if (req.method === "GET" && look) {
      if (look[1] === "s_gone") return err(res, 404, "not_found", "Avatar not found");
      return ok(res, { id: look[1], name: look[1], avatar_type: "studio_avatar", status: "completed", supported_api_engines: look[1] === "s_iii" ? ["avatar_iii"] : ["avatar_iv", "avatar_iii"] });
    }
    const m = url.pathname.match(/^\/v3\/videos\/([\w-]+)$/);
    if (req.method === "GET" && m) {
      if (m[1] === "v_proc01") return ok(res, { id: m[1], status: "processing", video_url: null, duration: null });
      if (m[1] === "v_fail01") return ok(res, { id: m[1], status: "failed", failure_code: "MOVIO_PAYMENT_INSUFFICIENT_CREDIT", failure_message: `Render failed; token=${KEY}` });
      if (m[1] === "v_pend01") return ok(res, { id: m[1], status: "pending" });
      if (m[1] === "v_rate01") return err(res, 429, "rate_limited", "Too many requests", { "Retry-After": "12" });
      return ok(res, { id: m[1], status: "completed", video_url: `http://127.0.0.1:${MOCK_PORT}/files/${m[1]}.mp4?X-Amz-Signature=zzz`, duration: 9.4 });
    }
    if (req.method === "GET" && url.pathname.startsWith("/files/")) {
      res.writeHead(200, { "Content-Type": "video/mp4" });
      return res.end(Buffer.alloc(2048, 7));
    }
    err(res, 404, "not_found", "Not found");
  });
});

// ---------- app under test ----------
let logs = "";
function startApp() {
  const p = spawn("npx", ["wrangler", "pages", "dev", "dist", "--port", String(APP_PORT), "--ip", "127.0.0.1",
    "--binding", `HEYGEN_API_KEY=${KEY}`, "--binding", `HEYGEN_API_BASE=http://127.0.0.1:${MOCK_PORT}`,
    "--binding", "AVATAR_PROVIDERS=heygen", "--binding", `APP_ACCESS_CODE=${CODE}`], { stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", d => (logs += d));
  p.stderr.on("data", d => (logs += d));
  return p;
}
async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${APP}/api/status`)).ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error("app didn't start");
}
const api = async (path, init = {}) => {
  const res = await fetch(`${APP}${path}`, { ...init, headers: { "X-DirectorAI-Code": CODE, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const text = await res.text();
  assert.ok(!text.includes(KEY), `credential leaked in response to ${path}`);
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {}
  return { status: res.status, body, text, headers: res.headers };
};
const render = (avatarId, extra = {}) => api("/api/avatar/render", { method: "POST", body: JSON.stringify({ avatarId, voiceId: "dbb793080e5b4733bf2cba6a66a4909d", text: "Welcome to Haven Memory OS.", test: true, ...extra }) });
const posts = avatar => calls.filter(c => c.method === "POST" && c.body?.avatar_id === avatar).length;

// ---------- checks ----------
const checks = [];
const check = (name, fn) => checks.push([name, fn]);

check("200 created: correct payload, header, job id", async () => {
  const r = await render("s200");
  assert.equal(r.status, 200);
  assert.equal(r.body.jobId, "heygen.v_done01");
  assert.equal(r.body.provider, "heygen");
  assert.equal(r.body.providerJobId, "v_done01");
  assert.match(r.body.requestId, /^dr-/);
  const c = calls.find(x => x.method === "POST" && x.body.avatar_id === "s200");
  assert.equal(c.key, KEY, "X-Api-Key header sent");
  assert.deepEqual(
    { type: c.body.type, voice_id: c.body.voice_id, script: c.body.script, resolution: c.body.resolution, aspect_ratio: c.body.aspect_ratio, output_format: c.body.output_format },
    { type: "avatar", voice_id: "dbb793080e5b4733bf2cba6a66a4909d", script: "Welcome to Haven Memory OS.", resolution: "720p", aspect_ratio: "16:9", output_format: "webm" }
  );
  assert.equal(c.body.engine, undefined);
  assert.equal(c.body.motion_prompt, undefined);
});
check("standard quality asks for 1080p", async () => {
  await render("s200", { test: false, quality: "standard" });
  assert.equal(calls.filter(x => x.method === "POST" && x.body.avatar_id === "s200").at(-1).body.resolution, "1080p");
});
check("processing / pending map to rendering / queued", async () => {
  assert.equal((await api("/api/avatar/render/heygen.v_proc01")).body.status, "rendering");
  assert.equal((await api("/api/avatar/render/heygen.v_pend01")).body.status, "queued");
});
check("completed: duration + job-scoped media URL, clip downloads", async () => {
  const r = await api("/api/avatar/render/heygen.v_done01");
  assert.equal(r.body.status, "completed");
  assert.equal(r.body.duration, 9.4);
  assert.equal(r.body.mediaUrl, "/api/avatar/render/heygen.v_done01/media");
  assert.ok(!r.text.includes("X-Amz-Signature"), "presigned URL not exposed");
  const media = await fetch(`${APP}${r.body.mediaUrl}`, { headers: { "X-DirectorAI-Code": CODE } });
  assert.equal(media.status, 200, await media.clone().text());
  assert.equal(media.headers.get("content-type"), "video/mp4");
  assert.equal((await media.arrayBuffer()).byteLength, 2048);
});
check("failed render: provider failure code/message surfaced, sanitized", async () => {
  const r = await api("/api/avatar/render/heygen.v_fail01");
  assert.equal(r.body.status, "failed");
  assert.equal(r.body.detail.code, "MOVIO_PAYMENT_INSUFFICIENT_CREDIT");
  assert.equal(r.body.detail.kind, "quota");
  assert.equal(r.body.detail.jobId, "heygen.v_fail01");
  assert.match(r.body.detail.message, /token=\[redacted\]/);
});
const createCases = [
  ["s400", 400, "invalid", "invalid_parameter"],
  ["s401", 401, "auth", "unauthorized"],
  ["s402", 402, "quota", "insufficient_credit"],
  ["s403", 403, "auth", "forbidden"],
  ["s422", 422, "invalid", "voice_not_found"],
  ["s429", 429, "rate_limit", "rate_limited"],
  ["s500", 502, "provider", "internal_error"]
];
for (const [avatar, status, kind, code] of createCases) {
  check(`create ${avatar.slice(1)} → HTTP ${status}, kind ${kind}, one provider call`, async () => {
    const r = await render(avatar);
    assert.equal(r.status, status);
    assert.equal(r.body.kind, kind);
    assert.equal(r.body.detail.code, code);
    assert.equal(r.body.detail.http, Number(avatar.slice(1)));
    assert.equal(r.body.detail.endpoint, "POST /v3/videos");
    assert.match(r.body.detail.requestId, /^dr-/);
    assert.ok(r.body.error.length > 10);
    assert.equal(posts(avatar), 1, "no automatic retry");
  });
}
check("400 message has credentials redacted", async () => {
  const r = await render("s400");
  assert.match(r.body.detail.message, /x-api-key: \[redacted\]/i);
  assert.ok(!r.body.detail.message.includes("abc.def"), "bearer token redacted");
});
check("402 wording says nothing is retried", async () => {
  assert.match((await render("s402")).body.error, /Nothing will be retried/);
});
check("429 carries Retry-After", async () => {
  const r = await render("s429");
  assert.equal(r.body.detail.retryAfter, 30);
  assert.match(r.body.error, /30 seconds/);
});
check("429 while polling reports rate_limit (job state kept)", async () => {
  const r = await api("/api/avatar/render/heygen.v_rate01");
  assert.equal(r.status, 429);
  assert.equal(r.body.kind, "rate_limit");
  assert.equal(r.body.detail.jobId, "heygen.v_rate01");
});
check("transparent fallback: webm refused → one mp4 retry (validation only, not a render)", async () => {
  const r = await render("s_matting");
  assert.equal(r.status, 200);
  assert.equal(r.body.alpha, false);
  assert.deepEqual(calls.filter(x => x.body?.avatar_id === "s_matting").map(x => x.body.output_format), ["webm", "mp4"]);
});
check("avatar_iii-only avatar: engine avatar_iii sent, one create call", async () => {
  const r = await render("s_iii");
  assert.equal(r.status, 200, r.text);
  const c = calls.filter(x => x.method === "POST" && x.body.avatar_id === "s_iii");
  assert.equal(c.length, 1);
  assert.deepEqual(c[0].body.engine, { type: "avatar_iii" });
});
check("avatar unknown to the API → clear 400, no create call", async () => {
  const r = await render("s_gone");
  assert.equal(r.status, 400);
  assert.match(r.body.error, /isn't available through the provider's API/);
  assert.equal(posts("s_gone"), 0);
});
check("mock provider can't be selected when not enabled", async () => {
  const r = await render("s200", { provider: "mock" });
  assert.equal(r.status, 400);
  assert.equal((await api("/api/avatar/providers")).body.providers.map(p => p.id).join(), "heygen");
});
check("diagnostics: read-only, no credential", async () => {
  const before = calls.filter(c => c.method === "POST").length;
  const r = await api("/api/avatar/diagnostics");
  assert.equal(r.body.credentialConfigured, true);
  assert.equal(r.body.autoSelects, "heygen");
  assert.equal(calls.filter(c => c.method === "POST").length, before, "diagnostics must not create renders");
});
check("server logs never contain the credential", async () => {
  await new Promise(r => setTimeout(r, 500));
  assert.ok(logs.includes("provider_error"), "diagnostic lines are logged");
  assert.ok(!logs.includes(KEY), "credential in logs");
});

// ---------- run ----------
await new Promise(r => mock.listen(MOCK_PORT, "127.0.0.1", r));
const app = startApp();
let failed = 0;
try {
  await waitUp();
  for (const [name, fn] of checks) {
    try {
      await fn();
      console.log(`✓ ${name}`);
    } catch (e) {
      failed++;
      console.log(`✗ ${name}\n  ${e.message.split("\n").join("\n  ")}`);
    }
  }
} finally {
  try {
    process.kill(-app.pid);
  } catch {}
  mock.close();
}
console.log(`\n${checks.length - failed}/${checks.length} provider checks passed`);
process.exit(failed ? 1 : 0);
