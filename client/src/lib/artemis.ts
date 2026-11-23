import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import git from 'isomorphic-git';
import { merge } from 'node-diff3';
import type { ExerciseConfig } from '@/types';
import { appendEditLog, pendingEdits, variantChanges, type FileChange } from './changes';
import { getArtemisToken, getProxyBase } from './config';
import { commonRoot, importZipBytes, replaceRepo, repoZipEntries, zipRepo } from './importer';
import { fs, pathExists, readArtemisExportBytes, readArtemisMeta, repoDir, REPO_TYPES, writeArtemisMeta, type ArtemisMeta, type RepoType } from './repoStore';

/*  Artemis "export-instructor-exercise" ZIP: Problem-Statement-*.md, Exercise-Details-*.json and a nested
    <course>-<title>-<id>-<timestamp>.zip holding <course>-<title>-{exercise,solution,tests}.zip repositories
    (see Artemis ProgrammingExerciseExportService); nested ZIPs are searched recursively like Artemis does on import  */
const ARTEMIS_REPO_SUFFIXES: Array<[ string, RepoType ]> = [ [ '-exercise', 'template' ], [ '-solution', 'solution' ], [ '-tests', 'test' ] ];
const MAX_ZIP_DEPTH = 3;

export type ArtemisExport = {
  title?: string;
  exerciseId?: number;
  problemStatement?: string;
  repos: Partial<Record<RepoType, Uint8Array>>;
};

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const repoTypeOfZip = (name: string) => ARTEMIS_REPO_SUFFIXES.find(([ suffix ]) => name.slice(0, -4).endsWith(suffix))?.[1];
const isProblemStatement = (name: string) => name.startsWith('Problem-Statement') && name.endsWith('.md');
const isExerciseDetails = (name: string) => name.startsWith('Exercise-Details') && name.endsWith('.json');
const isZip = (name: string) => name.toLowerCase().endsWith('.zip');

function collectArtemisEntries(bytes: Uint8Array, result: ArtemisExport, depth: number) {
  const entries = Object.entries(unzipSync(bytes)).filter(([ p ]) => !p.endsWith('/') && !p.includes('__MACOSX'));
  for (const [ path, data ] of entries) {
    const name = baseName(path);
    if (isZip(name)) {
      const repoType = repoTypeOfZip(name);
      if (repoType)
        result.repos[repoType] ??= data;
      else if (depth < MAX_ZIP_DEPTH)
        collectArtemisEntries(data, result, depth + 1);
    }
    else if (isProblemStatement(name))
      result.problemStatement = strFromU8(data);
    else if (isExerciseDetails(name)) {
      try {
        const details = JSON.parse(strFromU8(data)) as { id?: number; title?: string; problemStatement?: string };
        result.title = details.title;
        result.exerciseId = details.id;
        result.problemStatement ??= details.problemStatement;
      }
      catch {
        /*  details are optional  */
      }
    }
  }
}

export function parseArtemisExport(bytes: Uint8Array): ArtemisExport {
  const result: ArtemisExport = { repos: {} };
  collectArtemisEntries(bytes, result, 0);
  if (Object.keys(result.repos).length === 0)
    throw new Error('Not an Artemis exercise export: no *-exercise.zip, *-solution.zip or *-tests.zip found.');
  return result;
}

/*  Accept an export URL or any Artemis URL containing /programming-exercises/<id>  */
export function toArtemisExportUrl(input: string): URL {
  const url = new URL(input.trim());
  const id = url.pathname.match(/\/programming-exercises\/(\d+)/)?.[1];
  if (!id)
    throw new Error('Artemis URL must contain /programming-exercises/<id>.');
  return new URL(`/api/programming/programming-exercises/${id}/export-instructor-exercise`, url.origin);
}

/*  Call the Artemis REST API with the session token, through /artemis-proxy if configured  */
async function artemisFetch(host: string, pathAndQuery: string, init: RequestInit = {}) {
  const token = getArtemisToken();
  if (!token)
    throw new Error('Please enter your Artemis token first.');
  const proxyBase = getProxyBase();
  const target = proxyBase ? `${proxyBase}/artemis-proxy/${host}${pathAndQuery}` : `https://${host}${pathAndQuery}`;
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(target, { ...init, headers });
  if (response.status === 401 || response.status === 403)
    throw new Error(`Artemis rejected the request (${response.status}): token expired or missing editor/instructor rights.`);
  if (!response.ok)
    throw new Error(`Artemis request ${init.method ?? 'GET'} ${pathAndQuery} failed (${response.status} ${response.statusText}): ${(await response.text()).slice(0, 300)}`);
  return response;
}

