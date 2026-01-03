/**
 * Keybindings - Single Source of Truth
 *
 * This file contains ALL keybinding definitions for the MRMD editor.
 *
 * ## Architecture
 * - This file: WHAT keybindings exist (static, declarative)
 * - keybinding-manager.js: HOW they're dispatched (runtime)
 * - Individual modules: Register handlers via KeybindingManager.handle()
 *
 * ## Adding a new keybinding
 * 1. Add entry to KEYBINDINGS below
 * 2. In your module, call: KeybindingManager.handle('your:id', handlerFn)
 *
 * ## Contexts
 * - 'global': Active everywhere unless a modal/overlay is open
 * - 'editor': Only when cursor is in the editor
 * - 'editor-or-global': Editor if in editor, otherwise global (for Ctrl+B)
 * - 'quick-picker': Only when quick picker is open
 * - 'ai-menu': Only when AI spell menu is open
 *
 * ## Special Binding Types
 * - double: true → Double-tap detection (e.g., 'jj')
 * - hold: true → Charge-on-hold behavior
 * - sequence: true → Part of a key sequence
 */

// Platform detection (shared)
export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
export const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl';
export const MOD_KEY_TEXT = IS_MAC ? 'Cmd' : 'Ctrl';

/**
 * All keybindings in the application.
 *
 * Schema:
 * {
 *   key: string,           // The key (lowercase for letters, 'ArrowUp', 'Enter', etc.)
 *   mod?: boolean,         // Requires Ctrl/Cmd
 *   shift?: boolean,       // Requires Shift
 *   alt?: boolean,         // Requires Alt/Option
 *   context?: string,      // When this binding is active
 *   label: string,         // Human-readable label
 *   description?: string,  // Longer description for help
 *   double?: boolean,      // Double-tap detection
 *   hold?: boolean,        // Charge-on-hold behavior
 *   preventDefault?: boolean, // Whether to prevent default (default: true)
 * }
 */
