import { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { useExercise } from '@/contexts/ExerciseContext';
import { useToast } from '@/contexts/ToastContext';
import { buildReport, reportFileName } from '@/lib/report';
import { downloadFile } from '@/lib/utils';

type Scope = 'active' | 'all';

/*  Export the review report as Markdown: choose scope and detail, preview it, then copy or download it  */
export function ReportDialog({ onClose }: Readonly<{ onClose: () => void }>) {
  const { exercises, activeExerciseIndex } = useExercise();
  const { addToast } = useToast();
  const [ scope, setScope ] = useState<Scope>('active');
  const [ detailed, setDetailed ] = useState(false);
  const [ report, setReport ] = useState<string | null>(null);
  const [ error, setError ] = useState('');

  const exerciseIndices = scope === 'active' ? [ activeExerciseIndex ] : exercises.map((_, idx) => idx);
  const exerciseNames = exerciseIndices.map((idx) => exercises[idx]?.exerciseName ?? '');

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setError('');
    buildReport({ exerciseIndices, detailed })
      .then((text) => !cancelled && setReport(text))
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : 'Failed to build the report.'));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ scope, detailed, activeExerciseIndex, exercises.length ]);

  const copy = async () => {
    if (!report)
      return;
    try {
      await navigator.clipboard.writeText(report);
      addToast('Report copied to the clipboard.', 'success');
    }
    catch {
      addToast('Copying failed; download the report instead.', 'error');
    }
  };

  const download = () => {
    if (report)
      downloadFile(reportFileName(exerciseNames), report, 'text/markdown;charset=utf-8');
  };

  const option = (active: boolean, label: string, onClick: () => void, title: string) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
        active ? 'bg-primary text-primary-foreground' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
      }`}
    >
      {label}
    </button>
  );

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-4xl shadow-lg" role="dialog" aria-modal="true" aria-labelledby="report-dialog-title">
          <CardHeader>
            <CardTitle id="report-dialog-title">Export review report</CardTitle>
            <CardDescription>
              Markdown summary of review progress, findings with comments, remaining differences and edits:
              to remember, as proof, or to hand over to an AI agent.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Exercises:</span>
                {option(scope === 'active', 'Active exercise', () => setScope('active'), exercises[activeExerciseIndex]?.exerciseName ?? '')}
                {option(scope === 'all', `All (${exercises.length})`, () => setScope('all'), 'All configured exercises')}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Detail:</span>
                {option(!detailed, 'Compact', () => setDetailed(false), 'Statistics and file lists')}
                {option(detailed, 'Detailed', () => setDetailed(true), 'Adds diffs and context for AI agents')}
              </div>
            </div>
            <pre className="h-[55vh] overflow-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-xs whitespace-pre-wrap break-words">
              {error ? <span className="text-red-600">{error}</span> : report ?? 'Building report…'}
            </pre>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={onClose}>Close</Button>
              <Button variant="outline" onClick={copy} disabled={!report}>Copy to clipboard</Button>
              <Button onClick={download} disabled={!report}>Download .md</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
