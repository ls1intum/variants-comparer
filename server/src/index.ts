import cors from 'cors';
import { diffLines } from 'diff';
import express from 'express';
import fs from 'fs-extra';
import path from 'path';
import { simpleGit } from 'simple-git';
import { z } from 'zod';
import { diffChars } from 'diff';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const ALLOWED_BASE_DIR = path.resolve(
  process.env.ALLOWED_BASE_DIR ?? path.join(__dirname, '..', '..', 'data'),
);
const CONFIG_PATH = path.resolve(
  process.env.CONFIG_PATH ?? path.join(__dirname, '..', 'storage', 'config.json'),
);
// Host path for VS Code - when running in Docker, this maps container /data to host path
const HOST_DATA_PATH = process.env.HOST_DATA_PATH ?? ALLOWED_BASE_DIR;

fs.ensureDirSync(ALLOWED_BASE_DIR);
fs.ensureDirSync(path.dirname(CONFIG_PATH));

const git = simpleGit();

const repoField = z
  .string()
  .trim()
  .refine(
    (value) => {
      if (!value) return true;
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Repo must be a valid URL or left blank' },
  );

const optionalLinkField = z
  .string()
  .trim()
  .refine(
    (value) => {
      if (!value) return true;
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Link must be a valid URL or left blank' },
  )
  .default('');

const variantSchema = z.object({
  label: z.string().trim().min(1, 'Variant label is required'),
  testRepo: repoField.default(''),
  solutionRepo: repoField.default(''),
  templateRepo: repoField.default(''),
  markdown: z.string().default(''),
  courseLink: optionalLinkField,
});

const fileMappingSchema = z.object({
  baseFile: z.string().min(1, 'Base file path is required'),
  variantFile: z.string().min(1, 'Variant file path is required'),
  variantLabel: z.string().min(1, 'Variant label is required'),
});

const payloadSchema = z.object({
  targetFolder: z.string().min(1, 'Target folder is required'),
  exerciseName: z.string().trim().min(1, 'Exercise name is required'),
  variants: z.array(variantSchema).length(3, 'Exactly three variants are required'),
  fileMappings: z.array(fileMappingSchema).optional().default([]),
});

// Review status for file comparisons
const reviewStatusSchema = z.enum(['unchecked', 'correct', 'needs-attention']);
const fileReviewSchema = z.object({
  filePath: z.string(),
  variantLabel: z.string(),
  compareType: z.enum(['problem', 'test', 'solution', 'template']),
  status: reviewStatusSchema,
});

const multiExerciseConfigSchema = z.object({
  exercises: z.array(payloadSchema).min(1, 'At least one exercise is required'),
  activeExerciseIndex: z.number().int().min(0).default(0),
  reviewStatuses: z.array(fileReviewSchema).optional().default([]),
  statsIncludedTypes: z.array(z.enum(['problem', 'test', 'solution', 'template'])).optional().default(['problem', 'test', 'solution', 'template']),
});

const compareTypeSchema = z.enum(['problem', 'test', 'solution', 'template']);
const compareRequestSchema = z.object({
  compareType: compareTypeSchema,
});

function computeLineDiff(baseContent: string, variantContent: string) {
  const changes = diffLines(baseContent, variantContent);
  
  const result: Array<{ base?: string; variant?: string; type: 'equal' | 'add' | 'remove' | 'modify' }> = [];

  for (const change of changes) {
    const lines = change.value.split('\n').filter((line, idx, arr) => idx < arr.length - 1 || line !== '');
    
    if (!change.added && !change.removed) {
      // Equal lines
      for (const line of lines) {
        result.push({ base: line, variant: line, type: 'equal' });
      }
    } else if (change.removed) {
      // Lines removed from base (present in base, not in variant)
      for (const line of lines) {
        result.push({ base: line, type: 'remove' });
      }
    } else if (change.added) {
      // Lines added in variant (not in base, present in variant)
      for (const line of lines) {
        result.push({ variant: line, type: 'add' });
      }
    }
  }

  // Post-process: pair up remove/add lines that are similar into modify
  // Use a smarter matching algorithm that finds best matches across chunks
  const processed: typeof result = [];
  let i = 0;
  
  while (i < result.length) {
    const current = result[i];
    if (!current) {
      i++;
      continue;
    }
    
    // If it's not a remove line, just add it and continue
    if (current.type !== 'remove') {
      processed.push(current);
      i++;
      continue;
    }
    
    // Found a remove line - collect all consecutive remove lines
    const removeLines: Array<{ index: number; line: typeof current }> = [];
    let j = i;
    while (j < result.length && result[j]?.type === 'remove') {
      removeLines.push({ index: j, line: result[j]! });
      j++;
    }
    
    // Collect all consecutive add lines that follow
    const addLines: Array<{ index: number; line: typeof current }> = [];
    while (j < result.length && result[j]?.type === 'add') {
      addLines.push({ index: j, line: result[j]! });
      j++;
    }
    
    // If we have both removes and adds, find best matches
    if (removeLines.length > 0 && addLines.length > 0) {
      const usedAddIndices = new Set<number>();
      
      // For each remove line, find the best matching add line
      for (const removePair of removeLines) {
        let bestMatch: { addIdx: number; similarity: number } | null = null;
        
        for (let addIdx = 0; addIdx < addLines.length; addIdx++) {
          if (usedAddIndices.has(addIdx)) continue;
          
          const addPair = addLines[addIdx];
          if (removePair.line.base && addPair?.line.variant) {
            const similarity = calculateStringSimilarity(removePair.line.base, addPair.line.variant);
            
            if (similarity > 0.2 && (!bestMatch || similarity > bestMatch.similarity)) {
              bestMatch = { addIdx, similarity };
            }
          }
        }
        
        // If found a good match, create modify entry
        if (bestMatch && addLines[bestMatch.addIdx]) {
          const baseStr = removePair.line.base;
          const variantStr = addLines[bestMatch.addIdx]!.line.variant;
          if (baseStr && variantStr) {
            processed.push({
              base: baseStr,
              variant: variantStr,
              type: 'modify'
            });
            usedAddIndices.add(bestMatch.addIdx);
          } else {
            processed.push(removePair.line);
          }
        } else {
          // No match found, keep as remove
          processed.push(removePair.line);
        }
      }
      
      // Add any unmatched add lines
      for (let addIdx = 0; addIdx < addLines.length; addIdx++) {
        if (!usedAddIndices.has(addIdx) && addLines[addIdx]) {
          processed.push(addLines[addIdx]!.line);
        }
      }
      
      i = j; // Skip to after the processed chunk
    } else {
      // No matching adds, just keep the removes
      for (const removePair of removeLines) {
        processed.push(removePair.line);
      }
      i = j;
    }
  }

  return processed;
}

function calculateStringSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 1;
  if (!str1 || !str2) return 0;
  
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1;
  
  const editDistance = levenshteinDistance(str1, str2);
  return (longer.length - editDistance) / longer.length;
}

function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = Array(str2.length + 1).fill(0).map(() => Array(str1.length + 1).fill(0));
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i]![0] = i;
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0]![j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i]![j] = matrix[i - 1]![j - 1]!;
      } else {
        matrix[i]![j] = Math.min(
          matrix[i - 1]![j - 1]! + 1,
          matrix[i]![j - 1]! + 1,
          matrix[i - 1]![j]! + 1
        );
      }
    }
  }
  
  return matrix[str2.length]![str1.length]!;
}

