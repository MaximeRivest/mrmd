/**
 * Inline TOC - Jony Ive's Vision
 *
 * "The document IS the interface. The TOC isn't a panel beside the document.
 * The document BECOMES the TOC. Headings elevate. Body recedes."
 *
 * Implementation: A seamless overlay that feels like the document transforming.
 * - Same position as the editor content
 * - Clean typographic list of headings
 * - Fuzzy search by typing
 * - Feels like zooming out, not opening a panel
 */

import { extractHeadings } from './toc-panel.js';

let editorRef = null;
let containerEl = null;
let isActive = false;
let headings = [];
let focusedIndex = 0;
let filterText = '';
let filteredIndices = []; // Indices into headings array that match filter

// Elements
let overlayEl = null;
let filterIndicatorEl = null;

/**
 * Initialize inline TOC with editor reference
 * @param {Object} options
 * @param {Object} options.editor - Rich editor instance
 * @param {HTMLElement} options.container - Main container element
 */
export function init(options = {}) {
    editorRef = options.editor;
    containerEl = options.container || document.body;
}

/**
 * Set the editor reference
 * @param {Object} editor
 */
export function setEditor(editor) {
    editorRef = editor;
}

/**
 * Check if structure mode is active
 * @returns {boolean}
 */
export function isStructureModeActive() {
    return isActive;
}

/**
 * Toggle structure mode
 */
export function toggle() {
    if (isActive) {
        deactivate();
    } else {
        activate();
    }
}

/**
 * Activate structure mode - show the TOC overlay
 */
export function activate() {
    if (isActive) return;
    if (!editorRef) {
        console.warn('[InlineTOC] No editor reference');
        return;
    }

    // Get current markdown and extract headings
    const markdown = typeof editorRef.getContent === 'function'
        ? editorRef.getContent()
        : '';

    headings = extractHeadings(markdown);

    if (headings.length === 0) {
        showNoHeadingsMessage();
        return;
    }

    isActive = true;
    filterText = '';
    filteredIndices = headings.map((_, i) => i); // All visible initially

    // Find the heading closest to current position
    const currentLineIndex = getCurrentLineIndex();
    focusedIndex = findClosestHeadingIndex(currentLineIndex);

    // Create the overlay
    createOverlay();

    // Add keyboard listener
    document.addEventListener('keydown', handleKeydown, true);

    // Focus the current heading
    focusHeading(focusedIndex);
}

/**
 * Deactivate structure mode - close the overlay
 */
export function deactivate() {
    if (!isActive) return;

    isActive = false;
    filterText = '';

    // Remove keyboard listener
    document.removeEventListener('keydown', handleKeydown, true);

    // Animate out and remove overlay
    if (overlayEl) {
        overlayEl.classList.add('structure-mode-exiting');
        setTimeout(() => {
            overlayEl?.remove();
            overlayEl = null;
        }, 150);
    }

    // Remove filter indicator and hint
    filterIndicatorEl?.remove();
    filterIndicatorEl = null;
    containerEl?.querySelector('.structure-mode-hint')?.remove();

    // Focus back on editor
    editorRef?.focus?.();
}

/**
 * Create the TOC overlay - a clean list of headings
 */
function createOverlay() {
    // Remove any existing overlay
    overlayEl?.remove();

    // Create overlay container
    overlayEl = document.createElement('div');
    overlayEl.className = 'structure-mode-overlay';

    // Create heading list
    const list = document.createElement('div');
    list.className = 'structure-mode-list';

    // Find min level for indentation calculation
    const minLevel = Math.min(...headings.map(h => h.level));

    headings.forEach((heading, index) => {
        const item = document.createElement('button');
        item.className = `structure-mode-item structure-mode-level-${heading.level}`;
        item.dataset.index = index;
        item.dataset.line = heading.lineNumber;

        const indent = heading.level - minLevel;
        item.style.setProperty('--indent', indent);

        // Heading text
        const text = document.createElement('span');
        text.className = 'structure-mode-text';
        text.textContent = heading.text;
        item.appendChild(text);

        // Line number (subtle)
        const lineNum = document.createElement('span');
        lineNum.className = 'structure-mode-line-num';
        lineNum.textContent = heading.lineNumber + 1;
        item.appendChild(lineNum);

        // Click handler
        item.addEventListener('click', () => navigateToHeading(index));

        // Hover to preview
        item.addEventListener('mouseenter', () => {
            focusedIndex = index;
            updateFocusedItem();
        });

        list.appendChild(item);
    });

    overlayEl.appendChild(list);

    // Create filter indicator
    filterIndicatorEl = document.createElement('div');
    filterIndicatorEl.className = 'structure-mode-filter';
    overlayEl.appendChild(filterIndicatorEl);

    // Click outside to close
    overlayEl.addEventListener('click', (e) => {
        if (e.target === overlayEl) {
            deactivate();
        }
    });

    // Add to container
    containerEl.appendChild(overlayEl);

    // Create hint bar
    createHint();

    // Trigger enter animation
    requestAnimationFrame(() => {
        overlayEl?.classList.add('structure-mode-active');
    });
}

