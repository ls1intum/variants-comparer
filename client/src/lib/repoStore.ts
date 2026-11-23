import LightningFS from '@isomorphic-git/lightning-fs';
import type { ExerciseConfig } from '@/types';

/*  IndexedDB-backed file system holding all cloned/imported repositories  */
export const fs = new LightningFS('variants-comparer');
const pfs = fs.promises;

export type RepoType = 'test' | 'solution' | 'template';
export const REPO_TYPES: RepoType[] = [ 'test', 'solution', 'template' ];

const ignoredDirs = new Set([ '.git', 'node_modules' ]);

export function slugify(input: string, fallback: string) {
  const slug = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

export function exerciseDir(exercise: ExerciseConfig) {
  return `/${slugify(exercise.exerciseName, 'exercise')}`;
}

export function variantDir(exercise: ExerciseConfig, variantIndex: number) {
  const variant = exercise.variants[variantIndex];
  return `${exerciseDir(exercise)}/${slugify(variant?.label ?? '', `variant-${variantIndex + 1}`)}`;
}

export function repoDir(exercise: ExerciseConfig, variantIndex: number, repoType: RepoType) {
  return `${variantDir(exercise, variantIndex)}/${repoType}`;
}

/*  LightningFS saves its file index only 500 ms after the last write; persist it right away when an action ends,
    so a reload or closed tab directly afterwards does not lose the change  */
export const persist = () => pfs.flush();

export async function pathExists(filepath: string) {
  try {
    await pfs.stat(filepath);
    return true;
  }
  catch {
    return false;
  }
}

/*  Tolerates directories created concurrently by parallel writes into the same tree  */
export async function mkdirp(dir: string) {
  let current = '';
  for (const part of dir.split('/').filter(Boolean)) {
    current += `/${part}`;
    try {
      await pfs.mkdir(current); /*  NOSONAR: parent directories must exist before their children  */
    }
    catch (error) {
      if ((error as { code?: string }).code !== 'EEXIST')
        throw error;
    }
  }
}

export async function removeRecursive(target: string) {
  let stat;
  try {
    stat = await pfs.lstat(target);
  }
  catch {
    return;
  }
  if (stat.isDirectory()) {
    for (const entry of await pfs.readdir(target))
      await removeRecursive(`${target}/${entry}`);
    await pfs.rmdir(target);
  }
  else
    await pfs.unlink(target);
}

export async function writeFileDeep(filepath: string, data: Uint8Array | string) {
  await mkdirp(filepath.slice(0, filepath.lastIndexOf('/')));
  await pfs.writeFile(filepath, data);
}

/*  Read all files below dir as UTF-8 text, keyed by path relative to dir  */
export async function readFilesRecursive(dir: string, baseDir = dir): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const name of await pfs.readdir(dir)) {
    if (ignoredDirs.has(name))
      continue;
    const fullPath = `${dir}/${name}`;
    const stat = await pfs.stat(fullPath);
    if (stat.isDirectory()) {
      const child = await readFilesRecursive(fullPath, baseDir);
      child.forEach((content, relPath) => files.set(relPath, content));
    }
    else if (stat.isFile())
      files.set(fullPath.slice(baseDir.length + 1), await pfs.readFile(fullPath, 'utf8'));
  }
  return files;
}

/*  Read a repo of an exercise variant, or undefined if it was never downloaded/imported  */
export async function readRepo(exercise: ExerciseConfig, variantIndex: number, repoType: RepoType) {
  const dir = repoDir(exercise, variantIndex, repoType);
  return (await pathExists(dir)) ? readFilesRecursive(dir) : undefined;
}

/*  Paths of all files below dir (ignoring .git / node_modules) relative to baseDir, without reading their content  */
export async function listFilePaths(dir: string, baseDir = dir): Promise<string[]> {
  const names = (await pfs.readdir(dir)).filter((name) => !ignoredDirs.has(name));
  const nested = await Promise.all(names.map(async (name): Promise<string[]> => {
    const fullPath = `${dir}/${name}`;
    const stat = await pfs.stat(fullPath);
    if (stat.isDirectory())
      return listFilePaths(fullPath, baseDir);
    return stat.isFile() ? [ fullPath.slice(baseDir.length + 1) ] : [];
  }));
  return nested.flat();
}

/*  File counts of all stored repositories of an exercise (undefined = not stored)  */
export type RepoStatus = Array<Record<RepoType, number | undefined>>;

export async function getRepoStatus(exercise: ExerciseConfig): Promise<RepoStatus> {
  return Promise.all(exercise.variants.map(async (_, index) => {
    const counts = await Promise.all(REPO_TYPES.map(async (repoType) => {
      const dir = repoDir(exercise, index, repoType);
      return (await pathExists(dir)) ? (await listFilePaths(dir)).length : undefined;
    }));
    return Object.fromEntries(REPO_TYPES.map((repoType, idx) => [ repoType, counts[idx] ])) as Record<RepoType, number | undefined>;
  }));
}

export async function removeRepo(exercise: ExerciseConfig, variantIndex: number, repoType: RepoType) {
  await removeRecursive(repoDir(exercise, variantIndex, repoType));
  await persist();
}

/*  Move a stored directory (e.g. after renaming an exercise or variant); refuses to overwrite  */
export async function moveDir(from: string, to: string) {
  if (from === to || !(await pathExists(from)))
    return;
  if (await pathExists(to))
    throw new Error(`Repositories already exist at ${to}.`);
  await mkdirp(to.slice(0, to.lastIndexOf('/')));
  await pfs.rename(from, to);
  await persist();
}

/*  Origin of an Artemis variant: original export bytes plus baseline problem statement, stored next to its repos  */
export type ArtemisMeta = {
  via: 'zip' | 'api';
  host?: string;
  exerciseId?: number;
  problemStatement: string;
};

const artemisMetaPath = (exercise: ExerciseConfig, variantIndex: number) => `${variantDir(exercise, variantIndex)}/.artemis.json`;
const artemisExportPath = (exercise: ExerciseConfig, variantIndex: number) => `${variantDir(exercise, variantIndex)}/.artemis-export.zip`;

export async function readArtemisMeta(exercise: ExerciseConfig, variantIndex: number): Promise<ArtemisMeta | undefined> {
  const path = artemisMetaPath(exercise, variantIndex);
  return (await pathExists(path)) ? JSON.parse(await pfs.readFile(path, 'utf8') as string) as ArtemisMeta : undefined;
}

export async function writeArtemisMeta(exercise: ExerciseConfig, variantIndex: number, meta: ArtemisMeta, exportBytes?: Uint8Array) {
  await writeFileDeep(artemisMetaPath(exercise, variantIndex), JSON.stringify(meta));
  if (exportBytes)
    await writeFileDeep(artemisExportPath(exercise, variantIndex), exportBytes);
  await persist();
}

export async function readArtemisExportBytes(exercise: ExerciseConfig, variantIndex: number) {
  const path = artemisExportPath(exercise, variantIndex);
  return (await pathExists(path)) ? await pfs.readFile(path) as Uint8Array : undefined;
}

/*  A repo replaced from another source no longer belongs to the Artemis exercise  */
export async function removeArtemisMeta(exercise: ExerciseConfig, variantIndex: number) {
  await removeRecursive(artemisMetaPath(exercise, variantIndex));
  await removeRecursive(artemisExportPath(exercise, variantIndex));
}
