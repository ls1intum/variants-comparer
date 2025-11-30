import { useEffect, useState } from 'react';
import { API_BASE } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import type { CompareType, FileReview } from '@/types';

type CompareTypeStats = {
  correct: number;
  needsAttention: number;
  total: number;
};

type ExerciseStats = {
  exerciseName: string;
  targetFolder: string;
  variants: string[];
  byCompareType: Record<string, CompareTypeStats>;
  byVariant: Record<string, Record<string, CompareTypeStats>>;
  totalReviewed: number;
};

type StatsResponse = {
  ok: boolean;
  stats: ExerciseStats[];
};

const compareTypeLabels: Record<string, string> = {
  problem: 'Problem Statements',
  test: 'Test Repositories',
  solution: 'Solution Repositories',
  template: 'Template Repositories',
};

const allCompareTypes: CompareType[] = ['problem', 'test', 'solution', 'template'];

function StatsPage() {
  const [stats, setStats] = useState<ExerciseStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includedTypes, setIncludedTypes] = useState<CompareType[]>(allCompareTypes);
  const [reviewStatuses, setReviewStatuses] = useState<FileReview[]>([]);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  // Function to fetch data (extracted so we can call it after clearing)
  const fetchData = async () => {
    try {
      setLoading(true);
      
      // Fetch stats, included types, and review statuses in parallel
      const [statsRes, typesRes, reviewRes] = await Promise.all([
        fetch(`${API_BASE}/api/stats`),
        fetch(`${API_BASE}/api/stats-included-types`),
        fetch(`${API_BASE}/api/review-status`),
      ]);
      
      const statsData: StatsResponse = await statsRes.json();
      const typesData = await typesRes.json();
      const reviewData = await reviewRes.json();
      
      if (statsData.ok) {
        setStats(statsData.stats);
      } else {
        setError('Failed to load stats');
      }
      
      if (typesData.ok && typesData.statsIncludedTypes) {
        setIncludedTypes(typesData.statsIncludedTypes);
      }
      
      if (reviewData.ok && reviewData.reviewStatuses) {
        setReviewStatuses(reviewData.reviewStatuses);
      }
    } catch (err) {
      setError('Failed to fetch stats');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Fetch stats, included types, and review statuses
  useEffect(() => {
    fetchData();
  }, []);

  // Clear all review statuses
  const handleClearAllStats = async () => {
    try {
      setIsClearing(true);
      const response = await fetch(`${API_BASE}/api/review-status`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (data.ok) {
        // Refresh the data
        await fetchData();
      } else {
        console.error('Failed to clear stats:', data.error);
      }
    } catch (err) {
      console.error('Failed to clear stats:', err);
    } finally {
      setIsClearing(false);
    }
  };

  // Toggle a compare type and save to server
  const toggleIncludedType = async (type: CompareType) => {
    const newIncluded = includedTypes.includes(type)
      ? includedTypes.filter(t => t !== type)
      : [...includedTypes, type];
    
    setIncludedTypes(newIncluded);
    
    // Save to server
    try {
      await fetch(`${API_BASE}/api/stats-included-types`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statsIncludedTypes: newIncluded }),
      });
    } catch (err) {
      console.error('Failed to save included types:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <header className="space-y-2">
          <p className="text-sm font-medium tracking-widest text-muted-foreground">Statistics</p>
          <h1 className="text-3xl font-semibold tracking-tight">Review Progress</h1>
        </header>
        <p className="text-muted-foreground">Loading stats...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-6">
        <header className="space-y-2">
          <p className="text-sm font-medium tracking-widest text-muted-foreground">Statistics</p>
          <h1 className="text-3xl font-semibold tracking-tight">Review Progress</h1>
        </header>
        <p className="text-red-600">{error}</p>
      </div>
    );
  }

  // Calculate overall stats (only for included types)
  const overallStats = stats.reduce(
    (acc, exercise) => {
      Object.entries(exercise.byCompareType).forEach(([type, ct]) => {
        if (includedTypes.includes(type as CompareType)) {
          acc.correct += ct.correct;
          acc.needsAttention += ct.needsAttention;
          acc.total += ct.total;
        }
      });
      return acc;
    },
    { correct: 0, needsAttention: 0, total: 0 }
  );

  const overallReviewed = overallStats.correct + overallStats.needsAttention;
  const overallProgress = overallStats.total > 0 ? (overallReviewed / overallStats.total) * 100 : 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-2">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium tracking-widest text-muted-foreground">Statistics</p>
            <h1 className="text-3xl font-semibold tracking-tight">Review Progress</h1>
            <p className="text-muted-foreground mt-2">Track your review progress across all exercises and comparison types.</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowClearConfirm(true)}
            disabled={isClearing || reviewStatuses.length === 0}
            className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2">
              <path d="M3 6h18"></path>
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
            Clear All Stats
          </Button>
        </div>
      </header>

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={handleClearAllStats}
        title="Clear All Review Stats?"
        description="This will permanently delete all review progress for all exercises. This action cannot be undone."
        confirmText="Clear All Stats"
        cancelText="Cancel"
        variant="destructive"
      />

      {/* Overall Progress */}
      <Card>
        <CardHeader>
          <CardTitle>Overall Progress</CardTitle>
          <CardDescription>Combined progress across all exercises</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Filter toggles */}
            <div className="flex flex-wrap items-center gap-2 pb-2 border-b">
              <span className="text-sm text-muted-foreground mr-2">Include in progress:</span>
              {allCompareTypes.map((type) => {
                const isIncluded = includedTypes.includes(type);
                return (
                  <button
                    key={type}
                    onClick={() => toggleIncludedType(type)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      isIncluded
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                  >
                    {compareTypeLabels[type]}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between text-sm">
              <span>
                {overallReviewed} of {overallStats.total} files reviewed
              </span>
              <span className="font-medium">{Math.round(overallProgress)}%</span>
            </div>
            <Progress value={overallProgress} className="h-3" />
            <div className="flex gap-6 text-sm">
              <div className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-full bg-green-500"></span>
                <span className="text-green-700 font-medium">{overallStats.correct} correct</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-full bg-red-500"></span>
                <span className="text-red-700 font-medium">{overallStats.needsAttention} need attention</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-full bg-slate-300"></span>
                <span className="text-slate-600">{overallStats.total - overallReviewed} remaining</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Files Needing Attention */}
      {(() => {
        const filesNeedingAttention = reviewStatuses.filter(
          (r) => r.status === 'needs-attention' && includedTypes.includes(r.compareType)
        );
        
        if (filesNeedingAttention.length === 0) return null;
        
        return (
          <Card className="border-red-200 bg-red-50/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-red-700 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                Files Needing Attention ({filesNeedingAttention.length})
              </CardTitle>
              <CardDescription>These files have been marked as requiring attention during review.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {filesNeedingAttention.map((file) => {
                  // Parse the filePath to extract exercise name and relative path
                  const [exerciseName, ...pathParts] = file.filePath.split(':');
                  const relativePath = pathParts.join(':');
                  
                  return (
                    <div
                      key={`${file.filePath}-${file.variantLabel}`}
                      className="flex items-center justify-between p-3 rounded-lg border bg-white"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm truncate">{relativePath}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          <span className="px-1.5 py-0.5 rounded bg-slate-100">{exerciseName}</span>
                          <span>→</span>
                          <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">{file.variantLabel}</span>
                          <span>•</span>
                          <span className="capitalize">{file.compareType}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Per-Exercise Stats */}
      {stats.map((exercise) => {
        // Calculate stats only for included types
        const exerciseTotal = Object.entries(exercise.byCompareType)
          .filter(([type]) => includedTypes.includes(type as CompareType))
          .reduce((sum, [, ct]) => sum + ct.total, 0);
        const exerciseReviewed = Object.entries(exercise.byCompareType)
          .filter(([type]) => includedTypes.includes(type as CompareType))
          .reduce((sum, [, ct]) => sum + ct.correct + ct.needsAttention, 0);
        const exerciseProgress = exerciseTotal > 0 ? (exerciseReviewed / exerciseTotal) * 100 : 0;
        const exerciseCorrect = Object.entries(exercise.byCompareType)
          .filter(([type]) => includedTypes.includes(type as CompareType))
          .reduce((sum, [, ct]) => sum + ct.correct, 0);
        const exerciseNeedsAttention = Object.entries(exercise.byCompareType)
          .filter(([type]) => includedTypes.includes(type as CompareType))
          .reduce((sum, [, ct]) => sum + ct.needsAttention, 0);

        return (
          <Card key={exercise.exerciseName}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle>{exercise.exerciseName}</CardTitle>
                  <CardDescription className="font-mono text-xs mt-1">{exercise.targetFolder}</CardDescription>
                </div>
                <div className="text-right">
                  <span className="text-2xl font-bold">{Math.round(exerciseProgress)}%</span>
                  <p className="text-xs text-muted-foreground">reviewed</p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {/* Exercise-level summary */}
                <div className="space-y-2">
                  <Progress value={exerciseProgress} className="h-2" />
                  <div className="flex gap-4 text-xs">
                    <span className="text-green-700">✓ {exerciseCorrect} correct</span>
                    <span className="text-red-600">⚠ {exerciseNeedsAttention} need attention</span>
                    <span className="text-slate-500">{exerciseTotal - exerciseReviewed} remaining</span>
                  </div>
                </div>

                {/* Per compare type breakdown - only show included types */}
                <div className="grid gap-4 md:grid-cols-2">
                  {Object.entries(exercise.byCompareType)
                    .filter(([type]) => includedTypes.includes(type as CompareType))
                    .map(([type, ct]) => {
                    const reviewed = ct.correct + ct.needsAttention;
                    const progress = ct.total > 0 ? (reviewed / ct.total) * 100 : 0;
                    const remaining = ct.total - reviewed;

                    return (
                      <div key={type} className="p-4 rounded-lg border bg-slate-50/50">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium text-sm">{compareTypeLabels[type] || type}</span>
                          <span className="text-xs text-muted-foreground">
                            {reviewed}/{ct.total}
                          </span>
                        </div>
                        <Progress value={progress} className="h-1.5 mb-2" />
                        <div className="flex gap-3 text-xs">
                          {ct.correct > 0 && (
                            <span className="text-green-700">✓ {ct.correct}</span>
                          )}
                          {ct.needsAttention > 0 && (
                            <span className="text-red-600">⚠ {ct.needsAttention}</span>
                          )}
                          {remaining > 0 && (
                            <span className="text-slate-500">{remaining} left</span>
                          )}
                          {ct.total === 0 && (
                            <span className="text-slate-400 italic">No files</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Per-variant breakdown */}
                {exercise.byVariant && Object.keys(exercise.byVariant).length > 0 && (
                  <div className="border-t pt-4 mt-4">
                    <h4 className="text-sm font-medium mb-3 text-muted-foreground">Per Variant Breakdown</h4>
                    <div className="space-y-4">
                      {Object.entries(exercise.byVariant).map(([variantLabel, variantStats]) => {
                        const variantTotal = Object.entries(variantStats)
                          .filter(([type]) => includedTypes.includes(type as CompareType))
                          .reduce((sum, [, ct]) => sum + ct.total, 0);
                        const variantReviewed = Object.entries(variantStats)
                          .filter(([type]) => includedTypes.includes(type as CompareType))
                          .reduce((sum, [, ct]) => sum + ct.correct + ct.needsAttention, 0);
                        const variantProgress = variantTotal > 0 ? (variantReviewed / variantTotal) * 100 : 0;
                        const variantCorrect = Object.entries(variantStats)
                          .filter(([type]) => includedTypes.includes(type as CompareType))
                          .reduce((sum, [, ct]) => sum + ct.correct, 0);
                        const variantNeedsAttention = Object.entries(variantStats)
                          .filter(([type]) => includedTypes.includes(type as CompareType))
                          .reduce((sum, [, ct]) => sum + ct.needsAttention, 0);

                        return (
                          <div key={variantLabel} className="p-3 rounded-lg border bg-white">
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-medium text-sm">{variantLabel}</span>
                              <span className="text-xs text-muted-foreground">
                                {variantReviewed}/{variantTotal} ({Math.round(variantProgress)}%)
                              </span>
                            </div>
                            <Progress value={variantProgress} className="h-1.5 mb-2" />
                            <div className="flex flex-wrap gap-3 text-xs">
                              {variantCorrect > 0 && (
                                <span className="text-green-700">✓ {variantCorrect}</span>
                              )}
                              {variantNeedsAttention > 0 && (
                                <span className="text-red-600">⚠ {variantNeedsAttention}</span>
                              )}
                              {variantTotal - variantReviewed > 0 && (
                                <span className="text-slate-500">{variantTotal - variantReviewed} left</span>
                              )}
                            </div>
                            {/* Mini breakdown by type */}
                            <div className="mt-2 flex flex-wrap gap-2">
                              {Object.entries(variantStats)
                                .filter(([type]) => includedTypes.includes(type as CompareType))
                                .map(([type, ct]) => {
                                  const typeReviewed = ct.correct + ct.needsAttention;
                                  return (
                                    <span
                                      key={type}
                                      className={`text-xs px-2 py-0.5 rounded ${
                                        typeReviewed === ct.total && ct.total > 0
                                          ? 'bg-green-100 text-green-700'
                                          : typeReviewed > 0
                                          ? 'bg-amber-100 text-amber-700'
                                          : 'bg-slate-100 text-slate-500'
                                      }`}
                                    >
                                      {compareTypeLabels[type]?.split(' ')[0] || type}: {typeReviewed}/{ct.total}
                                    </span>
                                  );
                                })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {stats.length === 0 && (
        <Card>
          <CardContent className="py-8">
            <p className="text-center text-muted-foreground">
              No exercises configured yet. Go to Configure to set up exercises.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default StatsPage;