type VariantPayload = z.infer<typeof variantSchema>;
type Payload = z.infer<typeof payloadSchema>;
type MultiExerciseConfig = z.infer<typeof multiExerciseConfigSchema>;

const defaultConfig: Payload = {
  targetFolder: 'exam-variants',
  exerciseName: 'Generic',
  variants: [1, 2, 3].map((idx) => ({
    label: `Variant ${idx}`,
    testRepo: '',
    solutionRepo: '',
    templateRepo: '',
    markdown: '',
    courseLink: '',
  })),
  fileMappings: [],
};

const defaultMultiExerciseConfig: MultiExerciseConfig = {
  exercises: [defaultConfig],
  activeExerciseIndex: 0,
  reviewStatuses: [],
  statsIncludedTypes: ['problem', 'test', 'solution', 'template'],
};

function slugify(input: string, fallback: string) {
  const slug = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function normalizeTargetFolder(raw: string) {
  const cleaned = raw.trim();
  if (!cleaned) {
    throw new Error('Target folder is empty');
  }
  // Remove leading slash if present - all paths are relative to ALLOWED_BASE_DIR
  const relativePath = cleaned.startsWith('/') ? cleaned.slice(1) : cleaned;
  const absolute = path.resolve(ALLOWED_BASE_DIR, relativePath);
  const relative = path.relative(ALLOWED_BASE_DIR, absolute);
  if (relative.startsWith('..')) {
    throw new Error(`Target folder must be inside ${ALLOWED_BASE_DIR}`);
  }
  // Ensure the directory exists
  fs.ensureDirSync(absolute);
  return absolute;
}

async function readConfig(): Promise<Payload> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    const safe = payloadSchema.parse(parsed);
    return {
      ...safe,
      targetFolder: normalizeTargetFolder(safe.targetFolder),
      exerciseName: safe.exerciseName.trim() || defaultConfig.exerciseName,
    };
  } catch (err) {
    return defaultConfig;
  }
}

async function readMultiExerciseConfig(): Promise<MultiExerciseConfig> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    
    // Try to parse as multi-exercise config first
    try {
      const safe = multiExerciseConfigSchema.parse(parsed);
      // Bug fix: Ensure activeExerciseIndex is within bounds
      if (safe.activeExerciseIndex >= safe.exercises.length) {
        safe.activeExerciseIndex = Math.max(0, safe.exercises.length - 1);
      }
      return safe;
    } catch {
      // If that fails, try single exercise (legacy format)
      const single = payloadSchema.parse(parsed);
      return {
        exercises: [single],
        activeExerciseIndex: 0,
        reviewStatuses: [],
        statsIncludedTypes: ['problem', 'test', 'solution', 'template'],
      };
    }
  } catch (err) {
    return defaultMultiExerciseConfig;
  }
}

