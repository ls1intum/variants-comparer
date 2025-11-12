import { useEffect, useState, useRef } from 'react';
import DiffMatchPatch from 'diff-match-patch';

import { API_BASE } from '@/lib/api';
import type { CompareType, ComparisonResponse, FileComparison } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useExercise } from '@/contexts/ExerciseContext';

const compareOptions: { value: CompareType; label: string }[] = [
  { value: 'problem', label: 'Problem Statement (Markdown)' },
  { value: 'test', label: 'Test Repositories' },
  { value: 'template', label: 'Exercise / Template Repositories' },
  { value: 'solution', label: 'Solution Repositories' },
];

// Character-level diff using Myers algorithm
type CharSegment = { text: string; type: 'equal' | 'insert' | 'delete' };

function getInlineDiff(text1: string, text2: string): { left: CharSegment[]; right: CharSegment[] } {
  const dmp = new DiffMatchPatch();
  const diffs = dmp.diff_main(text1, text2);
  dmp.diff_cleanupSemantic(diffs); // Makes diff more human-readable
  
  const left: CharSegment[] = [];
  const right: CharSegment[] = [];
  
  diffs.forEach(([operation, text]) => {
    if (operation === -1) {
      // Deletion - show on left only
      left.push({ text, type: 'delete' });
    } else if (operation === 1) {
      // Insertion - show on right only
      right.push({ text, type: 'insert' });
    } else {
      // Equal - show on both sides
      left.push({ text, type: 'equal' });
      right.push({ text, type: 'equal' });
    }
  });
  
  return { left, right };
}

