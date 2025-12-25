/**
 * Script execution manager for HTML cells
 *
 * Prevents re-execution of scripts when widgets are recreated
 * (e.g., on viewport scroll). Each execution ID tracks which
 * scripts have already run.
 */

/** Map of execId -> Set of script content hashes */
const cellScripts = new Map<string, Set<string>>();

/**
 * Simple hash function for script content
 */
function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) - hash + content.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

/**
 * Execute scripts for a cell, skipping any that have already run
 *
 * @param execId - Unique execution ID for this cell
 * @param scripts - Array of script contents to execute
 * @param context - The element or shadow root to use as `this` context
 */
export function executeScripts(
  execId: string,
  scripts: string[],
  context: Element | ShadowRoot
): void {
  if (!cellScripts.has(execId)) {
    cellScripts.set(execId, new Set());
  }
  const executed = cellScripts.get(execId)!;

  for (const script of scripts) {
    const trimmed = script.trim();
    if (!trimmed) continue;

    const hash = hashContent(trimmed);
    if (executed.has(hash)) continue;
    executed.add(hash);

    try {
      // Create function and execute with context as `this`
      const fn = new Function(trimmed);
      fn.call(context);
    } catch (error) {
      console.error(`[HTML Cell ${execId}] Script error:`, error);
    }
  }
}

/**
 * Clear tracked scripts for a cell (call before re-execution)
 */
export function clearCellScripts(execId: string): void {
  cellScripts.delete(execId);
}

/**
 * Clear all tracked scripts
 */
export function clearAllScripts(): void {
  cellScripts.clear();
}

/**
 * Check if a cell has any executed scripts
 */
export function hasExecutedScripts(execId: string): boolean {
  return cellScripts.has(execId) && cellScripts.get(execId)!.size > 0;
}