export async function fetchArtemisExport(input: string): Promise<Uint8Array> {
  const exportUrl = toArtemisExportUrl(input);
  const response = await artemisFetch(exportUrl.host, exportUrl.pathname);
  return new Uint8Array(await response.arrayBuffer());
}

/*  Replace a variant's repositories with those of a parsed Artemis export and remember its origin for write-back  */
export async function importArtemisExport(exercise: ExerciseConfig, variantIndex: number, bytes: Uint8Array, parsed: ArtemisExport, sourceUrl?: string) {
  const repos = Object.entries(parsed.repos) as Array<[ RepoType, Uint8Array ]>;
  await Promise.all(repos.map(([ repoType, repoBytes ]) => importZipBytes(exercise, variantIndex, repoType, repoBytes)));
  const imported = repos.map(([ repoType ]) => repoType);
  const exportUrl = sourceUrl ? toArtemisExportUrl(sourceUrl) : undefined;
  const meta: ArtemisMeta = {
    via: exportUrl ? 'api' : 'zip',
    host: exportUrl?.host,
    exerciseId: Number(exportUrl?.pathname.match(/\/programming-exercises\/(\d+)/)?.[1] ?? parsed.exerciseId) || undefined,
    problemStatement: parsed.problemStatement ?? '',
  };
  await writeArtemisMeta(exercise, variantIndex, meta, bytes);
  return imported;
}

/*  Rebuild a ZIP level of the stored export: repo ZIPs get the current working trees (below their original root
    folder, without .git, which Artemis skips on import anyway), the problem statement gets the current text  */
async function rebuildExportLevel(exercise: ExerciseConfig, variantIndex: number, bytes: Uint8Array, problemStatement: string, depth: number): Promise<ReturnType<typeof zipSync>> {
  const rebuildEntry = async (path: string, data: Uint8Array): Promise<Uint8Array> => {
    const name = baseName(path);
    const repoType = isZip(name) ? repoTypeOfZip(name) : undefined;
    if (repoType && await pathExists(repoDir(exercise, variantIndex, repoType)))
      return zipRepo(exercise, variantIndex, repoType, commonRoot(Object.keys(unzipSync(data))));
    if (repoType)
      return data;
    if (isZip(name) && depth < MAX_ZIP_DEPTH)
      return rebuildExportLevel(exercise, variantIndex, data, problemStatement, depth + 1);
    if (isProblemStatement(name))
      return strToU8(problemStatement);
    if (isExerciseDetails(name)) {
      try {
        return strToU8(JSON.stringify({ ...JSON.parse(strFromU8(data)), problemStatement }, null, 2));
      }
      catch {
        return data;
      }
    }
    return data;
  };
  const entries = Object.entries(unzipSync(bytes));
  const rebuilt = await Promise.all(entries.map(([ path, data ]) => rebuildEntry(path, data)));
  return zipSync(Object.fromEntries(entries.map(([ path ], idx) => [ path, rebuilt[idx]! ])));
}

/*  Artemis export ZIP of a variant with all local edits, for "Import from file" in Artemis (creates a new exercise)  */
export async function buildArtemisZip(exercise: ExerciseConfig, variantIndex: number) {
  const bytes = await readArtemisExportBytes(exercise, variantIndex);
  if (!bytes)
    throw new Error('The original Artemis export is not stored; re-import the variant from Artemis first.');
  return rebuildExportLevel(exercise, variantIndex, bytes, exercise.variants[variantIndex]?.markdown ?? '', 0);
}

/*  Three-way line merge of a local and a server change against their common baseline; undefined on conflict  */
export function mergeText(local: string, base: string, server: string) {
  const { conflict, result } = merge(local.split('\n'), base.split('\n'), server.split('\n'), { excludeFalseConflicts: true });
  return conflict ? undefined : result.join('\n');
}

