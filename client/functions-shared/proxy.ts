/*  Shared helpers of the Cloudflare Pages proxy functions (kept outside functions/ so it is no route)  */

export type Env = { ALLOWED_ORIGINS?: string; ALLOWED_GIT_HOSTS?: string; ALLOWED_ARTEMIS_HOSTS?: string };
export type Context = { request: Request; env: Env; params: { path?: string | string[] } };

export const list = (value?: string) => (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export const isValidHost = (host: string) => /^[a-z0-9.-]+\.[a-z0-9-]+(:\d+)?$/i.test(host);

export const joinPath = (path?: string | string[]) => (Array.isArray(path) ? path.join('/') : (path ?? ''));

/*  CORS headers for the own origin and ALLOWED_ORIGINS only  */
export function corsHeaders(request: Request, env: Env, allowMethods: string[], allowHeaders: string[], exposeHeaders: string[]): Headers {
  const headers = new Headers({ 'vary': 'Origin' });
  const origin = request.headers.get('origin');
  const allowed = [ new URL(request.url).origin, ...list(env.ALLOWED_ORIGINS) ];
  if (origin && allowed.includes(origin)) {
    headers.set('access-control-allow-origin', origin);
    headers.set('access-control-allow-methods', [ ...allowMethods, 'OPTIONS' ].join(', '));
    headers.set('access-control-allow-headers', allowHeaders.join(', '));
    headers.set('access-control-expose-headers', exposeHeaders.join(', '));
    headers.set('access-control-max-age', '86400');
  }
  return headers;
}

/*  Copy the listed upstream response headers and stream the body back  */
export function relay(upstream: Response, headers: Headers, exposeHeaders: string[]): Response {
  for (const name of exposeHeaders) {
    const value = upstream.headers.get(name);
    if (value)
      headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
}
