/**
 * Editor Keybindings - Code execution and editor-specific shortcuts
 *
 * This module registers keybinding handlers for editor operations that should
 * work across all modes (Study, Codes, Compact). It's part of the shared
 * service layer.
 *
 * Features:
 * - Cross-project detection: prompts before running code in a different project
 * - Status updates during execution
 *
 * Usage:
 *   import { initEditorKeybindings } from '/core/editor-keybindings.js';
 *   initEditorKeybindings({ getEditor: () => editor, statusEl });
 */

import { KeybindingManager } from './keybinding-manager.js';
import * as SessionState from './session-state.js';
import * as ProjectStatus from './project-status.js';

// Dynamic getter for current editor - ensures we always get the live reference
let getEditorFn = null;
let statusEl = null;
let initialized = false;

/**
 * Get the current editor instance
 * Uses the dynamic getter to avoid stale references
 */
function getEditor() {
    const editor = getEditorFn?.();
    if (!editor) {
        console.warn('[EditorKeybindings] No editor available');
    }
    return editor;
}

/**
 * Initialize editor keybindings
 * @param {Object} options - Configuration options
 * @param {Function} options.getEditor - Function that returns the current MrmdEditor instance
 * @param {HTMLElement} options.statusEl - Status element for execution feedback
 */
export function initEditorKeybindings(options = {}) {
    // Always update the getter - this allows re-initialization with new editor
    getEditorFn = options.getEditor || null;
    statusEl = options.statusEl || null;

    if (initialized) {
        return;
    }

    // Ensure KeybindingManager is initialized
    KeybindingManager.init();

    // Register the 'editor' context if not already registered
    KeybindingManager.registerContext('editor', () => {
        const active = document.activeElement;
        return !!active?.closest('.cm-editor, .code-block-editor, [contenteditable="true"]');
    });

    // Register code execution handlers
    KeybindingManager.handle('code:run-cell', handleRunCell);
    KeybindingManager.handle('code:run-cell-advance', handleRunCellAdvance);
    KeybindingManager.handle('code:run-all', handleRunAll);

    initialized = true;
}

/**
 * Update the status element reference
 * @param {HTMLElement} el - Status element for execution feedback
 */
export function setStatusElement(el) {
    statusEl = el;
}

/**
 * Clean up keybinding handlers
 */
export function destroyEditorKeybindings() {
    KeybindingManager.unhandle('code:run-cell');
    KeybindingManager.unhandle('code:run-cell-advance');
    KeybindingManager.unhandle('code:run-all');
    getEditorFn = null;
    statusEl = null;
    initialized = false;
}

// ============================================================================
// Internal Handlers
// ============================================================================

/**
 * Update status display
 */
function setStatus(text) {
    if (statusEl) {
        statusEl.textContent = text;
    }
}

/**
 * Check if we can run code, handling cross-project scenarios
 * Returns true if we should proceed with execution
 */
async function checkCrossProjectExecution() {
    const currentFile = SessionState.getActiveFilePath();
    if (!currentFile) return true; // No file, proceed

    const { matches, fileProject, activeProject } = ProjectStatus.checkProjectMatch(currentFile);

    if (matches) {
        return true; // Same project, proceed
    }

    // File belongs to a different project - prompt user
    if (fileProject) {
        const shouldSwitch = await ProjectStatus.showSwitchProjectPrompt(fileProject, activeProject);

        if (shouldSwitch) {
            // Switch to the file's project
            setStatus('switching project...');
            try {
                // Use openProject with skipWarning=true since user already confirmed
                const result = await SessionState.openProject(fileProject.projectPath, true, { skipFileOpen: true });
                if (result.success) {
                    setStatus('ready');
                    return true; // Now can proceed
                } else {
                    console.error('[EditorKeybindings] Project switch failed:', result.message);
                    setStatus('switch failed');
                    return false;
                }
            } catch (err) {
                console.error('[EditorKeybindings] Failed to switch project:', err);
                setStatus('switch failed');
                return false;
            }
        } else {
            // User cancelled
            return false;
        }
    }

    return true; // No file project tracked, proceed
}