/*  What to write for a locally changed file, given its baseline and current server version (undefined = absent)  */
export type WriteDecision = { action: 'skip' } | { action: 'conflict' } | { action: 'delete' } | { action: 'create' | 'update'; content: string };

export function decideWrite(base: string | undefined, local: string | undefined, server: string | undefined): WriteDecision {
  let target = local;
  if (server === local)
    return { action: 'skip' };
  if (server !== base) {
    const merged = base !== undefined && local !== undefined && server !== undefined ? mergeText(local, base, server) : undefined;
    if (merged === undefined)
      return { action: 'conflict' };
    target = merged;
  }
  if (target === undefined)
    return server === undefined ? { action: 'skip' } : { action: 'delete' };
  return { action: server === undefined ? 'create' : 'update', content: target };
}

type RepoPlan = { creates: Array<[ string, string ]>; updates: Array<[ string, string ]>; deletes: string[]; conflicts: string[] };

async function baselineFile(dir: string, filepath: string) {
  try {
    const { blob } = await git.readBlob({ fs, dir, oid: await git.resolveRef({ fs, dir, ref: 'HEAD' }), filepath });
    return strFromU8(blob);
  }
  catch {
    return undefined;
  }
}

/*  Decide the server operations of one repo from its local changes, their baselines and the current server files  */
async function planRepoWrites(dir: string, changes: FileChange[], serverFiles: Map<string, Uint8Array>): Promise<RepoPlan> {
  const decisions = await Promise.all(changes.map(async (change) => {
    const local = change.kind === 'deleted' ? undefined : await fs.promises.readFile(`${dir}/${change.path}`, 'utf8') as string;
    const serverFile = serverFiles.get(change.path);
    return { path: change.path, decision: decideWrite(await baselineFile(dir, change.path), local, serverFile && strFromU8(serverFile)) };
  }));
  const plan: RepoPlan = { creates: [], updates: [], deletes: [], conflicts: [] };
  for (const { path, decision } of decisions) {
    if (decision.action === 'conflict')
      plan.conflicts.push(path);
    else if (decision.action === 'delete')
      plan.deletes.push(path);
    else if (decision.action === 'create')
      plan.creates.push([ path, decision.content ]);
    else if (decision.action === 'update')
      plan.updates.push([ path, decision.content ]);
  }
  return plan;
}

/*  Server files of a repo after applying a plan, i.e. what the server holds once the plan is written  */
function applyPlan(serverFiles: Map<string, Uint8Array>, plan: RepoPlan) {
  const files = new Map(serverFiles);
  for (const [ path, content ] of [ ...plan.creates, ...plan.updates ])
    files.set(path, strToU8(content));
  for (const path of plan.deletes)
    files.delete(path);
  return files;
}

type Participations = { templateParticipation?: { id: number }; solutionParticipation?: { id: number } };
type ArtemisRequest = [ string, RequestInit ];

const TEXT_HEADERS = { 'content-type': 'text/plain' };

/*  Online-editor requests writing a plan to one repository (template/solution by participation, tests by exercise)  */
function repoRequests(base: string, plan: RepoPlan): ArtemisRequest[] {
  const fileUrl = (path: string) => `${base}/file?file=${encodeURIComponent(path)}`;
  const updates: ArtemisRequest[] = plan.updates.length === 0 ? [] : [ [ `${base}/files?commit=false`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(plan.updates.map(([ fileName, fileContent ]) => ({ fileName, fileContent }))),
  } ] ];
  return [
    ...plan.creates.map(([ path, content ]): ArtemisRequest => [ fileUrl(path), { method: 'POST', headers: TEXT_HEADERS, body: content } ]),
    ...updates,
    ...plan.deletes.map((path): ArtemisRequest => [ fileUrl(path), { method: 'DELETE' } ]),
    [ `${base}/commit`, { method: 'POST' } ],
  ];
}

