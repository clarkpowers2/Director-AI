/** Poll a D-ID talk until status is "done"; result_url is the avatar video. */
import { didFetch, json, type Env } from "../../../../server/shared";

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const id = String(params.id ?? "");
  if (!/^[\w-]{1,100}$/.test(id)) return json({ error: "Invalid talk id." }, 400);
  return didFetch(env, `/talks/${id}`);
};
