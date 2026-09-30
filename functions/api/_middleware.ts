/** Every /api route except /api/status requires the studio access code. */
import { json, safeEqual, type Env } from "../../server/shared";

export const onRequest: PagesFunction<Env> = async ({ request, env, next }) => {
  const url = new URL(request.url);
  if (url.pathname === "/api/status") return next();

  if (!env.APP_ACCESS_CODE) {
    return json({ error: "Server not configured: APP_ACCESS_CODE secret is missing." }, 503);
  }
  const code = request.headers.get("X-DirectorAI-Code") ?? "";
  // DIAG_ACCESS_CODE: optional, temporary second code for developer diagnostics — delete the secret when done
  const diag = !!env.DIAG_ACCESS_CODE && env.DIAG_ACCESS_CODE.length >= 24 && safeEqual(code, env.DIAG_ACCESS_CODE);
  if (!safeEqual(code, env.APP_ACCESS_CODE) && !diag) {
    return json({ error: "Enter your studio access code in Settings (gear icon, top right)." }, 401);
  }
  return next();
};
