/** GET /api/avatar/render/:jobId/media — the finished clip, fetched server-side from the provider by job id */
import type { Env } from "../../../../../server/shared";
import { resolveJob } from "../../../../../server/avatar/service";
import { failure } from "../[job]";

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const jobId = String(params.job ?? "");
  try {
    const { provider, providerJobId } = resolveJob(env, jobId);
    return await provider.fetchRenderedMedia(env, providerJobId);
  } catch (err) {
    return failure(err, jobId);
  }
};
