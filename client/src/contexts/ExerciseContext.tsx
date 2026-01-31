/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import { API_BASE } from '@/lib/api';
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
  isSaving: boolean;
};

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
    })),
  };
}

export function ExerciseProvider({ children }: { children: ReactNode }) {
  const [exercises, setExercises] = useState<ExerciseConfig[]>([createExerciseTemplate()]);
  const [activeExerciseIndex, setActiveExerciseIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const isInitialMount = useRef(true);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/config`);
        const payload = await response.json();
        if (response.ok && payload?.ok) {
          const multiConfig: MultiExerciseConfig = payload.data;
          if (multiConfig.exercises && multiConfig.exercises.length > 0) {
            setExercises(multiConfig.exercises);
            setActiveExerciseIndex(multiConfig.activeExerciseIndex || 0);
          }
        }
      } catch (error) {
        console.error('Failed to load configuration:', error);
      } finally {
        setLoading(false);
      }
    };

    loadConfig();
  }, []);

  // Save activeExerciseIndex to server when it changes (but not on initial mount)
  // Bug fix: Added debouncing to prevent race conditions when both exercises and activeIndex change
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    
    const timeoutId = setTimeout(async () => {
      setIsSaving(true);
      try {
        // Filter out incomplete file mappings to pass server validation
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
        console.log('Saving active exercise index:', activeExerciseIndex);
        const response = await fetch(`${API_BASE}/api/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const result = await response.json();
        console.log('Save result:', result);
      } catch (error) {
        console.error('Failed to save active exercise index:', error);
      } finally {
        setIsSaving(false);
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
        isSaving,
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