async function writeMultiExerciseConfig(config: MultiExerciseConfig) {
  await fs.ensureDir(path.dirname(CONFIG_PATH));
  await fs.writeJSON(CONFIG_PATH, config, { spaces: 2 });
}

async function writeConfig(payload: Payload) {
  await fs.ensureDir(path.dirname(CONFIG_PATH));
  await fs.writeJSON(CONFIG_PATH, payload, { spaces: 2 });
}

async function cloneRepository(url: string, destination: string) {
  if (!url) {
    return { skipped: true } as const;
  }
  await fs.ensureDir(path.dirname(destination));
  if (await fs.pathExists(destination)) {
    await fs.remove(destination);
  }
  await git.clone(url, destination);
  return { skipped: false } as const;
}

app.get('/api/config', async (_req, res) => {
  try {
    const multiConfig = await readMultiExerciseConfig();
    res.json({ ok: true, data: multiConfig });
  } catch (error) {
    res.json({ ok: true, data: defaultMultiExerciseConfig });
  }
});

app.post('/api/save', async (req, res) => {
  try {
    const multiConfig = multiExerciseConfigSchema.parse(req.body);
    
    // Validate and normalize each exercise
    const normalizedExercises = multiConfig.exercises.map(exercise => {
      normalizeTargetFolder(exercise.targetFolder);
      const relativePath = exercise.targetFolder.trim().startsWith('/') 
        ? exercise.targetFolder.trim().slice(1) 
        : exercise.targetFolder.trim();
      return {
        ...exercise,
        targetFolder: relativePath,
        exerciseName: exercise.exerciseName.trim(),
      };
    });
    
    // Preserve existing review statuses when saving
    const existingConfig = await readMultiExerciseConfig();
    
    const normalizedConfig: MultiExerciseConfig = {
      exercises: normalizedExercises,
      activeExerciseIndex: multiConfig.activeExerciseIndex,
      reviewStatuses: existingConfig.reviewStatuses || [],
      statsIncludedTypes: existingConfig.statsIncludedTypes || ['problem', 'test', 'solution', 'template'],
    };
    
    await writeMultiExerciseConfig(normalizedConfig);
    res.json({ ok: true, savedTo: CONFIG_PATH });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ ok: false, error: error.flatten() });
      return;
    }
    res.status(500).json({ ok: false, error: (error as Error).message });
  }
});

app.post('/api/download', async (req, res) => {
  try {
    const payload = payloadSchema.parse(req.body);
    const targetRoot = normalizeTargetFolder(payload.targetFolder);
    // Save the original input (with leading slash removed if present)
    const relativePath = payload.targetFolder.trim().startsWith('/') 
      ? payload.targetFolder.trim().slice(1) 
      : payload.targetFolder.trim();
    const normalizedPayload: Payload = {
      ...payload,
      targetFolder: relativePath,
      exerciseName: payload.exerciseName.trim(),
    };
    
    // Update the multi-exercise config with this exercise
    const multiConfig = await readMultiExerciseConfig();
    const exerciseIndex = multiConfig.exercises.findIndex(
      ex => ex.exerciseName === normalizedPayload.exerciseName
    );
    
    if (exerciseIndex >= 0) {
      multiConfig.exercises[exerciseIndex] = normalizedPayload;
    } else {
      multiConfig.exercises.push(normalizedPayload);
      multiConfig.activeExerciseIndex = multiConfig.exercises.length - 1;
    }
    
    await writeMultiExerciseConfig(multiConfig);
    
    const events: Array<{
      variant: string;
      repoType: 'test' | 'solution' | 'template';
      destination: string;
      success: boolean;
      message: string;
    }> = [];

    const exerciseSlug = slugify(normalizedPayload.exerciseName, 'exercise');
    const exerciseRoot = path.join(targetRoot, exerciseSlug);
    await fs.ensureDir(exerciseRoot);

    for (const [index, variant] of normalizedPayload.variants.entries()) {
      const slug = slugify(variant.label, `variant-${index + 1}`);
      const variantRoot = path.join(exerciseRoot, slug);
      await fs.ensureDir(variantRoot);

      const repos: Array<[keyof Omit<VariantPayload, 'label' | 'markdown' | 'courseLink'>, string]> = [
        ['testRepo', variant.testRepo],
        ['solutionRepo', variant.solutionRepo],
        ['templateRepo', variant.templateRepo],
      ];

      for (const [key, url] of repos) {
        const label = key === 'testRepo' ? 'test' : key === 'solutionRepo' ? 'solution' : 'template';
        const destination = path.join(variantRoot, label);
        if (!url) {
          events.push({
            variant: variant.label,
            repoType: label,
            destination,
            success: true,
            message: 'No URL provided, skipped',
          });
          continue;
        }
        try {
          await cloneRepository(url, destination);
          events.push({
            variant: variant.label,
            repoType: label,
            destination,
            success: true,
            message: 'Cloned successfully',
          });
        } catch (cloneError) {
          events.push({
            variant: variant.label,
            repoType: label,
            destination,
            success: false,
            message: (cloneError as Error).message,
          });
        }
      }

      if (variant.markdown?.trim()) {
        const notePath = path.join(variantRoot, 'notes.md');
        await fs.writeFile(notePath, variant.markdown, 'utf-8');
      }
    }

    res.json({ ok: true, targetRoot: relativePath, exerciseRoot, exerciseName: normalizedPayload.exerciseName, events });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ ok: false, error: error.flatten() });
      return;
    }
    res.status(500).json({ ok: false, error: (error as Error).message });
  }
});

