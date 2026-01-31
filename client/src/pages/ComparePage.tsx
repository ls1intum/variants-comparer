import { useEffect, useState, useRef, useCallback } from 'react';
import DiffMatchPatch from 'diff-match-patch';

import { API_BASE } from '@/lib/api';
import type { CompareType, ComparisonResponse, FileComparison, ReviewStatus } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

type OpenExternalAction = 'vscode-together' | 'vscode-separately';

function FileComparisonCard({ 
  fileComp, 
  baseVariant, 
  activeVariantIndex,
  fileMappings = [],
  reviewStatus,
  onReviewStatusChange,
  compareType,
  onOpenExternal,
}: { 
  fileComp: FileComparison; 
  baseVariant: string;
  activeVariantIndex: number;
  fileMappings?: Array<{ baseFile: string; variantFile: string; variantLabel: string }>;
  reviewStatus: ReviewStatus;
  onReviewStatusChange: (status: ReviewStatus) => void;
  compareType: CompareType;
  onOpenExternal: (relativePath: string, variantLabel: string, action: OpenExternalAction, mappedPath?: string) => void;
}) {
  const baseLines = fileComp.baseContent.split('\n');
  const scrollRefs = useRef<(HTMLDivElement | null)[]>([]);
  const hasScrolledToFirst = useRef(false);
  const [showOpenMenu, setShowOpenMenu] = useState(false);
  const menuTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Bug fix: Clear timeout on unmount to prevent memory leak
  useEffect(() => {
    return () => {
      if (menuTimeoutRef.current) {
        clearTimeout(menuTimeoutRef.current);
      }
    };
  }, []);
  
  const handleMenuBlur = useCallback(() => {
    menuTimeoutRef.current = setTimeout(() => setShowOpenMenu(false), 150);
  }, []);
  
  // Only show the selected variant
  const selectedVariant = fileComp.variants[activeVariantIndex];
  
  // Check if this file has a mapping
  const mapping = fileMappings.find(
    m => m.baseFile === fileComp.relativePath && m.variantLabel === selectedVariant?.variant
  );
  
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

  const borderColorClass = 
    reviewStatus === 'correct' ? 'border-green-500 border-2' : 
    reviewStatus === 'needs-attention' ? 'border-red-500 border-2' : 
    'border-slate-300';

  // External tools available for repo comparisons, not markdown
  const canOpenExternal = compareType !== 'problem';

  return (
    <Card className={`border ${borderColorClass}`}>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <CardTitle className="text-base font-mono flex-1">{fileComp.relativePath}</CardTitle>
          <div className="flex items-center gap-2 shrink-0">
            {mapping && (
              <div className="flex items-center gap-2 text-xs">
                <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
                  Mapped
                </span>
                <span className="text-muted-foreground">
                  <span className="font-mono font-medium">{mapping.variantFile}</span>
                </span>
              </div>
            )}
            {/* VS Code dropdown */}
            {canOpenExternal && selectedVariant && (
              <div className="relative">
                <button
                  onClick={() => setShowOpenMenu(!showOpenMenu)}
                  onBlur={handleMenuBlur}
                  className="p-1.5 rounded-md transition-colors hover:bg-blue-50 flex items-center gap-1"
                  title="Open in VS Code"
                >
                  <img src="/vscode_icon.svg" alt="VS Code" width="16" height="16" />
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </button>
                {showOpenMenu && (
                  <div className="absolute right-0 top-full mt-1 bg-white rounded-md shadow-lg border border-slate-200 py-1 z-50 min-w-[200px]">
                    <button
                      onClick={() => {
                        onOpenExternal(fileComp.relativePath, selectedVariant.variant, 'vscode-together', mapping?.variantFile);
                        setShowOpenMenu(false);
                      }}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 flex items-center gap-2"
                    >
                      <img src="/vscode_icon.svg" alt="" width="14" height="14" />
                      Open Together
                    </button>
                    <button
                      onClick={() => {
                        onOpenExternal(fileComp.relativePath, selectedVariant.variant, 'vscode-separately', mapping?.variantFile);
                        setShowOpenMenu(false);
                      }}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 flex items-center gap-2"
                    >
                      <img src="/vscode_icon.svg" alt="" width="14" height="14" />
                      Open Separately
                    </button>
                  </div>
                )}
              </div>
            )}
            {/* Review status buttons */}
            <div className="flex items-center gap-1 ml-2">
              <button
                onClick={() => onReviewStatusChange(reviewStatus === 'correct' ? 'unchecked' : 'correct')}
                className={`p-1.5 rounded-md transition-colors ${
                  reviewStatus === 'correct' 
                    ? 'bg-green-100 text-green-700 ring-1 ring-green-500' 
                    : 'hover:bg-green-50 text-slate-400 hover:text-green-600'
                }`}
                title="Mark as correct / aligned"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              </button>
              <button
                onClick={() => onReviewStatusChange(reviewStatus === 'needs-attention' ? 'unchecked' : 'needs-attention')}
                className={`p-1.5 rounded-md transition-colors ${
                  reviewStatus === 'needs-attention' 
                    ? 'bg-red-100 text-red-700 ring-1 ring-red-500' 
                    : 'hover:bg-red-50 text-slate-400 hover:text-red-600'
                }`}
                title="Mark as needs attention / doesn't align"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
              </button>
            </div>
          </div>
        </div>
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
  const [reviewStatuses, setReviewStatuses] = useState<Record<string, ReviewStatus>>({});
  const [showFilter, setShowFilter] = useState<'all' | 'needs-attention' | 'unchecked'>('all');

  const exerciseName = currentExercise.exerciseName;
  const targetFolder = currentExercise.targetFolder;

  // Fetch review statuses from server
  useEffect(() => {
    const fetchReviewStatuses = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/review-status`);
        const data = await response.json();
        if (data.ok && data.reviewStatuses) {
          // Convert array to map for easier lookup
          const statusMap: Record<string, ReviewStatus> = {};
          for (const review of data.reviewStatuses) {
            // Key format: exerciseName:filePath + compareType + variantLabel
            const key = `${review.filePath}:${review.compareType}:${review.variantLabel}`;
            statusMap[key] = review.status;
          }
          setReviewStatuses(statusMap);
        }
      } catch (error) {
        console.error('Failed to fetch review statuses:', error);
      }
    };
    fetchReviewStatuses();
  }, []);

  // Generate a unique key for a file's review status
  const getReviewKey = useCallback((relativePath: string, variantLabel: string) => {
    return `${exerciseName}:${relativePath}:${compareType}:${variantLabel}`;
  }, [exerciseName, compareType]);

  // Update review status for a file - save to server
  const handleReviewStatusChange = useCallback(async (relativePath: string, variantLabel: string, status: ReviewStatus) => {
    const key = getReviewKey(relativePath, variantLabel);
    
    // Optimistically update local state
    setReviewStatuses(prev => ({ ...prev, [key]: status }));
    
    // Save to server
    try {
      await fetch(`${API_BASE}/api/review-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exerciseName,
          filePath: relativePath,
          variantLabel,
          compareType,
          status,
        }),
      });
    } catch (error) {
      console.error('Failed to save review status:', error);
    }
  }, [getReviewKey, exerciseName, compareType]);

  // Open files in VS Code
  const handleOpenExternal = useCallback(async (relativePath: string, variantLabel: string, action: OpenExternalAction, mappedPath?: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/open-vscode-diff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          compareType,
          relativePath,
          variantLabel,
          mappedPath,
        }),
      });
      const data = await response.json();
      if (!data.ok) {
        console.error('Failed to get file paths:', data.error);
        return;
      }
      
      const { baseFilePath, variantFilePath } = data;
      
      if (action === 'vscode-together') {
        // Open both files in the same VS Code window
        if (baseFilePath && variantFilePath) {
          window.open(`vscode://file${baseFilePath}?windowId=_blank`, '_blank');
          setTimeout(() => {
            window.open(`vscode://file${variantFilePath}`, '_blank');
          }, 500);
        } else if (baseFilePath) {
          window.open(`vscode://file${baseFilePath}?windowId=_blank`, '_blank');
        } else if (variantFilePath) {
          window.open(`vscode://file${variantFilePath}?windowId=_blank`, '_blank');
        }
      } else if (action === 'vscode-separately') {
        // Open each file in its own new VS Code window
        if (baseFilePath) {
          window.open(`vscode://file${baseFilePath}?windowId=_blank`, '_blank');
        }
        if (variantFilePath) {
          setTimeout(() => {
            window.open(`vscode://file${variantFilePath}?windowId=_blank`, '_blank');
          }, 300);
        }
      }
    } catch (error) {
      console.error('Failed to open in VS Code:', error);
    }
  }, [compareType]);

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
      // Bug fix: Handle empty or invalid variantLabels array
      if (!comparison.variantLabels.length) {
        return <p className="text-sm text-muted-foreground">No variant labels found.</p>;
      }
      
      // Reset activeVariantIndex if it's out of bounds
      if (activeVariantIndex >= comparison.variantLabels.length) {
        setActiveVariantIndex(0);
        return null;
      }
      
      const totalVariants = comparison.variantLabels.length;
      const canSwitchVariant = totalVariants > 1;
      const currentVariantLabel = comparison.variantLabels[activeVariantIndex] || '';

      // Filter to only show files where the current variant has actual differences
      const filesWithDifferencesForVariant = comparison.fileComparisons.filter((fileComp) => {
        const variant = fileComp.variants[activeVariantIndex];
        return variant?.hasDifference === true;
      });

      if (filesWithDifferencesForVariant.length === 0) {
        return (
          <>
            <p className="text-sm text-muted-foreground">No differences detected for this variant.</p>
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

      // Calculate review stats only for files with actual differences
      const reviewStats = filesWithDifferencesForVariant.reduce(
        (acc, fileComp) => {
          const key = getReviewKey(fileComp.relativePath, currentVariantLabel);
          const status = reviewStatuses[key] || 'unchecked';
          acc[status]++;
          return acc;
        },
        { unchecked: 0, correct: 0, 'needs-attention': 0 } as Record<ReviewStatus, number>
      );

      return (
        <>
          {/* Review progress summary */}
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">Review progress:</span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-full bg-green-500"></span>
              <span className="text-green-700 font-medium">{reviewStats.correct} correct</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-full bg-red-500"></span>
              <span className="text-red-700 font-medium">{reviewStats['needs-attention']} need attention</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-full bg-slate-300"></span>
              <span className="text-slate-600">{reviewStats.unchecked} unchecked</span>
            </span>
          </div>

          <div className="space-y-6">
            {filesWithDifferencesForVariant
              .filter((fileComp) => {
                if (showFilter === 'all') return true;
                const reviewKey = getReviewKey(fileComp.relativePath, currentVariantLabel);
                const status = reviewStatuses[reviewKey] || 'unchecked';
                if (showFilter === 'needs-attention') return status === 'needs-attention';
                if (showFilter === 'unchecked') return status === 'unchecked';
                return true;
              })
              .map((fileComp) => {
              const reviewKey = getReviewKey(fileComp.relativePath, currentVariantLabel);
              const reviewStatus = reviewStatuses[reviewKey] || 'unchecked';
              
              return (
                <FileComparisonCard 
                  key={fileComp.relativePath} 
                  fileComp={fileComp} 
                  baseVariant={comparison.baseVariant}
                  activeVariantIndex={activeVariantIndex}
                  fileMappings={currentExercise.fileMappings || []}
                  reviewStatus={reviewStatus}
                  onReviewStatusChange={(status) => handleReviewStatusChange(fileComp.relativePath, currentVariantLabel, status)}
                  compareType={compareType}
                  onOpenExternal={handleOpenExternal}
                />
              );
            })}
            {/* Show message when filter returns no results */}
            {filesWithDifferencesForVariant.filter((fileComp) => {
              if (showFilter === 'all') return true;
              const reviewKey = getReviewKey(fileComp.relativePath, currentVariantLabel);
              const status = reviewStatuses[reviewKey] || 'unchecked';
              if (showFilter === 'needs-attention') return status === 'needs-attention';
              if (showFilter === 'unchecked') return status === 'unchecked';
              return true;
            }).length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                No files match the current filter.
              </p>
            )}
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
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {compareOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => setCompareType(option.value)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  compareType === option.value
                    ? 'bg-primary text-primary-foreground shadow'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          
          {/* Review status filter */}
          <div className="flex items-center gap-2 pt-2 border-t">
            <span className="text-sm text-muted-foreground">Show:</span>
            <button
              onClick={() => setShowFilter('all')}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                showFilter === 'all'
                  ? 'bg-slate-700 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              All files
            </button>
            <button
              onClick={() => setShowFilter('needs-attention')}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                showFilter === 'needs-attention'
                  ? 'bg-red-600 text-white'
                  : 'bg-red-50 text-red-700 hover:bg-red-100'
              }`}
            >
              ⚠ Needs attention
            </button>
            <button
              onClick={() => setShowFilter('unchecked')}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                showFilter === 'unchecked'
                  ? 'bg-amber-600 text-white'
                  : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
              }`}
            >
              Not reviewed
            </button>
          </div>
        </CardContent>
      </Card>

      {renderComparisons()}
    </div>
  );
}

export default ComparePage;
