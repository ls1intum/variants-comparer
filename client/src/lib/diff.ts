import { diffChars, diffLines } from 'diff';
import type { LineDiff, VariantComparison } from '@/types';

export function computeLineDiff(baseContent: string, variantContent: string): LineDiff[] {
  const changes = diffLines(baseContent, variantContent);
  
  const result: LineDiff[] = [];

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

export function calculateSimilarity(content1: string, content2: string): number {
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

export type AlignedCell = { text: string; lineNo: number; type: LineDiff['type'] };

export type AlignedRow = {
  id: string;
  base?: { text: string; lineNo: number; changed: boolean };
  cells: Array<AlignedCell | undefined>;
};

/*  Align all variants on the base lines: variant insertions become gap rows,
    padded to the longest insertion across variants  */
export function alignVariants(baseContent: string, variants: VariantComparison[]): AlignedRow[] {
  /*  Split like computeLineDiff: no line for the final newline  */
  const baseLines = baseContent === '' ? [] : baseContent.replace(/\n$/, '').split('\n');
  const n = baseLines.length;

  /*  Per variant: insertions before base line k (k = n: trailing) and the cell at base line k  */
  const slots = variants.map((variant) => {
    const inserts: string[][] = Array.from({ length: n + 1 }, () => []);
    const atBase: Array<{ text?: string; type: LineDiff['type'] }> = baseLines.map((line) => ({ text: line, type: 'equal' }));
    if (variant.lineDiff.length > 0) {
      let k = 0;
      for (const d of variant.lineDiff) {
        if (d.type === 'add')
          inserts[Math.min(k, n)]!.push(d.variant ?? '');
        else if (k < n)
          atBase[k++] = { text: d.type === 'remove' ? undefined : d.variant ?? '', type: d.type };
      }
    }
    return { inserts, atBase };
  });

  const rows: AlignedRow[] = [];
  const lineNos = variants.map(() => 0);
  let baseLineNo = 0;
  for (let k = 0; k <= n; k++) {
    const gap = Math.max(0, ...slots.map((s) => s.inserts[k]!.length));
    for (let g = 0; g < gap; g++)
      rows.push({ id: `gap-${k}-${g}`, cells: slots.map((s, v) => {
        const text = s.inserts[k]![g];
        return text === undefined ? undefined : { text, lineNo: ++lineNos[v]!, type: 'add' };
      }) });
    if (k === n)
      break;
    const cells = slots.map((s, v) => {
      const cell = s.atBase[k]!;
      return cell.text === undefined ? undefined : { text: cell.text, lineNo: ++lineNos[v]!, type: cell.type };
    });
    rows.push({
      id: `base-${k}`,
      base: { text: baseLines[k]!, lineNo: ++baseLineNo, changed: slots.some((s) => s.atBase[k]!.type !== 'equal') },
      cells,
    });
  }
  return rows;
}
