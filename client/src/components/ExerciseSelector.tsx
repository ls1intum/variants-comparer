import { useState, useRef, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import type { ExerciseConfig } from '@/types';

type ExerciseSelectorProps = {
  exercises: ExerciseConfig[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onAdd: (name: string) => void;
  onDelete: (index: number) => void;
};

export function ExerciseSelector({ exercises, activeIndex, onSelect, onAdd, onDelete }: ExerciseSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [newExerciseName, setNewExerciseName] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentExercise = exercises[activeIndex];
  const displayName = currentExercise?.exerciseName || `Exercise ${activeIndex + 1}`;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setIsAdding(false);
        setNewExerciseName('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (isAdding && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isAdding]);

  const handleSelect = (index: number) => {
    onSelect(index);
    setIsOpen(false);
  };

  const handleAddClick = () => {
    setIsAdding(true);
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newExerciseName.trim()) {
      onAdd(newExerciseName.trim());
      setNewExerciseName('');
      setIsAdding(false);
      setIsOpen(false);
    }
  };

  const handleDelete = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (exercises.length > 1) {
      onDelete(index);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex h-9 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-w-[200px]"
      >
        <span className="truncate">{displayName}</span>
        <svg
          className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 z-50 mt-1 w-full min-w-[280px] rounded-md border border-border bg-card shadow-lg">
          <div className="max-h-[300px] overflow-y-auto p-1">
            {exercises.map((ex, idx) => (
              <div
                key={idx}
                onClick={() => handleSelect(idx)}
                className={`flex items-center justify-between gap-2 rounded-sm px-3 py-2 text-sm cursor-pointer transition-colors ${
                  idx === activeIndex
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-accent hover:text-accent-foreground'
                }`}
              >
                <span className="truncate flex-1">{ex.exerciseName || `Exercise ${idx + 1}`}</span>
                {exercises.length > 1 && (
                  <button
                    onClick={(e) => handleDelete(idx, e)}
                    className="hover:text-destructive p-1"
                    title="Delete exercise"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="border-t border-border p-2">
            {!isAdding ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleAddClick}
                className="w-full"
              >
                + Add New Exercise
              </Button>
            ) : (
              <form onSubmit={handleAddSubmit} className="space-y-2">
                <Input
                  ref={inputRef}
                  type="text"
                  placeholder="Exercise name..."
                  value={newExerciseName}
                  onChange={(e) => setNewExerciseName(e.target.value)}
                  className="h-8"
                />
                <div className="flex gap-2">
                  <Button type="submit" size="sm" className="flex-1">
                    Add
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setIsAdding(false);
                      setNewExerciseName('');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