export const KEYBINDINGS = {
    // =========================================================================
    // FILE OPERATIONS (Global)
    // =========================================================================
    'file:save': {
        key: 's',
        mod: true,
        context: 'global',
        label: 'Save',
        description: 'Save the current file',
    },
    'file:save-as': {
        key: 's',
        mod: true,
        shift: true,
        context: 'global',
        label: 'Save As',
        description: 'Save file with a new name',
    },
    'file:new': {
        key: 'n',
        mod: true,
        context: 'global',
        label: 'New File',
        description: 'Create a new file',
    },
    'file:close': {
        key: 'w',
        mod: true,
        context: 'global',
        label: 'Close File',
        description: 'Close the current file',
    },

    // =========================================================================
    // NAVIGATION (Global)
    // =========================================================================
    // Universal picker: ⌘P opens it, prefixes switch modes:
    // (none) = files, / = browse, > = commands, ? = content search
    'nav:picker': {
        key: 'p',
        mod: true,
        context: 'global',
        label: 'Open',
        description: 'Open universal picker (find files, commands, browse)',
    },
    // ⌘⇧P opens picker with > prefix (commands mode)
    'nav:quick-open-commands': {
        key: 'p',
        mod: true,
        shift: true,
        context: 'global',
        label: 'Commands',
        description: 'Open command palette (> prefix in picker)',
    },
    // ⌘O opens picker with / prefix (browse mode)
    'nav:browse': {
        key: 'o',
        mod: true,
        context: 'global',
        label: 'Browse',
        description: 'Open file browser (/ prefix in picker)',
    },
    // ⌘⇧F opens picker with ? prefix (content search)
    'nav:search-content': {
        key: 'f',
        mod: true,
        shift: true,
        context: 'global',
        label: 'Search in Files',
        description: 'Search content across files (? prefix in picker)',
    },
    'nav:toggle-toc': {
        key: 'o',
        mod: true,
        shift: true,
        context: 'global',
        label: 'Toggle Outline',
        description: 'Toggle inline table of contents',
    },

    // =========================================================================
    // UI CONTROLS (Global)
    // =========================================================================
    'ui:toggle-terminal': {
        key: '`',
        mod: true,
        context: 'global',
        label: 'Toggle Terminal',
        description: 'Show/hide terminal',
    },
    // Note: Ctrl+B is handled by format:bold in editor context
    // In non-editor context, Ctrl+B is reserved for future use
    'ui:settings': {
        key: ',',
        mod: true,
        context: 'global',
        label: 'Settings',
        description: 'Open settings',
    },

    // =========================================================================
    // TEXT FORMATTING (Editor context)
    // =========================================================================
    'format:bold': {
        key: 'b',
        mod: true,
        context: 'editor',
        label: 'Bold',
        description: 'Make selected text bold',
        markdown: ['**', '**'],
    },
    'format:italic': {
        key: 'i',
        mod: true,
        context: 'editor',
        label: 'Italic',
        description: 'Make selected text italic',
        markdown: ['*', '*'],
    },
    'format:code': {
        key: 'e',
        mod: true,
        context: 'editor',
        label: 'Code',
        description: 'Format selected text as code',
        markdown: ['`', '`'],
    },
    'format:strikethrough': {
        key: 's',
        mod: true,
        shift: true,
        context: 'editor',
        label: 'Strikethrough',
        description: 'Add strikethrough to selected text',
        markdown: ['~~', '~~'],
    },
    'format:link': {
        key: 'k',
        mod: true,
        context: 'editor',
        label: 'Link',
        description: 'Insert or edit link',
    },

    // =========================================================================
    // CODE EXECUTION (Editor context)
    // =========================================================================
    'code:run-cell': {
        key: 'Enter',
        mod: true,
        context: 'editor',
        label: 'Run Cell',
        description: 'Execute current code cell',
    },
    'code:run-cell-advance': {
        key: 'Enter',
        shift: true,
        context: 'editor',
        label: 'Run & Advance',
        description: 'Execute cell and move to next',
    },
    'code:run-all': {
        key: 'Enter',
        mod: true,
        shift: true,
        context: 'editor',
        label: 'Run All Cells',
        description: 'Execute all code cells',
    },
    'code:interrupt': {
        key: 'Escape',
        context: 'editor',
        label: 'Interrupt',
        description: 'Cancel execution',
        preventDefault: false, // Let escape bubble for other uses
    },

    // =========================================================================
    // AI SPELLS (Editor context + AI Menu context)
    // =========================================================================
    'ai:open-menu': {
        key: 'j',
        double: true,
        doubleTimeout: 300,
        context: 'editor',
        label: 'AI Spells',
        description: 'Open AI spell menu (double-tap j)',
    },
    'ai:close-menu': {
        key: 'Escape',
        context: 'ai-menu',
        label: 'Close',
        description: 'Close AI spell menu',
    },
    'ai:toggle-scope': {
        key: 'Tab',
        context: 'ai-menu',
        label: 'Toggle Scope',
        description: 'Switch between line and section scope',
    },
    'ai:navigate-up': {
        key: 'ArrowUp',
        context: 'ai-menu',
        label: 'Previous',
        description: 'Navigate to previous spell',
    },
    'ai:navigate-down': {
        key: 'ArrowDown',
        context: 'ai-menu',
        label: 'Next',
        description: 'Navigate to next spell',
    },
    'ai:execute-selected': {
        key: 'Enter',
        context: 'ai-menu',
        label: 'Execute',
        description: 'Execute highlighted spell',
    },

    // AI Spell shortcuts (when menu is open)
    // These use hold-to-charge for juice level selection
    'ai:spell:ask': {
        key: 'a',
        context: 'ai-menu',
        hold: true,
        label: 'Ask Claude',
        description: 'Ask Claude anything about the selection',
        spellId: 'askClaude',
    },
    'ai:spell:finish-line': {
        key: 'j',
        context: 'ai-menu',
        hold: true,
        label: 'Finish Line',
        description: 'Complete the current line',
        spellId: 'finishLine',
    },
    'ai:spell:finish-section': {
        key: 'k',
        context: 'ai-menu',
        hold: true,
        label: 'Finish Section',
        description: 'Complete the paragraph or code block',
        spellId: 'finishSection',
    },
    'ai:spell:fix-finish': {
        key: 'f',
        context: 'ai-menu',
        hold: true,
        label: 'Fix + Finish',
        description: 'Correct errors, then continue',
        spellId: 'correctAndFinish',
    },
    'ai:spell:grammar': {
        key: 'g',
        context: 'ai-menu',
        hold: true,
        label: 'Grammar',
        description: 'Fix spelling and grammar',
        spellId: 'fixGrammar',
        spellContext: 'text',
    },
    'ai:spell:transcription': {
        key: 't',
        context: 'ai-menu',
        hold: true,
        label: 'Transcription',
        description: 'Clean up speech-to-text',
        spellId: 'fixTranscription',
        spellContext: 'text',
    },
    'ai:spell:synonyms': {
        key: 's',
        context: 'ai-menu',
        hold: true,
        label: 'Synonyms',
        description: 'Find alternative words',
        spellId: 'synonyms',
        spellContext: 'text',
    },
    'ai:spell:reformat': {
        key: 'm',
        context: 'ai-menu',
        hold: true,
        label: 'Reformat',
        description: 'Clean up markdown formatting',
        spellId: 'reformatMarkdown',
        spellContext: 'text',
    },
    'ai:spell:document': {
        key: 'd',
        context: 'ai-menu',
        hold: true,
        label: 'Document',
        description: 'Add documentation/docstring',
        spellId: 'documentCode',
        spellContext: 'code',
    },
    'ai:spell:complete': {
        key: 'c',
        context: 'ai-menu',
        hold: true,
        label: 'Complete',
        description: 'Complete code block',
        spellId: 'completeCode',
        spellContext: 'code',
    },
    'ai:spell:type-hints': {
        key: 'h',
        context: 'ai-menu',
        hold: true,
        label: 'Type Hints',
        description: 'Add type annotations',
        spellId: 'addTypeHints',
        spellContext: 'code',
    },
    'ai:spell:names': {
        key: 'v',
        context: 'ai-menu',
        hold: true,
        label: 'Better Names',
        description: 'Improve variable/function names',
        spellId: 'improveNames',
        spellContext: 'code',
    },
    'ai:spell:explain': {
        key: 'e',
        context: 'ai-menu',
        hold: true,
        label: 'Explain',
        description: 'Add inline comments',
        spellId: 'explainCode',
        spellContext: 'code',
    },
    'ai:spell:refactor': {
        key: 'r',
        context: 'ai-menu',
        hold: true,
        label: 'Refactor',
        description: 'Simplify and clean up code',
        spellId: 'refactorCode',
        spellContext: 'code',
    },
    'ai:spell:format': {
        key: 'p',
        context: 'ai-menu',
        hold: true,
        label: 'Format',
        description: 'Format and prettify code',
        spellId: 'formatCode',
        spellContext: 'code',
    },

    // =========================================================================
    // QUICK PICKER (Quick Picker context)
    // =========================================================================
    'picker:close': {
        key: 'Escape',
        context: 'quick-picker',
        label: 'Close',
        description: 'Close quick picker',
    },
    'picker:select': {
        key: 'Enter',
        context: 'quick-picker',
        label: 'Select',
        description: 'Select highlighted item',
    },
    'picker:open-project': {
        key: 'Enter',
        mod: true,
        context: 'quick-picker-browse',
        label: 'Open as Project',
        description: 'Open directory as project',
    },
    'picker:navigate-up': {
        key: 'ArrowUp',
        context: 'quick-picker',
        label: 'Up',
        description: 'Navigate up',
    },
    'picker:navigate-down': {
        key: 'ArrowDown',
        context: 'quick-picker',
        label: 'Down',
        description: 'Navigate down',
    },
    'picker:next-mode': {
        key: 'Tab',
        context: 'quick-picker',
        label: 'Next Mode',
        description: 'Switch to next mode',
    },
    'picker:prev-mode': {
        key: 'Tab',
        shift: true,
        context: 'quick-picker',
        label: 'Previous Mode',
        description: 'Switch to previous mode',
    },
    'picker:go-up': {
        key: 'Backspace',
        context: 'quick-picker-browse-empty',
        label: 'Go Up',
        description: 'Navigate to parent directory',
    },
};

