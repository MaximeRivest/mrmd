/**
 * Keybinding Manager - Runtime Dispatcher
 *
 * This module handles keybinding dispatch at runtime.
 * - Keybinding definitions are in keybindings.js (static)
 * - Handlers are registered by individual modules
 * - Context determines which bindings are active
 *
 * Usage:
 *   import { KeybindingManager } from './keybinding-manager.js';
 *
 *   // Register a handler
 *   KeybindingManager.handle('format:bold', (e, binding) => {
 *       editor.wrapSelection('**', '**');
 *   });
 *
 *   // Initialize (call once at app startup)
 *   KeybindingManager.init();
 */

import { KEYBINDINGS, IS_MAC, getBindingDisplayString } from './keybindings.js';

// Registered handlers: Map<bindingId, handlerFn>
const handlers = new Map();

// Context providers: Map<contextName, () => boolean>
const contextProviders = new Map();

// Double-tap tracking
const doubleTap = {
    lastKey: null,
    lastTime: 0,
};

// Hold/charge tracking: Map<bindingId, { startTime, animFrame }>
const holdState = new Map();

// Callbacks for hold events
const holdCallbacks = {
    onHoldStart: null,
    onHoldProgress: null,
    onHoldComplete: null,
    onHoldCancel: null,
};

// Global state
let initialized = false;
let enabled = true;

/**
 * Register a handler for a keybinding
 * @param {string} id - Keybinding ID from keybindings.js
 * @param {Function} handler - Handler function (e, binding) => void
 */
export function handle(id, handler) {
    if (!KEYBINDINGS[id]) {
        console.warn(`[KeybindingManager] Unknown binding ID: ${id}`);
    }
    handlers.set(id, handler);
}

/**
 * Unregister a handler
 * @param {string} id - Keybinding ID
 */
export function unhandle(id) {
    handlers.delete(id);
}

/**
 * Register a context provider
 * Context providers return true when their context is active
 * @param {string} name - Context name (e.g., 'editor', 'ai-menu')
 * @param {Function} provider - () => boolean
 */
export function registerContext(name, provider) {
    contextProviders.set(name, provider);
}

/**
 * Unregister a context provider
 * @param {string} name - Context name
 */
export function unregisterContext(name) {
    contextProviders.delete(name);
}

/**
 * Check if a context is currently active
 * @param {string} name - Context name
 * @returns {boolean}
 */
export function isContextActive(name) {
    if (name === 'global') return true;

    const provider = contextProviders.get(name);
    if (provider) {
        return provider();
    }

    // Handle composite contexts
    if (name === 'not-editor') {
        return !isContextActive('editor');
    }
    if (name === 'quick-picker-browse') {
        return isContextActive('quick-picker') && isContextActive('quick-picker-browse-mode');
    }
    if (name === 'quick-picker-browse-empty') {
        return isContextActive('quick-picker-browse') && isContextActive('quick-picker-input-empty');
    }

    return false;
}

/**
 * Find matching bindings for a key event
 * @param {KeyboardEvent} e
 * @returns {Array<{id: string, binding: object}>}
 */
function findMatchingBindings(e) {
    const matches = [];
    const key = e.key.toLowerCase();
    const hasMod = IS_MAC ? e.metaKey : e.ctrlKey;

    for (const [id, binding] of Object.entries(KEYBINDINGS)) {
        // Skip double-tap bindings in normal matching
        if (binding.double) continue;

        // Check key match
        const bindingKey = binding.key.toLowerCase();
        if (bindingKey !== key && binding.key !== e.key) continue;

        // Check modifiers
        if (!!binding.mod !== hasMod) continue;
        if (!!binding.shift !== e.shiftKey) continue;
        if (!!binding.alt !== e.altKey) continue;

        // Check context
        if (!isContextActive(binding.context || 'global')) continue;

        matches.push({ id, binding });
    }

    // Sort by context specificity (more specific contexts first)
    const contextPriority = {
        'ai-menu': 10,
        'quick-picker-browse-empty': 9,
        'quick-picker-browse': 8,
        'quick-picker': 7,
        'editor': 5,
        'not-editor': 4,
        'global': 0,
    };

    matches.sort((a, b) => {
        const aPriority = contextPriority[a.binding.context] || 0;
        const bPriority = contextPriority[b.binding.context] || 0;
        return bPriority - aPriority;
    });

    return matches;
}

/**
 * Check for double-tap bindings
 * @param {KeyboardEvent} e
 * @returns {{id: string, binding: object} | null}
 */
