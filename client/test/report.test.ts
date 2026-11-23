import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ExerciseConfig, FileReview } from '@/types';

import 'fake-indexeddb/auto';

/*  In-memory configuration instead of localStorage  */
const store = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock('@/lib/config', () => ({
  getProxyBase: () => '',
  readConfig:   () => store.config,
  writeConfig:  (config: unknown) => { store.config = config; },
}));

const { appendEditLog, pendingEdits, repoChanges, writeRepoFile } = await import('@/lib/changes');
const { buildReport } = await import('@/lib/report');
const { setReviewComment, setReviewStatus } = await import('@/lib/service');
const { repoDir, writeFileDeep } = await import('@/lib/repoStore');

const variant = (label: string) =>
  ({ label, testRepo: '', solutionRepo: '', templateRepo: '', markdown: '', courseLink: '', artemisUrl: '', source: 'urls' as const });
const exercise: ExerciseConfig = { targetFolder: 'x', exerciseName: 'Report', variants: [ variant('A'), variant('B'), variant('C') ], fileMappings: [] };
const reviews = () => (store.config as { reviewStatuses: FileReview[] }).reviewStatuses;

beforeAll(async () => {
  store.config = { exercises: [ exercise ], activeExerciseIndex: 0, reviewStatuses: [], statsIncludedTypes: [] };
  for (const [ idx, content ] of [ 'x = 1\n', 'x = 2\n', 'x = 3\n' ].entries()) {
    await writeFileDeep(`${repoDir(exercise, idx, 'solution')}/a.txt`, content);
    await writeFileDeep(`${repoDir(exercise, idx, 'solution')}/same.txt`, 'same\n');
    await repoChanges(repoDir(exercise, idx, 'solution'));
  }
});

describe('review comments', () => {
  const target = { exerciseName: 'Report', filePath: 'a.txt', variantLabel: 'B', compareType: 'solution' as const };

  it('keeps a comment when the status is reset, drops the review once both are empty', () => {
    setReviewStatus({ ...target, status: 'needs-attention' });
    setReviewComment({ ...target, comment: '  wrong constant ' });
    expect(reviews()).toEqual([ { filePath: 'Report:a.txt', variantLabel: 'B', compareType: 'solution', status: 'needs-attention', comment: 'wrong constant' } ]);
    setReviewStatus({ ...target, status: 'unchecked' });
    expect(reviews()[0]).toMatchObject({ status: 'unchecked', comment: 'wrong constant' });
    setReviewComment({ ...target, comment: '' });
    expect(reviews()).toEqual([]);
  });
});

describe('review report', () => {
  beforeAll(async () => {
    setReviewStatus({ exerciseName: 'Report', filePath: 'a.txt', variantLabel: 'B', compareType: 'solution', status: 'needs-attention' });
    setReviewComment({ exerciseName: 'Report', filePath: 'a.txt', variantLabel: 'B', compareType: 'solution', comment: 'should be 1' });
    await writeRepoFile(exercise, 2, 'solution', 'a.txt', 'x = 1\n');
    await appendEditLog(exercise, 2, 'Git push (solution)', await pendingEdits(exercise, 2), 'Fix constant');
    await writeRepoFile(exercise, 1, 'solution', 'new.txt', 'new\n');
  });

  it('records pending edits as unified diffs', async () => {
    expect(await pendingEdits(exercise, 1)).toEqual([ { repoType: 'solution', path: 'new.txt', kind: 'added', patch: expect.stringContaining('+new') } ]);
  });

  it('builds a compact report with findings, remaining work and edits', async () => {
    const report = await buildReport({ exerciseIndices: [ 0 ], detailed: false });
    expect(report).toContain('## Exercise: Report');
    expect(report).toContain('| B | Solution repository | 2 | 0 | 1 | 1 |');
    expect(report).toContain('| B | Test repository | not loaded | – | – | – |');
    expect(report).toMatch(/### Needs attention\n\n#### B · Solution repository\n\n- `a\.txt` — should be 1/);
    expect(report).toMatch(/### Not reviewed yet\n\n#### B · Solution repository\n\n- `new\.txt`/);
    expect(report).toMatch(/· C · Git push \(solution\): Fix constant\n\n- M `solution\/a\.txt`/);
    expect(report).toMatch(/##### B\n\n- A `solution\/new\.txt`/);
    expect(report).not.toContain('```diff');
    expect(report).not.toContain('Context for AI agents');
  });

  it('adds diffs and the agent context in detailed mode', async () => {
    const report = await buildReport({ exerciseIndices: [ 0 ], detailed: true });
    expect(report).toContain('Context for AI agents');
    expect(report).toContain('  ```diff\n  --- a/a.txt\n  +++ b/a.txt\n  @@ -1,1 +1,1 @@\n  -x = 1\n  +x = 2\n  ```');
  });
});