const ignoredDirs = new Set(['.git', 'node_modules']);

async function readFilesRecursive(dir: string, baseDir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const child = await readFilesRecursive(fullPath, baseDir);
      child.forEach((content, relPath) => files.set(relPath, content));
    } else if (entry.isFile()) {
      const relPath = path.relative(baseDir, fullPath) || entry.name;
      const content = await fs.readFile(fullPath, 'utf-8');
      files.set(relPath, content);
    }
  }
  return files;
}

app.post('/api/compare', async (req, res) => {
  try {
    const { compareType } = compareRequestSchema.parse(req.body);
    const multiConfig = await readMultiExerciseConfig();
    const config = multiConfig.exercises[multiConfig.activeExerciseIndex];
    
    if (!config) {
      res.status(400).json({ ok: false, error: 'No active exercise found.' });
      return;
    }
    
    const baseVariant = config.variants[0];
    if (!baseVariant) {
      res.status(400).json({ ok: false, error: 'At least one variant is required before comparing.' });
      return;
    }

    if (compareType === 'problem') {
      const baseLabel = baseVariant.label || 'Variant 1';
      
      // Build file-centric comparison for problem statements
      const fileComparisons = [{
        relativePath: 'problem.md',
        baseContent: baseVariant.markdown || '',
        variants: config.variants.slice(1).map((variant) => {
          const variantContent = variant.markdown || '';
          const lineDiff = computeLineDiff(baseVariant.markdown || '', variantContent);
          return {
            variant: variant.label || 'Variant',
            content: variantContent,
            lineDiff,
            hasDifference: baseVariant.markdown !== variantContent,
            exists: true,
          };
        }),
      }];

      res.json({
        ok: true,
        compareType,
        baseVariant: baseLabel,
        fileComparisons,
        variantLabels: config.variants.slice(1).map((v) => v.label || 'Variant'),
      });
      return;
    }

  const folderMap: Record<'test' | 'solution' | 'template', string> = {
    test: 'test',
    solution: 'solution',
    template: 'template',
  };
    const folderName = folderMap[compareType as keyof typeof folderMap];
    
    // Normalize targetFolder to get absolute path
    const targetRoot = normalizeTargetFolder(config.targetFolder);
    const exerciseSlug = slugify(config.exerciseName, 'exercise');
    const baseSlug = slugify(baseVariant.label, 'variant-1');
    const baseDir = path.join(targetRoot, exerciseSlug, baseSlug, folderName);

    if (!(await fs.pathExists(baseDir))) {
      res.status(400).json({ ok: false, error: `Base folder missing at ${baseDir}. Run a download first.` });
      return;
    }

    const baseRepoFiles = await readFilesRecursive(baseDir, baseDir);
    
    // Get file mappings for this exercise
    const fileMappings = config.fileMappings || [];
    
    // Collect all variant file maps
    const variantFileMaps: Array<{ label: string; files: Map<string, string>; exists: boolean }> = await Promise.all(
      config.variants.slice(1).map(async (variant, idx) => {
        const variantSlug = slugify(variant.label, `variant-${idx + 2}`);
        const variantDir = path.join(targetRoot, exerciseSlug, variantSlug, folderName);
        const exists = await fs.pathExists(variantDir);
        if (!exists) {
          return {
            label: variant.label || `Variant ${idx + 2}`,
            files: new Map<string, string>(),
            exists: false,
          };
        }
        const variantFiles = await readFilesRecursive(variantDir, variantDir);
        
        // Apply file mappings for this variant
        const mappedFiles = new Map<string, string>();
        variantFiles.forEach((content, filePath) => {
          // Check if this file has a mapping
          const mapping = fileMappings.find(
            m => m.variantFile === filePath && m.variantLabel === variant.label
          );
          if (mapping) {
            // Use the base file name for comparison
            mappedFiles.set(mapping.baseFile, content);
          } else {
            // Keep original file path
            mappedFiles.set(filePath, content);
          }
        });
        
        return {
          label: variant.label || `Variant ${idx + 2}`,
          files: mappedFiles,
          exists: true,
        };
      }),
    );

    // Collect all unique file paths that have changes
    const filesWithChanges = new Set<string>();
    const allPaths = new Set(baseRepoFiles.keys());
    
    for (const variantData of variantFileMaps) {
      for (const relPath of variantData.files.keys()) {
        allPaths.add(relPath);
      }
    }

    // Check which files have differences
    for (const relPath of allPaths) {
      const baseContent = baseRepoFiles.get(relPath) ?? '';
      let hasDifference = false;
      
      for (const variantData of variantFileMaps) {
        const variantContent = variantData.files.get(relPath) ?? '';
        if (baseContent !== variantContent) {
          hasDifference = true;
          break;
        }
      }
      
      if (hasDifference) {
        filesWithChanges.add(relPath);
      }
    }

    // Build file-centric structure
    const fileComparisons = Array.from(filesWithChanges).sort().map((relPath) => {
      const baseContent = baseRepoFiles.get(relPath) ?? '';
      const variants = variantFileMaps.map((variantData) => {
        const variantContent = variantData.files.get(relPath) ?? '';
        const hasDiff = baseContent !== variantContent;
        const lineDiff = hasDiff ? computeLineDiff(baseContent, variantContent) : [];
        
        return {
          variant: variantData.label,
          content: variantContent,
          lineDiff,
          hasDifference: hasDiff,
          exists: variantData.files.has(relPath),
        };
      });

      return {
        relativePath: relPath,
        baseContent,
        variants,
      };
    });

    res.json({
      ok: true,
      compareType,
      baseVariant: baseVariant.label || 'Variant 1',
      fileComparisons,
      variantLabels: variantFileMaps.map((v) => v.label),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ ok: false, error: error.flatten() });
      return;
    }
    res.status(500).json({ ok: false, error: (error as Error).message });
  }
});

