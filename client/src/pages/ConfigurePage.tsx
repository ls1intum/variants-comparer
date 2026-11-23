import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';

import { fetchArtemisExport, importArtemisExport, parseArtemisExport } from '@/lib/artemis';
import { variantChanges, type VariantChanges } from '@/lib/changes';
import { exportConfigJson, getArtemisToken, getDefaultProxyBase, getProxyBase, importConfigJson, setArtemisToken, setProxyBase } from '@/lib/config';
import { cloneExercise, cloneJobs } from '@/lib/git';
import { clearExerciseRepos, importFolder, importZip } from '@/lib/importer';
import { exerciseDir, getRepoStatus, moveDir, removeRepo, REPO_TYPES, variantDir, type RepoStatus, type RepoType } from '@/lib/repoStore';
import { listFiles, suggestMappings } from '@/lib/service';
import { downloadFile } from '@/lib/utils';
import type { DownloadResult, ExerciseConfig, VariantForm, MultiExerciseConfig, FileMapping } from '@/types';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { useExercise, type SaveState } from '@/contexts/ExerciseContext';
import { useToast } from '@/contexts/ToastContext';

const formatRepoType = (type: DownloadResult['repoType']) => type.charAt(0).toUpperCase() + type.slice(1);

const toErrorMessage = (error: unknown) => {
  if (!error) return 'Unexpected error';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object') return JSON.stringify(error);
  return 'Unexpected error';
};

/*  Same rule as the zod schema: empty or a parseable URL  */
const isValidUrl = (value: string) => {
  if (!value.trim()) return true;
  try {
    new URL(value.trim());
    return true;
  } catch {
    return false;
  }
};

const REPO_FIELDS: Array<{ repoType: RepoType; field: 'templateRepo' | 'solutionRepo' | 'testRepo'; label: string; placeholder: string }> = [
  { repoType: 'template', field: 'templateRepo', label: 'Template repository', placeholder: 'https://github.com/org/template' },
  { repoType: 'solution', field: 'solutionRepo', label: 'Solution repository', placeholder: 'https://github.com/org/solution' },
  { repoType: 'test', field: 'testRepo', label: 'Test repository', placeholder: 'https://github.com/org/tests' },
];

type ImportKind = 'folder' | 'zip';

