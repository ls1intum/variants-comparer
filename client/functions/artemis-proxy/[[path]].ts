/*  Cloudflare Pages Function: CORS proxy for the few Artemis REST endpoints the app uses (exercise export,
    online-editor repository writes, problem statement update); everything else is rejected.
    Request shape: /artemis-proxy/<host>/api/programming/...[?query]
    Env: ALLOWED_ORIGINS (comma list, besides the own origin), ALLOWED_ARTEMIS_HOSTS (optional comma list)  */

import { corsHeaders, isValidHost, joinPath, list, relay, type Context } from '../../functions-shared/proxy';

const FORWARDED_REQUEST_HEADERS = [ 'authorization', 'content-type' ];
const EXPOSED_RESPONSE_HEADERS = [ 'content-type', 'content-length', 'filename' ];
const EXERCISE = String.raw`/api/programming/programming-exercises/\d+`;
const REPOSITORY = String.raw`(?:/api/programming/participations/\d+/repository|${EXERCISE}/test-repository)`;

/*  Exact method and path allowlist  */
const ALLOWED: Array<[ string, RegExp ]> = [
  [ 'GET', new RegExp(`^${EXERCISE}/export-instructor-exercise$`) ],
  [ 'GET', new RegExp(`^${EXERCISE}/with-template-and-solution-participation$`) ],
  [ 'PATCH', new RegExp(`^${EXERCISE}/problem-statement$`) ],
  [ 'POST', new RegExp(`^${REPOSITORY}/(?:file|commit)$`) ],
  [ 'PUT', new RegExp(`^${REPOSITORY}/files$`) ],
  [ 'DELETE', new RegExp(`^${REPOSITORY}/file$`) ],
];

const isAllowedArtemisRequest = (method: string, apiPath: string) =>
  ALLOWED.some(([ allowedMethod, pattern ]) => allowedMethod === method && pattern.test(apiPath));

export async function onRequest({ request, env, params }: Context): Promise<Response> {
  const headers = corsHeaders(request, env, [ 'GET', 'POST', 'PUT', 'PATCH', 'DELETE' ], FORWARDED_REQUEST_HEADERS, EXPOSED_RESPONSE_HEADERS);
  if (request.method === 'OPTIONS')
    return new Response(null, { status: 204, headers });

  const path = joinPath(params.path);
  const slash = path.indexOf('/');
  const host = slash > 0 ? path.slice(0, slash) : '';
  const apiPath = slash > 0 ? path.slice(slash) : '';
  const allowedHosts = list(env.ALLOWED_ARTEMIS_HOSTS);
  if (!isValidHost(host) || !isAllowedArtemisRequest(request.method, apiPath)
    || (allowedHosts.length > 0 && !allowedHosts.includes(host)))
    return new Response('Forbidden: only the Artemis endpoints used by this app are proxied', { status: 403, headers });

  const upstreamHeaders = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value)
      upstreamHeaders.set(name, value);
  }
  const upstream = await fetch(`https://${host}${apiPath}${new URL(request.url).search}`, {
    method: request.method,
    headers: upstreamHeaders,
    body: request.method === 'GET' ? undefined : await request.arrayBuffer(),
    redirect: 'manual',
  });
  return relay(upstream, headers, EXPOSED_RESPONSE_HEADERS);
}
