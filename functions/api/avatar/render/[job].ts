/**
 * GET    /api/avatar/render/:jobId — normalized status of one render
 * DELETE /api/avatar/render/:jobId — ask the provider to stop it
 * Logs safe diagnostics only (job ids, provider, status, sanitized error) — never keys or headers.
 */
import { json, type Env } from "../../../../server/shared";
import { resolveJob } from "../../../../server/avatar/service";
import { ProviderError } from "../../../../server/avatar/provider";

export function failure(err: unknown, jobId: string): Response {
  if (err instanceof ProviderError) {
    return json({ error: err.message, kind: err.detail?.kind ?? null, detail: err.detail ? { ...err.detail, jobId } : { jobId } }, err.status);
  }
  return json({ error: "Couldn't reach the avatar renderer. Try again shortly.", kind: "network", detail: { jobId } }, 502);
}

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const jobId = String(params.job ?? "");
  try {
    const { provider, providerJobId } = resolveJob(env, jobId);
    const st = await provider.getRenderStatus(env, providerJobId);
    if (st.status === "failed" || st.status === "completed") {
      console.log(JSON.stringify({ event: "render_status", jobId, provider: provider.id, providerJobId, status: st.status, duration: st.duration, code: st.detail?.code, message: st.detail?.message }));
    }
    return json({
      ...st,
      jobId,
      providerJobId,
      mediaUrl: st.status === "completed" && st.mediaUrl ? `/api/avatar/render/${encodeURIComponent(jobId)}/media` : null,
      detail: st.detail ? { ...st.detail, jobId, providerJobId } : null
    });
  } catch (err) {
    return failure(err, jobId);
  }
};

export const onRequestDelete: PagesFunction<Env> = async ({ params, env }) => {
  const jobId = String(params.job ?? "");
  try {
    const { provider, providerJobId } = resolveJob(env, jobId);
    const stopped = await provider.cancelRender(env, providerJobId);
    console.log(JSON.stringify({ event: "render_cancel", jobId, provider: provider.id, providerJobId, stopped }));
    return json({
      cancelled: stopped,
      note: stopped ? null : "The renderer can't stop a render once it has started, so it may still use credits. DirectorAI stopped waiting for it."
    });
  } catch (err) {
    return failure(err, jobId);
  }
};
