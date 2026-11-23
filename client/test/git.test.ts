import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExerciseConfig } from '@/types';
import { gitCli, startGitServer } from './helpers';

import 'fake-indexeddb/auto';
vi.mock('@/lib/config', () => ({ getProxyBase: () => '' }));

const { cloneExercise, pushRepo } = await import('@/lib/git');
const { deleteRepoFile, discardFile, readEditLog, readRepoFile, repoChanges, variantChanges, writeRepoFile } = await import('@/lib/changes');
const { repoDir } = await import('@/lib/repoStore');

const author = { name: 'Editor', email: 'editor@test' };
let server: Server;
let serverUrl: string;
let remoteRoot: string;
let work: string;

function exerciseFor(url: string): ExerciseConfig {
  const variant = { label: 'A', testRepo: '', solutionRepo: url, templateRepo: '', markdown: '', courseLink: '', source: 'urls' as const };
  return { targetFolder: 'x', exerciseName: `Ex${exerciseCounter}`, variants: [ variant ], fileMappings: [] };
}

/*  Commit a change to the remote from an independent clone  */
function remoteCommit(file: string, content: string) {
  gitCli(work, 'pull', '-q');
  writeFileSync(path.join(work, file), content);
  gitCli(work, 'commit', '-qam', `outside change of ${file}`);
  gitCli(work, 'push', '-q');
}

beforeAll(async () => {
  remoteRoot = mkdtempSync(path.join(tmpdir(), 'vc-remote-'));
  ({ server, url: serverUrl } = await startGitServer(remoteRoot));
});

afterAll(() => {
  server.close();
  rmSync(remoteRoot, { recursive: true, force: true });
});

let exercise: ExerciseConfig;
let exerciseCounter = 0;

beforeEach(async () => {
  const name = `repo-${Date.now()}.git`;
  exerciseCounter++;
  gitCli(remoteRoot, 'init', '-q', '--bare', '-b', 'main', name);
  gitCli(path.join(remoteRoot, name), 'config', 'http.receivepack', 'true');
  work = mkdtempSync(path.join(tmpdir(), 'vc-work-'));
  gitCli(work, 'clone', '-q', path.join(remoteRoot, name), '.');
  writeFileSync(path.join(work, 'a.txt'), 'line 1\nline 2\nline 3\n');
  writeFileSync(path.join(work, 'b.txt'), 'b\n');
  gitCli(work, 'add', '.');
  gitCli(work, 'commit', '-qm', 'initial');
  gitCli(work, 'push', '-q', 'origin', 'main');
  exercise = exerciseFor(`${serverUrl}/${name}`);
  const [ result ] = await cloneExercise(exercise);
  expect(result?.success, result?.message).toBe(true);
});

describe('change tracking', () => {
  it('reports and discards edits against the cloned baseline', async () => {
    await writeRepoFile(exercise, 0, 'solution', 'a.txt', 'changed\n');
    await writeRepoFile(exercise, 0, 'solution', 'new/c.txt', 'c\n');
    expect(await repoChanges(repoDir(exercise, 0, 'solution'))).toEqual([
      { path: 'a.txt', kind: 'modified' },
      { path: 'new/c.txt', kind: 'added' },
    ]);
    await discardFile(exercise, 0, 'solution', 'a.txt');
    await discardFile(exercise, 0, 'solution', 'new/c.txt');
    expect(await readRepoFile(exercise, 0, 'solution', 'a.txt')).toBe('line 1\nline 2\nline 3\n');
    expect((await variantChanges(exercise, 0)).count).toBe(0);
  });
});

describe('pushRepo', () => {
  it('pushes a commit with the edits', async () => {
    await writeRepoFile(exercise, 0, 'solution', 'a.txt', 'line 1\nedited\nline 3\n');
    await writeRepoFile(exercise, 0, 'solution', 'src/c.txt', 'c\n');
    await deleteRepoFile(exercise, 0, 'solution', 'b.txt');
    expect(await pushRepo(exercise, 0, 'solution', 'Fix a', author)).toBe('pushed');
    gitCli(work, 'pull', '-q');
    expect(gitCli(work, 'show', 'HEAD:a.txt')).toBe('line 1\nedited\nline 3');
    expect(gitCli(work, 'ls-tree', '-r', '--name-only', 'HEAD')).toBe('a.txt\nsrc/c.txt');
    expect(gitCli(work, 'log', '-1', '--format=%an %s')).toBe('Editor Fix a');
    expect(await repoChanges(repoDir(exercise, 0, 'solution'))).toEqual([]);
    const [ entry, ...rest ] = await readEditLog(exercise, 0);
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ via: 'Git push (solution)', message: 'Fix a' });
    expect(entry!.edits.map((edit) => `${edit.kind} ${edit.path}`).sort()).toEqual([ 'added src/c.txt', 'deleted b.txt', 'modified a.txt' ]);
    expect(entry!.edits.find((edit) => edit.path === 'a.txt')!.patch).toContain('-line 2\n+edited');
  });

  it('merges remote changes to other lines and pushes', async () => {
    remoteCommit('b.txt', 'remote b\n');
    await writeRepoFile(exercise, 0, 'solution', 'a.txt', 'line 1\nedited\nline 3\n');
    expect(await pushRepo(exercise, 0, 'solution', 'Fix a', author)).toBe('merged');
    gitCli(work, 'pull', '-q');
    expect(gitCli(work, 'show', 'HEAD:a.txt')).toBe('line 1\nedited\nline 3');
    expect(gitCli(work, 'show', 'HEAD:b.txt')).toBe('remote b');
    expect(await readRepoFile(exercise, 0, 'solution', 'b.txt')).toBe('remote b\n');
    expect(await repoChanges(repoDir(exercise, 0, 'solution'))).toEqual([]);
  });

  it('keeps edits pending on a conflict', async () => {
    remoteCommit('a.txt', 'line 1\nremote\nline 3\n');
    await writeRepoFile(exercise, 0, 'solution', 'a.txt', 'line 1\nlocal\nline 3\n');
    await expect(pushRepo(exercise, 0, 'solution', 'Fix a', author)).rejects.toThrow(/conflict/);
    expect(await readEditLog(exercise, 0)).toEqual([]);
    expect(await readRepoFile(exercise, 0, 'solution', 'a.txt')).toBe('line 1\nlocal\nline 3\n');
    expect(await repoChanges(repoDir(exercise, 0, 'solution'))).toEqual([ { path: 'a.txt', kind: 'modified' } ]);
    gitCli(work, 'pull', '-q');
    expect(gitCli(work, 'show', 'HEAD:a.txt')).toBe('line 1\nremote\nline 3');
  });
});
