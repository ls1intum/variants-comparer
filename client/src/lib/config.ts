import { z } from 'zod';
import type { CompareType, MultiExerciseConfig } from '@/types';

/*  Browser-side persistence of the exercise configuration (formerly server/storage/config.json)  */
const CONFIG_KEY = 'variants-comparer:config';
const PROXY_KEY = 'variants-comparer:proxy-base';
const ARTEMIS_TOKEN_KEY = 'variants-comparer:artemis-token';
const COMMIT_AUTHOR_KEY = 'variants-comparer:commit-author';

const urlField = (message: string) =>
  z
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
      { message },
    )
    .default('');

const variantSchema = z.object({
  label: z.string().trim().min(1, 'Variant label is required'),
  testRepo: urlField('Repo must be a valid URL or left blank'),
  solutionRepo: urlField('Repo must be a valid URL or left blank'),
  templateRepo: urlField('Repo must be a valid URL or left blank'),
  markdown: z.string().default(''),
  courseLink: urlField('Link must be a valid URL or left blank'),
  artemisUrl: urlField('Artemis link must be a valid URL or left blank'),
  source: z.enum([ 'urls', 'artemis' ]).default('urls'),
});

const fileMappingSchema = z.object({
  baseFile: z.string().min(1, 'Base file path is required'),
  variantFile: z.string().min(1, 'Variant file path is required'),
  variantLabel: z.string().min(1, 'Variant label is required'),
});

export const compareTypeSchema = z.enum([ 'problem', 'test', 'solution', 'template' ]);
const ALL_TYPES: CompareType[] = [ 'problem', 'test', 'solution', 'template' ];

export const exerciseSchema = z.object({
  targetFolder: z.string().default('exam-variants'),
  exerciseName: z.string().trim().min(1, 'Exercise name is required'),
  variants: z.array(variantSchema).length(3, 'Exactly three variants are required'),
  fileMappings: z.array(fileMappingSchema).optional().default([]),
});

const fileReviewSchema = z.object({
  filePath: z.string(),
  variantLabel: z.string(),
  compareType: compareTypeSchema,
  status: z.enum([ 'unchecked', 'correct', 'needs-attention' ]),
  comment: z.string().optional(),
});

const multiExerciseConfigSchema = z.object({
  exercises: z.array(exerciseSchema).min(1, 'At least one exercise is required'),
  activeExerciseIndex: z.number().int().min(0).default(0),
  reviewStatuses: z.array(fileReviewSchema).optional().default([]),
  statsIncludedTypes: z.array(compareTypeSchema).optional().default(ALL_TYPES),
});

export type FullConfig = z.infer<typeof multiExerciseConfigSchema>;

const defaultConfig: FullConfig = {
  exercises: [ {
    targetFolder: 'exam-variants',
    exerciseName: 'Generic',
    variants: [ 1, 2, 3 ].map((idx) => ({
      label: `Variant ${idx}`,
      testRepo: '',
      solutionRepo: '',
      templateRepo: '',
      markdown: '',
      courseLink: '',
      artemisUrl: '',
      source: 'urls' as const,
    })),
    fileMappings: [],
  } ],
  activeExerciseIndex: 0,
  reviewStatuses: [],
  statsIncludedTypes: ALL_TYPES,
};

/*  Parse a multi-exercise config, accepting the legacy single-exercise format, too  */
export function parseConfig(raw: unknown): FullConfig {
  const multi = multiExerciseConfigSchema.safeParse(raw);
  if (multi.success) {
    const config = multi.data;
    if (config.activeExerciseIndex >= config.exercises.length)
      config.activeExerciseIndex = Math.max(0, config.exercises.length - 1);
    return config;
  }
  const single = exerciseSchema.parse(raw);
  return { exercises: [ single ], activeExerciseIndex: 0, reviewStatuses: [], statsIncludedTypes: ALL_TYPES };
}

export function readConfig(): FullConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? parseConfig(JSON.parse(raw)) : structuredClone(defaultConfig);
  }
  catch (error) {
    console.error('Failed to read configuration:', error);
    return structuredClone(defaultConfig);
  }
}

export function writeConfig(config: FullConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

/*  Save exercises and active index, preserving review statuses and stats settings  */
export function saveExercises(payload: MultiExerciseConfig) {
  const parsed = multiExerciseConfigSchema.parse(payload);
  const existing = readConfig();
  writeConfig({
    exercises: parsed.exercises.map((exercise) => ({ ...exercise, exerciseName: exercise.exerciseName.trim() })),
    activeExerciseIndex: parsed.activeExerciseIndex,
    reviewStatuses: existing.reviewStatuses,
    statsIncludedTypes: existing.statsIncludedTypes,
  });
}

export function exportConfigJson(): string {
  return JSON.stringify(readConfig(), null, 2);
}

/*  Import a config JSON file (also accepts the former server/storage/config.json)  */
export function importConfigJson(text: string): FullConfig {
  const config = parseConfig(JSON.parse(text));
  writeConfig(config);
  return config;
}

/*  Base URL of the proxy functions (/git-proxy, /artemis-proxy); empty = no proxy  */
const normalizeProxyBase = (url: string) => url.trim().replace(/\/+$/, '');

/*  Default from VITE_PROXY_BASE (client/.env or build env), else the own origin (Cloudflare Pages Functions)  */
export function getDefaultProxyBase(): string {
  const env = import.meta.env.VITE_PROXY_BASE as string | undefined;
  return env !== undefined ? normalizeProxyBase(env) : window.location.origin;
}

export function getProxyBase(): string {
  return localStorage.getItem(PROXY_KEY) ?? getDefaultProxyBase();
}

/*  Only deviations from the default are stored, so a changed default reaches every browser  */
export function setProxyBase(url: string) {
  const value = normalizeProxyBase(url);
  if (value === getDefaultProxyBase())
    localStorage.removeItem(PROXY_KEY);
  else
    localStorage.setItem(PROXY_KEY, value);
}

/*  Artemis JWT is kept for the browser session only  */
export function getArtemisToken(): string {
  return sessionStorage.getItem(ARTEMIS_TOKEN_KEY) ?? '';
}

export function setArtemisToken(token: string) {
  sessionStorage.setItem(ARTEMIS_TOKEN_KEY, token.trim());
}

/*  Author of commits pushed from the app, remembered per browser  */
export function getCommitAuthor(): { name: string; email: string } {
  try {
    const parsed = JSON.parse(localStorage.getItem(COMMIT_AUTHOR_KEY) ?? '{}') as { name?: unknown; email?: unknown };
    return { name: typeof parsed.name === 'string' ? parsed.name : '', email: typeof parsed.email === 'string' ? parsed.email : '' };
  }
  catch {
    return { name: '', email: '' };
  }
}

export function setCommitAuthor(author: { name: string; email: string }) {
  localStorage.setItem(COMMIT_AUTHOR_KEY, JSON.stringify({ name: author.name.trim(), email: author.email.trim() }));
}
