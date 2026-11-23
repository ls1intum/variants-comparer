import type { CompareType, ComparisonResponse, ExerciseConfig, FileReview, ReviewStatus } from '@/types';
import { readConfig, writeConfig } from './config';
import { calculateSimilarity, computeLineDiff } from './diff';
import { readRepo, REPO_TYPES, type RepoType } from './repoStore';

/*  Browser-side replacement of the former Express endpoints (same result shapes)  */

/*  Re-key variant files onto their mapped base file paths  */
function applyMappings(exercise: ExerciseConfig, variantLabel: string, files: Map<string, string>) {
  const mapped = new Map<string, string>();
  files.forEach((content, filePath) => {
    const mapping = (exercise.fileMappings ?? []).find(
      (m) => m.variantFile === filePath && m.variantLabel === variantLabel);
    mapped.set(mapping ? mapping.baseFile : filePath, content);
  });
  return mapped;
}

/*  Merge all repo types of a variant into one file map (later types win on equal paths)  */
async function readAllRepos(exercise: ExerciseConfig, variantIndex: number) {
  const merged = new Map<string, string>();
  for (const repoType of REPO_TYPES)
    (await readRepo(exercise, variantIndex, repoType))?.forEach((content, relPath) => merged.set(relPath, content));
  return merged;
}

export async function compare(exercise: ExerciseConfig, compareType: CompareType): Promise<ComparisonResponse> {
  const baseVariant = exercise.variants[0];
  if (!baseVariant)
    throw new Error('At least one variant is required before comparing.');
  const compareVariants = exercise.variants.slice(1);

  if (compareType === 'problem') {
    const baseMarkdown = baseVariant.markdown || '';
    return {
      compareType,
      baseVariant: baseVariant.label || 'Variant 1',
      fileComparisons: [ {
        relativePath: 'problem.md',
        baseContent: baseMarkdown,
        baseExists: true,
        variants: compareVariants.map((variant) => {
          const content = variant.markdown || '';
          return {
            variant: variant.label || 'Variant',
            content,
            lineDiff: computeLineDiff(baseMarkdown, content),
            hasDifference: baseMarkdown !== content,
            exists: true,
          };
        }),
      } ],
      variantLabels: compareVariants.map((v) => v.label || 'Variant'),
    };
  }

  const baseFiles = await readRepo(exercise, 0, compareType);
  if (!baseFiles)
    throw new Error(`Base ${compareType} repository of "${baseVariant.label}" is missing. Download or import it first.`);

  const variantFileMaps = await Promise.all(compareVariants.map(async (variant, idx) => {
    const files = await readRepo(exercise, idx + 1, compareType);
    return {
      label: variant.label || `Variant ${idx + 2}`,
      files: files ? applyMappings(exercise, variant.label, files) : new Map<string, string>(),
    };
  }));

  const allPaths = new Set(baseFiles.keys());
  for (const variantData of variantFileMaps)
    for (const relPath of variantData.files.keys())
      allPaths.add(relPath);

  const filesWithChanges = Array.from(allPaths).filter((relPath) => {
    const baseContent = baseFiles.get(relPath) ?? '';
    return variantFileMaps.some((v) => (v.files.get(relPath) ?? '') !== baseContent);
  });

  return {
    compareType,
    baseVariant: baseVariant.label || 'Variant 1',
    fileComparisons: filesWithChanges.sort().map((relPath) => {
      const baseContent = baseFiles.get(relPath) ?? '';
      return {
        relativePath: relPath,
        baseContent,
        baseExists: baseFiles.has(relPath),
        variants: variantFileMaps.map((variantData) => {
          const content = variantData.files.get(relPath) ?? '';
          const hasDifference = baseContent !== content;
          return {
            variant: variantData.label,
            content,
            lineDiff: hasDifference ? computeLineDiff(baseContent, content) : [],
            hasDifference,
            exists: variantData.files.has(relPath),
          };
        }),
      };
    }),
    variantLabels: variantFileMaps.map((v) => v.label),
  };
}

export async function listFiles(exercise: ExerciseConfig) {
  const filesByVariant: Record<string, { label: string; files: string[] }> = {};
  for (const [ idx, variant ] of exercise.variants.entries()) {
    const label = variant.label || `Variant ${idx + 1}`;
    filesByVariant[label] = { label, files: Array.from((await readAllRepos(exercise, idx)).keys()).sort() };
  }
  return filesByVariant;
}

export async function suggestMappings(exercise: ExerciseConfig, threshold = 50) {
  const suggestions: Array<{ baseFile: string; variantFile: string; variantLabel: string; similarity: number }> = [];
  const baseFileMap = await readAllRepos(exercise, 0);
  for (const [ idx, variant ] of exercise.variants.slice(1).entries()) {
    const variantFileMap = await readAllRepos(exercise, idx + 1);

    /*  Candidates: variant files missing in base, paired with base files missing in variant  */
    for (const [ variantFile, variantContent ] of variantFileMap) {
      if (baseFileMap.has(variantFile))
        continue;
      for (const [ baseFile, baseContent ] of baseFileMap) {
        if (variantFileMap.has(baseFile))
          continue;
        const similarity = calculateSimilarity(baseContent, variantContent);
        if (similarity >= threshold)
          suggestions.push({ baseFile, variantFile, variantLabel: variant.label || `Variant ${idx + 2}`, similarity });
      }
    }
  }
  return suggestions.sort((a, b) => b.similarity - a.similarity);
}

