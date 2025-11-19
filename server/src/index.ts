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

const multiExerciseConfigSchema = z.object({
  exercises: z.array(payloadSchema).min(1, 'At least one exercise is required'),
  activeExerciseIndex: z.number().int().min(0).default(0),
});

const compareTypeSchema = z.enum(['problem', 'test', 'solution', 'template']);
const compareRequestSchema = z.object({
  compareType: compareTypeSchema,
});

function computeLineDiff(baseContent: string, variantContent: string) {
  const baseLines = baseContent.split('\n');
  const variantLines = variantContent.split('\n');
  const changes = diffLines(baseContent, variantContent);
  
  const result: Array<{ base?: string; variant?: string; type: 'equal' | 'add' | 'remove' | 'modify' }> = [];
  let baseIdx = 0;
  let variantIdx = 0;

  for (const change of changes) {
    const lines = change.value.split('\n').filter((line, idx, arr) => idx < arr.length - 1 || line !== '');
    
    if (!change.added && !change.removed) {
      // Equal lines
      for (const line of lines) {
        result.push({ base: line, variant: line, type: 'equal' });
        baseIdx++;
        variantIdx++;
      }
    } else if (change.removed) {
      // Lines removed from base (present in base, not in variant)
      for (const line of lines) {
        result.push({ base: line, type: 'remove' });
        baseIdx++;
      }
    } else if (change.added) {
      // Lines added in variant (not in base, present in variant)
      for (const line of lines) {
        result.push({ variant: line, type: 'add' });
        variantIdx++;
      }
    }
  }

  return result;
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
      return safe;
    } catch {
      // If that fails, try single exercise (legacy format)
      const single = payloadSchema.parse(parsed);
      return {
        exercises: [single],
        activeExerciseIndex: 0,
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
    
    const normalizedConfig: MultiExerciseConfig = {
      exercises: normalizedExercises,
      activeExerciseIndex: multiConfig.activeExerciseIndex,
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
  let totalChars = 0;
  let matchingChars = 0;
  
  for (const change of changes) {
    const length = change.value.length;
    totalChars += length;
    if (!change.added && !change.removed) {
      matchingChars += length;
    }
  }
  
  return totalChars > 0 ? Math.round((matchingChars / totalChars) * 100) : 0;
}

app.get('/api/suggest-mappings', async (req, res) => {
  try {
    const thresholdParam = req.query.threshold;
    const threshold = thresholdParam ? Number(thresholdParam) : 30; // Default 30% similarity
    
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

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Config path: ${CONFIG_PATH}`);
  console.log(`Allowed base dir: ${ALLOWED_BASE_DIR}`);
});