/**
 * Handle Ctrl+Enter - Run current code block
 * Uses the same code path as clicking the run button directly.
 * Checks for cross-project execution first.
 */
async function handleRunCell() {
    const editor = getEditor();
    if (!editor) return;

    // Check cross-project before running
    const canRun = await checkCrossProjectExecution();
    if (!canRun) return;

    if (editor.runCodeBlockAtCursor()) {
        setStatus('running...');
        // Status will be updated by execution completion
    }
}

/**
 * Handle Shift+Enter - Run current block and advance to next
 * If no next block exists, create a new code cell after the output block
 * so user can continue coding while execution runs.
 *
 * Uses AST-based block detection (not DOM) to reliably find blocks
 * regardless of scroll position or viewport.
 * Checks for cross-project execution first.
 */
async function handleRunCellAdvance() {
    const editor = getEditor();
    if (!editor) return;

    // Check cross-project before running
    const canRun = await checkCrossProjectExecution();
    if (!canRun) return;

    const cursor = editor.getCursor();
    const blocks = editor.getCodeBlocks();

    if (blocks.length === 0) return;

    // Find current block: the one containing cursor, or the last one before cursor
    let currentIndex = -1;
    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        if (cursor >= block.start && cursor <= block.end) {
            // Cursor is inside this block
            currentIndex = i;
            break;
        }
        if (block.end < cursor) {
            // Block is before cursor - might be current if no block contains cursor
            currentIndex = i;
        }
    }

    if (currentIndex < 0) return;

    const currentBlock = blocks[currentIndex];
    const nextBlock = blocks[currentIndex + 1];

    if (nextBlock) {
        // Next block exists - move cursor there, then run current
        editor.setCursor(nextBlock.codeStart);
        editor.focus();

        setStatus('running...');
        editor.runCodeBlock(currentIndex);
        return;
    }

    // No next block - run current and create a new one after it
    setStatus('running...');
    editor.runCodeBlock(currentIndex);

    // Wait for the output block to be inserted, then create new cell
    setTimeout(() => {
        const doc = editor.getDoc();

        // Find where to insert (after output block if it exists)
        const afterCodeBlock = doc.slice(currentBlock.end);
        const outputMatch = afterCodeBlock.match(/^\n```output:[^\n]*\n[\s\S]*?```/);

        let insertPos;
        if (outputMatch) {
            insertPos = currentBlock.end + outputMatch[0].length;
        } else {
            insertPos = currentBlock.end;
        }

        // Create new code cell with same language
        const newCell = `\n\n\`\`\`${currentBlock.language}\n\n\`\`\`\n`;

        editor.view.dispatch({
            changes: { from: insertPos, insert: newCell }
        });

        // Position cursor inside the new cell (after ```lang\n)
        const cursorPos = insertPos + 2 + 3 + currentBlock.language.length + 1;
        editor.setCursor(cursorPos);
        editor.focus();
    }, 50);
}

/**
 * Handle Ctrl+Shift+Enter - Run all code blocks
 * Uses the same code path as clicking run buttons directly.
 * Checks for cross-project execution first.
 */
async function handleRunAll() {
    const editor = getEditor();
    if (!editor) return;

    // Check cross-project before running
    const canRun = await checkCrossProjectExecution();
    if (!canRun) return;

    setStatus('running all...');
    try {
        const count = await editor.runAllCodeBlocks();
        if (count > 0) {
            setStatus('ready');
        }
    } catch (err) {
        console.error('[EditorKeybindings] Execution failed:', err);
        setStatus('error');
    }
}

export default {
    initEditorKeybindings,
    setStatusElement,
    destroyEditorKeybindings,
};
