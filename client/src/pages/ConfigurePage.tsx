import { useEffect, useState, type ChangeEvent } from 'react';

import { API_BASE } from '@/lib/api';
import type { DownloadResult, VariantForm, MultiExerciseConfig, FileMapping } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { useExercise } from '@/contexts/ExerciseContext';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const formatRepoType = (type: DownloadResult['repoType']) => type.charAt(0).toUpperCase() + type.slice(1);

const toErrorMessage = (error: unknown) => {
  if (!error) return 'Unexpected error';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object') return JSON.stringify(error);
  return 'Unexpected error';
};

function ConfigurePage() {
  const { exercises, activeExerciseIndex, setExercises, currentExercise } = useExercise();
  const [status, setStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [results, setResults] = useState<DownloadResult[]>([]);
  const [loading, setLoading] = useState<'save' | 'download' | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [showProgress, setShowProgress] = useState(false);
  const [currentStep, setCurrentStep] = useState('');
  const [availableFiles, setAvailableFiles] = useState<Record<string, { label: string; files: string[] }>>({});
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [suggestions, setSuggestions] = useState<Array<{ baseFile: string; variantFile: string; variantLabel: string; similarity: number }>>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  const variants = currentExercise.variants;
  const targetFolder = currentExercise.targetFolder;
  const exerciseName = currentExercise.exerciseName;
  const fileMappings = currentExercise.fileMappings || [];

  const handleVariantChange = (index: number, field: keyof VariantForm, value: string) => {
    setExercises((prev) => prev.map((ex, exIdx) => {
      if (exIdx !== activeExerciseIndex) return ex;
      return {
        ...ex,
        variants: ex.variants.map((variant, idx) => (idx === index ? { ...variant, [field]: value } : variant)),
      };
    }));
  };

  const handleExerciseFieldChange = (field: 'targetFolder' | 'exerciseName', value: string) => {
    setExercises((prev) => prev.map((ex, idx) => {
      if (idx !== activeExerciseIndex) return ex;
      return { ...ex, [field]: value };
    }));
  };

  const handleAddFileMapping = () => {
    setExercises((prev) => prev.map((ex, idx) => {
      if (idx !== activeExerciseIndex) return ex;
      const newMapping: FileMapping = {
        baseFile: '',
        variantFile: '',
        variantLabel: variants[1]?.label || 'Variant 2',
      };
      return {
        ...ex,
        fileMappings: [...(ex.fileMappings || []), newMapping],
      };
    }));
  };

  const handleFileMappingChange = (mappingIndex: number, field: keyof FileMapping, value: string) => {
    setExercises((prev) => prev.map((ex, idx) => {
      if (idx !== activeExerciseIndex) return ex;
      return {
        ...ex,
        fileMappings: (ex.fileMappings || []).map((mapping, mIdx) => {
          if (mIdx === mappingIndex) {
            const updated = { ...mapping, [field]: value };
            // Reset variantFile when variant label changes
            if (field === 'variantLabel') {
              updated.variantFile = '';
            }
            return updated;
          }
          return mapping;
        }),
      };
    }));
  };

  const handleRemoveFileMapping = (mappingIndex: number) => {
    setExercises((prev) => prev.map((ex, idx) => {
      if (idx !== activeExerciseIndex) return ex;
      return {
        ...ex,
        fileMappings: (ex.fileMappings || []).filter((_, mIdx) => mIdx !== mappingIndex),
      };
    }));
  };

  const buildPayload = (): MultiExerciseConfig => ({
    exercises: exercises.map(ex => ({
      targetFolder: ex.targetFolder.trim(),
      exerciseName: ex.exerciseName.trim(),
      variants: ex.variants.map((variant, idx) => ({
        label: variant.label.trim() || `Variant ${idx + 1}`,
        testRepo: variant.testRepo.trim(),
        solutionRepo: variant.solutionRepo.trim(),
        templateRepo: variant.templateRepo.trim(),
        markdown: variant.markdown,
        courseLink: variant.courseLink.trim(),
      })),
      fileMappings: ex.fileMappings || [],
    })),
    activeExerciseIndex,
  });

  const handleSave = async () => {
    setLoading('save');
    setStatus(null);
    try {
      const payload = buildPayload();
      const currentEx = payload.exercises[payload.activeExerciseIndex];
      if (!currentEx || !currentEx.targetFolder) {
        throw new Error('Please provide a target folder before saving.');
      }
      if (!currentEx.exerciseName) {
        throw new Error('Please provide an exercise name before saving.');
      }
      const response = await fetch(`${API_BASE}/api/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error ?? 'Could not save configuration');
      }
      setStatus({ type: 'success', text: 'Configuration saved locally.' });
    } catch (error) {
      setStatus({ type: 'error', text: `Save failed: ${toErrorMessage(error)}` });
    } finally {
      setLoading(null);
    }
  };

  const handleDownload = async () => {
    setLoading('download');
    setStatus(null);
    setResults([]);
    setCurrentStep('');
    let events: DownloadResult[] = [];
    try {
      const payload = buildPayload();
      const currentEx = payload.exercises[payload.activeExerciseIndex];
      if (!currentEx || !currentEx.targetFolder) {
        throw new Error('Please provide a target folder before downloading.');
      }
      if (!currentEx.exerciseName) {
        throw new Error('Please provide an exercise name before downloading.');
      }
      
      // Send only the current exercise to download endpoint
      const response = await fetch(`${API_BASE}/api/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentEx),
      });
      const data = await response.json();
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error ?? 'Download failed');
      }
      events = data.events ?? [];
      const totalSteps = Math.max(events.length, 1);
      let completed = 0;
      for (const event of events) {
        completed += 1;
        const percent = Math.min(100, Math.round((completed / totalSteps) * 100));
        setDownloadProgress(percent);
        setCurrentStep(`${event.variant} – ${formatRepoType(event.repoType)}: ${event.message}`);
        await sleep(120);
      }
      setResults(events);
      // Update the current exercise with the returned data
      if (data.targetRoot) {
        handleExerciseFieldChange('targetFolder', data.targetRoot);
      }
      setStatus({ type: 'success', text: 'Repositories downloaded.' });
    } catch (error) {
      setStatus({ type: 'error', text: `Download failed: ${toErrorMessage(error)}` });
    } finally {
      if (!events.length) {
        setDownloadProgress(100);
      }
      setTimeout(() => {
        setShowProgress(false);
        setDownloadProgress(0);
        setCurrentStep('');
      }, 600);
      setLoading(null);
    }
  };

  const isBusy = loading === 'save' || loading === 'download';

  const fetchAvailableFiles = async () => {
    setLoadingFiles(true);
    try {
      const response = await fetch(`${API_BASE}/api/files`);
      const data = await response.json();
      if (data.ok && data.filesByVariant) {
        setAvailableFiles(data.filesByVariant);
      }
    } catch (error) {
      console.error('Failed to fetch files:', error);
    } finally {
      setLoadingFiles(false);
    }
  };

  const fetchSuggestions = async (threshold = 50) => {
    setLoadingSuggestions(true);
    try {
      const response = await fetch(`${API_BASE}/api/suggest-mappings?threshold=${threshold}`);
      const data = await response.json();
      if (data.ok && data.suggestions) {
        setSuggestions(data.suggestions);
      }
    } catch (error) {
      console.error('Failed to fetch suggestions:', error);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const acceptSuggestion = (suggestion: { baseFile: string; variantFile: string; variantLabel: string; similarity: number }) => {
    setExercises((prev) => prev.map((ex, idx) => {
      if (idx !== activeExerciseIndex) return ex;
      const newMapping: FileMapping = {
        baseFile: suggestion.baseFile,
        variantFile: suggestion.variantFile,
        variantLabel: suggestion.variantLabel,
      };
      return {
        ...ex,
        fileMappings: [...(ex.fileMappings || []), newMapping],
      };
    }));
    // Remove accepted suggestion from list
    setSuggestions((prev) => prev.filter((s) => 
      !(s.baseFile === suggestion.baseFile && 
        s.variantFile === suggestion.variantFile && 
        s.variantLabel === suggestion.variantLabel)
    ));
  };

  const rejectSuggestion = (suggestion: { baseFile: string; variantFile: string; variantLabel: string; similarity: number }) => {
    setSuggestions((prev) => prev.filter((s) => 
      !(s.baseFile === suggestion.baseFile && 
        s.variantFile === suggestion.variantFile && 
        s.variantLabel === suggestion.variantLabel)
    ));
  };

  useEffect(() => {
    // Fetch files and suggestions when results are available (after download)
    if (results.length > 0) {
      fetchAvailableFiles();
      fetchSuggestions();
    }
  }, [results]);

  useEffect(() => {
    if (loading === 'download') {
      setShowProgress(true);
      setDownloadProgress(0);
      setCurrentStep('Preparing downloads...');
    }
  }, [loading]);

  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-2">
        <p className="text-sm font-medium tracking-widest text-muted-foreground">Exam variant comparer</p>
        <h1 className="text-3xl font-semibold tracking-tight">Configure your repositories</h1>
        <p className="text-muted-foreground">
          Provide the template, solution, and test repositories plus a problem statement for each variant. All clones are stored inside the target folder using smart
          subdirectories.
        </p>
      </header>

      <div className="rounded-md border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
        <strong>Important:</strong> Variant 1 is treated as the source of truth for <span className="font-semibold">{exerciseName || 'this exercise'}</span>. Keep its repositories and notes authoritative;
        variants 2 and 3 should diverge only where necessary.
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Target folder</CardTitle>
          <CardDescription>Select where cloned repositories should live. This path must be inside the shared volume.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="targetFolder">Absolute or relative path</Label>
            <Input
              id="targetFolder"
              placeholder="exam-variants"
              value={targetFolder}
              onChange={(event: ChangeEvent<HTMLInputElement>) => handleExerciseFieldChange('targetFolder', event.target.value)}
              disabled={loading !== null}
            />
            <p className="text-xs text-muted-foreground">Relative paths are resolved inside /data (e.g., &quot;exam-variants&quot; → /data/exam-variants)</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="exerciseName">Exercise name</Label>
            <Input
              id="exerciseName"
              placeholder="e.g. Exercise 1 - Arrays"
              value={exerciseName}
              onChange={(event: ChangeEvent<HTMLInputElement>) => handleExerciseFieldChange('exerciseName', event.target.value)}
              disabled={loading !== null}
            />
            <p className="text-xs text-muted-foreground">Each exercise gets its own folder inside the target directory so you can store multiple variants per exercise.</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-3">
        {variants.map((variant, index) => (
          <Card key={index} className={`border border-border/70 ${index === 0 ? 'border-primary bg-primary/5' : ''}`}>
            <CardHeader>
              <CardTitle>{variant.label || `Variant ${index + 1}`}</CardTitle>
              <CardDescription>Template, solution, and test repos plus problem statement.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor={`label-${index}`}>Variant label</Label>
                <Input id={`label-${index}`} value={variant.label} onChange={(event: ChangeEvent<HTMLInputElement>) => handleVariantChange(index, 'label', event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`course-link-${index}`}>Course management link</Label>
                <Input
                  id={`course-link-${index}`}
                  placeholder="https://course-system.local/courses/123"
                  value={variant.courseLink}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => handleVariantChange(index, 'courseLink', event.target.value)}
                />
                {variant.courseLink && (
                  <a href={variant.courseLink} target="_blank" rel="noreferrer" className="text-xs font-medium text-primary underline underline-offset-4">
                    Open course page for this variant
                  </a>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor={`template-${index}`}>Template repository URL</Label>
                <Input
                  id={`template-${index}`}
                  placeholder="https://github.com/org/template"
                  value={variant.templateRepo}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => handleVariantChange(index, 'templateRepo', event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`solution-${index}`}>Solution repository URL</Label>
                <Input
                  id={`solution-${index}`}
                  placeholder="https://github.com/org/solution"
                  value={variant.solutionRepo}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => handleVariantChange(index, 'solutionRepo', event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`test-${index}`}>Test repository URL</Label>
                <Input
                  id={`test-${index}`}
                  placeholder="https://github.com/org/tests"
                  value={variant.testRepo}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => handleVariantChange(index, 'testRepo', event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`markdown-${index}`}>Problem Statement</Label>
                <Textarea
                  id={`markdown-${index}`}
                  rows={4}
                  placeholder="Problem description, requirements, and grading rubric for this variant..."
                  value={variant.markdown}
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>) => handleVariantChange(index, 'markdown', event.target.value)}
                />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>File Mappings (Optional)</CardTitle>
          <CardDescription>
            If variants have renamed files that should be compared together, map them here. For example, if Variant 1 has &quot;SpaceBox.java&quot; 
            and Variant 2 has &quot;VolcanicCargo.java&quot;, you can map them to compare as if they had the same name.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingFiles && (
            <p className="text-sm text-muted-foreground">Loading available files...</p>
          )}
          {!loadingFiles && Object.keys(availableFiles).length === 0 && (
            <div className="rounded-md border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-900">
              <strong>Note:</strong> Download repositories first, then click &quot;Load files&quot; to see available files in the dropdowns.
            </div>
          )}
          {!loadingFiles && Object.keys(availableFiles).length > 0 && (
            <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
              <strong>Files loaded:</strong> {Object.entries(availableFiles).map(([label, data]) => 
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
            <p className="text-sm text-muted-foreground">No file mappings configured. Click &quot;Add mapping&quot; to start.</p>
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
            <Button variant="outline" size="sm" onClick={handleAddFileMapping} disabled={isBusy}>
              Add mapping
            </Button>
            {Object.keys(availableFiles).length === 0 && !loadingFiles && (
              <Button variant="outline" size="sm" onClick={fetchAvailableFiles} disabled={loadingFiles}>
                Load files
              </Button>
            )}
            {Object.keys(availableFiles).length > 0 && !loadingSuggestions && (
              <Button variant="outline" size="sm" onClick={() => fetchSuggestions()} disabled={loadingSuggestions}>
                Suggest mappings
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {status && (
        <div
          className={`rounded-md border px-4 py-3 text-sm ${
            status.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'
          }`}
        >
          {status.text}
        </div>
      )}

      {showProgress && (
        <div className="rounded-md border border-border/70 bg-card px-4 py-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>{currentStep || 'Preparing downloads...'}</span>
            <span>{Math.round(downloadProgress)}%</span>
          </div>
          <Progress value={downloadProgress} />
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <Button onClick={handleSave} disabled={isBusy || loading === 'config'}>
          {loading === 'save' ? 'Saving...' : 'Save links'}
        </Button>
        <Button variant="secondary" onClick={handleDownload} disabled={isBusy || loading === 'config'}>
          {loading === 'download' ? 'Downloading...' : 'Download repos'}
        </Button>
      </div>

      {!!results.length && (
        <Card>
          <CardHeader>
            <CardTitle>Download summary</CardTitle>
            <CardDescription>Each variant is split into dedicated folders for tests, solutions, and templates.</CardDescription>
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
    </div>
  );
}

export default ConfigurePage;
