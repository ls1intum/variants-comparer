import git, { clone, Errors } from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import type { DownloadResult, ExerciseConfig } from '@/types';
import { appendEditLog, commitAll, pendingEdits, type CommitAuthor } from './changes';
import { getProxyBase } from './config';
import { fs, mkdirp, persist, removeArtemisMeta, removeRecursive, repoDir, REPO_TYPES, type RepoType } from './repoStore';

/*  Split "https://user:token@host/repo.git" into a credential-free URL and its credentials  */
function splitCredentials(raw: string) {
  const url = new URL(raw);
  const auth = { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) };
  url.username = '';
  url.password = '';
  return { url: url.toString(), auth: auth.username || auth.password ? auth : undefined };
}

function corsProxy() {
  const proxyBase = getProxyBase();
  return proxyBase ? `${proxyBase}/git-proxy` : undefined;
}

async function cloneRepository(rawUrl: string, dir: string) {
  const { url, auth } = splitCredentials(rawUrl);
  await removeRecursive(dir);
  await mkdirp(dir);
  await clone({
    fs,
    http,
    dir,
    url,
    corsProxy: corsProxy(),
    depth: 1,
    singleBranch: true,
    noTags: true,
    onAuth: auth ? () => auth : undefined,
  });
  await persist();
}

/*  Repositories of URL-mode variants that have a URL configured  */
export function cloneJobs(exercise: ExerciseConfig) {
  return exercise.variants.flatMap((variant, index) => (variant.source === 'artemis' ? [] : REPO_TYPES)
    .map((repoType) => ({ variant, index, repoType, url: variant[`${repoType}Repo`].trim() }))
    .filter((job) => job.url));
}

/*  Clone all configured repositories of an exercise into the browser file system  */
export async function cloneExercise(exercise: ExerciseConfig, onProgress?: (done: number, total: number) => void) {
  const jobs = cloneJobs(exercise);
  const events: DownloadResult[] = [];
  let done = 0;
  for (const job of jobs) {
    const destination = repoDir(exercise, job.index, job.repoType);
    const event = { variant: job.variant.label, repoType: job.repoType, destination };
    try {
      await removeArtemisMeta(exercise, job.index); /*  NOSONAR: clones run one after another for progress reporting  */
      await cloneRepository(job.url, destination);
      events.push({ ...event, success: true, message: 'Cloned successfully' });
    }
    catch (error) {
      events.push({ ...event, success: false, message: (error as Error).message });
    }
    onProgress?.(++done, jobs.length);
  }
  return events;
}

/*  Push the current branch; false if rejected because the remote branch moved on  */
async function tryPush(remote: Parameters<typeof git.push>[0], ref: string) {
  try {
    const result = await git.push({ ...remote, ref });
    if (!result.ok)
      throw new Error(result.error ?? Object.values(result.refs).find((r) => r.error)?.error ?? 'Push failed.');
    return true;
  }
  catch (error) {
    if (error instanceof Errors.PushRejectedError && error.data.reason === 'not-fast-forward')
      return false;
    throw error;
  }
}

/*  Undo a local commit (and merge) but keep its edits as pending changes in the working tree  */
async function restorePending(dir: string, branch: string, commit: string, baseline: string) {
  const ref = `refs/heads/${branch}`;
  await git.writeRef({ fs, dir, ref, value: commit, force: true });
  await git.checkout({ fs, dir, ref: branch, force: true });
  await git.writeRef({ fs, dir, ref, value: baseline, force: true });
  for (const [ filepath, head, , stage ] of await git.statusMatrix({ fs, dir }))
    if (stage !== head)
      await git.resetIndex({ fs, dir, filepath }); /*  NOSONAR: index updates of one repo must not overlap  */
}

export type PushOutcome = 'unchanged' | 'pushed' | 'merged';

/*  Commit all pending changes of a cloned repo and push them to its branch. A push rejected because the remote
    moved on is fetched, merged (diff3) and pushed once more; on any failure the edits stay pending  */
export async function pushRepo(exercise: ExerciseConfig, variantIndex: number, repoType: RepoType, message: string, author: CommitAuthor): Promise<PushOutcome> {
  const dir = repoDir(exercise, variantIndex, repoType);
  const rawUrl = exercise.variants[variantIndex]?.[`${repoType}Repo`].trim() ?? '';
  const auth = rawUrl ? splitCredentials(rawUrl).auth : undefined;
  const remote = { fs, http, dir, corsProxy: corsProxy(), onAuth: auth ? () => auth : undefined };
  const branch = await git.currentBranch({ fs, dir });
  if (!branch)
    throw new Error('The repository has no checked out branch.');
  const baseline = await git.resolveRef({ fs, dir, ref: branch });
  const edits = await pendingEdits(exercise, variantIndex, [ repoType ], false);
  const commit = await commitAll(dir, message, author);
  if (!commit)
    return 'unchanged';
  let outcome: PushOutcome = 'pushed';
  try {
    if (!(await tryPush(remote, branch))) {
      await git.fetch({ ...remote, ref: branch, singleBranch: true, tags: false });
      await git.merge({
        fs,
        dir,
        ours: branch,
        theirs: `refs/remotes/origin/${branch}`,
        abortOnConflict: true,
        author,
        message: `Merge remote-tracking branch 'origin/${branch}'`,
      });
      await git.checkout({ fs, dir, ref: branch, force: true });
      if (!(await tryPush(remote, branch)))
        throw new Error('Push rejected again: the remote branch changed during the merge.');
      outcome = 'merged';
    }
  }
  catch (error) {
    await restorePending(dir, branch, commit, baseline);
    if (error instanceof Errors.MergeConflictError)
      throw new Error(`Remote changes conflict with your edits in ${error.data.filepaths.join(', ')}. Your edits stay pending.`);
    if (error instanceof Errors.MergeNotSupportedError)
      throw new Error('Remote changes cannot be merged automatically with your edits. Your edits stay pending.');
    throw error;
  }
  await appendEditLog(exercise, variantIndex, `Git push (${repoType})`, edits, message);
  return outcome;
}