function checkDoubleTap(e) {
    const key = e.key.toLowerCase();
    const now = Date.now();

    // Find double-tap bindings for this key
    for (const [id, binding] of Object.entries(KEYBINDINGS)) {
        if (!binding.double) continue;
        if (binding.key.toLowerCase() !== key) continue;
        if (!isContextActive(binding.context || 'global')) continue;

        const timeout = binding.doubleTimeout || 300;

        if (doubleTap.lastKey === key && (now - doubleTap.lastTime) < timeout) {
            // Double-tap detected!
            doubleTap.lastKey = null;
            doubleTap.lastTime = 0;
            return { id, binding };
        }

        // First tap - record it
        doubleTap.lastKey = key;
        doubleTap.lastTime = now;
        return { id: null, binding, pending: true };
    }

    // Clear double-tap state for other keys
    if (doubleTap.lastKey && doubleTap.lastKey !== key) {
        doubleTap.lastKey = null;
        doubleTap.lastTime = 0;
    }

    return null;
}

/**
 * Start hold tracking for a binding
 * @param {string} id - Binding ID
 * @param {object} binding - Binding config
 * @param {KeyboardEvent} e - Original event
 */
function startHold(id, binding, e) {
    if (holdState.has(id)) return;

    const state = {
        startTime: Date.now(),
        animFrame: null,
        binding,
        event: e,
    };

    holdState.set(id, state);

    if (holdCallbacks.onHoldStart) {
        holdCallbacks.onHoldStart(id, binding);
    }

    // Start animation loop for progress
    const animate = () => {
        if (!holdState.has(id)) return;
        const elapsed = Date.now() - state.startTime;
        if (holdCallbacks.onHoldProgress) {
            holdCallbacks.onHoldProgress(id, binding, elapsed);
        }
        state.animFrame = requestAnimationFrame(animate);
    };
    animate();
}

/**
 * Complete hold and execute
 * @param {string} id - Binding ID
 */
function completeHold(id) {
    const state = holdState.get(id);
    if (!state) return;

    if (state.animFrame) {
        cancelAnimationFrame(state.animFrame);
    }

    const elapsed = Date.now() - state.startTime;
    holdState.delete(id);

    if (holdCallbacks.onHoldComplete) {
        holdCallbacks.onHoldComplete(id, state.binding, elapsed);
    }

    // Execute the handler
    const handler = handlers.get(id);
    if (handler) {
        handler(state.event, state.binding, { holdDuration: elapsed });
    }
}

/**
 * Cancel hold without executing
 * @param {string} id - Binding ID
 */
function cancelHold(id) {
    const state = holdState.get(id);
    if (!state) return;

    if (state.animFrame) {
        cancelAnimationFrame(state.animFrame);
    }
    holdState.delete(id);

    if (holdCallbacks.onHoldCancel) {
        holdCallbacks.onHoldCancel(id, state.binding);
    }
}

/**
 * Cancel all active holds
 */
function cancelAllHolds() {
    for (const id of holdState.keys()) {
        cancelHold(id);
    }
}

/**
 * Main keydown handler
 * @param {KeyboardEvent} e
 */
function handleKeydown(e) {
    if (!enabled) return;

    // Skip if in input/textarea (unless it's our editor or a special context is active)
    const target = e.target;
    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
    const isEditor = target.closest('.cm-editor, .code-block-editor, [contenteditable="true"]');

    // For non-editor inputs, only handle:
    // 1. Shortcuts with modifiers (global shortcuts)
    // 2. Navigation keys in modal contexts (quick-picker, ai-menu)
    if (isInput && !isEditor) {
        const hasMod = IS_MAC ? e.metaKey : e.ctrlKey;
        const isModalContext = isContextActive('quick-picker') || isContextActive('ai-menu');
        const isNavKey = ['Escape', 'Enter', 'ArrowUp', 'ArrowDown', 'Tab', 'Backspace'].includes(e.key);

        if (!hasMod && !isModalContext) return;
        if (!hasMod && isModalContext && !isNavKey) return;
    }

    // Check double-tap first
    const doubleTapResult = checkDoubleTap(e);
    if (doubleTapResult) {
        if (doubleTapResult.pending) {
            // First tap - prevent default if there's a selection to preserve
            // The handler will be called on second tap
            e.preventDefault();
            return;
        }
        if (doubleTapResult.id) {
            e.preventDefault();
            e.stopPropagation();
            const handler = handlers.get(doubleTapResult.id);
            if (handler) {
                handler(e, doubleTapResult.binding);
            }
            return;
        }
    }

    // Find matching bindings
    const matches = findMatchingBindings(e);
    if (matches.length === 0) return;

    // Take the highest priority match
    const { id, binding } = matches[0];

    // Handle hold bindings
    if (binding.hold && !e.repeat) {
        e.preventDefault();
        e.stopPropagation();
        startHold(id, binding, e);
        return;
    }

    // Skip key repeats for hold bindings
    if (binding.hold && e.repeat) {
        e.preventDefault();
        e.stopPropagation();
        return;
    }

    // Execute handler
    const handler = handlers.get(id);
    if (handler) {
        if (binding.preventDefault !== false) {
            e.preventDefault();
        }
        e.stopPropagation();
        handler(e, binding);
    }
}

