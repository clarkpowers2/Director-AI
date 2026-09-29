/** Which server features are configured — never returns the secrets themselves. */
import { json, type Env } from "../../server/shared";

export const onRequestGet: PagesFunction<Env> = ({ env }) =>
  json({ did: !!env.DID_API_KEY, anthropic: !!env.ANTHROPIC_API_KEY, tts: !!env.AI, accessRequired: true });