/**
 * Create keyboard hint
 */
function createHint() {
    // Remove existing hint
    const existing = containerEl.querySelector('.structure-mode-hint');
    existing?.remove();

    const hint = document.createElement('div');
    hint.className = 'structure-mode-hint';
    hint.innerHTML = '<kbd>↑</kbd><kbd>↓</kbd> navigate · <kbd>Enter</kbd> go · <kbd>Esc</kbd> close · <span class="hint-type">type to filter</span>';
    containerEl.appendChild(hint);
}

/**
 * Update the focused item visual state
 */
function updateFocusedItem() {
    if (!overlayEl) return;

    const items = overlayEl.querySelectorAll('.structure-mode-item');
    items.forEach((item, i) => {
        const index = parseInt(item.dataset.index, 10);
        if (index === focusedIndex) {
            item.classList.add('focused');
            item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else {
            item.classList.remove('focused');
        }
    });
}

/**
 * Update the filter and re-apply visibility
 */
function updateFilter() {
    if (!overlayEl) return;

    const query = filterText.toLowerCase();

    // Update filter indicator
    if (filterIndicatorEl) {
        if (filterText) {
            filterIndicatorEl.textContent = filterText;
            filterIndicatorEl.classList.add('visible');
        } else {
            filterIndicatorEl.textContent = '';
            filterIndicatorEl.classList.remove('visible');
        }
    }

    // Filter headings (fuzzy match)
    if (query) {
        filteredIndices = headings
            .map((h, i) => ({ h, i }))
            .filter(({ h }) => fuzzyMatch(h.text.toLowerCase(), query))
            .map(({ i }) => i);
    } else {
        filteredIndices = headings.map((_, i) => i);
    }

    // Update visibility of items in overlay
    const filteredSet = new Set(filteredIndices);
    const items = overlayEl.querySelectorAll('.structure-mode-item');

    items.forEach(item => {
        const index = parseInt(item.dataset.index, 10);
        if (filteredSet.has(index)) {
            item.classList.remove('filtered-out');
        } else {
            item.classList.add('filtered-out');
        }
    });

    // Adjust focus if current focused is filtered out
    if (filteredIndices.length > 0 && !filteredSet.has(focusedIndex)) {
        focusedIndex = filteredIndices[0];
        updateFocusedItem();
    }
}

/**
 * Simple fuzzy match - characters must appear in order
 * @param {string} text - Text to search in
 * @param {string} query - Query to match
 * @returns {boolean}
 */
function fuzzyMatch(text, query) {
    let ti = 0;
    let qi = 0;

    while (ti < text.length && qi < query.length) {
        if (text[ti] === query[qi]) {
            qi++;
        }
        ti++;
    }

    return qi === query.length;
}

/**
 * Navigate to a heading and exit structure mode
 * @param {number} index - Heading index
 */
function navigateToHeading(index) {
    const heading = headings[index];
    if (!heading) return;

    const lineNumber = heading.lineNumber;

    // Exit structure mode first
    deactivate();

    // Then scroll to the heading
    setTimeout(() => {
        if (typeof editorRef.scrollToLine === 'function') {
            editorRef.scrollToLine(lineNumber);
        } else if (typeof editorRef.goToLine === 'function') {
            editorRef.goToLine(lineNumber);
        } else {
            const editorEl = editorRef?.editorEl || editorRef?.container;
            const lineEl = editorEl?.querySelector(`[data-line="${lineNumber}"]`);
            if (lineEl) {
                lineEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }

        // Brief highlight
        highlightLine(lineNumber);
    }, 50);
}

/**
 * Focus a specific heading
 * @param {number} index - Index into headings array
 */
function focusHeading(index) {
    if (index < 0 || index >= headings.length) return;
    focusedIndex = index;
    updateFocusedItem();
}

/**
 * Handle keyboard navigation
 * @param {KeyboardEvent} e
 */
function handleKeydown(e) {
    if (!isActive) return;

    // Always handle Escape
    if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        deactivate();
        return;
    }

    // Navigation keys
    if (e.key === 'ArrowDown' || (e.key === 'j' && !filterText)) {
        e.preventDefault();
        e.stopPropagation();
        navigateInFilteredList(1);
        return;
    }

    if (e.key === 'ArrowUp' || (e.key === 'k' && !filterText)) {
        e.preventDefault();
        e.stopPropagation();
        navigateInFilteredList(-1);
        return;
    }

    if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (filteredIndices.length > 0) {
            navigateToHeading(focusedIndex);
        }
        return;
    }

    if (e.key === 'Home') {
        e.preventDefault();
        e.stopPropagation();
        if (filteredIndices.length > 0) {
            focusHeading(filteredIndices[0]);
        }
        return;
    }

    if (e.key === 'End') {
        e.preventDefault();
        e.stopPropagation();
        if (filteredIndices.length > 0) {
            focusHeading(filteredIndices[filteredIndices.length - 1]);
        }
        return;
    }

    // Backspace - remove from filter
    if (e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        if (filterText.length > 0) {
            filterText = filterText.slice(0, -1);
            updateFilter();
        }
        return;
    }

    // Typing - add to filter (letters, numbers, space)
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        filterText += e.key;
        updateFilter();
        return;
    }
}

