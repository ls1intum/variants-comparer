import { Fragment, lazy, Suspense, useEffect, useMemo, useState, useRef, useCallback, type ReactNode } from 'react';
import DiffMatchPatch from 'diff-match-patch';

import { deleteRepoFile, writeRepoFile } from '@/lib/changes';
import { alignVariants, type AlignedCell, type AlignedRow } from '@/lib/diff';
import { compare, getReviewStatuses, setReviewComment, setReviewStatus } from '@/lib/service';
import type { CompareType, ComparisonResponse, FileComparison, FileMapping, ReviewStatus, VariantComparison } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { EditedSides } from '@/components/FileEditor';
import { PendingChangesPanel } from '@/components/PendingChangesPanel';
import { useExercise } from '@/contexts/ExerciseContext';
import { useToast } from '@/contexts/ToastContext';

/*  CodeMirror is only loaded once a file is edited  */
const FileEditor = lazy(() => import('@/components/FileEditor').then((module) => ({ default: module.FileEditor })));

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

function ReviewButtons({ status, onChange, comment, onCommentChange }: Readonly<{
  status: ReviewStatus;
  onChange: (status: ReviewStatus) => void;
  comment: string;
  onCommentChange: (comment: string) => void;
}>) {
  const [ draft, setDraft ] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isOpen = draft !== null;

  /*  Focus the comment field when it opens  */
  useEffect(() => {
    if (isOpen)
      textareaRef.current?.focus();
  }, [ isOpen ]);
  const saveComment = () => {
    if (draft !== null)
      onCommentChange(draft.trim());
    setDraft(null);
  };
  return (
    <div className="relative flex items-center gap-1 ml-2">
      <button
        onClick={() => onChange(status === 'correct' ? 'unchecked' : 'correct')}
        className={`p-1.5 rounded-md transition-colors ${
          status === 'correct'
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
        onClick={() => onChange(status === 'needs-attention' ? 'unchecked' : 'needs-attention')}
        className={`p-1.5 rounded-md transition-colors ${
          status === 'needs-attention'
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
      <button
        onClick={() => setDraft(draft === null ? comment : null)}
        className={`p-1.5 rounded-md transition-colors ${
          comment
            ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-500'
            : 'hover:bg-blue-50 text-slate-400 hover:text-blue-600'
        }`}
        title={comment ? `Comment: ${comment}` : 'Add a review comment'}
      >
        <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill={comment ? 'currentColor' : 'none'} fillOpacity={comment ? 0.2 : 0} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
      </button>
      {draft !== null && (
        <div className="absolute right-0 top-full z-20 mt-1 w-80 space-y-2 rounded-md border border-slate-200 bg-white p-2 text-left shadow-lg">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape')
                setDraft(null);
              else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey))
                saveComment();
            }}
            rows={3}
            placeholder="Why does this file need attention, or what was verified?"
            className="w-full rounded-md border border-slate-300 p-2 text-xs font-sans font-normal"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setDraft(null)}>Cancel</Button>
            <Button size="sm" className="h-7 text-xs" onClick={saveComment}>Save</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function DiffCounts({ variant }: Readonly<{ variant: VariantComparison }>) {
  const added = variant.lineDiff.filter(d => d.type === 'add').length;
  const removed = variant.lineDiff.filter(d => d.type === 'remove').length;
  const modified = variant.lineDiff.filter(d => d.type === 'modify').length;
  return (
    <span className="flex items-center gap-2 text-xs font-mono">
      {added > 0 && <span className="text-green-700 font-semibold">+{added}</span>}
      {removed > 0 && <span className="text-red-600 font-semibold">-{removed}</span>}
      {modified > 0 && <span className="text-yellow-700 font-semibold">~{modified}</span>}
    </span>
  );
}

const cellBgClass: Record<AlignedCell['type'], string> = { add: 'bg-green-100', modify: 'bg-yellow-50', equal: '', remove: '' };

function baseBgClass(row: AlignedRow) {
  if (!row.base)
    return 'bg-slate-50/30';
  return row.base.changed ? 'bg-yellow-50' : '';
}

/*  Variant cell text; modified lines get char-level insert highlights, keyed by text offset  */
function renderCellContent(row: AlignedRow, cell: AlignedCell | undefined) {
  if (!cell)
    return '\u00a0';
  if (cell.type !== 'modify' || !row.base)
    return cell.text || ' ';
  let offset = 0;
  return getInlineDiff(row.base.text, cell.text).right.map((segment) => {
    const key = offset;
    offset += segment.text.length;
    return (
      <span key={key} className={segment.type === 'insert' ? 'bg-green-600 text-white' : ''}>
        {segment.text}
      </span>
    );
  });
}

/*  Base and all variants side by side in one table, rows aligned on the base lines  */
function AllVariantsFileCard({
  fileComp,
  baseVariant,
  fileMappings,
  reviewStatusFor,
  onReviewStatusChange,
  commentFor,
  onCommentChange,
  onEdit,
}: Readonly<{
  fileComp: FileComparison;
  baseVariant: string;
  fileMappings: FileMapping[];
  reviewStatusFor: (variantLabel: string) => ReviewStatus;
  onReviewStatusChange: (variantLabel: string, status: ReviewStatus) => void;
  commentFor: (variantLabel: string) => string;
  onCommentChange: (variantLabel: string, comment: string) => void;
  onEdit: (variantIndex: number) => void;
}>) {
  const rows = useMemo(() => alignVariants(fileComp.baseContent, fileComp.variants), [ fileComp ]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const firstDiffRef = useRef<HTMLTableRowElement | null>(null);
  const firstDiffIndex = rows.findIndex((row) => !row.base || row.base.changed);

  /*  Scroll to the first difference, keeping 5 lines of context  */
  useEffect(() => {
    if (scrollRef.current && firstDiffRef.current)
      scrollRef.current.scrollTop = Math.max(0, firstDiffRef.current.offsetTop - 5 * 24);
  }, [ rows ]);

  const differing = fileComp.variants.filter((v) => v.hasDifference);
  const statuses = differing.map((v) => reviewStatusFor(v.variant));
  let borderColorClass = 'border-slate-300';
  if (statuses.includes('needs-attention'))
    borderColorClass = 'border-red-500 border-2';
  else if (statuses.length > 0 && statuses.every((s) => s === 'correct'))
    borderColorClass = 'border-green-500 border-2';

  const lineNoCell = (lineNo?: number) => (
    <td className="w-8 px-2 py-0.5 text-right text-slate-400 select-none border-x border-slate-200 bg-slate-50 h-6">
      {lineNo ?? '\u00a0'}
    </td>
  );

  return (
    <Card className={`border ${borderColorClass}`}>
      <CardHeader>
        <CardTitle className="text-base font-mono">{fileComp.relativePath}</CardTitle>
      </CardHeader>
      <CardContent>
        <div ref={scrollRef} className="max-h-[600px] overflow-auto rounded-md bg-white border border-slate-200 shadow-inner">
          <table className="w-full text-xs font-mono table-fixed">
            <colgroup>
              {[ baseVariant, ...fileComp.variants.map((v) => v.variant) ].map((label) => (
                <Fragment key={label}>
                  <col className="w-10" />
                  <col />
                </Fragment>
              ))}
            </colgroup>
            <thead className="sticky top-0 z-10 bg-white shadow-sm">
              <tr className="align-top">
                <th colSpan={2} className="px-3 py-2 text-left text-sm font-semibold text-slate-700">{baseVariant}</th>
                {fileComp.variants.map((variant, variantIndex) => {
                  const mapping = fileMappings.find((m) => m.baseFile === fileComp.relativePath && m.variantLabel === variant.variant);
                  return (
                    <th key={variant.variant} colSpan={2} className="px-3 py-2 text-left font-normal">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-700">{variant.variant}</span>
                        {!variant.exists && <span className="text-xs text-red-600">(missing)</span>}
                        {mapping && (
                          <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10" title={mapping.variantFile}>
                            Mapped
                          </span>
                        )}
                        <DiffCounts variant={variant} />
                        {variant.hasDifference
                          ? <ReviewButtons
                              status={reviewStatusFor(variant.variant)}
                              onChange={(status) => onReviewStatusChange(variant.variant, status)}
                              comment={commentFor(variant.variant)}
                              onCommentChange={(comment) => onCommentChange(variant.variant, comment)}
                            />
                          : <span className="text-xs text-muted-foreground">identical</span>}
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onEdit(variantIndex)}>Edit</Button>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={row.id} ref={idx === firstDiffIndex ? firstDiffRef : undefined} className="h-6">
                  {lineNoCell(row.base?.lineNo)}
                  <td className={`px-3 py-0.5 whitespace-pre-wrap break-all ${baseBgClass(row)}`}>
                    {row.base ? row.base.text || ' ' : '\u00a0'}
                  </td>
                  {fileComp.variants.map((variant, v) => {
                    const cell = row.cells[v];
                    return (
                      <Fragment key={variant.variant}>
                        {lineNoCell(cell?.lineNo)}
                        <td className={`px-3 py-0.5 whitespace-pre-wrap break-all ${cell ? cellBgClass[cell.type] : 'bg-slate-50/30'}`}>
                          {renderCellContent(row, cell)}
                        </td>
                      </Fragment>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/*  File list of the "All variants" view; review stats and filter cover all (file, differing variant) pairs  */
function AllVariantsComparison({
  fileComparisons,
  baseVariant,
  fileMappings,
  showFilter,
  statusOf,
  onReviewStatusChange,
  commentOf,
  onCommentChange,
  onEdit,
}: Readonly<{
  fileComparisons: FileComparison[];
  baseVariant: string;
  fileMappings: FileMapping[];
  showFilter: 'all' | 'needs-attention' | 'unchecked';
  statusOf: (path: string, variantLabel: string) => ReviewStatus;
  onReviewStatusChange: (path: string, variantLabel: string, status: ReviewStatus) => void;
  commentOf: (path: string, variantLabel: string) => string;
  onCommentChange: (path: string, variantLabel: string, comment: string) => void;
  onEdit: (path: string, variantIndex: number) => void;
}>) {
  const filesWithDifferences = fileComparisons.filter((fileComp) => fileComp.variants.some((v) => v.hasDifference));
  if (filesWithDifferences.length === 0)
    return <p className="text-sm text-muted-foreground">No differences detected.</p>;

  const statusesOf = (fileComp: FileComparison) =>
    fileComp.variants.filter((v) => v.hasDifference).map((v) => statusOf(fileComp.relativePath, v.variant));
  const allStats = { unchecked: 0, correct: 0, 'needs-attention': 0 } as Record<ReviewStatus, number>;
  for (const fileComp of filesWithDifferences)
    for (const status of statusesOf(fileComp))
      allStats[status]++;
  const visibleFiles = filesWithDifferences.filter((fileComp) =>
    showFilter === 'all' || statusesOf(fileComp).includes(showFilter));

  return (
    <>
      <div className="flex items-center gap-4 text-sm">
        <span className="text-muted-foreground">Review progress:</span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full bg-green-500"></span>
          <span className="text-green-700 font-medium">{allStats.correct} correct</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full bg-red-500"></span>
          <span className="text-red-700 font-medium">{allStats['needs-attention']} need attention</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full bg-slate-300"></span>
          <span className="text-slate-600">{allStats.unchecked} unchecked</span>
        </span>
      </div>
      <div className="space-y-6">
        {visibleFiles.map((fileComp) => (
          <AllVariantsFileCard
            key={fileComp.relativePath}
            fileComp={fileComp}
            baseVariant={baseVariant}
            fileMappings={fileMappings}
            reviewStatusFor={(label) => statusOf(fileComp.relativePath, label)}
            onReviewStatusChange={(label, status) => onReviewStatusChange(fileComp.relativePath, label, status)}
            commentFor={(label) => commentOf(fileComp.relativePath, label)}
            onCommentChange={(label, comment) => onCommentChange(fileComp.relativePath, label, comment)}
            onEdit={(variantIndex) => onEdit(fileComp.relativePath, variantIndex)}
          />
        ))}
        {visibleFiles.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            No files match the current filter.
          </p>
        )}
      </div>
    </>
  );
}

function FileComparisonCard({
  fileComp, 
  baseVariant, 
  activeVariantIndex,
  fileMappings = [],
  reviewStatus,
  onReviewStatusChange,
  reviewComment,
  onReviewCommentChange,
  onEdit,
  editor,
}: { 
  fileComp: FileComparison; 
  baseVariant: string;
  activeVariantIndex: number;
  fileMappings?: Array<{ baseFile: string; variantFile: string; variantLabel: string }>;
  reviewStatus: ReviewStatus;
  onReviewStatusChange: (status: ReviewStatus) => void;
  reviewComment: string;
  onReviewCommentChange: (comment: string) => void;
  onEdit: () => void;
  editor?: ReactNode;
}) {
  const baseLines = fileComp.baseContent.split('\n');
  const scrollRefs = useRef<(HTMLDivElement | null)[]>([]);
  const hasScrolledToFirst = useRef(false);
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
            <ReviewButtons status={reviewStatus} onChange={onReviewStatusChange} comment={reviewComment} onCommentChange={onReviewCommentChange} />
            {!editor && <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onEdit}>Edit</Button>}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {editor ?? <div className="grid gap-4 lg:grid-cols-2">
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
              <DiffCounts variant={selectedVariant} />
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
        </div>}
      </CardContent>
    </Card>
  );
}

function ComparePage() {
  const { currentExercise, activeExerciseIndex, setExercises } = useExercise();
  const { addToast } = useToast();
  const [compareType, setCompareType] = useState<CompareType>('problem');
  const [comparison, setComparison] = useState<ComparisonResponse | null>(null);
  const [compareStatus, setCompareStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [compareError, setCompareError] = useState<string>('');
  const [activeVariantIndex, setActiveVariantIndex] = useState(0);
  const [reviewStatuses, setReviewStatuses] = useState<Record<string, ReviewStatus>>({});
  const [reviewComments, setReviewComments] = useState<Record<string, string>>({});
  const [showFilter, setShowFilter] = useState<'all' | 'needs-attention' | 'unchecked'>('all');
  const [viewMode, setViewMode] = useState<'pairwise' | 'all'>('pairwise');
  const [editing, setEditing] = useState<{ path: string; compareIndex: number } | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const shownCompareType = useRef<CompareType | null>(null);

  const exerciseName = currentExercise.exerciseName;

  // Load persisted review statuses
  useEffect(() => {
    const fetchReviewStatuses = async () => {
      try {
        // Convert array to map for easier lookup
        const statusMap: Record<string, ReviewStatus> = {};
        const commentMap: Record<string, string> = {};
        for (const review of getReviewStatuses()) {
          // Key format: exerciseName:filePath + compareType + variantLabel
          const key = `${review.filePath}:${review.compareType}:${review.variantLabel}`;
          statusMap[key] = review.status;
          if (review.comment)
            commentMap[key] = review.comment;
        }
        setReviewStatuses(statusMap);
        setReviewComments(commentMap);
      } catch (error) {
        console.error('Failed to load review statuses:', error);
      }
    };
    fetchReviewStatuses();
  }, []);

  // Generate a unique key for a file's review status
  const getReviewKey = useCallback((relativePath: string, variantLabel: string) => {
    return `${exerciseName}:${relativePath}:${compareType}:${variantLabel}`;
  }, [exerciseName, compareType]);

  // Update and persist review status for a file
  const handleReviewStatusChange = useCallback(async (relativePath: string, variantLabel: string, status: ReviewStatus) => {
    const key = getReviewKey(relativePath, variantLabel);
    
    // Optimistically update local state
    setReviewStatuses(prev => ({ ...prev, [key]: status }));
    
    try {
      setReviewStatus({ exerciseName, filePath: relativePath, variantLabel, compareType, status });
    } catch (error) {
      console.error('Failed to save review status:', error);
    }
  }, [getReviewKey, exerciseName, compareType]);

  const handleReviewCommentChange = useCallback((relativePath: string, variantLabel: string, comment: string) => {
    setReviewComments((prev) => ({ ...prev, [getReviewKey(relativePath, variantLabel)]: comment }));
    setReviewComment({ exerciseName, filePath: relativePath, variantLabel, compareType, comment });
  }, [getReviewKey, exerciseName, compareType]);

  // Reset variant index and editor when switching what is compared; the loading state hides the old exercise's files
  useEffect(() => {
    setActiveVariantIndex(0);
    setEditing(null);
    shownCompareType.current = null;
  }, [compareType, activeExerciseIndex]);

  /*  Refreshes after edits keep the current comparison visible instead of showing the loading state  */
  useEffect(() => {
    let cancelled = false;
    const runComparison = async () => {
      if (shownCompareType.current !== compareType)
        setCompareStatus('loading');
      setCompareError('');
      try {
        const result = await compare(currentExercise, compareType);
        if (!cancelled) {
          shownCompareType.current = compareType;
          setComparison(result);
          setCompareStatus('idle');
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setCompareError(error instanceof Error ? error.message : 'Unknown error');
          setCompareStatus('error');
        }
      }
    };

    runComparison();
    return () => {
      cancelled = true;
    };
  }, [compareType, currentExercise, refreshToken]);

  const setVariantMarkdown = useCallback((variantIndex: number, markdown: string) => {
    setExercises((prev) => prev.map((ex, idx) => (idx !== activeExerciseIndex ? ex : {
      ...ex,
      variants: ex.variants.map((variant, vIdx) => (vIdx === variantIndex ? { ...variant, markdown } : variant)),
    })));
  }, [activeExerciseIndex, setExercises]);

  /*  Store edits of a base file and its counterpart in the compared variant (index into variantLabels); an edited
      file needs to be reviewed again, for all variants if the base changed  */
  const handleSaveEdit = useCallback(async (fileComp: FileComparison, compareIndex: number, sides: EditedSides) => {
    const variantLabel = comparison?.variantLabels?.[compareIndex] ?? '';
    const writes: Array<[ number, string, string | null ]> = [];
    if (sides.base !== undefined)
      writes.push([ 0, fileComp.relativePath, sides.base ]);
    if (sides.variant !== undefined) {
      const mapping = (currentExercise.fileMappings ?? []).find((m) => m.baseFile === fileComp.relativePath && m.variantLabel === variantLabel);
      writes.push([ compareIndex + 1, mapping?.variantFile ?? fileComp.relativePath, sides.variant ]);
    }
    await Promise.all(writes.map(async ([ variantIndex, path, content ]) => {
      if (compareType === 'problem')
        setVariantMarkdown(variantIndex, content ?? '');
      else if (content === null)
        await deleteRepoFile(currentExercise, variantIndex, compareType, path);
      else
        await writeRepoFile(currentExercise, variantIndex, compareType, path, content);
    }));
    const resetLabels = sides.base !== undefined ? comparison?.variantLabels ?? [] : [ variantLabel ];
    await Promise.all(resetLabels.map((label) => handleReviewStatusChange(fileComp.relativePath, label, 'unchecked')));
    setEditing(null);
    setRefreshToken((token) => token + 1);
  }, [comparison, compareType, currentExercise, handleReviewStatusChange, setVariantMarkdown]);

  const renderEditor = (fileComp: FileComparison, compareIndex: number) => {
    const variant = fileComp.variants[compareIndex];
    if (editing?.path !== fileComp.relativePath || editing.compareIndex !== compareIndex || !variant || !comparison)
      return undefined;
    return (
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading editor...</p>}>
        <FileEditor
          fileName={fileComp.relativePath}
          baseLabel={comparison.baseVariant}
          variantLabel={variant.variant}
          baseContent={fileComp.baseExists ? fileComp.baseContent : null}
          variantContent={variant.exists ? variant.content : null}
          allowCreateDelete={compareType !== 'problem'}
          onSave={(sides) => handleSaveEdit(fileComp, compareIndex, sides)}
          onCancel={() => setEditing(null)}
        />
      </Suspense>
    );
  };

  /*  Editing happens in the pairwise view of the chosen variant  */
  const editInPairwiseView = (path: string, compareIndex: number) => {
    setViewMode('pairwise');
    setActiveVariantIndex(compareIndex);
    setEditing({ path, compareIndex });
  };

  const renderConfigSummary = () => {
    if (!exerciseName) {
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
            <p className="text-muted-foreground">Variants</p>
            <p className="font-medium">{currentExercise.variants.map((v) => v.label).join(', ')}</p>
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
      
      if (viewMode === 'all')
        return (
          <AllVariantsComparison
            fileComparisons={comparison.fileComparisons}
            baseVariant={comparison.baseVariant}
            fileMappings={currentExercise.fileMappings || []}
            showFilter={showFilter}
            statusOf={(path, label) => reviewStatuses[getReviewKey(path, label)] || 'unchecked'}
            onReviewStatusChange={handleReviewStatusChange}
            commentOf={(path, label) => reviewComments[getReviewKey(path, label)] ?? ''}
            onCommentChange={handleReviewCommentChange}
            onEdit={editInPairwiseView}
          />
        );

      const totalVariants = comparison.variantLabels.length;
      const canSwitchVariant = totalVariants > 1;
      const currentVariantLabel = comparison.variantLabels[activeVariantIndex] || '';

      // Filter to only show files where the current variant has actual differences (and the file being edited)
      const isEditing = (fileComp: FileComparison) => editing?.path === fileComp.relativePath && editing.compareIndex === activeVariantIndex;
      const filesWithDifferencesForVariant = comparison.fileComparisons.filter((fileComp) => {
        const variant = fileComp.variants[activeVariantIndex];
        return variant?.hasDifference === true || isEditing(fileComp);
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
                if (showFilter === 'all' || isEditing(fileComp)) return true;
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
                  reviewComment={reviewComments[reviewKey] ?? ''}
                  onReviewCommentChange={(comment) => handleReviewCommentChange(fileComp.relativePath, currentVariantLabel, comment)}
                  onEdit={() => setEditing({ path: fileComp.relativePath, compareIndex: activeVariantIndex })}
                  editor={renderEditor(fileComp, activeVariantIndex)}
                />
              );
            })}
            {/* Show message when filter returns no results */}
            {filesWithDifferencesForVariant.filter((fileComp) => {
              if (showFilter === 'all' || isEditing(fileComp)) return true;
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

      <PendingChangesPanel
        exercise={currentExercise}
        refreshToken={refreshToken}
        onWritten={() => setRefreshToken((token) => token + 1)}
        onProblemStatement={setVariantMarkdown}
        onToast={addToast}
      />

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

          {/* View mode: one variant vs. base, or all variants side by side */}
          <div className="flex items-center gap-2 pt-2 border-t">
            <span className="text-sm text-muted-foreground">View:</span>
            {([ [ 'pairwise', 'One variant' ], [ 'all', 'All variants' ] ] as const).map(([ mode, label ]) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  viewMode === mode
                    ? 'bg-slate-700 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {label}
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
