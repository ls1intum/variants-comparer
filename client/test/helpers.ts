import { execFileSync, spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

/*  System Git by absolute path, ignoring the user's config (e.g. commit signing)  */
const GIT = '/usr/bin/git';
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' };

export const gitCli = (cwd: string, ...args: string[]) =>
  execFileSync(GIT, [ '-c', 'user.name=Remote', '-c', 'user.email=remote@test', '-c', 'commit.gpgsign=false', ...args ], { cwd, encoding: 'utf8', env: GIT_ENV }).trim();

/*  Smart-HTTP Git server (git http-backend as CGI) serving the bare repos below projectRoot, push enabled  */
export async function startGitServer(projectRoot: string): Promise<{ server: Server; url: string }> {
  const backend = path.join(execFileSync(GIT, [ '--exec-path' ], { encoding: 'utf8', env: GIT_ENV }).trim(), 'git-http-backend');
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const cgi = spawn(backend, [], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: projectRoot,
        GIT_HTTP_EXPORT_ALL: '1',
        REQUEST_METHOD: req.method ?? 'GET',
        PATH_INFO: url.pathname,
        QUERY_STRING: url.search.slice(1),
        CONTENT_TYPE: req.headers['content-type'] ?? '',
        REMOTE_USER: 'tester',
        REMOTE_ADDR: '127.0.0.1',
      },
    });
    req.pipe(cgi.stdin);
    const chunks: Buffer[] = [];
    cgi.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    cgi.on('close', () => {
      const output = Buffer.concat(chunks);
      const split = output.indexOf('\r\n\r\n');
      const head = output.subarray(0, split).toString('utf8');
      let status = 200;
      for (const line of head.split('\r\n')) {
        const [ name, ...rest ] = line.split(':');
        const value = rest.join(':').trim();
        if (name!.toLowerCase() === 'status')
          status = Number.parseInt(value, 10);
        else
          res.setHeader(name!, value);
      }
      res.statusCode = status;
      res.end(output.subarray(split + 4));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}