// Get file paths for VS Code diff
const openVSCodeDiffSchema = z.object({
  compareType: z.enum(['test', 'solution', 'template']),
  relativePath: z.string().min(1),
  variantLabel: z.string().min(1),
  mappedPath: z.string().optional(), // If there's a file mapping, this is the variant's actual file path
});

app.post('/api/open-vscode-diff', async (req, res) => {
  try {
    const { compareType, relativePath, variantLabel, mappedPath } = openVSCodeDiffSchema.parse(req.body);
    
    const multiConfig = await readMultiExerciseConfig();
    const config = multiConfig.exercises[multiConfig.activeExerciseIndex];
    
    if (!config) {
      res.status(400).json({ ok: false, error: 'No active exercise found.' });
      return;
    }
    
    const baseVariant = config.variants[0];
    if (!baseVariant) {
      res.status(400).json({ ok: false, error: 'No base variant configured.' });
      return;
    }
    
    const targetRoot = normalizeTargetFolder(config.targetFolder);
    const exerciseSlug = slugify(config.exerciseName, 'exercise');
    const baseSlug = slugify(baseVariant.label, 'variant-1');
    
    // Find the variant index
    const variantIndex = config.variants.findIndex(v => v.label === variantLabel);
    if (variantIndex < 1) {
      res.status(400).json({ ok: false, error: `Variant "${variantLabel}" not found.` });
      return;
    }
    
    const variant = config.variants[variantIndex];
    if (!variant) {
      res.status(400).json({ ok: false, error: `Variant "${variantLabel}" not found.` });
      return;
    }
    
    const variantSlug = slugify(variant.label, `variant-${variantIndex + 1}`);
    
    // Build absolute paths (these are paths inside the container's /data volume)
    const baseFilePath = path.join(targetRoot, exerciseSlug, baseSlug, compareType, relativePath);
    const variantFilePath = path.join(
      targetRoot, 
      exerciseSlug, 
      variantSlug, 
      compareType, 
      mappedPath || relativePath
    );
    
    // Check files exist
    const baseExists = await fs.pathExists(baseFilePath);
    const variantExists = await fs.pathExists(variantFilePath);
    
    // Convert container paths to host paths for VS Code
    // Replace the container data dir with the host data dir
    const toHostPath = (containerPath: string) => {
      return containerPath.replace(ALLOWED_BASE_DIR, HOST_DATA_PATH);
    };
    
    // Return the paths - the client will construct the vscode:// URL
    res.json({ 
      ok: true, 
      baseFilePath: baseExists ? toHostPath(baseFilePath) : null,
      variantFilePath: variantExists ? toHostPath(variantFilePath) : null,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ ok: false, error: error.flatten() });
      return;
    }
    res.status(500).json({ ok: false, error: (error as Error).message });
  }
});

