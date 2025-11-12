import { NavLink } from 'react-router-dom';
import { useState } from 'react';

import { cn } from '@/lib/utils';
import { useExercise } from '@/contexts/ExerciseContext';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ExerciseSelector } from '@/components/ExerciseSelector';

const navItems = [
  { to: '/', label: 'Configure' },
  { to: '/compare', label: 'Compare' },
];

export function SiteHeader() {
  const { exercises, activeExerciseIndex, setActiveExerciseIndex, addExercise, deleteExercise } = useExercise();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [exerciseToDelete, setExerciseToDelete] = useState<number | null>(null);

  const handleDeleteClick = (index: number) => {
    if (exercises.length <= 1) return;
    setExerciseToDelete(index);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (exerciseToDelete !== null) {
      deleteExercise(exerciseToDelete);
      setExerciseToDelete(null);
    }
  };

  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-4">
          <img src="/logo_comparer.png" alt="Exam Variants Comparer" className="h-20 w-auto" />
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Exam variants comparer</p>
            <p className="text-lg font-semibold">Variant workspace</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          {/* Exercise Selector */}
          <ExerciseSelector
            exercises={exercises}
            activeIndex={activeExerciseIndex}
            onSelect={setActiveExerciseIndex}
            onAdd={addExercise}
            onDelete={handleDeleteClick}
          />

          {/* Navigation */}
          <nav className="flex items-center gap-2 border-l pl-4">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:text-foreground',
                  )
                }
                end={item.to === '/'}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </div>

      <ConfirmDialog
        isOpen={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={confirmDelete}
        title="Delete Exercise"
        description="Are you sure you want to delete this exercise?"
        confirmText="Delete"
        cancelText="Cancel"
        variant="destructive"
      >
        <p className="text-sm text-muted-foreground">
          {exerciseToDelete !== null && (
            <>
              You are about to delete <span className="font-semibold">{exercises[exerciseToDelete]?.exerciseName || `Exercise ${exerciseToDelete + 1}`}</span>.
              This action cannot be undone.
            </>
          )}
        </p>
      </ConfirmDialog>
    </header>
  );
}