/*  URL input with inline validation and a clear button  */
function UrlInput({ id, value, placeholder, disabled, onChange }: {
  id: string;
  value: string;
  placeholder: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const invalid = !isValidUrl(value);
  return (
    <div className="space-y-1">
      <div className="relative">
        <Input
          id={id}
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          aria-invalid={invalid}
          className={`pr-8 ${invalid ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
        />
        {value && !disabled && (
          <button
            type="button"
            aria-label="Clear"
            title="Clear"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1 text-muted-foreground hover:text-foreground"
            onClick={() => onChange('')}
          >
            ×
          </button>
        )}
      </div>
      {invalid && <p className="text-xs text-red-600">Not a valid URL.</p>}
    </div>
  );
}

/*  Stored state of one repository in browser storage  */
function RepoBadge({ count, modified, disabled, onRemove }: Readonly<{ count: number | undefined; modified: number; disabled: boolean; onRemove: () => void }>) {
  if (count === undefined)
    return <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">not loaded</span>;
  return (
    <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
      ✓ {count} files
      {modified > 0 && <span className="rounded bg-amber-200 px-1 text-amber-900" title="Edited files not yet written back (see Compare page)">{modified} modified</span>}
      <button type="button" title="Remove from browser storage" aria-label="Remove repository" disabled={disabled} className="px-0.5 hover:text-red-700 disabled:opacity-50" onClick={onRemove}>
        ×
      </button>
    </span>
  );
}

/*  Folder/ZIP import as alternative to cloning a repository URL  */
function RepoImportControls({ disabled, title, onImport }: { disabled: boolean; title?: string; onImport: (files: FileList | null, kind: ImportKind) => void }) {
  const folderRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const handle = (kind: ImportKind) => (event: ChangeEvent<HTMLInputElement>) => {
    onImport(event.target.files, kind);
    event.target.value = '';
  };
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground" title={title}>
      <span>or import:</span>
      <input ref={folderRef} type="file" className="hidden" onChange={handle('folder')} {...{ webkitdirectory: '' }} />
      <input ref={zipRef} type="file" accept=".zip" className="hidden" onChange={handle('zip')} />
      <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" disabled={disabled} onClick={() => folderRef.current?.click()}>
        Folder
      </Button>
      <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" disabled={disabled} onClick={() => zipRef.current?.click()}>
        ZIP
      </Button>
    </div>
  );
}

type VariantCardProps = {
  index: number;
  variant: VariantForm;
  status: Record<RepoType, number | undefined> | undefined;
  pending: VariantChanges | undefined;
  isBusy: boolean;
  hasName: boolean;
  hasToken: boolean;
  onChange: (field: keyof VariantForm, value: string) => void;
  onLabelFocus: () => void;
  onLabelBlur: () => void;
  onRepoImport: (repoType: RepoType, files: FileList | null, kind: ImportKind) => void;
  onRemoveRepo: (repoType: RepoType) => void;
  onArtemisLoad: () => void;
  onArtemisUpload: (file: File) => void;
};

function VariantCard({
  index, variant, status, pending, isBusy, hasName, hasToken,
  onChange, onLabelFocus, onLabelBlur, onRepoImport, onRemoveRepo, onArtemisLoad, onArtemisUpload,
}: VariantCardProps) {
  const zipRef = useRef<HTMLInputElement>(null);
  const source = variant.source ?? 'urls';
  const artemisUrl = variant.artemisUrl ?? '';
  const artemisLoadBlocker = !artemisUrl.trim() ? 'Enter the Artemis exercise URL first.'
    : !isValidUrl(artemisUrl) ? 'The Artemis URL is invalid.'
    : !hasToken ? 'Enter your Artemis token above first.'
    : undefined;
  const importBlocker = hasName ? undefined : 'Enter an exercise name first.';

  return (
    <Card className={`border border-border/70 ${index === 0 ? 'border-primary bg-primary/5' : ''}`}>
      <CardHeader>
        <CardTitle>{variant.label || `Variant ${index + 1}`}</CardTitle>
        <CardDescription>{index === 0 ? 'Base variant (source of truth).' : 'Compared against the base variant.'}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor={`label-${index}`}>Variant label</Label>
          <Input
            id={`label-${index}`}
            value={variant.label}
            disabled={isBusy}
            onFocus={onLabelFocus}
            onBlur={onLabelBlur}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onChange('label', event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>Source</Label>
          <div role="radiogroup" className="grid grid-cols-2 rounded-md border border-input p-0.5 text-sm">
            {([ [ 'urls', 'Repository URLs' ], [ 'artemis', 'Artemis exercise' ] ] as const).map(([ value, text ]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={source === value}
                disabled={isBusy}
                className={`rounded px-2 py-1 transition-colors ${source === value ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                onClick={() => onChange('source', value)}
              >
                {text}
              </button>
            ))}
          </div>
        </div>

        {source === 'artemis' ? (
          <div className="space-y-3 rounded-md border border-border/70 p-3">
            <div className="space-y-2">
              <Label htmlFor={`artemis-${index}`}>Artemis exercise URL</Label>
              <UrlInput
                id={`artemis-${index}`}
                placeholder="https://artemis.tum.de/.../programming-exercises/12345"
                value={artemisUrl}
                disabled={isBusy}
                onChange={(value) => onChange('artemisUrl', value)}
              />
            </div>
            <input
              ref={zipRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                const file = event.target.files?.[0];
                if (file) onArtemisUpload(file);
                event.target.value = '';
              }}
            />
            <div className="flex flex-wrap gap-2">
              <span title={artemisLoadBlocker}>
                <Button type="button" variant="outline" size="sm" disabled={isBusy || !!artemisLoadBlocker} onClick={onArtemisLoad}>
                  Load from Artemis
                </Button>
              </span>
              <Button type="button" variant="outline" size="sm" disabled={isBusy} onClick={() => zipRef.current?.click()}>
                Upload exercise ZIP
              </Button>
            </div>
            {artemisLoadBlocker && artemisUrl.trim() && <p className="text-xs text-muted-foreground">{artemisLoadBlocker}</p>}
            <ul className="space-y-1 text-xs">
              {REPO_FIELDS.map(({ repoType, label }) => (
                <li key={repoType} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{label}</span>
                  <RepoBadge count={status?.[repoType]} modified={pending?.repos[repoType].length ?? 0} disabled={isBusy} onRemove={() => onRemoveRepo(repoType)} />
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">Loading replaces template, solution, tests, and problem statement of this variant.</p>
          </div>
        ) : (
          REPO_FIELDS.map(({ repoType, field, label, placeholder }) => (
            <div key={repoType} className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor={`${repoType}-${index}`}>{label} URL</Label>
                <RepoBadge count={status?.[repoType]} modified={pending?.repos[repoType].length ?? 0} disabled={isBusy} onRemove={() => onRemoveRepo(repoType)} />
              </div>
              <UrlInput
                id={`${repoType}-${index}`}
                placeholder={placeholder}
                value={variant[field]}
                disabled={isBusy}
                onChange={(value) => onChange(field, value)}
              />
              <RepoImportControls
                disabled={isBusy || !!importBlocker}
                title={importBlocker}
                onImport={(files, kind) => onRepoImport(repoType, files, kind)}
              />
            </div>
          ))
        )}

        <div className="space-y-2">
          <Label htmlFor={`course-link-${index}`}>Course management link</Label>
          <UrlInput
            id={`course-link-${index}`}
            placeholder="https://course-system.local/courses/123"
            value={variant.courseLink}
            disabled={isBusy}
            onChange={(value) => onChange('courseLink', value)}
          />
          {variant.courseLink && isValidUrl(variant.courseLink) && (
            <a href={variant.courseLink} target="_blank" rel="noreferrer" className="text-xs font-medium text-primary underline underline-offset-4">
              Open course page for this variant
            </a>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor={`markdown-${index}`}>Problem Statement</Label>
          <Textarea
            id={`markdown-${index}`}
            rows={4}
            disabled={isBusy}
            placeholder={source === 'artemis' ? 'Filled from the Artemis export...' : 'Problem description, requirements, and grading rubric for this variant...'}
            value={variant.markdown}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange('markdown', event.target.value)}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/*  Autosave status of the configuration (replaces the former "Save links" button)  */
function SaveIndicator({ state }: { state: SaveState }) {
  if (state.status === 'error')
    return <span className="rounded-md bg-red-50 px-3 py-1 text-sm text-red-700" role="status">Not saved: {state.error}</span>;
  return (
    <span className="rounded-md bg-muted px-3 py-1 text-sm text-muted-foreground" role="status">
      {state.status === 'saving' ? 'Saving…' : 'All changes saved'}
    </span>
  );
}

function ConfigurePage() {
  const { exercises, activeExerciseIndex, setExercises, currentExercise, setActiveExerciseIndex, saveState, loading: configLoading } = useExercise();
  const { addToast } = useToast();
  const [results, setResults] = useState<DownloadResult[]>([]);
  const [loading, setLoading] = useState<'download' | 'import' | 'clear' | 'artemis' | 'rename' | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [showProgress, setShowProgress] = useState(false);
  const [currentStep, setCurrentStep] = useState('');
  const [availableFiles, setAvailableFiles] = useState<Record<string, { label: string; files: string[] }>>({});
  const [suggestions, setSuggestions] = useState<Array<{ baseFile: string; variantFile: string; variantLabel: string; similarity: number }>>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [exportName, setExportName] = useState('config-backup');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [proxyBase, setProxyBaseState] = useState(getProxyBase);
  const [artemisToken, setArtemisTokenState] = useState(getArtemisToken);
  const [repoStatus, setRepoStatus] = useState<RepoStatus>([]);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [pending, setPending] = useState<VariantChanges[]>([]);
  const [discardConfirm, setDiscardConfirm] = useState<{ count: number; action: () => void } | null>(null);
  const renameOrigin = useRef<ExerciseConfig | null>(null);

  const variants = currentExercise.variants;
  const exerciseName = currentExercise.exerciseName;
  const fileMappings = currentExercise.fileMappings || [];
  const isBusy = loading !== null;

  /*  Re-read which repositories are stored; file lists for mappings follow automatically  */
  const refreshRepoStatus = useCallback(async (exercise: ExerciseConfig) => {
    try {
      const status = await getRepoStatus(exercise);
      setRepoStatus(status);
      setPending(await Promise.all(exercise.variants.map((_, index) => variantChanges(exercise, index))));
      const variantsWithRepos = status.filter((counts) => REPO_TYPES.some((t) => counts[t] !== undefined)).length;
      setAvailableFiles(variantsWithRepos >= 2 ? await listFiles(exercise) : {});
    } catch (error) {
      console.error('Failed to read repository status:', error);
    }
  }, []);

  /*  Reset local state when switching (or initially loading) exercises; status is not refreshed while typing  */
  useEffect(() => {
    setResults([]);
    setDownloadProgress(0);
    setShowProgress(false);
    setCurrentStep('');
    setSuggestions([]);
    if (!configLoading)
      refreshRepoStatus(currentExercise);
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- only on exercise switch, not on every edit */
  }, [activeExerciseIndex, configLoading, refreshRepoStatus]);

  /*  Replacing or removing repositories loses edits not yet written back, so ask first  */
  const repoPending = (variantIndex: number, repoType: RepoType) => pending[variantIndex]?.repos[repoType].length ?? 0;
  const variantPending = (variantIndex: number) => pending[variantIndex]?.count ?? 0;
  const totalPending = pending.reduce((sum, changes) => sum + changes.count, 0);
  const guardPending = (count: number, action: () => void) => (count > 0 ? setDiscardConfirm({ count, action }) : action());

  const storedRepoCount = repoStatus.reduce((sum, counts) => sum + REPO_TYPES.filter((t) => counts[t] !== undefined).length, 0);
  const variantsWithFiles = Object.values(availableFiles).filter((v) => v.files.length > 0).length;
  const baseHasFiles = (availableFiles[variants[0]?.label || 'Variant 1']?.files.length ?? 0) > 0;
  const hasName = !!exerciseName.trim();
  const hasToken = !!artemisToken.trim();
  const anyArtemis = variants.some((v) => v.source === 'artemis');
  const artemisLoadable = variants.flatMap((v, idx) => (v.source === 'artemis' && v.artemisUrl?.trim() && isValidUrl(v.artemisUrl) ? [ idx ] : []));
  const downloadJobs = cloneJobs(currentExercise);

  /*  Cloning drops a variant's Artemis link, so its pending problem statement counts, too  */
  const downloadPending = downloadJobs.reduce((sum, job) => sum + repoPending(job.index, job.repoType), 0)
    + [ ...new Set(downloadJobs.map((job) => job.index)) ].filter((index) => pending[index]?.problemStatement).length;

  const invalidUrlCount = downloadJobs.filter((job) => !isValidUrl(job.url)).length;
  const downloadBlocker = !hasName ? 'Enter an exercise name first.'
    : downloadJobs.length === 0 ? 'Enter at least one repository URL (variants in "Repository URLs" mode).'
    : invalidUrlCount > 0 ? `Fix ${invalidUrlCount} invalid repository URL${invalidUrlCount > 1 ? 's' : ''} first.`
    : undefined;

  const updateCurrentExercise = (update: (exercise: ExerciseConfig) => ExerciseConfig) => {
    setExercises((prev) => prev.map((ex, idx) => (idx === activeExerciseIndex ? update(ex) : ex)));
  };

  // Export config to JSON file
  const handleExport = async () => {
    try {
      const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const filename = `${exportName.trim()}-${date}.json`;

      downloadFile(filename, exportConfigJson(), 'application/json');

      addToast(`Config exported as ${filename}`, 'success');
    } catch (error) {
      addToast(`Export failed: ${toErrorMessage(error)}`, 'error');
    }
  };

  // Import config from JSON file
  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      let config: MultiExerciseConfig;
      try {
        config = importConfigJson(text);
      } catch (parseError) {
        throw new Error(`Invalid config file: ${toErrorMessage(parseError)}`);
      }
      setExercises(config.exercises);
      setActiveExerciseIndex(config.activeExerciseIndex || 0);
      const active = config.exercises[config.activeExerciseIndex || 0];
      if (active)
        refreshRepoStatus(active);

      addToast(`Config imported from ${file.name}`, 'success');
    } catch (error) {
      addToast(`Import failed: ${toErrorMessage(error)}`, 'error');
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleVariantChange = (index: number, field: keyof VariantForm, value: string) => {
    updateCurrentExercise((ex) => ({
      ...ex,
      variants: ex.variants.map((variant, idx) => (idx === index ? { ...variant, [field]: value } : variant)),
    }));
  };

  /*  Renaming: remember the exercise on focus, move its stored repositories on blur  */
  const handleRenameStart = () => {
    renameOrigin.current = currentExercise;
  };

  /*  labelIndex: the renamed variant, undefined = the exercise name  */
  const handleRenameCommit = async (labelIndex?: number) => {
    const origin = renameOrigin.current;
    renameOrigin.current = null;
    const after = currentExercise;
    if (!origin)
      return;

    /*  Only the edited field is taken from the focus snapshot (other fields there may be stale)  */
    const withOriginLabel = (variants: VariantForm[]) => variants.map((v, idx) => (idx === labelIndex ? { ...v, label: origin.variants[idx]?.label ?? v.label } : v));
    const before: ExerciseConfig = labelIndex === undefined
      ? { ...after, exerciseName: origin.exerciseName }
      : { ...after, variants: withOriginLabel(after.variants) };
    if (exerciseDir(before) === exerciseDir(after) && before.variants.every((_, idx) => variantDir(before, idx) === variantDir(after, idx))
      && before.variants.every((v, idx) => v.label === after.variants[idx]?.label))
      return;
    const revert = (message: string) => {
      updateCurrentExercise((ex) => (labelIndex === undefined
        ? { ...ex, exerciseName: before.exerciseName }
        : { ...ex, variants: withOriginLabel(ex.variants) }));
      addToast(`Rename reverted: ${message}`, 'error');
    };
    const hadRepos = repoStatus.some((counts) => REPO_TYPES.some((t) => counts[t] !== undefined));

    const exerciseMoved = exerciseDir(before) !== exerciseDir(after);
    if (exerciseMoved && hadRepos && !after.exerciseName.trim())
      return revert('an exercise with stored repositories needs a name.');
    if (exerciseMoved && exercises.some((ex, idx) => idx !== activeExerciseIndex && exerciseDir(ex) === exerciseDir(after)))
      return revert(`another exercise is already named "${after.exerciseName.trim()}".`);
    const variantDirs = after.variants.map((_, idx) => variantDir(after, idx));
    if (new Set(variantDirs).size !== variantDirs.length)
      return revert('variant labels must be distinct.');

    /*  Keep file mappings pointing at renamed variants  */
    const renamedLabels = new Map(before.variants.map((v, idx) => [ v.label, after.variants[idx]?.label ?? v.label ] as const)
      .filter(([ from, to ]) => from !== to));
    if (renamedLabels.size > 0)
      updateCurrentExercise((ex) => ({
        ...ex,
        fileMappings: (ex.fileMappings || []).map((m) => ({ ...m, variantLabel: renamedLabels.get(m.variantLabel) ?? m.variantLabel })),
      }));
    if (!hadRepos)
      return;

    setLoading('rename');
    try {
      if (exerciseMoved)
        await moveDir(exerciseDir(before), exerciseDir(after));
      else {

        /*  Two-step move so swapping labels between variants does not collide  */
        const moves = before.variants.map((_, idx) => [ variantDir(before, idx), variantDir(after, idx) ] as const)
          .filter(([ from, to ]) => from !== to);
        for (const [ from ] of moves)
          await moveDir(from, `${from}.__renaming`);
        for (const [ from, to ] of moves)
          await moveDir(`${from}.__renaming`, to);
      }
      await refreshRepoStatus(after);
    } catch (error) {
      revert(toErrorMessage(error));
    } finally {
      setLoading(null);
    }
  };

  const handleAddFileMapping = () => {
    updateCurrentExercise((ex) => ({
      ...ex,
      fileMappings: [ ...(ex.fileMappings || []), { baseFile: '', variantFile: '', variantLabel: variants[1]?.label || 'Variant 2' } ],
    }));
  };

  const handleFileMappingChange = (mappingIndex: number, field: keyof FileMapping, value: string) => {
    updateCurrentExercise((ex) => ({
      ...ex,
      fileMappings: (ex.fileMappings || []).map((mapping, mIdx) => {
        if (mIdx !== mappingIndex) return mapping;
        const updated = { ...mapping, [field]: value };
        // Reset variantFile when variant label changes
        if (field === 'variantLabel') {
          updated.variantFile = '';
        }
        return updated;
      }),
    }));
  };

  const handleRemoveFileMapping = (mappingIndex: number) => {
    updateCurrentExercise((ex) => ({
      ...ex,
      fileMappings: (ex.fileMappings || []).filter((_, mIdx) => mIdx !== mappingIndex),
    }));
  };

  const handleDownload = async () => {
    setLoading('download');
    setResults([]);
    setShowProgress(true);
    setDownloadProgress(0);
    setCurrentStep('Preparing downloads...');
    try {
      const events = await cloneExercise(currentExercise, (done, total) => {
        setDownloadProgress(Math.round((done / total) * 100));
        setCurrentStep(`Cloned ${done} of ${total} repositories...`);
      });
      setResults(events);
      const failed = events.filter((event) => !event.success);
      if (failed.length > 0)
        addToast(`${failed.length} repositories failed: ${failed.map((e) => `${e.variant} – ${formatRepoType(e.repoType)}`).join(', ')}`, 'error');
      else
        addToast('Repositories downloaded.', 'success');
    } catch (error) {
      addToast(`Download failed: ${toErrorMessage(error)}`, 'error');
    } finally {
      await refreshRepoStatus(currentExercise);
      setTimeout(() => {
        setShowProgress(false);
        setDownloadProgress(0);
        setCurrentStep('');
      }, 600);
      setLoading(null);
    }
  };

  const handleRepoImport = async (variantIndex: number, repoType: RepoType, files: File[], kind: ImportKind) => {
    if (!files.length) return;
    setLoading('import');
    try {
      const count = kind === 'zip'
        ? await importZip(currentExercise, variantIndex, repoType, files[0]!)
        : await importFolder(currentExercise, variantIndex, repoType, files);
      addToast(`Imported ${count} files into ${variants[variantIndex]?.label} – ${formatRepoType(repoType)}.`, 'success');
    } catch (error) {
      addToast(`Import failed: ${toErrorMessage(error)}`, 'error');
    } finally {
      await refreshRepoStatus(currentExercise);
      setLoading(null);
    }
  };

  const handleRemoveRepo = async (variantIndex: number, repoType: RepoType) => {
    setLoading('clear');
    try {
      await removeRepo(currentExercise, variantIndex, repoType);
    } catch (error) {
      addToast(`Removing failed: ${toErrorMessage(error)}`, 'error');
    } finally {
      await refreshRepoStatus(currentExercise);
      setLoading(null);
    }
  };

  /*  Import full Artemis exercise exports (uploaded ZIP or fetched by URL) into variants;
      an empty exercise name is taken from the first export's title  */
  const handleArtemisImport = async (variantIndexes: number[], source?: File) => {
    setLoading('artemis');
    let name = exerciseName.trim();
    try {
      for (const variantIndex of variantIndexes) {
        const label = variants[variantIndex]?.label || `Variant ${variantIndex + 1}`;
        setCurrentStep(`Loading Artemis exercise for ${label}...`);
        try {
          const bytes = source
            ? new Uint8Array(await source.arrayBuffer())
            : await fetchArtemisExport(variants[variantIndex]?.artemisUrl ?? '');
          const parsed = parseArtemisExport(bytes);
          name ||= parsed.title?.trim() ?? '';
          if (!name)
            throw new Error('Please provide an exercise name first.');
          const imported = await importArtemisExport({ ...currentExercise, exerciseName: name }, variantIndex, bytes, parsed, /*  NOSONAR: the first export may set the exercise name  */
            source ? undefined : variants[variantIndex]?.artemisUrl);
          updateCurrentExercise((ex) => ({
            ...ex,
            exerciseName: name,
            variants: ex.variants.map((variant, idx) => (idx === variantIndex
              ? { ...variant, markdown: parsed.problemStatement ?? '' }
              : variant)),
          }));
          addToast(`${label}: imported ${imported.map(formatRepoType).join(', ')} from Artemis.`, 'success');
        } catch (error) {
          addToast(`${label}: Artemis import failed: ${toErrorMessage(error)}`, 'error');
        }
      }
    } finally {
      await refreshRepoStatus({ ...currentExercise, exerciseName: name });
      setCurrentStep('');
      setLoading(null);
    }
  };

  const handleClearRepos = async () => {
    setLoading('clear');
    try {
      await clearExerciseRepos(currentExercise);
      setResults([]);
      setSuggestions([]);
      addToast('Downloaded repositories removed from browser storage.', 'success');
    } catch (error) {
      addToast(`Clearing failed: ${toErrorMessage(error)}`, 'error');
    } finally {
      await refreshRepoStatus(currentExercise);
      setLoading(null);
    }
  };

  const fetchSuggestions = async (threshold = 50) => {
    setLoadingSuggestions(true);
    try {
      setSuggestions(await suggestMappings(currentExercise, threshold));
    } catch (error) {
      console.error('Failed to fetch suggestions:', error);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const acceptSuggestion = (suggestion: { baseFile: string; variantFile: string; variantLabel: string; similarity: number }) => {
    updateCurrentExercise((ex) => ({
      ...ex,
      fileMappings: [ ...(ex.fileMappings || []), { baseFile: suggestion.baseFile, variantFile: suggestion.variantFile, variantLabel: suggestion.variantLabel } ],
    }));
    rejectSuggestion(suggestion);
  };

  const rejectSuggestion = (suggestion: { baseFile: string; variantFile: string; variantLabel: string; similarity: number }) => {
    setSuggestions((prev) => prev.filter((s) =>
      !(s.baseFile === suggestion.baseFile &&
        s.variantFile === suggestion.variantFile &&
        s.variantLabel === suggestion.variantLabel)
    ));
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="text-sm font-medium tracking-widest text-muted-foreground">Exam variant comparer</p>
          <h1 className="text-3xl font-semibold tracking-tight">Configure your repositories</h1>
          <p className="text-muted-foreground">
            Provide the template, solution, and test repositories plus a problem statement for each variant. Repositories are cloned (or imported from a folder/ZIP)
            into your browser&apos;s local storage — nothing is uploaded to a server.
          </p>
        </div>
        <SaveIndicator state={saveState} />
      </header>

      {/* Import/Export Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Import / Export Configuration</CardTitle>
          <CardDescription>Backup or restore your configuration including all exercises and review statuses.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            {/* Export */}
            <div className="flex items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="exportName" className="text-xs">Export filename</Label>
                <Input
                  id="exportName"
                  value={exportName}
                  onChange={(e) => setExportName(e.target.value)}
                  placeholder="config-backup"
                  className="w-48 h-9"
                />
              </div>
              <Button onClick={handleExport} variant="outline" size="sm" disabled={!exportName.trim()} title={!exportName.trim() ? 'Enter a filename first.' : undefined}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Export
              </Button>
            </div>

            <div className="h-9 w-px bg-border" />

            {/* Import */}
            <div className="flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleImport}
                className="hidden"
                id="config-import"
              />
              <Button onClick={() => fileInputRef.current?.click()} variant="outline" size="sm" disabled={isBusy}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                Import
              </Button>
              <span className="text-xs text-muted-foreground">Select a .json file</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="rounded-md border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
        <strong>Important:</strong> Variant 1 is treated as the source of truth for <span className="font-semibold">{exerciseName || 'this exercise'}</span>. Keep its repositories and notes authoritative;
        variants 2 and 3 should diverge only where necessary.
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Exercise</CardTitle>
          <CardDescription>Name the exercise and choose how repositories are fetched.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="exerciseName">Exercise name</Label>
            <Input
              id="exerciseName"
              placeholder="e.g. Exercise 1 - Arrays"
              value={exerciseName}
              aria-invalid={!hasName}
              className={!hasName ? 'border-amber-500' : ''}
              onFocus={handleRenameStart}
              onBlur={() => handleRenameCommit()}
              onChange={(event: ChangeEvent<HTMLInputElement>) => updateCurrentExercise((ex) => ({ ...ex, exerciseName: event.target.value }))}
              disabled={isBusy}
            />
            <p className="text-xs text-muted-foreground">
              {hasName
                ? 'Renaming keeps the stored repositories of this exercise.'
                : 'Required before downloading or importing repositories (uploading an Artemis exercise ZIP fills it in).'}
            </p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="proxyBase">Proxy base URL</Label>
              {proxyBase.trim().replace(/\/+$/, '') !== getDefaultProxyBase() && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  disabled={isBusy}
                  onClick={() => {
                    setProxyBase(getDefaultProxyBase());
                    setProxyBaseState(getDefaultProxyBase());
                  }}
                >
                  Reset to default
                </Button>
              )}
            </div>
            <UrlInput
              id="proxyBase"
              placeholder="https://your-proxy.example.com (empty = no proxy)"
              value={proxyBase}
              disabled={isBusy}
              onChange={(value) => {
                setProxyBaseState(value);
                if (isValidUrl(value))
                  setProxyBase(value);
              }}
            />
            <p className="text-xs text-muted-foreground">
              Browsers cannot clone from Git hosts or download from Artemis directly, so requests are relayed through this proxy (<code>/git-proxy</code>, <code>/artemis-proxy</code>),
              including access tokens. Leave empty to fetch directly, or use the folder/ZIP imports instead.
              Default: <code>{getDefaultProxyBase() || '(none)'}</code>.
            </p>
          </div>
          {anyArtemis && (
            <div className="space-y-2">
              <Label htmlFor="artemisToken">Artemis token (only for loading exercises by URL)</Label>
              <div className="relative">
                <Input
                  id="artemisToken"
                  type="password"
                  autoComplete="off"
                  placeholder="Value of the jwt cookie of your Artemis session"
                  value={artemisToken}
                  className="pr-8"
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    setArtemisTokenState(event.target.value);
                    setArtemisToken(event.target.value);
                  }}
                  disabled={isBusy}
                />
                {artemisToken && !isBusy && (
                  <button
                    type="button"
                    aria-label="Clear token"
                    title="Clear token"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1 text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setArtemisTokenState('');
                      setArtemisToken('');
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Log in to Artemis, open the browser dev tools (Application → Cookies) and copy the <code>jwt</code> cookie. It grants full access to your Artemis
                account until it expires, is kept for this browser session only, and is sent through the proxy. Requires instructor rights for the exercise.
                Not needed for uploading exercise ZIPs.
              </p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowClearConfirm(true)}
              disabled={isBusy || storedRepoCount === 0}
              title={storedRepoCount === 0 ? 'No repositories stored for this exercise.' : undefined}
            >
              {loading === 'clear' ? 'Clearing...' : 'Clear downloaded repositories'}
            </Button>
            <span className="text-xs text-muted-foreground">
              {storedRepoCount === 0 ? 'No repositories stored yet.' : `${storedRepoCount} repositories stored in this browser.`}
            </span>
          </div>
        </CardContent>
      </Card>

      {anyArtemis && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={isBusy || artemisLoadable.length === 0 || !hasToken}
            title={!hasToken ? 'Enter your Artemis token first.' : artemisLoadable.length === 0 ? 'Enter an Artemis exercise URL first.' : undefined}
            onClick={() => guardPending(artemisLoadable.reduce((sum, index) => sum + variantPending(index), 0), () => handleArtemisImport(artemisLoadable))}
          >
            {loading === 'artemis' ? 'Loading from Artemis...' : `Load ${artemisLoadable.length || ''} variant${artemisLoadable.length === 1 ? '' : 's'} from Artemis`}
          </Button>
          {loading === 'artemis' && <span className="text-xs text-muted-foreground">{currentStep}</span>}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        {variants.map((variant, index) => (
          <VariantCard
            key={index}
            index={index}
            variant={variant}
            status={repoStatus[index]}
            pending={pending[index]}
            isBusy={isBusy}
            hasName={hasName}
            hasToken={hasToken}
            onChange={(field, value) => handleVariantChange(index, field, value)}
            onLabelFocus={handleRenameStart}
            onLabelBlur={() => handleRenameCommit(index)}
            onRepoImport={(repoType, files, kind) => {
              const picked = Array.from(files ?? []);
              guardPending(repoPending(index, repoType), () => handleRepoImport(index, repoType, picked, kind));
            }}
            onRemoveRepo={(repoType) => guardPending(repoPending(index, repoType), () => handleRemoveRepo(index, repoType))}
            onArtemisLoad={() => guardPending(variantPending(index), () => handleArtemisImport([ index ]))}
            onArtemisUpload={(file) => guardPending(variantPending(index), () => handleArtemisImport([ index ], file))}
          />
        ))}
      </div>

      {showProgress && (
        <div className="rounded-md border border-border/70 bg-card px-4 py-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>{currentStep || 'Preparing downloads...'}</span>
            <span>{Math.round(downloadProgress)}%</span>
          </div>
          <Progress value={downloadProgress} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => guardPending(downloadPending, handleDownload)} disabled={isBusy || !!downloadBlocker}>
          {loading === 'download'
            ? 'Downloading...'
            : `Download ${downloadJobs.length || ''} ${downloadJobs.length === 1 ? 'repository' : 'repositories'}`}
        </Button>
        {downloadBlocker && <span className="text-xs text-muted-foreground">{downloadBlocker}</span>}
      </div>

      {!!results.length && (
        <Card>
          <CardHeader>
            <CardTitle>Download summary</CardTitle>
            <CardDescription>Each variant is split into dedicated folders for tests, solutions, and templates (stored in browser storage).</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-2">Variant</th>
                  <th className="py-2">Type</th>
                  <th className="py-2">Destination</th>
                  <th className="py-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result, idx) => (
                  <tr key={`${result.variant}-${result.repoType}-${idx}`} className="border-t">
                    <td className="py-2 font-medium">{result.variant}</td>
                    <td className="py-2 capitalize">{result.repoType}</td>
                    <td className="py-2 text-xs text-muted-foreground">{result.destination}</td>
                    <td className="py-2 text-right">
                      <span className={result.success ? 'text-emerald-600' : 'text-red-600'}>{result.success ? 'Success' : 'Failed'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>File Mappings (Optional)</CardTitle>
          <CardDescription>
            If variants have renamed files that should be compared together, map them here. For example, if Variant 1 has &quot;SpaceBox.java&quot;
            and Variant 2 has &quot;VolcanicCargo.java&quot;, you can map them to compare as if they had the same name.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {variantsWithFiles < 2 ? (
            <div className="rounded-md border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-900">
              <strong>Note:</strong> Download or import the repositories of at least two variants to configure file mappings.
            </div>
          ) : (
            <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
              <strong>Files available:</strong> {Object.entries(availableFiles).map(([label, data]) =>
                `${label} (${data.files.length} files)`
              ).join(', ')}
            </div>
          )}

          {/* Suggestions Section */}
          {loadingSuggestions && (
            <div className="rounded-md border border-border/70 bg-muted px-4 py-3">
              <p className="text-sm text-muted-foreground">Analyzing files for potential mappings...</p>
            </div>
          )}
          {!loadingSuggestions && suggestions.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Suggested Mappings (≥50% similarity)</p>
                <Button variant="ghost" size="sm" onClick={() => setSuggestions([])}>
                  Dismiss all
                </Button>
              </div>
              <div className="space-y-2">
                {suggestions.map((suggestion, idx) => (
                  <div key={idx} className="flex items-center gap-3 rounded-md border border-green-200 bg-green-50 p-3">
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-medium text-green-900">Match: {suggestion.similarity}%</span>
                        <span className="text-muted-foreground">•</span>
                        <span className="text-muted-foreground">{suggestion.variantLabel}</span>
                      </div>
                      <div className="grid gap-2 text-xs md:grid-cols-2">
                        <div>
                          <span className="text-muted-foreground">Base: </span>
                          <span className="font-mono">{suggestion.baseFile}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Variant: </span>
                          <span className="font-mono">{suggestion.variantFile}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => acceptSuggestion(suggestion)}
                        className="h-8 bg-green-600 hover:bg-green-700"
                      >
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => rejectSuggestion(suggestion)}
                        className="h-8"
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {fileMappings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No file mappings configured.</p>
          ) : (
            <div className="space-y-3">
              {fileMappings.map((mapping, idx) => {
                const baseVariantLabel = variants[0]?.label || 'Variant 1';
                const baseFiles = availableFiles[baseVariantLabel]?.files || [];
                const variantFiles = availableFiles[mapping.variantLabel]?.files || [];
                
                return (
                  <div key={idx} className="flex flex-col gap-3 rounded-md border border-border/70 p-4">
                    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-[2fr_2fr_1fr_auto] items-end">
                      <div className="space-y-1 min-w-0">
                        <Label htmlFor={`mapping-base-${idx}`} className="text-xs font-medium">
                          Base file ({baseVariantLabel})
                        </Label>
                        {baseFiles.length > 0 ? (
                          <select
                            id={`mapping-base-${idx}`}
                            value={mapping.baseFile}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => handleFileMappingChange(idx, 'baseFile', e.target.value)}
                            className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <option value="">Select a file...</option>
                            {baseFiles.map((file) => (
                              <option key={file} value={file} title={file}>
                                {file}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <Input
                            id={`mapping-base-${idx}`}
                            placeholder="src/SpaceBox.java"
                            value={mapping.baseFile}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => handleFileMappingChange(idx, 'baseFile', e.target.value)}
                            className="h-10 text-xs"
                          />
                        )}
                      </div>
                      <div className="space-y-1 min-w-0">
                        <Label htmlFor={`mapping-variant-${idx}`} className="text-xs font-medium">
                          Variant file ({mapping.variantLabel})
                        </Label>
                        {variantFiles.length > 0 ? (
                          <select
                            id={`mapping-variant-${idx}`}
                            value={mapping.variantFile}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => handleFileMappingChange(idx, 'variantFile', e.target.value)}
                            className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <option value="">Select a file...</option>
                            {variantFiles.map((file) => (
                              <option key={file} value={file} title={file}>
                                {file}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <Input
                            id={`mapping-variant-${idx}`}
                            placeholder="src/VolcanicCargo.java"
                            value={mapping.variantFile}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => handleFileMappingChange(idx, 'variantFile', e.target.value)}
                            className="h-10 text-xs"
                          />
                        )}
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`mapping-label-${idx}`} className="text-xs font-medium">
                          Variant label
                        </Label>
                        <select
                          id={`mapping-label-${idx}`}
                          value={mapping.variantLabel}
                          onChange={(e: ChangeEvent<HTMLSelectElement>) => handleFileMappingChange(idx, 'variantLabel', e.target.value)}
                          className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {variants.slice(1).map((v, vIdx) => (
                            <option key={vIdx} value={v.label || `Variant ${vIdx + 2}`}>
                              {v.label || `Variant ${vIdx + 2}`}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-end justify-end md:justify-start">
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleRemoveFileMapping(idx)}
                          className="h-10"
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleAddFileMapping} disabled={isBusy || variantsWithFiles < 2}>
              Add mapping
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchSuggestions()}
              disabled={isBusy || loadingSuggestions || !baseHasFiles || variantsWithFiles < 2}
              title={!baseHasFiles ? 'Variant 1 has no stored repositories.' : undefined}
            >
              {loadingSuggestions ? 'Analyzing...' : 'Suggest mappings'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={handleClearRepos}
        title="Clear downloaded repositories?"
        description={`This removes ${storedRepoCount} stored repositories of "${exerciseName || 'this exercise'}" from browser storage. The configuration (URLs, problem statements, mappings) is kept.`
          + (totalPending > 0 ? ` ${totalPending} pending changes not yet written back are lost.` : '')}
        confirmText="Clear"
        variant="destructive"
      />

      <ConfirmDialog
        isOpen={!!discardConfirm}
        onClose={() => setDiscardConfirm(null)}
        onConfirm={() => discardConfirm?.action()}
        title="Discard pending changes?"
        description={`${discardConfirm?.count ?? 0} edited files are not yet written back (see the Compare page). Replacing or removing the repositories discards these edits.`}
        confirmText="Discard and continue"
        variant="destructive"
      />
    </div>
  );

}

export default ConfigurePage;