app.get('/api/files', async (_req, res) => {
  try {
    const multiConfig = await readMultiExerciseConfig();
    const config = multiConfig.exercises[multiConfig.activeExerciseIndex];
    
    if (!config) {
      res.status(400).json({ ok: false, error: 'No active exercise found.' });
      return;
    }

    const targetRoot = normalizeTargetFolder(config.targetFolder);
    const exerciseSlug = slugify(config.exerciseName, 'exercise');
    
    const filesByVariant: Record<string, { label: string; files: string[] }> = {};
    
    for (const [idx, variant] of config.variants.entries()) {
      const variantSlug = slugify(variant.label, `variant-${idx + 1}`);
      const variantFiles: string[] = [];
      
      // Collect files from all repo types (test, solution, template)
      for (const repoType of ['test', 'solution', 'template'] as const) {
        const variantDir = path.join(targetRoot, exerciseSlug, variantSlug, repoType);
        if (await fs.pathExists(variantDir)) {
          const files = await readFilesRecursive(variantDir, variantDir);
          files.forEach((_, relPath) => {
            if (!variantFiles.includes(relPath)) {
              variantFiles.push(relPath);
            }
          });
        }
      }
      
      filesByVariant[variant.label || `Variant ${idx + 1}`] = {
        label: variant.label || `Variant ${idx + 1}`,
        files: variantFiles.sort(),
      };
    }
    
    res.json({ ok: true, filesByVariant });
  } catch (error) {
    res.status(500).json({ ok: false, error: (error as Error).message });
  }
});

function calculateSimilarity(content1: string, content2: string): number {
  if (content1 === content2) return 100;
  if (!content1 || !content2) return 0;
  
  const changes = diffChars(content1, content2);
  let matchingChars = 0;
  
  for (const change of changes) {
    if (!change.added && !change.removed) {
      matchingChars += change.value.length;
    }
  }
  
  // Bug fix: Use the larger of the two strings as the denominator
  // instead of totalChars which double-counts differences
  const maxLength = Math.max(content1.length, content2.length);
  return maxLength > 0 ? Math.round((matchingChars / maxLength) * 100) : 0;
}

app.get('/api/suggest-mappings', async (req, res) => {
  try {
    const thresholdParam = req.query.threshold;
    const threshold = thresholdParam ? Number(thresholdParam) : 50; // Default 50% similarity
    
    const multiConfig = await readMultiExerciseConfig();
    const config = multiConfig.exercises[multiConfig.activeExerciseIndex];
    
    if (!config) {
      res.status(400).json({ ok: false, error: 'No active exercise found.' });
      return;
    }

    const targetRoot = normalizeTargetFolder(config.targetFolder);
    const exerciseSlug = slugify(config.exerciseName, 'exercise');
    const baseVariant = config.variants[0];
    
    if (!baseVariant) {
      res.status(400).json({ ok: false, error: 'Base variant not found.' });
      return;
    }
    
    const baseSlug = slugify(baseVariant.label, 'variant-1');
    
    const suggestions: Array<{
      baseFile: string;
      variantFile: string;
      variantLabel: string;
      similarity: number;
    }> = [];
    
    // Get base variant files
    const baseFileMap = new Map<string, string>();
    for (const repoType of ['test', 'solution', 'template'] as const) {
      const baseDir = path.join(targetRoot, exerciseSlug, baseSlug, repoType);
      if (await fs.pathExists(baseDir)) {
        const files = await readFilesRecursive(baseDir, baseDir);
        files.forEach((content, relPath) => {
          baseFileMap.set(relPath, content);
        });
      }
    }
    
    // Compare with other variants
    for (const [idx, variant] of config.variants.slice(1).entries()) {
      const variantSlug = slugify(variant.label, `variant-${idx + 2}`);
      const variantFileMap = new Map<string, string>();
      
      for (const repoType of ['test', 'solution', 'template'] as const) {
        const variantDir = path.join(targetRoot, exerciseSlug, variantSlug, repoType);
        if (await fs.pathExists(variantDir)) {
          const files = await readFilesRecursive(variantDir, variantDir);
          files.forEach((content, relPath) => {
            variantFileMap.set(relPath, content);
          });
        }
      }
      
      // Find files that exist in variant but not in base (renamed candidates)
      for (const [variantFile, variantContent] of variantFileMap) {
        if (!baseFileMap.has(variantFile)) {
          // This file doesn't exist in base with same name, check similarity with all base files
          for (const [baseFile, baseContent] of baseFileMap) {
            if (!variantFileMap.has(baseFile)) {
              // Base file also doesn't exist in variant with same name
              const similarity = calculateSimilarity(baseContent, variantContent);
              
              if (similarity >= threshold) {
                suggestions.push({
                  baseFile,
                  variantFile,
                  variantLabel: variant.label || `Variant ${idx + 2}`,
                  similarity,
                });
              }
            }
          }
        }
      }
    }
    
    // Sort by similarity (highest first)
    suggestions.sort((a, b) => b.similarity - a.similarity);
    
    res.json({ ok: true, suggestions });
  } catch (error) {
    res.status(500).json({ ok: false, error: (error as Error).message });
  }
});