/**
 * Get keybindings grouped by context
 */
export function getBindingsByContext(context) {
    return Object.entries(KEYBINDINGS)
        .filter(([_, b]) => b.context === context || b.context === 'global')
        .reduce((acc, [id, binding]) => {
            acc[id] = binding;
            return acc;
        }, {});
}

/**
 * Get all keybindings as a flat array with IDs
 */
export function getAllBindings() {
    return Object.entries(KEYBINDINGS).map(([id, binding]) => ({
        id,
        ...binding,
    }));
}

/**
 * Get AI spell bindings
 */
export function getAiSpellBindings() {
    return Object.entries(KEYBINDINGS)
        .filter(([id]) => id.startsWith('ai:spell:'))
        .map(([id, binding]) => ({
            id,
            ...binding,
        }));
}

/**
 * Get the display string for a keybinding
 * @param {string} id - Keybinding ID
 * @returns {string} - e.g., "⌘+B" or "Ctrl+Shift+P"
 */
export function getBindingDisplayString(id) {
    const binding = KEYBINDINGS[id];
    if (!binding) return '';

    if (binding.double) {
        return `${binding.key}${binding.key}`;
    }

    const parts = [];
    if (binding.mod) parts.push(MOD_KEY);
    if (binding.shift) parts.push('Shift');
    if (binding.alt) parts.push(IS_MAC ? 'Option' : 'Alt');
    parts.push(binding.key.length === 1 ? binding.key.toUpperCase() : binding.key);

    return parts.join('+');
}

/**
 * Find potential conflicts in keybindings
 * @returns {Array} - Array of conflict descriptions
 */
export function findConflicts() {
    const byKey = new Map();
    const conflicts = [];

    for (const [id, binding] of Object.entries(KEYBINDINGS)) {
        const keyStr = `${binding.mod ? 'mod+' : ''}${binding.shift ? 'shift+' : ''}${binding.alt ? 'alt+' : ''}${binding.key}`;

        if (!byKey.has(keyStr)) {
            byKey.set(keyStr, []);
        }
        byKey.get(keyStr).push({ id, binding });
    }

    for (const [keyStr, bindings] of byKey) {
        if (bindings.length > 1) {
            // Check if contexts overlap
            const contexts = bindings.map(b => b.binding.context);
            const hasGlobal = contexts.includes('global');
            const uniqueContexts = new Set(contexts);

            if (hasGlobal || uniqueContexts.size < bindings.length) {
                conflicts.push({
                    key: keyStr,
                    bindings: bindings.map(b => ({ id: b.id, context: b.binding.context })),
                });
            }
        }
    }

    return conflicts;
}

export default KEYBINDINGS;
