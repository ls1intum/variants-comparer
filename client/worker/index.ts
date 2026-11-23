/*  Standalone Cloudflare Worker serving the same proxies as the Pages Functions (/git-proxy, /artemis-proxy),
    for deployments where the app is not hosted on Cloudflare Pages. Set ALLOWED_ORIGINS to the app origin(s).  */

import { onRequest as artemisProxy } from '../functions/artemis-proxy/[[path]]';
import { onRequest as gitProxy } from '../functions/git-proxy/[[path]]';
import type { Context, Env } from '../functions-shared/proxy';

const ROUTES: Array<[ string, (context: Context) => Promise<Response> ]> = [
  [ '/git-proxy/', gitProxy ],
  [ '/artemis-proxy/', artemisProxy ],
];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    for (const [ prefix, handler ] of ROUTES)
      if (pathname.startsWith(prefix))
        return handler({ request, env, params: { path: pathname.slice(prefix.length).split('/').map(decodeURIComponent) } });
    return new Response('Not found: use /git-proxy/<host>/... or /artemis-proxy/<host>/...', { status: 404 });
  },
};