// Review status endpoints
const updateReviewStatusSchema = z.object({
  exerciseName: z.string(),
  filePath: z.string(),
  variantLabel: z.string(),
  compareType: compareTypeSchema,
  status: reviewStatusSchema,
});

app.post('/api/review-status', async (req, res) => {
  try {
    const { exerciseName, filePath, variantLabel, compareType, status } = updateReviewStatusSchema.parse(req.body);
    
    const config = await readMultiExerciseConfig();
    const reviewStatuses = config.reviewStatuses || [];
    
    // Bug fix: Always use consistent key format with exerciseName prefix
    const fullKey = `${exerciseName}:${filePath}`;
    
    // Find existing review using the full key format
    const existingIndex = reviewStatuses.findIndex(
      r => r.filePath === fullKey && 
           r.variantLabel === variantLabel && 
           r.compareType === compareType
    );
    
    // Clean up any legacy entries without the exercise prefix (migration)
    const legacyIndex = reviewStatuses.findIndex(
      r => r.filePath === filePath && 
           !r.filePath.includes(':') &&
           r.variantLabel === variantLabel && 
           r.compareType === compareType
    );
    if (legacyIndex >= 0) {
      reviewStatuses.splice(legacyIndex, 1);
    }
    
    if (status === 'unchecked') {
      // Remove the review status if set to unchecked
      if (existingIndex >= 0) {
        reviewStatuses.splice(existingIndex, 1);
      }
    } else {
      const newReview = {
        filePath: fullKey,
        variantLabel,
        compareType,
        status,
      };
      
      if (existingIndex >= 0) {
        reviewStatuses[existingIndex] = newReview;
      } else {
        reviewStatuses.push(newReview);
      }
    }
    
    config.reviewStatuses = reviewStatuses;
    await writeMultiExerciseConfig(config);
    
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ ok: false, error: error.flatten() });
      return;
    }
    res.status(500).json({ ok: false, error: (error as Error).message });
  }
});

app.get('/api/review-status', async (_req, res) => {
  try {
    const config = await readMultiExerciseConfig();
    res.json({ ok: true, reviewStatuses: config.reviewStatuses || [] });
  } catch (error) {
    res.status(500).json({ ok: false, error: (error as Error).message });
  }
});

// Clear all review statuses
app.delete('/api/review-status', async (_req, res) => {
  try {
    const config = await readMultiExerciseConfig();
    config.reviewStatuses = [];
    await writeMultiExerciseConfig(config);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: (error as Error).message });
  }
});

// Stats included types endpoints
app.get('/api/stats-included-types', async (_req, res) => {
  try {
    const config = await readMultiExerciseConfig();
    res.json({ ok: true, statsIncludedTypes: config.statsIncludedTypes || ['problem', 'test', 'solution', 'template'] });
  } catch (error) {
    res.status(500).json({ ok: false, error: (error as Error).message });
  }
});

const statsIncludedTypesSchema = z.object({
  statsIncludedTypes: z.array(z.enum(['problem', 'test', 'solution', 'template'])),
});

app.post('/api/stats-included-types', async (req, res) => {
  try {
    const { statsIncludedTypes } = statsIncludedTypesSchema.parse(req.body);
    const config = await readMultiExerciseConfig();
    config.statsIncludedTypes = statsIncludedTypes;
    await writeMultiExerciseConfig(config);
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ ok: false, error: error.flatten() });
      return;
    }
    res.status(500).json({ ok: false, error: (error as Error).message });
  }
});

