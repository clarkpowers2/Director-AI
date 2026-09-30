/** GET /api/avatar/providers — configured avatar renderers in priority order (ids, labels, capabilities; never keys) */
import { json, type Env } from "../../../server/shared";
import { providers } from "../../../server/avatar/service";

export const onRequestGet: PagesFunction<Env> = ({ env }) =>
  json({ providers: providers(env).map(p => ({ id: p.id, label: p.label, capabilities: p.capabilities })) });