function FileComparisonCard({ 
  fileComp, 
  baseVariant, 
  activeVariantIndex 
}: { 
  fileComp: FileComparison; 
  baseVariant: string;
  activeVariantIndex: number;
}) {
  const baseLines = fileComp.baseContent.split('\n');
  const scrollRefs = useRef<(HTMLDivElement | null)[]>([]);
  const hasScrolledToFirst = useRef(false);
  
  // Only show the selected variant
  const selectedVariant = fileComp.variants[activeVariantIndex];
  
  const handleScroll = (scrollingIndex: number) => (e: React.UIEvent<HTMLDivElement>) => {
    const scrollTop = e.currentTarget.scrollTop;
    const scrollLeft = e.currentTarget.scrollLeft;
    
    // Sync scroll position to the other container
    scrollRefs.current.forEach((ref, idx) => {
      if (ref && idx !== scrollingIndex) {
        ref.scrollTop = scrollTop;
        ref.scrollLeft = scrollLeft;
      }
    });
  };

  // Auto-scroll to first difference on mount or variant change
  useEffect(() => {
    hasScrolledToFirst.current = false;
  }, [activeVariantIndex]);

  useEffect(() => {
    if (hasScrolledToFirst.current || !selectedVariant) return;
    
    // Find first line with a difference
    let firstDiffLineIndex = -1;
    
    if (selectedVariant.lineDiff.length > 0) {
      firstDiffLineIndex = selectedVariant.lineDiff.findIndex(d => d.type !== 'equal');
    }
    
    // Scroll to the first difference
    if (firstDiffLineIndex > 0) {
      setTimeout(() => {
        scrollRefs.current.forEach((ref) => {
          if (ref) {
            const lineHeight = 24; // Approximate height of one line
            const contextLines = 5; // Show 5 lines of context before the diff
            const scrollTo = Math.max(0, (firstDiffLineIndex - contextLines) * lineHeight);
            ref.scrollTop = scrollTo;
          }
        });
        hasScrolledToFirst.current = true;
      }, 100);
    }
  }, [selectedVariant]);

  if (!selectedVariant) {
    return null;
  }

  return (
    <Card className="border border-slate-300">
      <CardHeader>
        <CardTitle className="text-base font-mono">{fileComp.relativePath}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Base variant column - show removed/modified lines highlighted */}
          <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-700">{baseVariant}</p>
            <div
              ref={(el) => { scrollRefs.current[0] = el; }}
              onScroll={handleScroll(0)}
              className="max-h-[600px] overflow-auto rounded-md bg-white border border-slate-200 shadow-inner"
            >
              <table className="w-full text-xs font-mono">
                <tbody>
                  {selectedVariant.lineDiff.length > 0 ? (
                    // Show line diff - highlight what was removed/changed in base
                    (() => {
                      let baseLineNum = 0;
                      return selectedVariant.lineDiff.map((diffLine, idx) => {
                        const bgClass =
                          diffLine.type === 'remove'
                            ? 'bg-red-100'
                            : diffLine.type === 'modify'
                            ? 'bg-yellow-50'
                            : '';
                        
                        const lineContent = diffLine.base ?? '';
                        const showLine = diffLine.type !== 'add'; // Don't show added lines in base
                        
                        if (!showLine) {
                          // Show empty placeholder for added lines to keep alignment
                          return (
                            <tr key={idx} className="bg-slate-50/30 h-6">
                              <td className="w-8 px-2 py-0.5 text-right text-slate-400 select-none border-r border-slate-200 bg-slate-100 h-6">
                                &nbsp;
                              </td>
                              <td className="px-3 py-0.5 whitespace-pre-wrap break-all h-6">
                                &nbsp;
                              </td>
                            </tr>
                          );
                        }
                        
                        baseLineNum++;
                        
                        // For modified lines, show character-level diff
                        const renderBaseContent = () => {
                          if (diffLine.type === 'modify' && diffLine.base && diffLine.variant) {
                            const { left } = getInlineDiff(diffLine.base, diffLine.variant);
                            return (
                              <span>
                                {left.map((segment, segIdx) => (
                                  <span
                                    key={segIdx}
                                    className={segment.type === 'delete' ? 'bg-red-600 text-white' : ''}
                                  >
                                    {segment.text}
                                  </span>
                                ))}
                              </span>
                            );
                          }
                          return lineContent || ' ';
                        };
                        
                        return (
                          <tr key={idx} className={`${bgClass} h-6`}>
                            <td className="w-8 px-2 py-0.5 text-right text-slate-400 select-none border-r border-slate-200 bg-slate-50 h-6">
                              {baseLineNum}
                            </td>
                            <td className="px-3 py-0.5 whitespace-pre-wrap break-all h-6">
                              {renderBaseContent()}
                            </td>
                          </tr>
                        );
                      });
                    })()
                  ) : (
                    // No diff, show base content as-is
                    baseLines.map((line, idx) => (
                      <tr key={idx}>
                        <td className="w-8 px-2 py-0.5 text-right text-slate-400 select-none border-r border-slate-200 bg-slate-50">
                          {idx + 1}
                        </td>
                        <td className="px-3 py-0.5 whitespace-pre-wrap break-all">
                          {line || ' '}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Selected variant column - show added/modified lines highlighted */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-700">
                {selectedVariant.variant}
                {!selectedVariant.exists && <span className="ml-2 text-xs text-red-600">(missing)</span>}
              </p>
              {(() => {
                const addedLines = selectedVariant.lineDiff.filter(d => d.type === 'add').length;
                const removedLines = selectedVariant.lineDiff.filter(d => d.type === 'remove').length;
                const modifiedLines = selectedVariant.lineDiff.filter(d => d.type === 'modify').length;
                const hasChanges = addedLines > 0 || removedLines > 0 || modifiedLines > 0;
                
                return hasChanges && (
                  <div className="flex items-center gap-2 text-xs font-mono">
                    {addedLines > 0 && (
                      <span className="text-green-700 font-semibold">+{addedLines}</span>
                    )}
                    {removedLines > 0 && (
                      <span className="text-red-600 font-semibold">-{removedLines}</span>
                    )}
                    {modifiedLines > 0 && (
                      <span className="text-yellow-700 font-semibold">~{modifiedLines}</span>
                    )}
                  </div>
                );
              })()}
            </div>
            <div
              ref={(el) => { scrollRefs.current[1] = el; }}
              onScroll={handleScroll(1)}
              className="max-h-[600px] overflow-auto rounded-md shadow-inner border border-slate-200 bg-white"
            >
              <table className="w-full text-xs font-mono">
                <tbody>
                  {selectedVariant.lineDiff.length > 0 ? (
                    // Show line diff - highlight what was added/changed in variant
                    (() => {
                      let variantLineNum = 0;
                      return selectedVariant.lineDiff.map((diffLine, idx) => {
                        const bgClass =
                          diffLine.type === 'add'
                            ? 'bg-green-100'
                            : diffLine.type === 'modify'
                            ? 'bg-yellow-50'
                            : '';
                        
                        const lineContent = diffLine.variant ?? '';
                        const showLine = diffLine.type !== 'remove'; // Don't show removed lines in variant
                      
                        if (!showLine) {
                          // Show empty placeholder for removed lines to keep alignment
                          return (
                            <tr key={idx} className="bg-slate-50/30 h-6">
                              <td className="w-8 px-2 py-0.5 text-right text-slate-400 select-none border-r border-slate-200 bg-slate-100 h-6">
                                &nbsp;
                              </td>
                              <td className="px-3 py-0.5 whitespace-pre-wrap break-all h-6">
                                &nbsp;
                              </td>
                            </tr>
                          );
                        }
                        
                        variantLineNum++;
                        
                        // For modified lines, show character-level diff
                        const renderVariantContent = () => {
                          if (diffLine.type === 'modify' && diffLine.base && diffLine.variant) {
                            const { right } = getInlineDiff(diffLine.base, diffLine.variant);
                            return (
                              <span>
                                {right.map((segment, segIdx) => (
                                  <span
                                    key={segIdx}
                                    className={segment.type === 'insert' ? 'bg-green-600 text-white' : ''}
                                  >
                                    {segment.text}
                                  </span>
                                ))}
                              </span>
                            );
                          }
                          return lineContent || ' ';
                        };
                        
                        return (
                          <tr key={idx} className={`${bgClass} h-6`}>
                            <td className="w-8 px-2 py-0.5 text-right text-slate-400 select-none border-r border-slate-200 bg-slate-50 h-6">
                              {variantLineNum}
                            </td>
                            <td className="px-3 py-0.5 whitespace-pre-wrap break-all h-6">
                              {renderVariantContent()}
                            </td>
                          </tr>
                        );
                      });
                    })()
                  ) : (
                    // No diff, show content as-is
                    (() => {
                      const variantLines = selectedVariant.content.split('\n');
                      return variantLines.map((line, idx) => (
                        <tr key={idx}>
                          <td className="w-8 px-2 py-0.5 text-right text-slate-400 select-none border-r border-slate-200 bg-slate-50">
                            {idx + 1}
                          </td>
                          <td className="px-3 py-0.5 whitespace-pre-wrap break-all">
                            {line || ' '}
                          </td>
                        </tr>
                      ));
                    })()
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ComparePage() {
  const { currentExercise, activeExerciseIndex, isSaving } = useExercise();
  const [compareType, setCompareType] = useState<CompareType>('problem');
  const [comparison, setComparison] = useState<ComparisonResponse | null>(null);
  const [compareStatus, setCompareStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [compareError, setCompareError] = useState<string>('');
  const [activeVariantIndex, setActiveVariantIndex] = useState(0);

  const exerciseName = currentExercise.exerciseName;
  const targetFolder = currentExercise.targetFolder;

  // Reset variant index when comparison data changes
  useEffect(() => {
    setActiveVariantIndex(0);
  }, [comparison]);

  useEffect(() => {
    // Wait for save to complete before fetching
    if (isSaving) {
      console.log('Waiting for save to complete...');
      return;
    }
    
    const fetchComparison = async () => {
      console.log('Fetching comparison for exercise index:', activeExerciseIndex);
      setCompareStatus('loading');
      setCompareError('');
      
      // Add a small delay to ensure the save has fully persisted
      await new Promise(resolve => setTimeout(resolve, 100));
      
      try {
        const response = await fetch(`${API_BASE}/api/compare`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ compareType }),
        });
        const payload = await response.json();
        console.log('Comparison response:', payload);
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error ?? 'Unable to compute comparison');
        }
        setComparison(payload);
        setCompareStatus('idle');
      } catch (error) {
        console.error(error);
        setCompareError(error instanceof Error ? error.message : 'Unknown error');
        setCompareStatus('error');
      }
    };

    fetchComparison();
  }, [compareType, activeExerciseIndex, isSaving]); // Re-fetch when exercise changes or save completes

  const renderConfigSummary = () => {
    if (!exerciseName || !targetFolder) {
      return <p className="text-sm text-red-600">Could not load config. Make sure you saved links first.</p>;
    }

    return (
      <Card>
        <CardHeader>
          <CardTitle>Exercise overview</CardTitle>
          <CardDescription>Currently saved metadata and targets.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 text-sm">
          <div>
            <p className="text-muted-foreground">Exercise name</p>
            <p className="font-medium">{exerciseName}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Target folder</p>
            <p className="font-mono text-xs">{targetFolder}</p>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderComparisons = () => {
    if (compareStatus === 'loading') {
      return <p className="text-sm text-muted-foreground">Computing diff...</p>;
    }
    if (compareStatus === 'error') {
      return <p className="text-sm text-red-600">{compareError || 'Comparison failed.'}</p>;
    }
    if (!comparison) {
      return null;
    }

    // Handle new file-centric format with line diff
    if (comparison.fileComparisons && comparison.variantLabels) {
      if (comparison.fileComparisons.length === 0) {
        return <p className="text-sm text-muted-foreground">No differences detected.</p>;
      }

      const totalVariants = comparison.variantLabels.length;
      const canSwitchVariant = totalVariants > 1;

      return (
        <>
          <div className="space-y-6">
            {comparison.fileComparisons.map((fileComp) => (
              <FileComparisonCard 
                key={fileComp.relativePath} 
                fileComp={fileComp} 
                baseVariant={comparison.baseVariant}
                activeVariantIndex={activeVariantIndex}
              />
            ))}
          </div>
          
          {/* Floating variant switcher button */}
          {canSwitchVariant && (
            <div className="fixed bottom-6 right-6 z-50">
              <Button
                onClick={() => setActiveVariantIndex((prev) => (prev + 1) % totalVariants)}
                className="shadow-lg rounded-full h-14 px-6 text-base font-semibold"
                size="lg"
              >
                Comparing: {comparison.variantLabels[activeVariantIndex]}
                <span className="ml-2 text-xs opacity-70">
                  ({activeVariantIndex + 1}/{totalVariants})
                </span>
              </Button>
            </div>
          )}
        </>
      );
    }

    // Legacy format fallback
    return <p className="text-sm text-muted-foreground">No comparison data available.</p>;
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-2">
        <p className="text-sm font-medium tracking-widest text-muted-foreground">Comparison</p>
        <h1 className="text-3xl font-semibold tracking-tight">Cross-check all variants</h1>
        <p className="text-muted-foreground">Choose what to compare and inspect inline diffs against Variant 1.</p>
      </header>

      {renderConfigSummary()}

      <Card>
        <CardHeader>
          <CardTitle>Comparison scope</CardTitle>
          <CardDescription>Select the content to diff against Variant 1.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2">
            <Label htmlFor="compareType">Compare</Label>
            <select
              id="compareType"
              value={compareType}
              onChange={(event) => setCompareType(event.target.value as CompareType)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {compareOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {renderComparisons()}
    </div>
  );
}

export default ComparePage;