// Stats endpoint - returns review progress for all exercises
app.get('/api/stats', async (_req, res) => {
  try {
    const config = await readMultiExerciseConfig();
    const reviewStatuses = config.reviewStatuses || [];
    
    // For each exercise, get file counts from disk and compare with reviews
    const stats = await Promise.all(config.exercises.map(async (exercise) => {
      const exerciseName = exercise.exerciseName;
      const targetFolder = exercise.targetFolder;
      const variants = exercise.variants;
      const baseVariant = variants[0];
      const baseVariantLabel = baseVariant?.label || 'Variant 1';
      const compareVariants = variants.slice(1);
      const fileMappings = exercise.fileMappings || [];
      
      // Get reviews for this exercise
      const exerciseReviews = reviewStatuses.filter(r => r.filePath.startsWith(`${exerciseName}:`));
      
      // Count by compareType and status (overall)
      const byCompareType: Record<string, { correct: number; needsAttention: number; total: number }> = {
        problem: { correct: 0, needsAttention: 0, total: 0 },
        test: { correct: 0, needsAttention: 0, total: 0 },
        solution: { correct: 0, needsAttention: 0, total: 0 },
        template: { correct: 0, needsAttention: 0, total: 0 },
      };
      
      // Per-variant stats
      const byVariant: Record<string, Record<string, { correct: number; needsAttention: number; total: number }>> = {};
      for (const variant of compareVariants) {
        byVariant[variant.label] = {
          problem: { correct: 0, needsAttention: 0, total: 0 },
          test: { correct: 0, needsAttention: 0, total: 0 },
          solution: { correct: 0, needsAttention: 0, total: 0 },
          template: { correct: 0, needsAttention: 0, total: 0 },
        };
      }
      
      // Count actual files WITH DIFFERENCES for each compare type and variant
      const targetRoot = normalizeTargetFolder(targetFolder);
      const exerciseSlug = slugify(exerciseName, 'exercise');
      const baseSlug = slugify(baseVariantLabel, 'variant-1');
      
      const compareTypes = ['test', 'solution', 'template'] as const;
      for (const ct of compareTypes) {
        const baseRepoPath = path.join(targetRoot, exerciseSlug, baseSlug, ct);
        
        try {
          if (await fs.pathExists(baseRepoPath)) {
            const baseFiles = await readFilesRecursive(baseRepoPath, baseRepoPath);
            
            // For each variant, count files that actually differ
            for (let i = 0; i < compareVariants.length; i++) {
              const variant = compareVariants[i];
              if (!variant) continue;
              
              const variantSlug = slugify(variant.label, `variant-${i + 2}`);
              const variantRepoPath = path.join(targetRoot, exerciseSlug, variantSlug, ct);
              
              if (!(await fs.pathExists(variantRepoPath))) continue;
              
              const variantFiles = await readFilesRecursive(variantRepoPath, variantRepoPath);
              
              // Apply file mappings for this variant
              const mappedVariantFiles = new Map<string, string>();
              variantFiles.forEach((content, filePath) => {
                const mapping = fileMappings.find(
                  m => m.variantFile === filePath && m.variantLabel === variant.label
                );
                if (mapping) {
                  mappedVariantFiles.set(mapping.baseFile, content);
                } else {
                  mappedVariantFiles.set(filePath, content);
                }
              });
              
              // Count files with actual differences for this variant
              const allPaths = new Set([...baseFiles.keys(), ...mappedVariantFiles.keys()]);
              let filesWithDifferences = 0;
              
              for (const relPath of allPaths) {
                const baseContent = baseFiles.get(relPath) ?? '';
                const variantContent = mappedVariantFiles.get(relPath) ?? '';
                if (baseContent !== variantContent) {
                  filesWithDifferences++;
                }
              }
              
              // Update per-variant total
              const variantEntry = byVariant[variant.label]?.[ct];
              if (variantEntry) {
                variantEntry.total = filesWithDifferences;
              }
            }
            
            // Overall total = sum of per-variant totals
            const entry = byCompareType[ct];
            if (entry) {
              entry.total = compareVariants.reduce((sum, v) => {
                return sum + (byVariant[v.label]?.[ct]?.total ?? 0);
              }, 0);
            }
          }
        } catch {
          // Ignore errors reading files
        }
      }
      
      // Problem statements - check if they actually differ per variant
      for (let i = 0; i < compareVariants.length; i++) {
        const variant = compareVariants[i];
        if (!variant) continue;
        
        // Check if problem statement differs for this variant
        const baseMarkdown = baseVariant?.markdown || '';
        const variantMarkdown = variant.markdown || '';
        const hasDifference = baseMarkdown !== variantMarkdown;
        
        const variantEntry = byVariant[variant.label]?.problem;
        if (variantEntry) {
          variantEntry.total = hasDifference ? 1 : 0;
        }
      }
      
      // Overall problem total = sum of per-variant totals
      if (byCompareType.problem) {
        byCompareType.problem.total = compareVariants.reduce((sum, v) => {
          return sum + (byVariant[v.label]?.problem?.total ?? 0);
        }, 0);
      }
      
      // Count reviews (overall and per-variant)
      for (const review of exerciseReviews) {
        const ct = review.compareType;
        const variantLabel = review.variantLabel;
        
        // Overall count
        const entry = byCompareType[ct];
        if (entry) {
          if (review.status === 'correct') {
            entry.correct++;
          } else if (review.status === 'needs-attention') {
            entry.needsAttention++;
          }
        }
        
        // Per-variant count
        const variantEntry = byVariant[variantLabel]?.[ct];
        if (variantEntry) {
          if (review.status === 'correct') {
            variantEntry.correct++;
          } else if (review.status === 'needs-attention') {
            variantEntry.needsAttention++;
          }
        }
      }
      
      return {
        exerciseName,
        targetFolder,
        variants: variants.map(v => v.label),
        byCompareType,
        byVariant,
        totalReviewed: exerciseReviews.length,
      };
    }));
    
    res.json({ ok: true, stats });
  } catch (error) {
    res.status(500).json({ ok: false, error: (error as Error).message });
  }
});

async function getJavaFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        files.push(...await getJavaFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.java')) {
        files.push(fullPath);
      }
    }
  } catch {
    // Ignore errors
  }
  return files;
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Config path: ${CONFIG_PATH}`);
  console.log(`Allowed base dir: ${ALLOWED_BASE_DIR}`);
});
