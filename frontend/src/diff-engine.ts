import * as Diff from 'diff';

export type DiffType = 'added' | 'removed' | 'unchanged' | 'omitted';

export interface DiffPart {
  type: 'added' | 'removed' | 'unchanged';
  value: string;
}

export interface DiffLine {
  type: DiffType;
  content: string;
  parts?: DiffPart[]; // For intra-line highlighting
}

/**
 * Generates a list of diff lines between two strings with context and intra-line highlighting.
 * @param context Number of lines of context to show around changes.
 */
export function generateDiff(oldStr: string, newStr: string, context: number = 3): DiffLine[] {
  const lineChanges = Diff.diffLines(oldStr, newStr);
  const allLines: DiffLine[] = [];

  for (const change of lineChanges) {
    const type: DiffType = change.added ? 'added' : change.removed ? 'removed' : 'unchanged';
    const contentLines = change.value.split('\n');

    if (contentLines.length > 0 && contentLines[contentLines.length - 1] === '') {
      contentLines.pop();
    }

    for (const line of contentLines) {
      allLines.push({ type, content: line });
    }
  }

  // Intra-line highlighting: look for removed line followed by added line
  for (let i = 0; i < allLines.length - 1; i++) {
    const current = allLines[i];
    const next = allLines[i + 1];

    if (current.type === 'removed' && next.type === 'added') {
      const charChanges = Diff.diffChars(current.content, next.content);
      
      // We only apply intra-line highlighting if the change isn't too massive
      // (otherwise it's just a completely different line)
      let addedCount = 0;
      let removedCount = 0;
      for (const part of charChanges) {
        if (part.added) addedCount += part.value.length;
        if (part.removed) removedCount += part.value.length;
      }

      const totalLen = Math.max(current.content.length, next.content.length);
      if ((addedCount + removedCount) < totalLen * 1.5) {
        current.parts = charChanges.filter(p => !p.added).map(p => ({
          type: p.removed ? 'removed' : 'unchanged',
          value: p.value
        }));
        next.parts = charChanges.filter(p => !p.removed).map(p => ({
          type: p.added ? 'added' : 'unchanged',
          value: p.value
        }));
      }
    }
  }

  if (context < 0) return allLines;

  const result: DiffLine[] = [];
  const mask = new Array(allLines.length).fill(false);

  // Mark changed lines and their context
  for (let i = 0; i < allLines.length; i++) {
    if (allLines[i].type === 'added' || allLines[i].type === 'removed') {
      for (let j = Math.max(0, i - context); j <= Math.min(allLines.length - 1, i + context); j++) {
        mask[j] = true;
      }
    }
  }

  // Build final diff with context gaps
  let omittedCount = 0;
  for (let i = 0; i < allLines.length; i++) {
    if (mask[i]) {
      if (omittedCount > 0) {
        result.push({ type: 'omitted', content: `... ${omittedCount} lines omitted ...` });
        omittedCount = 0;
      }
      result.push(allLines[i]);
    } else {
      omittedCount++;
    }
  }

  // Handle trailing omitted lines
  if (omittedCount > 0) {
    result.push({ type: 'omitted', content: `... ${omittedCount} lines omitted ...` });
  }

  return result;
}
