import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExerciseConfig } from '@/types';

import 'fake-indexeddb/auto';
vi.mock('@/lib/config', () => ({ getProxyBase: () => '', getArtemisToken: () => '' }));

const { buildArtemisZip, decideWrite, importArtemisExport, mergeText, parseArtemisExport } = await import('@/lib/artemis');
const { repoChanges, variantChanges, writeRepoFile } = await import('@/lib/changes');
const { removeRepo, repoDir } = await import('@/lib/repoStore');
const { repoZipEntries } = await import('@/lib/importer');

describe('mergeText', () => {
  it('merges changes to different lines', () => {
    expect(mergeText('a\nX\nc\nd\n', 'a\nb\nc\nd\n', 'a\nb\nc\nY\n')).toBe('a\nX\nc\nY\n');
  });

  it('reports conflicting changes of the same line', () => {
    expect(mergeText('a\nX\nc\n', 'a\nb\nc\n', 'a\nY\nc\n')).toBeUndefined();
  });
});

describe('decideWrite', () => {
  it('writes the local version if the server is unchanged', () => {
    expect(decideWrite('a', 'b', 'a')).toEqual({ action: 'update', content: 'b' });
    expect(decideWrite(undefined, 'new', undefined)).toEqual({ action: 'create', content: 'new' });
    expect(decideWrite('a', undefined, 'a')).toEqual({ action: 'delete' });
  });

  it('skips files the server already has in the local version', () => {
    expect(decideWrite('a', 'b', 'b')).toEqual({ action: 'skip' });
    expect(decideWrite('a', undefined, undefined)).toEqual({ action: 'skip' });
  });

  it('merges or reports concurrent server changes', () => {
    expect(decideWrite('1\n2\n3\n', 'X\n2\n3\n', '1\n2\nY\n')).toEqual({ action: 'update', content: 'X\n2\nY\n' });
    expect(decideWrite('1\n', 'X\n', 'Y\n')).toEqual({ action: 'conflict' });
    expect(decideWrite('a', undefined, 'changed')).toEqual({ action: 'conflict' });
    expect(decideWrite(undefined, 'mine', 'theirs')).toEqual({ action: 'conflict' });
  });
});

describe('buildArtemisZip', () => {
  const repoZip = (files: Record<string, string>) =>
    zipSync(Object.fromEntries(Object.entries(files).map(([ p, c ]) => [ p, strToU8(c) ])));
  const exportZip = () => zipSync({
    'Problem-Statement-Ex.md': strToU8('Old statement'),
    'Exercise-Details-Ex.json': strToU8(JSON.stringify({ id: 42, title: 'Ex', problemStatement: 'Old statement', points: 10 })),
    'C-Ex-42-2026.zip': zipSync({
      'C-Ex-exercise.zip': repoZip({ 'build.gradle': 'g\n', 'src/Main.java': 'template\n', '.git/HEAD': 'ref: refs/heads/main\n' }),
      'C-Ex-solution.zip': repoZip({ 'C-Ex-solution/build.gradle': 'g\n', 'C-Ex-solution/src/Main.java': 'solution\n' }),
      'C-Ex-tests.zip': repoZip({ 'build.gradle': 'g\n', 'test/MainTest.java': 'test\n' }),
      'notes.txt': strToU8('kept'),
    }),
  });
  let exercise: ExerciseConfig;
  let exerciseCounter = 0;

  beforeEach(() => {
    const variant = { label: 'A', testRepo: '', solutionRepo: '', templateRepo: '', markdown: '', courseLink: '', source: 'artemis' as const };
    exercise = { targetFolder: 'x', exerciseName: `Ex${++exerciseCounter}`, variants: [ variant ], fileMappings: [] };
  });

  it('round-trips edits and the problem statement into the export structure', async () => {
    const bytes = exportZip();
    await importArtemisExport(exercise, 0, bytes, parseArtemisExport(bytes));
    await writeRepoFile(exercise, 0, 'solution', 'src/Main.java', 'fixed solution\n');
    await writeRepoFile(exercise, 0, 'test', 'test/NewTest.java', 'new\n');
    exercise.variants[0]!.markdown = 'New statement';
    expect((await variantChanges(exercise, 0)).count).toBe(3);

    const rebuilt = await buildArtemisZip(exercise, 0);
    const parsed = parseArtemisExport(rebuilt);
    expect(parsed.problemStatement).toBe('New statement');
    expect(parsed.exerciseId).toBe(42);
    const files = (repo: Uint8Array | undefined) => Object.fromEntries(repoZipEntries(repo!).map(([ p, d ]) => [ p, strFromU8(d) ]));
    expect(files(parsed.repos.solution)).toEqual({ 'build.gradle': 'g\n', 'src/Main.java': 'fixed solution\n' });
    expect(files(parsed.repos.test)).toEqual({ 'build.gradle': 'g\n', 'test/MainTest.java': 'test\n', 'test/NewTest.java': 'new\n' });
    expect(files(parsed.repos.template)).toEqual({ 'build.gradle': 'g\n', 'src/Main.java': 'template\n' });
    expect(Object.keys(unzipSync(parsed.repos.solution!))).toEqual([ 'C-Ex-solution/build.gradle', 'C-Ex-solution/src/Main.java' ]);

    const outer = unzipSync(rebuilt);
    expect(JSON.parse(strFromU8(outer['Exercise-Details-Ex.json']!))).toMatchObject({ id: 42, points: 10, problemStatement: 'New statement' });
    expect(strFromU8(unzipSync(outer['C-Ex-42-2026.zip']!)['notes.txt']!)).toBe('kept');
  });

  it('keeps the original repo ZIP of a removed repository', async () => {
    const bytes = exportZip();
    const original = parseArtemisExport(bytes);
    await importArtemisExport(exercise, 0, bytes, original);
    await removeRepo(exercise, 0, 'test');
    const parsed = parseArtemisExport(await buildArtemisZip(exercise, 0));
    expect(parsed.repos.test).toEqual(original.repos.test);
  });

  it('reports an edit saved while the first baseline is being created', async () => {
    const bytes = exportZip();
    await importArtemisExport(exercise, 0, bytes, parseArtemisExport(bytes));
    const dir = repoDir(exercise, 0, 'solution');
    const baseline = repoChanges(dir);
    await writeRepoFile(exercise, 0, 'solution', 'src/Main.java', 'edited\n');
    await baseline;
    expect(await repoChanges(dir)).toEqual([ { path: 'src/Main.java', kind: 'modified' } ]);
  });
});