export function getReviewStatuses(): FileReview[] {
  return readConfig().reviewStatuses;
}

type ReviewTarget = { exerciseName: string; filePath: string; variantLabel: string; compareType: CompareType };

/*  Store status and comment of a file review; an unchecked review without comment is dropped  */
function updateReview(target: ReviewTarget, patch: { status?: ReviewStatus; comment?: string }) {
  const config = readConfig();
  const fullKey = `${target.exerciseName}:${target.filePath}`;
  const matches = (r: FileReview) => r.filePath === fullKey && r.variantLabel === target.variantLabel && r.compareType === target.compareType;
  const current = config.reviewStatuses.find(matches);
  const status  = patch.status ?? current?.status ?? 'unchecked';
  const comment = (patch.comment ?? current?.comment ?? '').trim();
  const reviewStatuses = config.reviewStatuses.filter((r) => !matches(r));
  if (status !== 'unchecked' || comment)
    reviewStatuses.push({ filePath: fullKey, variantLabel: target.variantLabel, compareType: target.compareType, status, ...(comment ? { comment } : {}) });
  writeConfig({ ...config, reviewStatuses });
}

export function setReviewStatus(review: ReviewTarget & { status: ReviewStatus }) {
  updateReview(review, { status: review.status });
}

export function setReviewComment(review: ReviewTarget & { comment: string }) {
  updateReview(review, { comment: review.comment });
}

export function clearReviewStatuses() {
  writeConfig({ ...readConfig(), reviewStatuses: [] });
}

export function getStatsIncludedTypes(): CompareType[] {
  return readConfig().statsIncludedTypes;
}

export function setStatsIncludedTypes(statsIncludedTypes: CompareType[]) {
  writeConfig({ ...readConfig(), statsIncludedTypes });
}

type Counts = { correct: number; needsAttention: number; total: number };
const emptyCounts = (): Record<CompareType, Counts> => ({
  problem: { correct: 0, needsAttention: 0, total: 0 },
  test: { correct: 0, needsAttention: 0, total: 0 },
  solution: { correct: 0, needsAttention: 0, total: 0 },
  template: { correct: 0, needsAttention: 0, total: 0 },
});

/*  Review progress for all exercises: files with differences vs. reviewed files  */
export async function getStats() {
  const config = readConfig();
  return Promise.all(config.exercises.map(async (exercise) => {
    const exerciseName = exercise.exerciseName;
    const baseVariant = exercise.variants[0];
    const compareVariants = exercise.variants.slice(1);
    const exerciseReviews = config.reviewStatuses.filter((r) => r.filePath.startsWith(`${exerciseName}:`));

    const byCompareType = emptyCounts();
    const byVariant: Record<string, Record<CompareType, Counts>> = {};
    for (const variant of compareVariants)
      byVariant[variant.label] = emptyCounts();

    for (const ct of REPO_TYPES as RepoType[]) {
      const baseFiles = await readRepo(exercise, 0, ct);
      if (!baseFiles)
        continue;
      for (const [ i, variant ] of compareVariants.entries()) {
        const variantFiles = await readRepo(exercise, i + 1, ct);
        if (!variantFiles)
          continue;
        const mapped = applyMappings(exercise, variant.label, variantFiles);
        const allPaths = new Set([ ...baseFiles.keys(), ...mapped.keys() ]);
        let filesWithDifferences = 0;
        for (const relPath of allPaths)
          if ((baseFiles.get(relPath) ?? '') !== (mapped.get(relPath) ?? ''))
            filesWithDifferences++;
        byVariant[variant.label]![ct].total = filesWithDifferences;
      }
      byCompareType[ct].total = compareVariants.reduce((sum, v) => sum + (byVariant[v.label]?.[ct].total ?? 0), 0);
    }

    for (const variant of compareVariants)
      byVariant[variant.label]!.problem.total = (baseVariant?.markdown || '') !== (variant.markdown || '') ? 1 : 0;
    byCompareType.problem.total = compareVariants.reduce((sum, v) => sum + (byVariant[v.label]?.problem.total ?? 0), 0);

    for (const review of exerciseReviews) {
      const key = review.status === 'correct' ? 'correct' : review.status === 'needs-attention' ? 'needsAttention' : undefined;
      if (!key)
        continue;
      byCompareType[review.compareType][key]++;
      const variantEntry = byVariant[review.variantLabel]?.[review.compareType];
      if (variantEntry)
        variantEntry[key]++;
    }

    return {
      exerciseName,
      targetFolder: exercise.targetFolder,
      variants: exercise.variants.map((v) => v.label),
      byCompareType,
      byVariant,
      totalReviewed: exerciseReviews.filter((r) => r.status !== 'unchecked').length,
    };
  }));
}
