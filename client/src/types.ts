export type FileMapping = {
  baseFile: string;
  variantFile: string;
  variantLabel: string;
};

export type VariantForm = {
  label: string;
  testRepo: string;
  solutionRepo: string;
  templateRepo: string;
  markdown: string;
  courseLink: string;
};

export type ExerciseConfig = {
  targetFolder: string;
  exerciseName: string;
  variants: VariantForm[];
  fileMappings?: FileMapping[];
};

export type MultiExerciseConfig = {
  exercises: ExerciseConfig[];
  activeExerciseIndex: number;
};

export type DownloadResult = {
  variant: string;
  repoType: 'test' | 'solution' | 'template';
  destination: string;
  success: boolean;
  message: string;
};

export type CompareType = 'problem' | 'test' | 'solution' | 'template';

export type ComparisonFileDiff = {
  relativePath: string;
  diff: string;
};

export type ComparisonResult = {
  variant: string;
  files: ComparisonFileDiff[];
  notes?: string;
};

export type LineDiff = {
  base?: string;
  variant?: string;
  type: 'equal' | 'add' | 'remove' | 'modify';
};

export type VariantComparison = {
  variant: string;
  content: string;
  lineDiff: LineDiff[];
  hasDifference: boolean;
  exists: boolean;
};

export type FileComparison = {
  relativePath: string;
  baseContent: string;
  variants: VariantComparison[];
};

export type ComparisonResponse = {
  compareType: CompareType;
  baseVariant: string;
  baseFiles?: ComparisonFileDiff[];
  comparisons?: ComparisonResult[];
  fileComparisons?: FileComparison[];
  variantLabels?: string[];
};
