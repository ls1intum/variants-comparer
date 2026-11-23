/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import { ZodError } from 'zod';
import { readConfig, saveExercises } from '@/lib/config';
import { clearExerciseRepos } from '@/lib/importer';
import { exerciseDir } from '@/lib/repoStore';
import type { ExerciseConfig, MultiExerciseConfig } from '@/types';

type ExerciseContextType = {
  exercises: ExerciseConfig[];
  activeExerciseIndex: number;
  setExercises: (exercises: ExerciseConfig[] | ((prev: ExerciseConfig[]) => ExerciseConfig[])) => void;
  setActiveExerciseIndex: (index: number) => void;
  addExercise: (name?: string) => void;
  deleteExercise: (index: number) => void;
  currentExercise: ExerciseConfig;
  loading: boolean;
  saveState: SaveState;
};

export type SaveState = { status: 'saved' | 'saving' } | { status: 'error'; error: string };

const ExerciseContext = createContext<ExerciseContextType | undefined>(undefined);

function createExerciseTemplate(): ExerciseConfig {
  return {
    targetFolder: 'exam-variants',
    exerciseName: '',
    variants: [0, 1, 2].map((idx) => ({
      label: `Variant ${idx + 1}`,
      testRepo: '',
      solutionRepo: '',
      templateRepo: '',
      markdown: '',
      courseLink: '',
      artemisUrl: '',
      source: 'urls' as const,
    })),
  };
}

export function ExerciseProvider({ children }: { children: ReactNode }) {
  const [exercises, setExercises] = useState<ExerciseConfig[]>([createExerciseTemplate()]);
  const [activeExerciseIndex, setActiveExerciseIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>({ status: 'saved' });
  const isInitialMount = useRef(true);

  useEffect(() => {
    const multiConfig = readConfig();
    if (multiConfig.exercises.length > 0) {
      setExercises(multiConfig.exercises);
      setActiveExerciseIndex(multiConfig.activeExerciseIndex || 0);
    }
    setLoading(false);
  }, []);

  // Persist exercises and active index when they change (debounced, not on initial mount)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    
    setSaveState({ status: 'saving' });
    const timeoutId = setTimeout(() => {
      try {
        // Filter out incomplete file mappings to pass validation
        const sanitizedExercises = exercises.map(ex => ({
          ...ex,
          fileMappings: (ex.fileMappings || []).filter(
            (m) => m.baseFile.trim() && m.variantFile.trim() && m.variantLabel.trim()
          ),
        }));
        const payload: MultiExerciseConfig = {
          exercises: sanitizedExercises,
          activeExerciseIndex,
        };
        saveExercises(payload);
        setSaveState({ status: 'saved' });
      } catch (error) {
        const message = error instanceof ZodError ? error.issues[0]?.message : (error as Error).message;
        setSaveState({ status: 'error', error: message ?? 'Invalid configuration' });
      }
    }, 300); // Debounce for 300ms to prevent race conditions

    return () => clearTimeout(timeoutId);
  }, [activeExerciseIndex, exercises]);

  const addExercise = (name?: string) => {
    const newExercise = createExerciseTemplate();
    if (name) {
      newExercise.exerciseName = name;
    }
    // Bug fix: Use functional update to get correct array length
    setExercises((prev) => {
      setActiveExerciseIndex(prev.length); // Use prev.length which is the actual current length
      return [...prev, newExercise];
    });
  };

  const deleteExercise = (index: number) => {
    if (exercises.length <= 1) return;
    const deleted = exercises[index];

    /*  Drop the stored repositories, unless another exercise maps to the same folder  */
    if (deleted && !exercises.some((ex, idx) => idx !== index && exerciseDir(ex) === exerciseDir(deleted)))
      clearExerciseRepos(deleted).catch((error) => console.error('Failed to clear repositories:', error));
    const newLength = exercises.length - 1;
    setExercises((prev) => prev.filter((_, idx) => idx !== index));
    // Bug fix: Ensure activeExerciseIndex stays within bounds after deletion
    if (activeExerciseIndex >= newLength) {
      setActiveExerciseIndex(Math.max(0, newLength - 1));
    } else if (activeExerciseIndex > index) {
      setActiveExerciseIndex(activeExerciseIndex - 1);
    }
  };

  const currentExercise = exercises[activeExerciseIndex] || createExerciseTemplate();

  return (
    <ExerciseContext.Provider
      value={{
        exercises,
        activeExerciseIndex,
        setExercises,
        setActiveExerciseIndex,
        addExercise,
        deleteExercise,
        currentExercise,
        loading,
        saveState,
      }}
    >
      {children}
    </ExerciseContext.Provider>
  );
}

export function useExercise() {
  const context = useContext(ExerciseContext);
  if (context === undefined) {
    throw new Error('useExercise must be used within an ExerciseProvider');
  }
  return context;
}
