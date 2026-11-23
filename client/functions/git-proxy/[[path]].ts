/*  Cloudflare Pages Function: minimal CORS proxy for Git smart-HTTP (clone/fetch/push).
    Request shape (isomorphic-git corsProxy): /git-proxy/<host>/<repo-path>/(info/refs|git-upload-pack|git-receive-pack)
    Env: ALLOWED_ORIGINS (comma list, besides the own origin), ALLOWED_GIT_HOSTS (optional comma list)  */

import { corsHeaders, isValidHost, joinPath, list, relay, type Context } from '../../functions-shared/proxy';

const FORWARDED_REQUEST_HEADERS = [ 'accept', 'authorization', 'content-type', 'git-protocol' ];
const EXPOSED_RESPONSE_HEADERS = [ 'content-type', 'content-length', 'cache-control', 'etag', 'x-redirected-url' ];

const GIT_SERVICES = [ 'git-upload-pack', 'git-receive-pack' ];

/*  Only allow the smart-HTTP endpoints of fetch and push, so this is no general-purpose open proxy  */
function isGitRequest(request: Request, path: string, search: URLSearchParams) {
  if (request.method === 'GET')
    return path.endsWith('/info/refs') && GIT_SERVICES.includes(search.get('service') ?? '');
  if (request.method === 'POST')
    return GIT_SERVICES.some((service) => path.endsWith(`/${service}`)
      && request.headers.get('content-type') === `application/x-${service}-request`);
  return false;
}

export async function onRequest({ request, env, params }: Context): Promise<Response> {
  const headers = corsHeaders(request, env, [ 'GET', 'POST' ], FORWARDED_REQUEST_HEADERS, EXPOSED_RESPONSE_HEADERS);
  if (request.method === 'OPTIONS')
    return new Response(null, { status: 204, headers });

  const path = joinPath(params.path);
  const { search, searchParams } = new URL(request.url);
  const host = path.split('/')[0] ?? '';
  const allowedHosts = list(env.ALLOWED_GIT_HOSTS);
  if (!isValidHost(host) || !isGitRequest(request, path, searchParams)
    || (allowedHosts.length > 0 && !allowedHosts.includes(host)))
    return new Response('Forbidden: only Git fetch/push requests are proxied', { status: 403, headers });

  const upstreamHeaders = new Headers({ 'user-agent': 'git/variants-comparer-proxy' });
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value)
      upstreamHeaders.set(name, value);
  }

  const upstream = await fetch(`https://${path}${search}`, {
    method: request.method,
    headers: upstreamHeaders,
    body: request.method === 'POST' ? await request.arrayBuffer() : undefined,
    redirect: 'follow',
  });
  if (upstream.redirected)
    headers.set('x-redirected-url', upstream.url);
  return relay(upstream, headers, EXPOSED_RESPONSE_HEADERS);
}
