/** Which server features are configured — never returns the secrets themselves. */
import { json, type Env } from "../../server/shared";
import { providers } from "../../server/avatar/service";

export const onRequestGet: PagesFunction<Env> = ({ env }) =>
  json({ heygen: !!env.HEYGEN_API_KEY, avatar: providers(env).length > 0, anthropic: !!env.ANTHROPIC_API_KEY, tts: !!env.AI, accessRequired: true });