/**
 * Navigate within the filtered list
 * @param {number} direction - 1 for next, -1 for previous
 */
function navigateInFilteredList(direction) {
    if (filteredIndices.length === 0) return;

    // Find current position in filtered list
    const currentFilteredPos = filteredIndices.indexOf(focusedIndex);

    let newFilteredPos;
    if (currentFilteredPos === -1) {
        // Not in filtered list, go to first or last
        newFilteredPos = direction > 0 ? 0 : filteredIndices.length - 1;
    } else {
        newFilteredPos = currentFilteredPos + direction;
        // Clamp to bounds
        newFilteredPos = Math.max(0, Math.min(filteredIndices.length - 1, newFilteredPos));
    }

    focusHeading(filteredIndices[newFilteredPos]);
}

/**
 * Show brief message when no headings found
 */
function showNoHeadingsMessage() {
    const msg = document.createElement('div');
    msg.className = 'structure-mode-no-headings';
    msg.textContent = 'No headings in document';

    containerEl.appendChild(msg);

    setTimeout(() => {
        msg.classList.add('structure-mode-no-headings-exit');
        setTimeout(() => msg.remove(), 200);
    }, 1500);
}

/**
 * Briefly highlight a line after navigation
 * @param {number} lineNumber
 */
function highlightLine(lineNumber) {
    const editorEl = editorRef?.editorEl || editorRef?.container;
    const lineEl = editorEl?.querySelector(`[data-line="${lineNumber}"]`);
    if (!lineEl) return;

    lineEl.classList.add('structure-mode-just-navigated');
    setTimeout(() => {
        lineEl.classList.remove('structure-mode-just-navigated');
    }, 1000);
}

/**
 * Get the current line index from editor cursor or scroll position
 * @returns {number} Current line index (0-based)
 */
function getCurrentLineIndex() {
    if (editorRef) {
        if (typeof editorRef.editingLineIndex === 'number' && editorRef.editingLineIndex >= 0) {
            return editorRef.editingLineIndex;
        }
        if (typeof editorRef.getCursorLine === 'function') {
            const line = editorRef.getCursorLine();
            if (typeof line === 'number' && line >= 0) return line;
        }
        if (typeof editorRef.cursorLine === 'number' && editorRef.cursorLine >= 0) {
            return editorRef.cursorLine;
        }
    }

    // Fallback: find first visible line
    const editorEl = editorRef?.editorEl || editorRef?.container;
    const scrollContainer = editorEl?.closest('.editor-content')
        || editorEl?.parentElement;

    if (scrollContainer && editorEl) {
        const containerRect = scrollContainer.getBoundingClientRect();
        const lineEls = editorEl.querySelectorAll('[data-line]');

        for (const lineEl of lineEls) {
            const rect = lineEl.getBoundingClientRect();
            if (rect.top >= containerRect.top - 50) {
                const lineIndex = parseInt(lineEl.dataset.line, 10);
                if (!isNaN(lineIndex)) return lineIndex;
            }
        }
    }

    return 0;
}

/**
 * Find the heading index closest to (and at or before) the given line
 * @param {number} lineIndex - Current line in the document
 * @returns {number} Index into headings array
 */
function findClosestHeadingIndex(lineIndex) {
    if (headings.length === 0) return 0;

    let closestIndex = 0;
    for (let i = 0; i < headings.length; i++) {
        if (headings[i].lineNumber <= lineIndex) {
            closestIndex = i;
        } else {
            break;
        }
    }
    return closestIndex;
}

/**
 * Cleanup
 */
export function destroy() {
    deactivate();
    editorRef = null;
    containerEl = null;
    headings = [];
}

export default {
    init,
    setEditor,
    toggle,
    activate,
    deactivate,
    isStructureModeActive,
    destroy
};
