import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest as artemisProxy } from '../functions/artemis-proxy/[[path]]';
import { onRequest as gitProxy } from '../functions/git-proxy/[[path]]';

const upstream = vi.fn(async () => new Response('ok', { status: 200 }));
vi.stubGlobal('fetch', upstream);
afterEach(() => upstream.mockClear());

async function call(handler: typeof gitProxy, prefix: string, method: string, target: string, contentType?: string) {
  const url = new URL(`https://app.test/${prefix}/${target}`);
  const request = new Request(url, {
    method,
    headers: { origin: 'https://app.test', ...(contentType ? { 'content-type': contentType } : {}) },
    body: method === 'GET' || method === 'DELETE' ? undefined : 'body',
  });
  const response = await handler({ request, env: {}, params: { path: url.pathname.slice(prefix.length + 2).split('/') } });
  return { status: response.status, upstreamUrl: (upstream.mock.calls.at(-1) as unknown[] | undefined)?.[0] };
}

describe('git proxy', () => {
  const git = (method: string, target: string, contentType?: string) => call(gitProxy, 'git-proxy', method, target, contentType);

  it('forwards fetch and push requests', async () => {
    expect((await git('GET', 'github.com/o/r.git/info/refs?service=git-upload-pack')).status).toBe(200);
    expect((await git('GET', 'github.com/o/r.git/info/refs?service=git-receive-pack')).upstreamUrl)
      .toBe('https://github.com/o/r.git/info/refs?service=git-receive-pack');
    expect((await git('POST', 'github.com/o/r.git/git-receive-pack', 'application/x-git-receive-pack-request')).status).toBe(200);
    expect((await git('POST', 'github.com/o/r.git/git-upload-pack', 'application/x-git-upload-pack-request')).status).toBe(200);
  });

  it('rejects anything else', async () => {
    expect((await git('GET', 'github.com/o/r.git/info/refs?service=other')).status).toBe(403);
    expect((await git('POST', 'github.com/o/r.git/git-receive-pack', 'application/x-git-upload-pack-request')).status).toBe(403);
    expect((await git('GET', 'github.com/o/r.git/HEAD')).status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe('artemis proxy', () => {
  const artemis = (method: string, target: string) => call(artemisProxy, 'artemis-proxy', method, `artemis.test${target}`, 'text/plain');
  const exercise = '/api/programming/programming-exercises/7';
  const participation = '/api/programming/participations/9/repository';

  it('forwards the endpoints used by the app, with query', async () => {
    expect((await artemis('GET', `${exercise}/export-instructor-exercise`)).status).toBe(200);
    expect((await artemis('GET', `${exercise}/with-template-and-solution-participation?withSubmissionResults=false`)).upstreamUrl)
      .toBe(`https://artemis.test${exercise}/with-template-and-solution-participation?withSubmissionResults=false`);
    expect((await artemis('PATCH', `${exercise}/problem-statement`)).status).toBe(200);
    expect((await artemis('POST', `${participation}/file?file=src%2FA.java`)).status).toBe(200);
    expect((await artemis('PUT', `${participation}/files?commit=false`)).status).toBe(200);
    expect((await artemis('DELETE', `${exercise}/test-repository/file?file=a`)).status).toBe(200);
    expect((await artemis('POST', `${exercise}/test-repository/commit`)).status).toBe(200);
  });

  it('rejects other methods and paths', async () => {
    expect((await artemis('DELETE', `${exercise}`)).status).toBe(403);
    expect((await artemis('PUT', `${exercise}/problem-statement`)).status).toBe(403);
    expect((await artemis('GET', '/api/core/account')).status).toBe(403);
    expect((await artemis('POST', `${participation}/files`)).status).toBe(403);
    expect((await artemis('POST', `${participation}/reset`)).status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });
});
