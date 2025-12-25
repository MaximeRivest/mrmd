/**
 * Editor Keybindings - Code execution and editor-specific shortcuts
 *
 * This module registers keybinding handlers for editor operations that should
 * work across all modes (Study, Codes, Compact). It's part of the shared
 * service layer.
 *
 * Usage:
 *   import { initEditorKeybindings } from '/core/editor-keybindings.js';
 *   initEditorKeybindings({ getEditor: () => editor, statusEl });
 */

import { KeybindingManager } from './keybinding-manager.js';

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
 * Find the code block containing the cursor
 */
function getCurrentCodeBlockIndex(editor) {
    if (!editor) return -1;

    const cursor = editor.getCursor();
    const blocks = editor.getCodeBlocks();

    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        if (cursor >= block.start && cursor <= block.end) {
            return i;
        }
    }
    return -1;
}

/**
 * Update status display
 */
function setStatus(text) {
    if (statusEl) {
        statusEl.textContent = text;
    }
}

/**
 * Handle Ctrl+Enter - Run current code block
 */
async function handleRunCell() {
    const editor = getEditor();
    if (!editor) return;

    const blockIndex = getCurrentCodeBlockIndex(editor);
    if (blockIndex >= 0) {
        setStatus('running...');
        try {
            await editor.runCodeBlock(blockIndex);
            setStatus('ready');
        } catch (err) {
            console.error('[EditorKeybindings] Execution failed:', err);
            setStatus('error');
        }
    }
}

/**
 * Handle Shift+Enter - Run current block and advance to next
 * If no next block exists, create a new code cell after the output block
 * so user can continue coding while execution runs
 */
async function handleRunCellAdvance() {
    const editor = getEditor();
    if (!editor) return;

    const blockIndex = getCurrentCodeBlockIndex(editor);
    if (blockIndex < 0) return;

    const blocks = editor.getCodeBlocks();
    const currentBlock = blocks[blockIndex];
    const currentLang = currentBlock.language || 'python';

    // Check if there's already a next code block
    if (blockIndex + 1 < blocks.length) {
        // Move cursor to next block first, then run execution
        const nextBlock = blocks[blockIndex + 1];
        const doc = editor.getDoc();
        const afterFence = doc.indexOf('\n', nextBlock.start);
        if (afterFence !== -1) {
            editor.setCursor(afterFence + 1);
        } else {
            editor.setCursor(nextBlock.start);
        }
        editor.focus();

        // Run execution in background (don't block user)
        setStatus('running...');
        editor.runCodeBlock(blockIndex)
            .then(() => setStatus('ready'))
            .catch(err => {
                console.error('[EditorKeybindings] Execution failed:', err);
                setStatus('error');
            });
        return;
    }

    // No next block - need to create one after the output block
    setStatus('running...');

    // Start execution - this creates the output block synchronously
    // before the async streaming begins
    const executionPromise = editor.runCodeBlock(blockIndex);

    // The output block is now in the document (sync operation in runBlock)
    // Find where to insert the new code block (after the output block)
    const doc = editor.getDoc();
    const afterCodeBlock = doc.slice(currentBlock.end);

    // Output block format: \n```output:{execId}\n```
    // We need to find the closing ``` of the output block
    const outputMatch = afterCodeBlock.match(/^\n```output:[^\n]*\n```/);

    let insertPos;
    if (outputMatch) {
        // Insert after the output block's closing fence
        insertPos = currentBlock.end + outputMatch[0].length;
    } else {
        // Fallback: insert after code block (shouldn't happen normally)
        insertPos = currentBlock.end;
    }

    // Create new code cell
    const newCell = `\n\n\`\`\`${currentLang}\n\n\`\`\`\n`;

    editor.view.dispatch({
        changes: { from: insertPos, insert: newCell }
    });

    // Position cursor inside the new cell (after opening fence)
    // insertPos + 2 (newlines) + 3 (```) + lang.length + 1 (newline after lang)
    const cursorPos = insertPos + 2 + 3 + currentLang.length + 1;
    editor.setCursor(cursorPos);
    editor.focus();

    // Let execution continue in background
    executionPromise
        .then(() => setStatus('ready'))
        .catch(err => {
            console.error('[EditorKeybindings] Execution failed:', err);
            setStatus('error');
        });
}

/**
 * Handle Ctrl+Shift+Enter - Run all code blocks
 */
async function handleRunAll() {
    const editor = getEditor();
    if (!editor) return;

    const blocks = editor.getCodeBlocks();
    if (blocks.length === 0) return;

    setStatus('running all...');
    try {
        for (let i = 0; i < blocks.length; i++) {
            await editor.runCodeBlock(i);
        }
        setStatus('ready');
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