/**
 * Main keyup handler (for hold completion)
 * @param {KeyboardEvent} e
 */
function handleKeyup(e) {
    if (!enabled) return;

    const key = e.key.toLowerCase();

    // Check if any active holds match this key
    for (const [id, state] of holdState) {
        if (state.binding.key.toLowerCase() === key) {
            e.preventDefault();
            e.stopPropagation();
            completeHold(id);
            return;
        }
    }
}

/**
 * Initialize the keybinding manager
 * Call this once at app startup
 */
export function init() {
    if (initialized) {
        console.warn('[KeybindingManager] Already initialized');
        return;
    }

    // Use capture phase to intercept before other handlers
    document.addEventListener('keydown', handleKeydown, true);
    document.addEventListener('keyup', handleKeyup, true);

    // Cancel holds on blur
    window.addEventListener('blur', cancelAllHolds);

    initialized = true;
    console.log('[KeybindingManager] Initialized');
}

/**
 * Destroy the keybinding manager
 */
export function destroy() {
    document.removeEventListener('keydown', handleKeydown, true);
    document.removeEventListener('keyup', handleKeyup, true);
    window.removeEventListener('blur', cancelAllHolds);
    handlers.clear();
    contextProviders.clear();
    cancelAllHolds();
    initialized = false;
}

/**
 * Enable or disable keybinding handling
 * @param {boolean} value
 */
export function setEnabled(value) {
    enabled = value;
}

/**
 * Check if keybindings are enabled
 * @returns {boolean}
 */
export function isEnabled() {
    return enabled;
}

/**
 * Set hold event callbacks
 * @param {object} callbacks
 */
export function setHoldCallbacks(callbacks) {
    Object.assign(holdCallbacks, callbacks);
}

/**
 * Get all registered handlers
 * @returns {Map<string, Function>}
 */
export function getHandlers() {
    return new Map(handlers);
}

/**
 * Get the display string for a binding
 * @param {string} id - Binding ID
 * @returns {string}
 */
export function getDisplayString(id) {
    return getBindingDisplayString(id);
}

/**
 * Manually trigger a keybinding by ID
 * @param {string} id - Binding ID
 * @param {object} options - Optional parameters to pass to handler
 */
export function trigger(id, options = {}) {
    const binding = KEYBINDINGS[id];
    if (!binding) {
        console.warn(`[KeybindingManager] Unknown binding: ${id}`);
        return;
    }

    const handler = handlers.get(id);
    if (handler) {
        handler(null, binding, options);
    }
}

/**
 * Clear double-tap state
 * Call this when context changes significantly
 */
export function clearDoubleTapState() {
    doubleTap.lastKey = null;
    doubleTap.lastTime = 0;
}

/**
 * Insert a character at cursor if double-tap first key wasn't followed by second
 * This is called by modules that capture the first keypress
 * @param {string} char - Character to insert
 */
export function insertPendingChar(char) {
    const activeEl = document.activeElement;

    // Handle textarea/input
    if (activeEl && (activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT')) {
        const start = activeEl.selectionStart;
        const end = activeEl.selectionEnd;
        const value = activeEl.value;
        activeEl.value = value.slice(0, start) + char + value.slice(end);
        activeEl.selectionStart = activeEl.selectionEnd = start + 1;
        activeEl.dispatchEvent(new Event('input', { bubbles: true }));
        return;
    }

    // Handle contenteditable
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const textNode = document.createTextNode(char);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);

        const editableEl = range.startContainer.parentElement?.closest('[contenteditable="true"]');
        if (editableEl) {
            editableEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }
}

// Export singleton-style API
export const KeybindingManager = {
    init,
    destroy,
    handle,
    unhandle,
    registerContext,
    unregisterContext,
    isContextActive,
    setEnabled,
    isEnabled,
    setHoldCallbacks,
    getHandlers,
    getDisplayString,
    trigger,
    clearDoubleTapState,
    insertPendingChar,
};

export default KeybindingManager;
