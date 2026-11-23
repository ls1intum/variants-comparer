import type { CompareType, ExerciseConfig, FileReview, ReviewStatus } from '@/types';
import { pendingEdits, readEditLog, unifiedPatch, type FileEdit } from './changes';
import { readConfig } from './config';
import { slugify } from './repoStore';
import { compare } from './service';

/*  Markdown review report of one or more exercises: progress, findings, remaining work and edits,
    readable for the reviewer, as proof for others and as hand-over to an LLM agent  */

export type ReportOptions = { exerciseIndices: number[]; detailed: boolean };

const typeLabels: Record<CompareType, string> = {
  problem:  'Problem statement',
  test:     'Test repository',
  template: 'Template repository',
  solution: 'Solution repository',
};
const TYPES: CompareType[] = [ 'problem', 'template', 'solution', 'test' ];
const KIND_LETTER = { added: 'A', modified: 'M', deleted: 'D' } as const;

type ReviewedFile = { path: string; status: ReviewStatus; comment?: string; patch: string };
type Section = { variant: string; type: CompareType; files: ReviewedFile[] };
type SummaryRow = { variant: string; type: CompareType; differing: number; correct: number; attention: number; note?: string };

const LLM_CONTEXT = [
  '> **Context for AI agents:** This report was exported from *Variants Comparer*, a tool for keeping the variants',
  '> of an exam exercise consistent. The first variant is the base; every other variant is compared file by file',
  '> against it, for the problem statement and the template, solution and test repositories. A reviewer marks each',
  '> differing file per variant as *correct* (difference intended and consistent) or *needs attention*',
  '> (inconsistency or mistake), optionally with a comment. Diffs are unified diffs from the base (`a/`) to the',
  '> variant (`b/`). **Task:** continue the consistency review: check the open findings and the unreviewed',
  '> differences, propose concrete fixes, and keep the variants consistent with the files already verified.',
];

const pad = (n: number) => String(n).padStart(2, '0');
function formatDate(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const cell = (text: string) => text.replaceAll('|', String.raw`\|`);
const oneLine = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean).join(' / ');

