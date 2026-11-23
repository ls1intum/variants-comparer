import { useCallback, useEffect, useState } from 'react';
import { buildArtemisZip, writeToArtemis } from '@/lib/artemis';
import { appendEditLog, commitAll, discardFile, pendingEdits, repoRemoteUrl, variantChanges, type FileChange, type VariantChanges } from '@/lib/changes';
import { getCommitAuthor, setCommitAuthor } from '@/lib/config';
import { pushRepo } from '@/lib/git';
import { zipRepo } from '@/lib/importer';
import { readArtemisMeta, repoDir, REPO_TYPES, slugify, writeArtemisMeta, type ArtemisMeta, type RepoType } from '@/lib/repoStore';
import { downloadFile } from '@/lib/utils';
import type { ExerciseConfig } from '@/types';
import { ConfirmDialog } from './ConfirmDialog';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';

type VariantState = {
  changes: VariantChanges;
  meta?: ArtemisMeta;
  remotes: Record<RepoType, string | undefined>;
};

type PushRequest = { variantIndex: number; repoTypes: RepoType[]; message: string; name: string; email: string };

const KIND_BADGE: Record<FileChange['kind'], [ string, string ]> = {
  added: [ 'A', 'bg-emerald-100 text-emerald-800' ],
  modified: [ 'M', 'bg-amber-100 text-amber-800' ],
  deleted: [ 'D', 'bg-red-100 text-red-800' ],
};

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/*  Pending (not yet written back) edits of all variants, with the write-back action fitting each variant's origin  */
export function PendingChangesPanel({ exercise, refreshToken, onWritten, onProblemStatement, onToast }: Readonly<{
  exercise: ExerciseConfig;
  refreshToken: number;
  onWritten: () => void;
  onProblemStatement: (variantIndex: number, markdown: string) => void;
  onToast: (message: string, type: 'success' | 'error') => void;
}>) {
  const [ states, setStates ] = useState<VariantState[]>([]);
  const [ busy, setBusy ] = useState(false);
  const [ push, setPush ] = useState<PushRequest | null>(null);

  const reload = useCallback(async () => {
    try {
      setStates(await Promise.all(exercise.variants.map(async (_, index) => {
        const urls = await Promise.all(REPO_TYPES.map((repoType) => repoRemoteUrl(repoDir(exercise, index, repoType))));
        const remotes = Object.fromEntries(REPO_TYPES.map((repoType, idx) => [ repoType, urls[idx] ])) as Record<RepoType, string | undefined>;
        return { changes: await variantChanges(exercise, index), meta: await readArtemisMeta(exercise, index), remotes };
      })));
    }
    catch (error) {
      console.error('Failed to read pending changes:', error);
    }
  }, [ exercise ]);

  useEffect(() => {
    reload();
  }, [ reload, refreshToken ]);

  /*  Run a write-back action; onWritten makes the parent refresh the comparison and this panel  */
  const run = async (action: () => Promise<string | undefined>) => {
    setBusy(true);
    try {
      const message = await action();
      if (message)
        onToast(message, 'success');
    }
    catch (error) {
      onToast(errorMessage(error), 'error');
    }
    finally {
      onWritten();
      setBusy(false);
    }
  };

  const labelOf = (index: number) => exercise.variants[index]?.label || `Variant ${index + 1}`;
  const fileBase = (index: number) => {
    const variantSlug = slugify(labelOf(index), `variant-${index + 1}`);
    return `${slugify(exercise.exerciseName, 'exercise')}-${variantSlug}`;
  };

  const downloadRepo = (index: number, repoType: RepoType) => run(async () => {
    downloadFile(`${fileBase(index)}-${repoType}.zip`, await zipRepo(exercise, index, repoType), 'application/zip');
    await appendEditLog(exercise, index, `ZIP download (${repoType})`, await pendingEdits(exercise, index, [ repoType ], false));
    await commitAll(repoDir(exercise, index, repoType), 'Downloaded as ZIP');
    return `${labelOf(index)} – ${repoType}: ZIP downloaded.`;
  });

  /*  For ZIP-uploaded variants the rebuilt ZIP is the write-back; for API variants it is a mere copy  */
  const downloadArtemisZip = (index: number, meta: ArtemisMeta) => run(async () => {
    downloadFile(`${fileBase(index)}-artemis-export.zip`, await buildArtemisZip(exercise, index), 'application/zip');
    if (meta.via === 'zip') {
      await appendEditLog(exercise, index, 'Artemis ZIP download', await pendingEdits(exercise, index));
      await Promise.all(REPO_TYPES.map((repoType) => commitAll(repoDir(exercise, index, repoType), 'Downloaded as Artemis ZIP')));
      await writeArtemisMeta(exercise, index, { ...meta, problemStatement: exercise.variants[index]?.markdown ?? '' });
    }
    return `${labelOf(index)}: Artemis ZIP downloaded. Import it in Artemis via "Import from file" (creates a new exercise).`;
  });

  const writeArtemis = (index: number) => run(async () => {
    const problemStatement = await writeToArtemis(exercise, index);
    onProblemStatement(index, problemStatement);
    return `${labelOf(index)}: changes written to Artemis.`;
  });

  const pushRepos = (request: PushRequest) => run(async () => {
    const author = { name: request.name.trim(), email: request.email.trim() };
    setCommitAuthor(author);
    const outcomes: string[] = [];
    for (const repoType of request.repoTypes) {
      const outcome = await pushRepo(exercise, request.variantIndex, repoType, request.message.trim(), author); /*  NOSONAR: stop at the first failed push  */
      outcomes.push(`${repoType} ${outcome === 'merged' ? 'merged with remote changes and pushed' : outcome}`);
    }
    return `${labelOf(request.variantIndex)}: ${outcomes.join(', ')}.`;
  });

  const openPushDialog = (index: number, repoTypes: RepoType[], changes: VariantChanges) => {
    const files = repoTypes.flatMap((repoType) => changes.repos[repoType].map((change) => change.path));
    const summary = files.length <= 3 ? files.join(', ') : `${files.slice(0, 3).join(', ')} and ${files.length - 3} more`;
    setPush({ variantIndex: index, repoTypes, message: `Edit via Variants Comparer: ${summary}`, ...getCommitAuthor() });
  };

  const discardProblemStatement = (index: number, meta: ArtemisMeta) => onProblemStatement(index, meta.problemStatement);

  const discardRepoFile = (index: number, repoType: RepoType, path: string) => run(async () => {
    await discardFile(exercise, index, repoType, path);
    return undefined;
  });

  const originLabel = (meta?: ArtemisMeta) => {
    if (!meta)
      return 'Git / imported repositories';
    return meta.via === 'api' ? 'Artemis (loaded by URL)' : 'Artemis (uploaded ZIP)';
  };

  const total = states.reduce((sum, state) => sum + state.changes.count, 0);
  const pushValid = !!push && !!push.message.trim() && !!push.name.trim() && /^[^\s@]+@[^\s@]+$/.test(push.email.trim());

  const renderActions = (index: number, state: VariantState) => {
    const { changes, meta, remotes } = state;
    if (meta)
      return (
        <>
          {meta.via === 'api' && (
            <Button size="sm" disabled={busy} onClick={() => writeArtemis(index)}>Write to Artemis</Button>
          )}
          <Button size="sm" variant={meta.via === 'api' ? 'outline' : 'default'} disabled={busy} onClick={() => downloadArtemisZip(index, meta)}>
            Download Artemis ZIP
          </Button>
        </>
      );
    const changed = REPO_TYPES.filter((repoType) => changes.repos[repoType].length > 0);
    const pushable = changed.filter((repoType) => remotes[repoType]);
    return (
      <>
        {pushable.length > 0 && (
          <Button size="sm" disabled={busy} onClick={() => openPushDialog(index, pushable, changes)}>
            Push {pushable.join(', ')}
          </Button>
        )}
        {changed.filter((repoType) => !remotes[repoType]).map((repoType) => (
          <Button key={repoType} size="sm" variant="outline" disabled={busy} onClick={() => downloadRepo(index, repoType)}>
            Download {repoType} ZIP
          </Button>
        ))}
      </>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pending changes{total > 0 ? ` (${total})` : ''}</CardTitle>
        <CardDescription>
          Edits are stored in this browser until written back: pushed to the cloned Git repository, written to Artemis,
          or downloaded as ZIP, depending on where the variant came from.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {total === 0 && <p className="text-sm text-muted-foreground">No pending changes. Use <strong>Edit</strong> on a file to change it.</p>}
        {states.map((state, index) => state.changes.count > 0 && (
          <div key={labelOf(index)} className="space-y-2 rounded-md border border-slate-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">
                {labelOf(index)}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {originLabel(state.meta)}
                </span>
              </p>
              <div className="flex flex-wrap gap-2">{renderActions(index, state)}</div>
            </div>
            <ul className="space-y-1 text-xs">
              {state.changes.problemStatement && state.meta && (
                <li className="flex items-center gap-2">
                  <span className="rounded px-1.5 font-mono bg-amber-100 text-amber-800">M</span>
                  <span className="flex-1">Problem statement</span>
                  <Button variant="ghost" size="sm" className="h-6 text-xs" disabled={busy} onClick={() => discardProblemStatement(index, state.meta!)}>Discard</Button>
                </li>
              )}
              {REPO_TYPES.flatMap((repoType) => state.changes.repos[repoType].map((change) => {
                const [ letter, badgeClass ] = KIND_BADGE[change.kind];
                return (
                  <li key={`${repoType}/${change.path}`} className="flex items-center gap-2">
                    <span className={`rounded px-1.5 font-mono ${badgeClass}`}>{letter}</span>
                    <span className="flex-1 font-mono break-all"><span className="text-muted-foreground">{repoType}/</span>{change.path}</span>
                    <Button variant="ghost" size="sm" className="h-6 text-xs" disabled={busy} onClick={() => discardRepoFile(index, repoType, change.path)}>
                      Discard
                    </Button>
                  </li>
                );
              }))}
            </ul>
          </div>
        ))}
      </CardContent>
      <ConfirmDialog
        isOpen={!!push}
        onClose={() => setPush(null)}
        onConfirm={() => push && pushRepos(push)}
        confirmDisabled={!pushValid}
        title={`Push ${push?.repoTypes.join(', ')} of ${push ? labelOf(push.variantIndex) : ''}`}
        description="Commits all pending changes of these repositories and pushes them to the cloned branch. If the remote branch has new commits, they are merged first; on a conflict nothing is pushed."
        confirmText="Commit and push"
      >
        {push && (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="push-message">Commit message</Label>
              <Textarea id="push-message" rows={3} value={push.message} onChange={(e) => setPush({ ...push, message: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="push-name">Author name</Label>
                <Input id="push-name" value={push.name} onChange={(e) => setPush({ ...push, name: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="push-email">Author email</Label>
                <Input id="push-email" value={push.email} onChange={(e) => setPush({ ...push, email: e.target.value })} />
              </div>
            </div>
            {!pushValid && <p className="text-xs text-red-600">Message, author name and a valid email are required.</p>}
          </div>
        )}
      </ConfirmDialog>
    </Card>
  );
}