async function repositoryBases(host: string, exerciseId: number): Promise<Record<RepoType, string | undefined>> {
  const participations = await (await artemisFetch(host,
    `/api/programming/programming-exercises/${exerciseId}/with-template-and-solution-participation?withSubmissionResults=false&withGradingCriteria=false`)).json() as Participations;
  const participationBase = (participation?: { id: number }) => participation && `/api/programming/participations/${participation.id}/repository`;
  return {
    template: participationBase(participations.templateParticipation),
    solution: participationBase(participations.solutionParticipation),
    test: `/api/programming/programming-exercises/${exerciseId}/test-repository`,
  };
}

/*  Write all pending edits of an Artemis variant back via the Artemis online-editor REST API. The current server
    state is fetched first; server changes since the import are merged, any conflict aborts before writing.
    Returns the problem statement now stored in Artemis  */
export async function writeToArtemis(exercise: ExerciseConfig, variantIndex: number) {
  const meta = await readArtemisMeta(exercise, variantIndex);
  if (meta?.via !== 'api' || !meta.host || !meta.exerciseId)
    throw new Error('Only variants loaded from Artemis by URL can be written back to Artemis.');
  const { host, exerciseId } = meta;
  const changes = await variantChanges(exercise, variantIndex);
  const edits = await pendingEdits(exercise, variantIndex);
  const serverBytes = await fetchArtemisExport(`https://${host}/api/programming/programming-exercises/${exerciseId}`);
  const server = parseArtemisExport(serverBytes);

  const serverFiles = {} as Record<RepoType, Map<string, Uint8Array>>;
  for (const repoType of REPO_TYPES) {
    const serverRepo = server.repos[repoType];
    serverFiles[repoType] = new Map(serverRepo ? repoZipEntries(serverRepo) : []);
  }
  const planList = await Promise.all(REPO_TYPES.map((repoType) =>
    planRepoWrites(repoDir(exercise, variantIndex, repoType), changes.repos[repoType], serverFiles[repoType])));
  const plans = Object.fromEntries(REPO_TYPES.map((repoType, idx) => [ repoType, planList[idx]! ])) as Record<RepoType, RepoPlan>;
  const psDecision = changes.problemStatement
    ? decideWrite(meta.problemStatement, exercise.variants[variantIndex]?.markdown ?? '', server.problemStatement ?? '')
    : { action: 'skip' as const };
  const conflicts = REPO_TYPES.flatMap((repoType) => plans[repoType].conflicts.map((path) => `${repoType}/${path}`));
  if (psDecision.action === 'conflict')
    conflicts.push('problem statement');
  if (conflicts.length > 0)
    throw new Error(`Changes made in Artemis since the import conflict with your edits in: ${conflicts.join(', ')}. Nothing was written; your edits stay pending.`);

  const changedRepos = REPO_TYPES.filter((repoType) => {
    const { creates, updates, deletes } = plans[repoType];
    return creates.length + updates.length + deletes.length > 0;
  });
  const requests: ArtemisRequest[] = [];
  if (changedRepos.length > 0) {
    const bases = await repositoryBases(host, exerciseId);
    for (const repoType of changedRepos) {
      const base = bases[repoType];
      if (!base)
        throw new Error(`Artemis returned no ${repoType} participation for exercise ${exerciseId}.`);
      requests.push(...repoRequests(base, plans[repoType]));
    }
  }
  let problemStatement = server.problemStatement ?? '';
  if (psDecision.action === 'update' || psDecision.action === 'create') {
    problemStatement = psDecision.content;
    requests.push([ `/api/programming/programming-exercises/${exerciseId}/problem-statement`, { method: 'PATCH', headers: TEXT_HEADERS, body: problemStatement || ' ' } ]);
  }
  for (const [ pathAndQuery, init ] of requests)
    await artemisFetch(host, pathAndQuery, init); /*  NOSONAR: requests must reach Artemis in order (files before commit)  */

  /*  Local repos now mirror the server: its state plus what was just written, committed as the new baseline  */
  await Promise.all(REPO_TYPES.filter((repoType) => server.repos[repoType]).map((repoType) =>
    replaceRepo(repoDir(exercise, variantIndex, repoType), [ ...applyPlan(serverFiles[repoType], plans[repoType]) ])));
  await writeArtemisMeta(exercise, variantIndex, { ...meta, problemStatement }, serverBytes);
  await appendEditLog(exercise, variantIndex, 'Write to Artemis', edits);
  return problemStatement;
}