/*  Fenced block whose fence is longer than any backtick run in the content, indented into a list item  */
function fenced(content: string, lang: string, indent = '  ') {
  const longest = Math.max(0, ...(content.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  const body = content.replace(/\n$/, '').split('\n').map((line) => line ? indent + line : line).join('\n');
  return `${indent}${fence}${lang}\n${body}\n${indent}${fence}`;
}

function fileLine(file: ReviewedFile, detailed: boolean, withPatch: boolean) {
  const comment = file.comment ? ` — ${oneLine(file.comment)}` : '';
  const line = `- \`${file.path}\`${comment}`;
  return detailed && withPatch && file.patch ? `${line}\n\n${fenced(file.patch, 'diff')}\n` : line;
}

function editLine(edit: FileEdit, detailed: boolean) {
  const path = edit.repoType === 'problem' ? 'problem statement' : `${edit.repoType}/${edit.path}`;
  const line = `- ${KIND_LETTER[edit.kind]} \`${path}\``;
  return detailed && edit.patch ? `${line}\n\n${fenced(edit.patch, 'diff')}\n` : line;
}

/*  Review state of all differing files of one exercise, per compared variant and content type  */
async function collectReviews(exercise: ExerciseConfig, reviews: FileReview[]) {
  const sections: Section[] = [];
  const summary: SummaryRow[] = [];
  const reviewOf = (path: string, variant: string, type: CompareType) =>
    reviews.find((r) => r.filePath === `${exercise.exerciseName}:${path}` && r.variantLabel === variant && r.compareType === type);
  const compareLabels = exercise.variants.slice(1).map((v, idx) => v.label || `Variant ${idx + 2}`);
  for (const type of TYPES) {
    let comparison;
    try {
      comparison = await compare(exercise, type); /*  NOSONAR: compares share the browser file system, keep them sequential  */
    }
    catch {
      summary.push(...compareLabels.map((variant) => ({ variant, type, differing: 0, correct: 0, attention: 0, note: 'not loaded' })));
      continue;
    }
    for (const variant of comparison.variantLabels ?? []) {
      const files: ReviewedFile[] = [];
      for (const fileComp of comparison.fileComparisons ?? []) {
        const variantComp = fileComp.variants.find((v) => v.variant === variant);
        if (!variantComp?.hasDifference)
          continue;
        const review = reviewOf(fileComp.relativePath, variant, type);
        files.push({
          path:    fileComp.relativePath,
          status:  review?.status ?? 'unchecked',
          comment: review?.comment,
          patch:   unifiedPatch(fileComp.relativePath, fileComp.baseContent, variantComp.content),
        });
      }
      sections.push({ variant, type, files });
      summary.push({
        variant,
        type,
        differing: files.length,
        correct:   files.filter((f) => f.status === 'correct').length,
        attention: files.filter((f) => f.status === 'needs-attention').length,
      });
    }
  }
  return { sections, summary };
}

function statusBlock(title: string, sections: Section[], status: ReviewStatus, detailed: boolean, withPatch: boolean) {
  const lines = [ `### ${title}`, '' ];
  let any = false;
  for (const section of sections) {
    const files = section.files.filter((f) => f.status === status);
    if (files.length === 0)
      continue;
    any = true;
    lines.push(`#### ${section.variant} · ${typeLabels[section.type]}`, '', ...files.map((f) => fileLine(f, detailed, withPatch)), '');
  }
  if (!any)
    lines.push('_None._', '');
  return lines;
}

async function exerciseReport(exercise: ExerciseConfig, reviews: FileReview[], detailed: boolean) {
  const labels = exercise.variants.map((v, idx) => v.label || `Variant ${idx + 1}`);
  const { sections, summary } = await collectReviews(exercise, reviews);
  const variantList = labels.map((label, idx) => (idx === 0 ? `\`${label}\` (base)` : `\`${label}\``)).join(', ');
  const lines = [
    `## Exercise: ${exercise.exerciseName}`,
    '',
    `Variants: ${variantList}`,
    '',
    '### Summary',
    '',
    '| Variant | Content | Differing files | Correct | Needs attention | Unreviewed |',
    '|---|---|---:|---:|---:|---:|',
  ];
  for (const row of summary) {
    const counts = row.note
      ? [ row.note, '–', '–', '–' ]
      : [ row.differing, row.correct, row.attention, row.differing - row.correct - row.attention ].map(String);
    lines.push(`| ${cell(row.variant)} | ${typeLabels[row.type]} | ${counts.join(' | ')} |`);
  }
  const total = summary.reduce((sum, row) => ({
    differing: sum.differing + row.differing,
    reviewed:  sum.reviewed + row.correct + row.attention,
    attention: sum.attention + row.attention,
  }), { differing: 0, reviewed: 0, attention: 0 });
  const percent = total.differing > 0 ? Math.round(total.reviewed / total.differing * 100) : 100;
  lines.push(
    '', `**Progress:** ${total.reviewed} of ${total.differing} differing files reviewed (${percent} %), ${total.attention} need attention.`, '',
    ...statusBlock('Needs attention', sections, 'needs-attention', detailed, true),
    ...statusBlock('Not reviewed yet', sections, 'unchecked', detailed, true),
    ...statusBlock('Verified as correct', sections, 'correct', detailed, false),
    '### Edits', '', '#### Written back', '');
  const written = (await Promise.all(exercise.variants.map(async (_, idx) =>
    (await readEditLog(exercise, idx)).map((entry) => ({ ...entry, variant: labels[idx]! })))))
    .flat()
    .sort((a, b) => a.at.localeCompare(b.at));
  if (written.length === 0)
    lines.push('_None._', '');
  for (const entry of written) {
    const message = entry.message ? `: ${oneLine(entry.message)}` : '';
    lines.push(`##### ${formatDate(new Date(entry.at))} · ${entry.variant} · ${entry.via}${message}`, '', ...entry.edits.map((e) => editLine(e, detailed)), '');
  }

  lines.push('#### Pending (not written back yet)', '');
  let anyPending = false;
  for (const [ idx, label ] of labels.entries()) {
    const edits = await pendingEdits(exercise, idx); /*  NOSONAR: reads of the browser file system, keep them sequential  */
    if (edits.length === 0)
      continue;
    anyPending = true;
    lines.push(`##### ${label}`, '', ...edits.map((e) => editLine(e, detailed)), '');
  }
  if (!anyPending)
    lines.push('_None._', '');
  return lines;
}

export async function buildReport({ exerciseIndices, detailed }: ReportOptions) {
  const config = readConfig();
  const exercises = exerciseIndices.map((idx) => config.exercises[idx]).filter((e) => e !== undefined);
  const lines = [
    '# Variant review report',
    '',
    `- **Generated:** ${formatDate(new Date())} with Variants Comparer`,
    `- **Exercises:** ${exercises.map((e) => e.exerciseName).join(', ')}`,
    `- **Detail:** ${detailed ? 'detailed (with diffs)' : 'compact'}`,
    '',
  ];
  if (detailed)
    lines.push(...LLM_CONTEXT, '');
  for (const exercise of exercises)
    lines.push(...await exerciseReport(exercise, config.reviewStatuses, detailed)); /*  NOSONAR: sequential file system reads  */
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

export function reportFileName(exerciseNames: string[], date = new Date()) {
  const name = exerciseNames.length === 1 ? exerciseNames[0]! : 'all-exercises';
  return `review-${slugify(name, 'exercise')}-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.md`;
}
